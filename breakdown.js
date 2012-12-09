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
		helper = require("./helper.js");

	var INDEXABLE = ["A","B","C","X","Y","Z","I","J","SP"];

	// Determine which registers are available
	function usingStack(tree) {
		var stack = false;
		helper.walk(tree, function (element) {
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
		
		helper.walk(tree, function (element) {
			if (element.type === 'register') {
				registers.push(element.name);
			}
		})
		
		return _.difference(INDEXABLE, registers);
	}

	function indexed (tree, safe) {
		var indirect = false;
		helper.walk(tree, function (element) {
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
				throw new Error("Complex expression in: " + helper.source(element));
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
			var instruction = constants.INSTRUCTIONS[element.name],
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

	this.breakdown = breakdown;

	return this;
});
