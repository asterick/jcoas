#!/usr/bin/env node

var pegjs = require("pegjs"),
	fs = require("fs"),
	_ = require("underscore"),
	optimist = require("optimist")
		.usage("Usage: $0 [assembly files]")
		.describe("o", "Output resource")
		.alias("o", "output");

var options = optimist.argv;

if (options._.length < 1) {
	optimist.showHelp();
	process.exit(-1);
}

global.parser = pegjs.buildParser(
	fs.readFileSync("coas.peg", "utf8"), 
	{trackLineAndColumn: true});

/**
 * Deep copy object
 */
function deepClone(obj) {
	if (Array.isArray(obj)) { return obj.map(deepClone); }
	if (obj === null) { return null; }

	switch (typeof obj) {
		case 'object':
			return _.reduce(obj, function (memo, v, k) {
				memo[k] = deepClone(v);
				return memo;
			}, {});
		case 'function':
		case 'number':
		case 'string':
		case 'boolean':
		case 'undefined':
			return obj;
	}
}

function walk(element, callback) {
	if (Array.isArray(element)) {
		return element.map(function(e) { return walk(e, callback); });
	}

	switch (element.type) {
		case 'unordered':
			// This is a special case, due to the fact that it should be processed in reverse order
			var e = callback(element) || element;
			if (e !== element) { return walk(e, callback); }

			e.left = walk(e.left, callback);
			e.right = walk(e.right, callback);
			return e;
		case 'unary':
		case 'paren':
			element.term = walk(element.term, callback);
			break ;
		case 'binary':
			element.right = walk(element.right, callback);
			element.left = walk(element.left, callback);
			break ;
		case 'operation':
		case 'data':
			element.arguments = walk(element.arguments, callback);
			break ;
		case 'align':
		case 'bss':
		case 'org':
			element.value = walk(element.value, callback);
			break ;
		case 'register':
		case 'identifier':
		case 'number':
		case 'string':
		case 'label':
			break ;
		default:
			throw "UNHANDLED ELEMENT:" + JSON.stringify(element);
	}

	return callback(element) || element;
}

/**
 * Balancing stage
 */

function balance(tree) {
	walk(tree, function (node) {
		if (node.type !== "unordered") {
			return ;
		}

		// Collapse chain into a couple lists for ease of use
		var values = [],
			operations = [],
			index = 0;

		do {
			node.operation.index = index++;
			operations.push(node.operation);
			values.push(node.left);

			node = node.right;
		} while(node.type === "unordered");
		values.push(node);
		
		// Sort operations in order of their priority
		operations.sort(function(a, b) { return b.priority - a.priority; });

		var start = 0, 
			end;

		while (start < operations.length) {
			var end = start;

			while (end < operations.length && operations[start].operation === operations[end].operation) {
				end++;
			}

			switch(operations[start].reorder) {
			case 'partial':
				start++;
			case 'full':
				var sorted = _.sortBy(values.slice(start, end+1),'weight');
				values.splice.apply(values, [start, (end-start+1)].concat(sorted));
				start = end;
			}
		}

		// ... and then collapse value tree into binary operations
		operations.forEach(function(o, i) {
			var index = o.index;
			operations.slice(i+1).forEach(function(o) {
				if(index < o.index) { o.index-- }
			});
			values.splice(index, 2, {
				line: o.line,
				column: o.column,
				type: "binary",
				operation: o.operation,
				left: values[index],
				right: values[index+1]
			})
		});

		return values[0];
	});
}

/**
 * Replace .macro and .equ 
 */
function replace(tree, set) {
	return walk(tree, function(element) {
		if (element.type === 'identifier' ||
			set[element.name]) {
			return deepClone(set[element.name]);
		}
	})
}

function replacementStage(tree) {
	var equates = {},
		macros = {};

	return tree.reduce(function (list, element) {
		var macro, args;

		switch (element.type) {
			// Explode located macros
			case 'operation':
				macro = macros[element.name];

				if (!macro) { return list.concat(replace(element, equates)); }

				if (macro.parameters.length !== element.arguments.length) {
					throw new Error("Macro " + macro.name + " argument mismatch");
				}

				args = {};
				macro.parameters.forEach(function(name, i){
					args[name] = replace(element.arguments[i], equates);
				});

				return list.concat(
					replace(
						replace(deepClone(macro.contents), args), 
						equates)
					);

			// Replacements are removed
			case 'equate':
				equates[element.name] = element.value;
				return list;
			case 'macro':
				element.contents = replacementStage(element.contents);
				macros[element.name] = element;
				return list;

			// Simply modify contents
			default:
				return list.concat(replace(element, equates));
		}
	}, []);
}

/**
 * Flatten stage
 */

function flatten(tree) {
	walk(tree, function (element) {
		switch (element.type) {
		case 'string':
			throw new Error("Strings are not allowed in " + element.type + "blocks");

		case 'binary':
			if (element.left.type === 'number' &&
				element.right.type === 'number') {

				return {
					type: 'number',
					value: ({
						"+": function(l,r) { return l+r; },
						"-": function(l,r) { return l-r; },
						"*": function(l,r) { return l*r; },
						"/": function(l,r) { return l/r; },
						"%": function(l,r) { return l%r; },
						"<<": function(l,r) { return l<<r; },
						">>": function(l,r) { return l>>r; },
						"||": function(l,r) { return l||r; },
						"&&": function(l,r) { return l&&r; },
						"^": function(l,r) { return l^r; },
						"|": function(l,r) { return l|r; },
						"&": function(l,r) { return l&r; },
						"#": function(l,r) { return (l & 0xFF) | ((r&0xFF) << 8); }
					}[element.operation])(element.left.value, element.right.value)
				};

			}

			break ;
		case 'unary':
			if (element.term.type === 'number') {
				return {
					type: 'number',
					value: ({
						"-": function(v) { return -v; },
						"~": function(v) { return ~v; },
						"&": function(v) { return v; }
					}[element.operation])(element.term.value)
				};
			}

			break ;
		}
	});
}

/**
 * Verification stage
 */

function defined(tree) {
	var detected = [],
		defined = [];

	walk(tree, function(element) {
		switch (element.type) {
			case 'org':
			case 'align':
			case 'bss':
			if (element.value.type !== 'number') { throw new Error("Cannot use label / register relative tags in "+element.type);}
				break ;
			case 'identifier':
				detected.push(element.name);
				break ;
			case 'label':
				defined.push(element.name);
				break ;
		}
	});

	var missing = _.difference(detected, defined);
	if(missing.length) {
		throw new Error("Undefined elements error: " + missing.join(", "));
	}
	return detected;
}

function estimate(tree, estimates) {
	// These are our PC ranges
	var minimum = 0,
		maximum = 0;

	function align(number, bias) {
		var offset = number % bias;
		return number + (offset ? bias - offset : 0);
	}

	function instruction(element) {
		// TODO: ESTIMATE SIZE OF THE OPERATION HERE
		// TODO: ACTUAL ESTIMATION HERE
		// TODO: CONVERT TO DATA IF LENGTH IS FIXED

		minimum += element.arguments.length;
		maximum += element.arguments.length;
		return element;
	}


	// TODO: DETERMINE SIZE OF STUFF HERE
	walk(tree, function (element) {
		switch (element.type) {
		case 'org':
			minimum = maximum = element.value.value;
			break ;
		case 'align':
			minimum = align(minimum, element.value.value);
			maximum = align(maximum, element.value.value);
			break ;
		case 'bss':
			minimum += element.value.value;
			maximum += element.value.value;
			break ;
		case 'data':
			minimum += element.arguments.length;
			maximum += element.arguments.length;
			break ;
		case 'label':
			estimates[element.name] = {minimum: minimum, maximum: maximum};
			break ;
		case 'operation':
			return instruction(element);
			break ;
		}
	});
}

function data(tree) {
	var output = [];
	walk(tree, function (element) {
		if(element.type !== 'data') { return ; }
		
		output = output.concat(_.pluck(element.arguments, 'value'));
	});
	return output;
}

function compile(tree) {
	balance(tree);
	flatten(tree);
	console.log(JSON.stringify(tree, null, 4));
	return ;

	var estimates = {};
	tree = replacementStage(tree);

	// Until all our expressions have been resolved
	while (defined(tree).length > 0) {
		estimate(tree, estimates);

		// Locate all our keys that have no-delta in minimums and maximum
		var keys = _.reduce(estimates, function (set, v, k) {
			if (v.minimum === v.maximum) { 
				set[k] = {
					type: 'number',
					value: v.minimum
				};
			}
			return set;
		}, {});

		// Replace and flatten the tree
		replace(tree, keys);
		flatten(tree);
	}

	return data(tree);
}

var parsed = options._.reduce(function (list, f) {
		return list.concat(global.parser.parse(fs.readFileSync(f, "utf8")));
	}, []);

compile(parsed);