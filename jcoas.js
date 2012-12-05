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

var INSTRUCTIONS = {
	"SET" : { "code": 0x01, "length": 2 },
	"ADD" : { "code": 0x02, "length": 2 },
	"SUB" : { "code": 0x03, "length": 2 },
	"MUL" : { "code": 0x04, "length": 2 },
	"MLI" : { "code": 0x05, "length": 2 },
	"DIV" : { "code": 0x06, "length": 2 },
	"DVI" : { "code": 0x07, "length": 2 },
	"MOD" : { "code": 0x08, "length": 2 },
	"MDI" : { "code": 0x09, "length": 2 },
	"AND" : { "code": 0x0a, "length": 2 },
	"BOR" : { "code": 0x0b, "length": 2 },
	"XOR" : { "code": 0x0c, "length": 2 },
	"SHR" : { "code": 0x0d, "length": 2 },
	"ASR" : { "code": 0x0e, "length": 2 },
	"SHL" : { "code": 0x0f, "length": 2 },
	"IFB" : { "code": 0x10, "length": 2 },
	"IFC" : { "code": 0x11, "length": 2 },
	"IFE" : { "code": 0x12, "length": 2 },
	"IFN" : { "code": 0x13, "length": 2 },
	"IFG" : { "code": 0x14, "length": 2 },
	"IFA" : { "code": 0x15, "length": 2 },
	"IFL" : { "code": 0x16, "length": 2 },
	"IFU" : { "code": 0x17, "length": 2 },
	"ADX" : { "code": 0x1a, "length": 2 },
	"SBX" : { "code": 0x1b, "length": 2 },
	"STI" : { "code": 0x1e, "length": 2 },
	"STD" : { "code": 0x1f, "length": 2 },
	"JSR" : { "code": 0x01, "length": 1 },
	"INT" : { "code": 0x08, "length": 1 },
	"IAG" : { "code": 0x09, "length": 1 },
	"IAS" : { "code": 0x0a, "length": 1 },
	"RFI" : { "code": 0x0b, "length": 1 },
	"IAQ" : { "code": 0x0c, "length": 1 },
	"HWN" : { "code": 0x10, "length": 1 },
	"HWQ" : { "code": 0x11, "length": 1 },
	"HWI" : { "code": 0x12, "length": 1 }
	};

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
		return element.reduce(function(list, e) {
			return list.concat(walk(e, callback));
		}, []);
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
			element.value = walk(element.value, callback);
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
		case 'equate':
		case 'indirect':
			element.value = walk(element.value, callback);
			break ;
		case 'proc':
		case 'macro':
			element.contents = walk(element.contents, callback);
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
 * Relabeler
 */

var suffixIndex = 0;
function relabel(tree) {
	var suffix = "$"+(suffixIndex++);

	return walk(tree, function(element) {
		if (element.name && element.name[0] === "_") {
			element.name += suffix;
		}
	});
}

/**
 * Balancing stage
 */

function balance(tree) {
	return walk(tree, function (node) {
		if (node.type !== "unordered") {
			return ;
		}

		// Collapse chain into a couple lists for ease of use
		var values = [],
			operations = [],
			index = 0,
			end, sortie, first, index;

		do {
			node.operation.index = index++;
			operations.push(node.operation);
			values.push(node.left);

			node = node.right;
		} while(node.type === "unordered");
		values.push(node);
		
		// Sort operations in order of their priority
		operations.sort(function(a, b) {
			if (b.priority > a.priority) return 1;
			else if(b.priority < a.priority) return -1;

			return a.index - b.index;
		});
		
		while (operations.length) {
			first = operations[0];
			index = first.index;

			// Find a reorderable group
			end = 0;
			while (end < operations.length && 
				operations[end].operation === first.operation &&
				(operations[end].index - index) === end) { 
				end++; 
			}

			function foldUp(index) {
				var operation = operations[index],
					left = values[operation.index],
					right = values[operation.index+1];

				operations.splice(index, 1);
				values.splice(operation.index, 2, {
					type: "binary",
					operation: (index > 0 && first.reorder === 'partial') ? first.inverse : first.operation,
					column: left.column,
					line: left.line,
					left: left,
					right: right
				});

				operations.forEach(function (o) {
					if (o.index >= operation.index) { o.index--; }
				});
			}

			// Group registers together (when allowed)
			if (first.reorder) {
				sortie = values.slice(index+1,index+end+1);
				if (values[0].type === 'register') {
					sortie.sort(function (a, b) { return a.type === 'register' ? -1 : 1; });
				} else {
					sortie.sort(function (a, b) { return a.type !== 'register' ? -1 : 1; });
				}
				values.splice.apply(values,[index+1,sortie.length].concat(sortie));

				// Fold up based on the type (prioritize non-register math)
				while(end) {
					var best = 0,
						i;
					
					for (i = 1; i < end; i++) {
						if (values[index+i].type === 'register' &&
							values[index+i+1].type === 'register')
						{
							continue ;
						}
						best = i;
						break ;
					}
					
					foldUp(best);
					end--;
				}
			} else {
				while(end--) { foldUp(0); }
			}
		}

		return values[0];
	});
}

/**
 * Mark expressions as integer
 */

function mark(tree) {
	return walk(tree, function (element) {
		switch(element.type) {
		case 'indirect':
		case 'register':
			element.integer = false;
			break ;
		case 'identifier':
		case 'number':
			element.integer = true;
			break ;
		case 'binary':
			element.integer = element.right.integer && element.left.integer;
			break ;
		case 'unary':
			element.integer = element.operation !== '&' && element.value.integer;
			break ;
		}
	});
}

/**
 * Replace .macro and .equ 
 */
function define(tree, set) {
	return walk(tree, function(element) {
		if (element.type === 'identifier' ||
			set[element.name]) {
			return deepClone(set[element.name]);
		}
	})
}

function replace(tree) {
	var equates = {},
		macros = {};

	return tree.reduce(function (list, element) {
		var macro, args;

		switch (element.type) {
			// Explode located macros
			case 'operation':
				macro = macros[element.name];

				if (!macro) { return list.concat(define(element, equates)); }

				if (macro.parameters.length !== element.arguments.length) {
					throw new Error("Macro " + macro.name + " argument mismatch");
				}

				args = {};
				macro.parameters.forEach(function(name, i){
					args[name] = define(element.arguments[i], equates);
				});

				return list.concat(
					define(
						define(deepClone(macro.contents), args), 
						equates)
					);

			// Replacements are removed
			case 'proc':
				return list.concat(replace(relabel(element.contents)));
			case 'equate':
				if (equates[element.name]) throw new Error("Cannot redefine " + element.name);
				equates[element.name] = element.value;
				return list;
			case 'macro':
				if (equates[element.name]) throw new Error("Cannot redefine " + element.name);
				element.contents = replace(relabel(element.contents));
				macros[element.name] = element;
				return list;

			// Simply modify contents
			default:
				return list.concat(define(element, equates));
		}
	}, []);
}

/**
 * Flatten stage
 */

function flatten(tree) {
	return walk(tree, function (element) {
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
			if (element.value.type === 'number') {
				return {
					type: 'number',
					value: ({
						"-": function(v) { return -v; },
						"~": function(v) { return ~v; },
						"&": function(v) { return v; }
					}[element.operation])(element.value.value)
				};
			}

			break ;
		}
	});
}

/**
 * Verification stage
 */

function verify(tree) {
	var detected = [],
		defined = [];

	walk(tree, function(element) {
		switch (element.type) {
		case 'operation':
			var opcode = INSTRUCTIONS[element.name];

			if (!opcode) {
				throw new Error("Unrecognized opcode: " + element.name);
			}

			if (opcode.length !== element.arguments.length) {
				throw new Error("Argument count mismatch");
			}

			element.arguments.slice(0,opcode.length - 1).forEach(function (element) {
				if (element.type !== 'register' && element.type !== 'indirect') {
					throw new Error("Left-hand argument must be an address or register");
				}
			});
			break ;
		case 'org':
		case 'align':
		case 'bss':
			if (element.value.type !== 'number') {
				throw new Error("Cannot use label / register relative tags in "+element.type);
			}
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
}

function identifiers(tree) {
	var unresolved = 0;

	walk(tree, function(element) {
		if (element.identifier) { unresolved++; }
	});

	return unresolved;
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
	var estimates = {};
	balance(tree);			// Order expression stage
	tree = replace(tree);	// Replace macros and equates
	mark(tree);				// Mark expressions which will resolve to an integer at compile time
	verify(tree);			// Run some sanity checks

	// TODO: BREAK DOWN COMPLEX INSTRUCTIONS

	// Until all our expressions have been resolved
	while (identifiers(tree) > 0) {
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
		define(tree, keys);
		flatten(tree);
	}

	//console.log(JSON.stringify(tree,null,4));
	process.exit(-1);

	return data(tree);
}

var parsed = options._.reduce(function (list, f) {
		return list.concat(global.parser.parse(fs.readFileSync(f, "utf8")));
	}, []);

compile(parsed);