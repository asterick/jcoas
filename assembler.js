"use strict";

var fs, parser, _, root;

// Cross compatibility zone
if (typeof module !== "undefined") {
	root = module.exports;
	root.readFile = function (fn) {
		var data = require("fs").readFileSync(fn),
			text = data.toString('utf8');
		
		return { buffer: data, text: text };
	}
	_ = require("underscore");
	parser = require("pegjs").
				buildParser(require('fs').readFileSync("jcoas.peg", "utf8"), {trackLineAndColumn: true});
} else {
	root = (window.jcoas || (window.jcoas = {}));
	_ = window._;
	parser = window.jcoas_parser;
}

(function() {
	var root = this,
		INDEXABLE = ["A","B","C","X","Y","Z","I","J","SP"],
		INSTRUCTIONS = {
		// 2-OP characters
		"SET" : { "code": 0x01, "length": 2 },
		"MOV" : { "code": 0x01, "length": 2 },

		"ADD" : { "code": 0x02, "length": 2, "carry": true },
		"SUB" : { "code": 0x03, "length": 2, "carry": true },
		"MUL" : { "code": 0x04, "length": 2, "carry": true },
		"MLI" : { "code": 0x05, "length": 2, "carry": true },
		"DIV" : { "code": 0x06, "length": 2, "carry": true },
		"DVI" : { "code": 0x07, "length": 2, "carry": true },
		"MOD" : { "code": 0x08, "length": 2 },
		"MDI" : { "code": 0x09, "length": 2 },
		"AND" : { "code": 0x0a, "length": 2 },
		"BOR" : { "code": 0x0b, "length": 2 },
		"XOR" : { "code": 0x0c, "length": 2 },

		"SHR" : { "code": 0x0d, "length": 2, "carry": true },
		"ASR" : { "code": 0x0e, "length": 2, "carry": true },
		"SHL" : { "code": 0x0f, "length": 2, "carry": true },

		"IFB" : { "code": 0x10, "length": 2 },
		"IFC" : { "code": 0x11, "length": 2 },
		"IFE" : { "code": 0x12, "length": 2 },
		"IFN" : { "code": 0x13, "length": 2 },
		"IFG" : { "code": 0x14, "length": 2 },
		"IFA" : { "code": 0x15, "length": 2 },
		"IFL" : { "code": 0x16, "length": 2 },
		"IFU" : { "code": 0x17, "length": 2 },

		"ADX" : { "code": 0x1a, "length": 2, "carry": true, "volatile": true },
		"SBX" : { "code": 0x1b, "length": 2, "carry": true, "volatile": true },

		"STI" : { "code": 0x1e, "length": 2 },
		"STD" : { "code": 0x1f, "length": 2 },
		// 1-OP characters
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
	function clone(obj) {
		if (obj === null || typeof obj !== "object") { return obj; }
		if (Array.isArray(obj)) { return obj.map(clone); }

		return _.reduce(obj, function (list, v, k) {
			list[k] = clone(v);
			return list;
		}, {});
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
			case 'include':
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

	function source(tree) {
		if (!Array.isArray(tree)) { tree = [tree]; }

		return walk(clone(tree), function (element) {
			switch (element.type) {
			case 'label':
				return ":" + element.name;
			case 'register':
				return element.name;
			case 'number':
				return element.value.toString(10);
			case 'operation':
				return "\t" + element.name + " " + element.arguments.join(", ");
			case 'binary':
				return "(" + element.left + element.operation + element.right + ")";
			case 'indirect':
				return "[" + element.value + "]";
			case 'identifier':
				return element.name;
			case 'data':
				return "\tDAT " + element.arguments.join(", ");
			case 'unary':
				return "(" + element.operation + element.value + ")";
			case 'org':
			case 'bss':
			case 'align':
				return "\t." +element.type + " " + element.value;
			default:
				throw new Error(element.type);
			}
		}).join("\n");
	}

	// Determine which registers are available
	function usingStack(tree) {
		var stack = false;
		walk(tree, function (element) {
			if (element.type === "register" &&
				(element.name === "POP" ||
				element.name === "SP" ||
				element.name === "PUSH")) {
				stack = true;
			}
		});
		return stack;
	}

	function safe (tree) {
		var registers = ["SP"];
	
		walk(tree, function (element) {
			if (element.type === 'register') {
				registers.push(element.name);
			}
		})
	
		return _.difference(INDEXABLE, registers);
	}

	function indexed (tree, safe) {
		var indirect = false;
		walk(tree, function (element) {
			switch (element.type) {
			case "register":
				if (safe) { return ; }
		
				if (element.name === "EX" ||
					element.name === "POP" ||
					element.name === "SP" ||
					element.name === "PC" ||
					element.name === "PUSH") {
					throw new Error("Cannot use EX, PC or Stack in complex expressions.");
				}
				break ;
			case "indirect":
				indirect = true;
			}
		});
		return indirect;
	}

	// Determine if an expression needs further breakdown
	function base(expression) {
		var value;
	
		switch (expression.type) {
		case 'register':	// r0-r7, ex, pc, sp, push, pop
			// Registers are always a valid source / target
			return true;
		case 'indirect':
			value = expression.value;
			// We can directly index whitelisted registers and 
			if (value.integer ||
				(value.type === "register" &&
				INDEXABLE.indexOf(value.name) >= 0)) {
				return true ;
			}

			// Is it an indexed register?
			if (value.type === 'binary' && (
				value.operation === "+" ||
				value.operation === "-"
				)) {
				// 
				if (value.right.integer &&
					value.left.type === "register" &&
					INDEXABLE.indexOf(value.left.name) >= 0) {
					return true;
				} else if (value.operation === "+" && 
					value.left.integer &&
					value.right.type === "register" &&
					INDEXABLE.indexOf(value.right.name) >= 0) {
					return true;
				}
			}
			return false;
		default:
			// Anything that resolves to an integer is valid
			return expression.integer;
		}
	}

	function breakdown(tree, allowed) {
		return tree.reduce(function (list, element) {
			// We do not transform directives / labels
			if (element.type != "operation") {
				return list.concat(element);
			}

			// This is a non-complex instruction, does not need a breakdown stage
			if (_.every(element.arguments, base)) {
				return list.concat(element);
			} else if (allowed) {
				throw new Error("Complex expression in: " + source(element));
			}

			// Check to see if this uses indexed-complex and stack together
			var stackBased = false,
				indexedComplex = false;

			element.arguments.forEach(function (e) {
				stackBased = stackBased || usingStack(e);

				indexedComplex = indexedComplex ||
					(indexed(e, true) && !base(e));
			});

			if (stackBased && indexedComplex) {
				throw new Error("Cannot combine Stack with Indexed complex expressions");
			}

			// Find a safe register to use for preservation
			var instruction = INSTRUCTIONS[element.name],
				preserve_stack = instruction.volatile || !instruction.carry,
				preserve_regs = [],
				indexers = safe(element),
				output = [],
				depth = 0;

			// Preserve our stack when nessessary
			if (preserve_stack) {
				output.push({
					type: "operation",
					name: "MOV",
					arguments: [
						{type:"register", name:"PUSH"},
						{type:"register", name:"EX"}
					]
				});
			}

			element.arguments = element.arguments.map(function (exp, index) {
				var last = index == (element.arguments.length - 1),
					indirect,
					indexer;

				function reduce(tree) {
					var BINARY_OPS = {
						"+": "ADD",
						"-": "SUB",
						"*": "MLI",
						"/": "DVI",
						"%": "MDI",
						"<<": "SHL",
						">>>": "ASR",
						">>": "SHR",
						"^": "XOR",
						"|": "BOR",
						"&": "AND"
					}, UNARY_OPS = {
						"-": "MLI",
						"~": "XOR"
					}, temp;

			
					// Leaf node
					if (base(tree)) {
						output.push({
							type: "operation",
							name: "MOV",
							arguments: [
								{type:"register", name: "PUSH"},
								tree
							]
						});
						return ;
					}

					switch (tree.type) {
					case 'indirect':
						reduce(tree.value);
						output.push({
							type: "operation",
							name: "MOV",
							arguments: [
								{type:"register", name: indexer},
								{type:"register", name: "POP"}
							]
						});
						output.push({
							type: "operation",
							name: "MOV",
							arguments: [
								{type:"register", name: "PUSH"},
								{type:"indirect", value: {type:"register", name: indexer}}
							]
						});
						break ;
					case 'unary':
						if(!UNARY_OPS[tree.operation]) {
							throw new Error("Cannot handle unary operator: " + tree.operation);
						}

						reduce(tree.value);
						output.push({
							type: "operation",
							name: UNARY_OPS[tree.operation],
							arguments: [
								{type:"indirect", value: {type:"register", name: "SP"}},
								{type:"number", value: -1}
							]
						});
						break ;
					case 'paren':
						return tree.value;
					case 'binary':
						if (!BINARY_OPS[tree.operation]) {
							throw new Error("Cannot run-time execute operation " + tree.operation);
						}

						reduce(tree.left);
				
						if (base(tree.right)) {
							temp = tree.right;
						} else {
							reduce(tree.right);
							temp = {type:"register", name: "POP"};
						}

						output.push({
							type: "operation",
							name: BINARY_OPS[tree.operation],
							arguments: [
								{type:"indirect", value: {type:"register", name: "SP"}},
								temp
							]
						});
						break ;
					default:
						console.log("UNKNOWN EXPRESSION TERM: " + JSON.stringify(exp));
						process.exit(-1);
					}
				}

				if (!last) {
					if (exp.type !== 'register' && exp.type !== 'indirect') {
						throw new Error("Left-hand argument must be an address or register");
					}
				}

				if (base(exp)) { return exp; }

				indirect = indexed(exp);
				indexer = indexed && indexers.pop();

				if (indirect) {
					if (!indexer) {
						throw new Error("Not enough registers for indexers");
					}
					preserve_regs.push(indexer);
				}

				depth++;

				if (last) {
					reduce (exp);
					return {
						type: "register",
						name: "POP"
					}
				} else {
					reduce (exp.value);
			
					output.push({
						type: "operation",
						name: "MOV",
						arguments: [
							{type:"register", name: indexer},
							{type:"register", name: "POP"}
						]
					});
			
					depth--;
					exp.value = {type:"register", name: indexer};
					return exp;
				}
			});
	
			// Restore the stack
			if (preserve_stack) {
				if (depth) {
					output.push({
						type: "operation",
						name: "MOV",
						arguments: [
							{type:"register", name:"EX"},
							{type:"indirect", value: {
								type: "binary",
								operation: "+",
								left: {type:"register", name:"SP"},
								right: {type:"number", value: depth}
							}}
						]
					}, element, {
						type: "operation",
						name: "ADD",
						arguments: [
							{type:"register", name:"SP"},
							{type:"number", value: depth}
						]
					});
				} else {
					output.push({
						type: "operation",
						name: "MOV",
						arguments: [
							{type:"register", name:"EX"},
							{type:"indirect", value: {type:"register", name:"SP"}}
							]
					}, element);
				}
			} else {
				output.push(element);
			}

			preserve_regs.forEach(function (r) {
				output.unshift({
					type: "operation",
					name: "MOV",
					arguments: [
						{type:"register", name: "PUSH"},
						{type:"register", name: r}
					]
				});
				output.push({
					type: "operation",
					name: "MOV",
					arguments: [
						{type:"register", name: r},
						{type:"register", name: "POP"}
					]
				});
			});

			return list.concat(output);
		}, []);
	}

	/**
	 * Inclusions stage
	 */
	function include(tree) {
		return walk(tree, function (node) {
			if (node.type !== 'include') { return ; }

			return node.arguments.map(function (fn) {
				var file = root.readFile(fn.value),
					array = [],
					i;

				switch (node.format) {
				case 'source':
					return include(parser.parse(file.text));
				case 'big':
					for (i = 0; i < buffer.length; i+= 2) { array[i/2] = {type:"number", value: file.buffer.readUInt16BE(i, true)}; }
					break ;
				case 'little':
					for (i = 0; i < buffer.length; i+= 2) { array[i/2] = {type:"number", value: file.buffer.readUInt16LE(i, true)}; }
					break ;
				case 'bytes':
					for (i = 0; i < buffer.length; i++) { array[i] = {type:"number", value: file.buffer[i]}; }
					break ;
				}

				return {
					type: 'data',
					line: node.line,
					column: node.column,
					arguments: array
				};
			});
		});
	}

	/**
	 * Balancing stage
	 */

	function balance(tree) {
		return walk(tree, function (node) {
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
		return walk(tree, function (element) {
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

		return walk(tree, function(element) {
			if (element.name && element.name[0] === "_") {
				element.name += suffix;
			}
		});
	}

	/**
	 * Replace .macro and .equ 
	 */
	function define(tree, set) {
		return walk(tree, function(element) {
			// Replace identifiers
			if (element.type === 'identifier' && set[element.name]) {
				return clone(set[element.name]);
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
							define(clone(macro.contents), args), 
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

		walk(tree, function(element) {
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
				var opcode = INSTRUCTIONS[element.name];

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

					walk(exp, function (e) {
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

		walk(tree, function(element) {
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
			walk(equation, function (e) {
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
				i = flatten(define(clone(equation), values)).value & 0xFFFF;

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
			var instruction = INSTRUCTIONS[element.name],
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

		walk(tree, function (element) {
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

		return walk(tree, function (element) {
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

				var instruction = INSTRUCTIONS[element.name],
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
		walk(tree, function (element) {
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
		tree = include(tree);	// Do source inclusions
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
			previous = clone(estimates);

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

	function fromFiles(files, expressions) {
		var t = new Date().getTime(),
			r = build([{
				type: "include",
				format: "source",
				arguments: files.map(function(f) { return {type:"string", value:f}; })
			}], expressions);
		console.error("Assembled in", (new Date().getTime() - t)/1000, "seconds");
			
		return r;
	}

	_.extend(this, {
		fromFiles : fromFiles,
		source: source,
		build: build
	});
}).call(root);
