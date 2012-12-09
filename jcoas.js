#!/usr/bin/env node
"use strict";

var pegjs = require("pegjs"),
	fs = require("fs"),
	_ = require("underscore"),
	optimist = require("optimist")
		.usage("Usage: $0 [assembly files]")
		.describe("f", "Output format")
		.alias("f", "format")
		.describe("o", "Output resource")
		.alias("o", "output")
		.describe("x", "Allow expressions")
		.alias("x", "expressions")
		.default("x", "true"),

	assembler = require("./assembler.js"),
	helper = require("./helper.js");

var options = optimist.argv;

if (options._.length < 1) {
	optimist.showHelp();
	process.exit(-1);
}

global.parser = pegjs.buildParser(
	fs.readFileSync("jcoas.peg", "utf8"), 
	{trackLineAndColumn: true});


var parsed = options._.reduce(function (list, f) {
		var file = fs.readFileSync(f, "utf8");

		try {
			return list.concat(global.parser.parse(file));
		} catch (e) {
			if (e.found) { e.message = "Unexpected '" + e.found + "'"; }

			e.file || (e.file = f);
			helper.error(e);
		}
	}, []),
	result = assembler.build(parsed, options.x.toLowerCase() === "false");

if (options.o) {
	console.log((data(result).length/2).toString(), "words assembled.");

	switch (options.f) {
		case 's':
		case 'source':
		case 'data':
			fs.writeFileSync(options.o, helper.source(result));
			break ;
		case 'l':
		case 'little':
		case "littleendian":
			fs.writeFileSync(options.o, data(result, true));
			break ;
		case 'b':
		case 'big':
		case "bigendian":
		default:
			fs.writeFileSync(options.o, data(result));
			break ;
	}
} else {
	console.log(helper.source(result));
}
