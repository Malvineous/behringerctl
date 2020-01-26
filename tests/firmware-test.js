const assert = require('assert');

const Behringer = require('../index.js');

describe('encoding firmware', () => {

	const text = 'UPDATING FIRMWARE';
	const textBytes = text.split('').map(c => c.charCodeAt(0));
	const input = [
		...textBytes,
		...new Array(256 - textBytes.length).fill(0),
	];
	const b = new Behringer();
	const output = b.packBlock(0xFF00, input);

	it('correct length is produced', () => {
		assert.equal(output.length, 256 + 3);
	});

	it('correct offset is stored', () => {
		assert.equal(output[0], 0xFF);
		assert.equal(output[1], 0x00);
	});

	it('correct CRC is generated', () => {
		assert.equal(output[2], 0x47);
	});

});

describe('encoding firmware 2', () => {

	const text = 'READY... PLEASE CYCLE POWER';
	const textBytes = text.split('').map(c => c.charCodeAt(0));
	const input = [
		...textBytes,
		...new Array(256 - textBytes.length).fill(0),
	];
	const b = new Behringer();
	const output = b.packBlock(0xFF00, input);

	it('correct CRC is generated', () => {
		assert.equal(output[2], 0x48);
	});

});
