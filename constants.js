"use strict";

function closure(cb) {
	// Node Common.JS Style
	if (module && module.exports) {
		var ret = cb.call(global, require);
		Object.getOwnPropertyNames(ret).forEach(function(key) {
			module.exports[key] = ret[key];
		});
	} else {
		define.apply(window, arguments);
	}
}

closure(function (require) {
	return {
		INSTRUCTIONS: {
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
		}
	};
});
