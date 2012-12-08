"use strict";

var _ = require("underscore"),
	fs = require("fs");

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

function source(tree) {
	if (!Array.isArray(tree)) { tree = [tree]; }

	return walk(deepClone(tree), function (element) {
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

function error(err) {
	var data = fs.readFileSync(err.file, "utf8"),
		line = data.split(/\n\r|\r\n|\n|\r/)[err.line-1].replace(/\t/g,"    "),
		notice = "("+err.line+", "+err.column+") "+err.name+":";

	console.error(notice,line);

	console.error(_.range(err.column+notice.length).map(function() {return " ";}).join("") + "\u2191 " + err.message);
	process.exit(-1);
}


module.exports = {
	source: source,
	walk: walk,
	deepClone: deepClone,
	error: error
};
