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
	// These are the non-standard objects we may incounter
	if (obj instanceof Uint16Array) { return obj; }
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

/**
 * Replace .macro and .equ 
 */
function replacementStage(tree) {
	var equates = {},
		macros = {};

	function equate(element, set) {

		if (Array.isArray(element)) {
			return element.map(function(e) { return equate(e, set); });
		}

		switch (element.type) {
			case 'identifier':
				var value = (set || equates)[element.name];

				return value ? deepClone(value) : element ;
			case 'unary':
				element.term = equate(element.term, set);
				return element ;
			case 'binary':
				element.right = equate(element.right, set);
				element.left = equate(element.left, set);
				return element ;
			case 'operation':
				element.arguments = equate(element.arguments, set);
				return element;
			case 'data':
				element.arguments = equate(element.arguments, set);
				return element;
			case 'align':
			case 'bss':
			case 'org':
				element.value = equate(element.value, set);
				return element;
			case 'compiled':
			case 'number':
			case 'string':
			case 'label':
				return element;
			default:
				throw "UNHANDLED EQUATE:" + JSON.stringify(element);
		}
	}

	return tree.reduce(function (list, element) {
		var macro, args;

		switch (element.type) {
			// Explode located macros
			case 'operation':
				macro = macros[element.name];

				if (!macro) { return list.concat(equate(element)); }

				if (macro.parameters.length !== element.arguments.length) {
					throw new Error("Macro " + macro.name + " argument mismatch");
				}

				args = {};
				macro.parameters.forEach(function(name, i){
					args[name] = equate(element.arguments[i]);
				});

				return list.concat(equate(equate(deepClone(macro.contents), args)));

			// Replacements are removed
			case 'equate':
				equates[element.name] = equate(element.value);
				return list;
			case 'macro':
				element.contents = replacementStage(element.contents);
				macros[element.name] = element;
				return list;

			// Simply modify contents
			default:
				return list.concat(equate(element));
		}
	}, []);
}

/**
 * Flatten stage
 */

function flattenStage(tree) {
	function flatten(tree) {
		if (Array.isArray(tree)) {
			return tree.map(flatten);
		}
	
		switch (tree.type) {
		case 'string':
			throw new Error("Strings are not allowed in " + tree.type + "blocks");

		case 'binary':
			tree.left = flatten(tree.left);
			tree.right = flatten(tree.right);

			if (tree.left.type === 'number' ||
				tree.right.type === 'number') {

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
					}[tree.operation])(tree.left.value, tree.right.value)
				};

			}

			return tree;
		case 'unary':
			tree.term = flatten(tree.term);
			if (tree.term.type === 'number') {
				return {
					type: 'number',
					value: ({
						"+": function(v) { return v; },
						"-": function(v) { return -v; },
						"~": function(v) { return ~v; },
						"&": function(v) { return v; }
					}[tree.operation])(tree.term.value)
				};
			}

			return tree;

		case 'bss':
		case 'align':
		case 'org':
			tree.value = flatten(tree.value);
			return tree;

		case 'data':
		case 'operation':
			tree.arguments = flatten(tree.arguments);
			return tree;
		case 'compiled':
		case 'label':
		case 'number':
			return tree;
		default:
			throw new Error("Unhandled element: " + tree.type)
		}
	}
	
	return flatten(tree);
}

function locateErrors(tree) {
	var detected = [],
		defined = [];

	function locate(tree){
		if (Array.isArray(tree)) {
			tree.forEach(locate);
		}

		switch (tree.type) {
		case 'label':
			defined.push(tree.name);
			break ;
		default:
			throw new Error("Unhandled element: " + tree.type)
		}
	}

	locate(tree);
}

var parsed = options._.reduce(function (list, f) {
		return list.concat(global.parser.parse(fs.readFileSync(f, "utf8")));
	}, []);

parsed = replacementStage(parsed);
parsed = flattenStage(parsed);

console.log(JSON.stringify(parsed, null, 4));
