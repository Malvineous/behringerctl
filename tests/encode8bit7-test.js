const assert = require('assert');

const encode8bit7 = require('../encode8bit7.js');

describe('encoding 8-bit data in 7 bits', () => {

	it('must encode 8-bit data', () => {
		const input = [0xFF, 0x55, 0xAA];
		const output = encode8bit7(input);

		assert.deepEqual(output, [0x7F, 0x2B, 0x29, 0x05]);
	});

	it('must encode 7-bit data', () => {
		const input = [0x7F, 0x55, 0x2A];
		const output = encode8bit7(input);

		assert.deepEqual(output, [0x7F, 0x2A, 0x29, 0x01]);
	});

});
