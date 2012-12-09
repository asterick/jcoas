"use strict";

function closure(cb) {
	// Node Common.JS Style
	if (module && module.exports) {
		cb.call(module.exports, require);
	} else {
		define(function (require) { return cb.apply({}, require); });
	}
}

closure(function (require) {
	var _ = require("underscore"),
		constants = require("./constants.js"),
		breakdown = require("./breakdown.js").breakdown,
		helper = require("./helper.js");

	/**
	 * Balancing stage
	 */

	function balance(tree) {
		return helper.walk(tree, function (node) {
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
	 * integer: Element contains only compile tile numerical values
	 * volatile: Element uses EX register (dangerous)
	 */

	function mark(tree) {
		return helper.walk(tree, function (element) {
			switch(element.type) {
			case 'indirect':
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
	 * Relabeler
	 */

	var suffixIndex = 0;
	function relabel(tree) {
		var suffix = "$"+(suffixIndex++);

		return helper.walk(tree, function(element) {
			if (element.name && element.name[0] === "_") {
				element.name += suffix;
			}
		});
	}

	/**
	 * Replace .macro and .equ 
	 */
	function define(tree, set) {
		return helper.walk(tree, function(element) {
			// Replace identifiers
			if (element.type === 'identifier' && set[element.name]) {
				return helper.deepClone(set[element.name]);
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
						args[name] = element.arguments[i];
					});

					return list.concat(
						define(
							define(helper.deepClone(macro.contents), args), 
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
		return helper.walk(tree, function (element) {
			switch (element.type) {
			case 'string':
				throw new Error("Strings are not allowed in " + element.type + "blocks");

			case 'paren':
				return element.value;

			case 'binary':
				if (element.operation === '#') {
					// Convert to machine operation here
					return flatten({
						type: "binary",
						operation: "|",
						left: {
							type: "binary",
							operation: "&",
							left: element.left,
							right: { type: "number", value: 255 }
						},
						right: {
							type: "binary",
							operation: "<<",
							left: element.right,
							right: { type: "number", value: 8 }
						}
					});
				}

				if (element.left.type === 'number' &&
					element.right.type === 'number') {

					return {
						type: 'number',
						value: ({
							"+": function(l,r) { return l+r; },
							"-": function(l,r) { return l-r; },
							"*": function(l,r) { return l*r; },
							"/": function(l,r) { return Math.floor(l/r); },
							"%": function(l,r) { return l%r; },
							"<<": function(l,r) { return l<<r; },
							">>>": function(l,r) { return l>>>r; },
							">>": function(l,r) { return l>>r; },
							"||": function(l,r) { return l||r; },
							"&&": function(l,r) { return l&&r; },
							"^": function(l,r) { return l^r; },
							"|": function(l,r) { return l|r; },
							"&": function(l,r) { return l&r; }
						}[element.operation])(element.left.value, element.right.value)
					};
				}

				break ;
			case 'unary':
				if (element.operation === '-') {
					return element.value;
				}

				if (element.value.type !== 'number') {
					break ;
				}

				return {
					type: 'number',
					value: ({
						"-": function(v) { return -v; },
						"~": function(v) { return ~v; },
						"&": function(v) { return v; }	// THIS DOES NOT DO WHAT IT SHOULD
					}[element.operation])(element.value.value)
				};
			}
		});
	}

	/**
	 * Verification stage
	 */

	function verify(tree) {
		var detected = [],
			defined = [];

		helper.walk(tree, function(element) {
			switch (element.type) {
			case 'string':
				throw new Error("Strings are not allowed in " + element.type + "blocks");

			case 'data':
				element.arguments.forEach(function (element) {
					if (!element.integer) {
						throw new Error("Data blocks may only contain compile time expressions");
					}
				});
				break ;
			case 'operation':
				var opcode = constants.INSTRUCTIONS[element.name];

				if (!opcode) {
					throw new Error("Unrecognized opcode: " + element.name);
				}

				if (opcode.length !== element.arguments.length) {
					throw new Error("Argument count mismatch");
				}

				element.arguments.forEach(function (exp, i) {
					var last = (i === element.arguments.length - 1),
						bad = last ? "PUSH" : "POP";

					if (!last && exp.integer) {
						throw new Error("Cannot use integer values as a left-hand argument");
					}

					helper.walk(exp, function (e) {
						if (e.type === "register" && e.name === bad) {
							throw new Error("Cannot use " + bad + "on this instruction");
						}
					});
				})

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

	function count(tree, type) {
		var total = 0;

		helper.walk(tree, function(element) {
			if (element.type === type) { total++; }
		});

		return total;
	}

	/**
	 * Estimate the values of labels
	 */
	function estimate(tree, estimates, force) {
		// These are our PC ranges
		var minimum = 0,
			maximum = 0,
			has_estimates = estimates || false;

		function align(number, bias) {
			var offset = number % bias;
			return number + (offset ? bias - offset : 0);
		}

		function references(equation) {
			var names = [];
			helper.walk(equation, function (e) {
				if (e.type === "identifier") {
					names.push(e.name);
				}
			});
			return names;
		}

		function range(equation, desired) {
			var use = references(equation),
				values = {},
				short = false, long = false,
				temp, name, i;

			use.forEach(function (name) {
				values[name] = { type: "number", value: estimates[name].minimum };
			})

			do {
				// Calculate what our value should be now
				i = flatten(define(helper.deepClone(equation), values)).value & 0xFFFF;

				if (desired.indexOf(i) >= 0) {
					short = true;
				} else {
					long = true;
				}

				for (i = 0; i < use.length; i++) {
					name = use[i];
					if (++values[name].value <= estimates[name].maximum) { break; }
					values[name].value = estimates[name.minimum];
				}
			} while (i < use.length && (!short || !long));

			// Determine range
			if (short) {
				if (long) { return "maybe"; }
				return "no";
			}
			return "yes";
		}

		function guess(field) {
			var value, values;
		
			switch (field.type) {
			case 'register':
				return "no";
			case 'indirect':
				if (field.type === "register") {
					return "no";
				}

				if (!has_estimates) { return "maybe"; }
				if (force) { return "true"; }

				value = field.value;
				if (value.type === "binary") {
					if (value.left.type === "register") {
						value = value.right;

						if (field.value.operation === '-') {
							value = { 
								type: "unary",
								value: value,
								operation: "-"
							}
						}
					} else if (value.right.type === "register") {
						value = value.left;
					}
				}

				return range(value, [0]);
			case 'binary':
			case 'unary':
			case 'identifier':
				if (!has_estimates) { return "maybe"; }
				if (force) { return "true"; }

				return range(field, [0xFFFF].concat(_.range(0,30)));
			case 'number':
				value = field.value & 0xFFFF;
				return (value <= 30 || value == 0xFFFF) ? "no" : "yes";
			default:
				console.log("UNHANDLED ESTIMATION: " + field.type);
				process.exit(-1);
			}
		}

		function instruction(element) {
			var instruction = constants.INSTRUCTIONS[element.name],
				badEstimate = false;

			minimum++; maximum++;

			element.arguments.forEach(function (field){
				switch(guess(field)) {
				case 'yes':   minimum++;
				case 'maybe': maximum++;
				}
			});

			return element;
		}

		// We need somewhere to put our estimates
		estimates || (estimates = {});
	
		helper.walk(tree, function (element) {
			switch (element.type) {
			case 'org':
				throw "";
				minimum = maximum = element.value.value;
				break ;
			case 'align':
				throw "";
				minimum = align(minimum, element.value.value);
				maximum = align(maximum, element.value.value);
				break ;
			case 'bss':
				throw "";
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
	
		return estimates;
	}

	function assemble(tree) {
		var REGISTERS = {
			"A": 0, "B": 1, "C": 3, "X": 4,
			"Y": 4, "Z": 5, "I": 6, "J": 7,
			"SP": 0x1b, "PC": 0x1c, "EX": 0x1d,
			"PUSH": 0x18, "POP": 0x18
		};

		function field(expression) {
			var value, reg, op;
		
			switch (expression.type) {
			case "number":
				value = expression.value & 0xFFFF;

				if (value <= 30 || value === 0xFFFF) {
					return { field: ((value + 1) & 0x1F) + 0x20 };
				} 

				return { field: 0x1f, immediate: value };
			case "register":
				return { field: REGISTERS[expression.name] };
			case "indirect":
				op = expression.value;

				if (op.type === "register") {
					reg = op.name;
					value = 0;
				} else if (op.type === 'binary') {
					if (op.left.type === "register") {
						reg = op.left.name;
						value = op.right.value;
					} else {
						reg = op.right.name;
						value = op.left.value;
					}
				} else if (op.type === "number") {
					return { field: 0x1e, immediate: op.value };
				} else {
					throw new Error("I don't know how this happened.  Sad face.");
				}

				if (reg === 'PC' || reg === 'EX') {
					throw new Error("I don't know how this happened.  Sad face.");
				}

				if (op.operation === '-') { value = -value; }

				if (value) {
					return { 
						field: (reg === 'SP') ? 0x1a : (0x10 + REGISTERS[reg]),
						immediate: value 
					};
				} else {
					return { 
						field: (reg === 'SP') ? 0x19 : (0x08 + REGISTERS[reg])
					};
				}
			default:
				throw new Error("I don't know how this happened.  Sad face.");
			}
		}

		return helper.walk(tree, function (element) {
			switch (element.type) {
			// Allocation space
			case 'bss':
				// Ignore non-operations and incompletes
				if (count(element, 'identifier') > 0) { 
					break ;
				}

				var zeros = _.range(element.value.value).map(function() { return {type:"number", value:0}; });

				return {
					type: "data",
					arguments: zeros
				};
			// Instructions
			case 'operation':
				// Ignore non-operations and incompletes
				if (count(element, 'identifier') > 0) { 
					break ;
				}

				var instruction = constants.INSTRUCTIONS[element.name],
					fields = element.arguments.map(field),
					immediates = _.chain(fields).pluck('immediate').filter(function(v) {
						return typeof v === "number";
					}).map(function (v) {
						return { type: 'number', value: v };
					}).reverse().value(),
					a, b, op;

				if (instruction.length === 1) {
					op = 0;
					b = instruction.code;
					a = fields[0].field;
				} else {
					op = instruction.code;
					b = fields[0].field;
					a = fields[1].field;
				}

				// Convert instruction to a data-block
				return {
					type: 'data',
					arguments: [
						{ type: "number", value: (a << 10) | (b << 5) | op}
					].concat(immediates)
				};
			}
		});
	}

	function data(tree, little) {
		var data = [],
			output;
		helper.walk(tree, function (element) {
			if(element.type !== 'data') { return ; }
		
			data = data.concat(_.pluck(element.arguments, 'value'));
		});

		output = new Buffer(data.length*2);
		data.forEach(function(word, i) {
			output[little?'writeUInt16LE':'writeUInt16BE'](word & 0xFFFF,i*2);
		});

		return output;
	}

	function build(tree, expressions) {
		// Preprocess the AST tree
		balance(tree);			// Order expression stage
		tree = replace(tree);	// Replace macros and equates
		mark(tree);				// Mark expressions which will resolve to an integer at compile time
		verify(tree);			// Run some sanity checks

		// Attempt to breakdown expressions
		tree = breakdown(tree, expressions);

		// Until all our expressions have been resolved
		var estimates, previous, should_force;
		do {
			estimates = estimate(tree, estimates, should_force);

			should_force = _.reduce(estimates, function(acc, est, key) {
				return (acc === null ? true : acc) && 
					previous &&
					previous[key].minimum == est.minimum &&
					previous[key].maximum == est.maximum;
			}, null);
			previous = helper.deepClone(estimates);

			if (should_force) {
				console.log("WARNING: Estimations went stale, forcing long constants");
			}

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

			// Finally, convert finished instructions to DATA blocks
			tree = assemble(tree);
		} while (count(tree, 'operation') > 0);

		return tree;
	}

	this.build = build;

	return this;
});
