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

var parser = pegjs.buildParser(
		fs.readFileSync("coas.peg", "utf8"), {trackLineAndColumn: true}),
	parsed = options._.reduce(function (list, f) {
		return list.concat(parser.parse(fs.readFileSync(f, "utf8")));
	}, []);

console.log(JSON.stringify(parsed));