/**
 * Command line interface implementation for `firmware` function.
 *
 * Copyright (C) 2020 Adam Nielsen <malvineous@shikadi.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const chalk = require('chalk');
const commandLineArgs = require('command-line-args');
const debug = require('debug')('behringerctl:cli:firmware');
const fs = require('fs');

const Behringer = require('../../index.js');
const { OperationsError } = require('../error.js');
const output = require('../output.js');

const midiData = require('../../midiData.js');
const sevenEightCoder = require('../../algo/sevenEightCoder.js');
const xor = require('../../algo/xor.js');

class Operations
{
	constructor()
	{
	}

	async destructor()
	{
	}

	examine(params)
	{
		if (!params['read']) {
			throw new OperationsError('Missing filename to --read.');
		}

		const dataIn = fs.readFileSync(params['read']);

		let firmware;
		try {
			firmware = Behringer.firmware.decode(dataIn, params['model']);
		} catch (e) {
			if (debug.enabled) throw e; // don't catch if we're debugging
			throw new OperationsError(`Error decoding firmware: ${e.message}`);
		}

		if (!firmware.device) {
			throw new OperationsError('Unable to autodetect the device model this '
				+ 'firmware is for.  Please specify --device-model.');
		}

		const dumpFilename = params['debug-dump'];
		if (dumpFilename) {
			const rawData = Behringer.util.blocksToImage(firmware.blocks, 0, 0xFFFF, false);
			fs.writeFileSync(dumpFilename, rawData);

			output(
				'Raw dump to',
				chalk.greenBright(dumpFilename),
			);
			return;
		}

		let info = firmware.device.examineFirmware(firmware.blocks);

		if (!info) {
			throw new OperationsError('Unrecognised firmware image');
		}

		for (let i of Object.keys(firmware.detail)) {
			let value = firmware.detail[i];
			if (typeof(value) == 'object') {
				// Value is an object, so convert it into a string of key=value pairs.
				const list = Object.keys(value).reduce((out, key) => {
					out.push(key + '="' + value[key] + '"');
					return out;
				}, []);
				value = list.join(', ');
			}
			output(chalk.whiteBright(i + ':'), chalk.greenBright(value));
		}
		output(chalk.whiteBright('Device:'), chalk.greenBright(info.id));
		for (let i of info.detail) {
			const valColour = i.preserveTrailing ? chalk.black.bgGreen : chalk.greenBright;
			output(
				chalk.whiteBright(i.title + ':'),
				valColour(i.value)
			);
		}
		output();

		output(
			chalk.white.inverse('Index'.padStart(5)),
			chalk.white.inverse('Offset'.padStart(10)),
			chalk.white.inverse('Available'.padStart(10)),
			chalk.white.inverse('Used'.padStart(10)),
			chalk.white.inverse('%'.padStart(3)),
			chalk.white.inverse('Image name'.padEnd(24)),
		);
		for (let i in info.images) {
			const img = info.images[i];
			output(
				output.padLeft(i - 1, 5, chalk.whiteBright),
				output.padLeft('0x' + img.offset.toString(16), 10, chalk.magentaBright),
				output.padLeft(img.capacity || 'N/A', 10, chalk.cyanBright),
				output.padLeft(img.data.length, 10, chalk.greenBright),
				output.padLeft(img.capacity ? Math.round((img.data.length / img.capacity) * 100) : '-', 3, chalk.blueBright),
				chalk.yellowBright(img.title),
			);
		}

		if (params['extract-index'] !== undefined) {
			if (!params['write']) {
				throw new OperationsError('Missing filename to --write.');
			}
			const index = parseInt(params['extract-index']);

			const img = info.images[index + 1];
			if (!img) {
				throw new OperationsError('Invalid --extract-index.');
			}

			const writeFilename = params['write'];
			fs.writeFileSync(writeFilename, img.data);

			output(
				'Wrote image',
				chalk.yellowBright(index),
				'to',
				chalk.greenBright(writeFilename),
			);
		}
	}

	examineBootloader(params)
	{
		if (!params['read']) {
			throw new OperationsError('Missing filename to --read.');
		}

		let dataIn = fs.readFileSync(params['read']);

		let blocks = [];
		while (dataIn.length > 10) {
			let block = {
				address:
					(
						(dataIn[0] << 0) |
						(dataIn[1] << 8) |
						(dataIn[2] << 16) |
						(dataIn[3] << 24)
					) >>> 0, // make unsigned
				length:
					(
						(dataIn[4] << 0) |
						(dataIn[5] << 8) |
						(dataIn[6] << 16) |
						(dataIn[7] << 24)
					) >>> 0, // make unsigned
				flags:
					(dataIn[8] << 0) |
					(dataIn[9] << 8),
				flagText: [],
			};
			block.content = dataIn.slice(10, 10 + block.length);
			dataIn = dataIn.slice(10 + block.length);

			// Taken from description above FGRAB_HEADER in ADSP-BF533-ROM-V03.asm
			// (BF533 internal boot ROM source code) available at:
			// https://sourceforge.net/projects/adiopshw/files/BootROM%20Source/
			if (block.flags & (1 << 0)) block.flagText.push('ZEROFILL');
			if (block.flags & (1 << 1)) block.flagText.push('RESVECT');
			if (block.flags & (1 << 2)) block.flagText.push('(reserved2)');
			if (block.flags & (1 << 3)) block.flagText.push('INIT');
			if (block.flags & (1 << 4)) block.flagText.push('IGNORE');
			if (block.flags & (0xF << 5)) block.flagText.push('PFLAG=' + ((block.flags >> 5) & 0xF));
			if (block.flags & (1 << 9)) block.flagText.push('(reserved9)');
			if (block.flags & (1 << 10)) block.flagText.push('(reserved10)');
			if (block.flags & (1 << 11)) block.flagText.push('(reserved11)');
			if (block.flags & (1 << 12)) block.flagText.push('(reserved12)');
			if (block.flags & (1 << 13)) block.flagText.push('(reserved13)');
			if (block.flags & (1 << 14)) block.flagText.push('(reserved14)');
			if (block.flags & (1 << 15)) block.flagText.push('FINAL');

			if (block.length > (1 << 21)) { // 2MB
				throw new OperationsError(`Corrupted bootloader - block length (${block.length}) is larger than total memory size.`);
			}
			blocks.push(block);
		}
		if (dataIn.length > 0) {
			blocks.push({
				address: 'Leftover',
				content: dataIn,
			});
		}

		const flashFlags = blocks[0].address & 0xFF;
		const flashWidth = (flashFlags & 0xF0 === 0x60) ? '16' : '8';
		blocks[0].flagText.push(`flash=${flashWidth}-bit`);

		// From GRAB_HEADER in internal boot rom source, see above.
		output('Entrypoint:', chalk.magentaBright('0xffa08000'));

		output(
			chalk.white.inverse('Index'.padStart(5)),
			chalk.white.inverse('Address'.padStart(10)),
			chalk.white.inverse('Size'.padStart(10)),
			chalk.white.inverse('Flags'.padEnd(24)),
		);
		for (let i in blocks) {
			const img = blocks[i];
			output(
				output.padLeft(i, 5, chalk.whiteBright),
				output.padLeft('0x' + img.address.toString(16).padStart(8, '0'), 10, chalk.magentaBright),
				output.padLeft(img.length, 10, chalk.greenBright),
				output.pad(img.flagText.join(' '), 17, chalk.yellowBright),
			);
		}

		if (params['extract-index'] !== undefined) {
			if (!params['write']) {
				throw new OperationsError('Missing filename to --write.');
			}
			const index = parseInt(params['extract-index']);

			const img = info.images[index + 1];
			if (!img) {
				throw new OperationsError('Invalid --extract-index.');
			}

			const writeFilename = params['write'];
			fs.writeFileSync(writeFilename, img.data);

			output(
				'Wrote image',
				chalk.yellowBright(index),
				'to',
				chalk.greenBright(writeFilename),
			);
		}
	}

	syx2bin(params)
	{
		if (!params['read']) {
			throw new OperationsError('Missing filename to --read.');
		}
		if (!params['write']) {
			throw new OperationsError('Missing filename to --write.');
		}
		const binMIDI = fs.readFileSync(params['read']);

		let chunks = [];
		midiData.processMIDI(binMIDI, event => {
			const eventInfo = midiData.parseSysEx(event);

			chunks.push(Buffer.from([eventInfo.command]));

			let data8bit = sevenEightCoder.decode(eventInfo.binData);
			debug(`SysEx command: ${eventInfo.command.toString(16)}, `
				+ `length: ${eventInfo.binData.length}, `
				+ `8-bit-length: ${data8bit.length}`);

			if (params['xor']) {
				data8bit = xor(params['xor'], data8bit);
			}
			chunks.push(Buffer.from(data8bit));
		});

		const dataOut = Buffer.concat(chunks);
		const writeFilename = params['write'];
		fs.writeFileSync(writeFilename, dataOut);

		output(
			'Extracted raw SysEx data to',
			chalk.greenBright(writeFilename),
		);
	}

	generate(params)
	{
		if (!params['device-model']) {
			throw new OperationsError('Missing --device-model.');
		}
		if (!params['read']) {
			throw new OperationsError('Missing filename to --read.');
		}
		if (!params['write']) {
			throw new OperationsError('Missing filename to --write.');
		}
		if (params['address'] === undefined) {
			throw new OperationsError('Missing --address.');
		}

		const dataIn = fs.readFileSync(params['read']);

		const dataOut = Behringer.firmware.encode(
			params['device-model'],
			parseInt(params['address']),
			dataIn
		);

		const writeFilename = params['write'];
		fs.writeFileSync(writeFilename, dataOut);

		output(
			'Wrote sysex firmware image to',
			chalk.greenBright(writeFilename),
		);
	}

	static async exec(createInstance, args)
	{
		let cmdDefinitions = [
			{ name: 'name', defaultOption: true },
		];
		const cmd = commandLineArgs(cmdDefinitions, { argv: args, stopAtFirstUnknown: true });

		if (!cmd.name) {
			throw new OperationsError(`subcommand required.`);
		}

		let proc = new Operations();

		try {
			const def = Operations.names[cmd.name] && Operations.names[cmd.name].optionList;
			if (def) {
				const runOptions = commandLineArgs(def, { argv: cmd._unknown || [] });
				await proc[cmd.name](runOptions);
			} else {
				throw new OperationsError(`unknown command: ${cmd.name}`);
			}

		} finally {
			if (proc.destructor) await proc.destructor();
			proc = undefined;
		}
	}
}

Operations.names = {
	examine: {
		summary: 'Print details about a raw (fully decoded) firmware binary',
		optionList: [
			{
				name: 'model',
				type: String,
				description: 'Device model, can be autodetected for some *.syx files',
			},
			{
				name: 'read',
				type: String,
				description: '*.bin or *.syx firmware file to read',
			},
			{
				name: 'extract-index',
				type: Number,
				description: 'Optional image index to extract from firmware blob',
			},
			{
				name: 'write',
				type: String,
				description: 'Filename to save --extract-index to',
			},
			{
				name: 'debug-dump',
				type: String,
				description: 'Dump SysEx decoded data for identifying new firmware images',
			},
		],
	},
	examineBootloader: {
		summary: 'Print details about a raw (fully decoded) bootloader binary',
		optionList: [
			{
				name: 'model',
				type: String,
				description: 'Device model',
			},
			{
				name: 'read',
				type: String,
				description: '*.bin firmware file to read',
			},
			{
				name: 'extract-index',
				type: Number,
				description: 'Optional image index to extract from firmware blob',
			},
			{
				name: 'write',
				type: String,
				description: 'Filename to save --extract-index to',
			},
		],
	},
	syx2bin: {
		summary: 'Convert SysEx events in *.syx raw MIDI data into 8-bit binary, '
			+ 'for examining unsupported firmware images',
		optionList: [
			{
				name: 'read',
				type: String,
				description: '*.bin firmware file to read',
			},
			{
				name: 'write',
				type: String,
				description: 'Filename to create (*.syx)',
			},
			{
				name: 'xor',
				type: String,
				description: 'Optional XOR key to apply over content',
			},
		],
	},
	generate: {
		summary: 'Create a *.syx firmware image',
		optionList: [
			{
				name: 'device-model',
				type: String,
				description: 'Device model being flashed',
			},
			{
				name: 'read',
				type: String,
				description: '*.bin firmware file to read',
			},
			{
				name: 'address',
				type: Number,
				description: 'Address in flash memory chip to write to',
			},
			{
				name: 'write',
				type: String,
				description: 'Filename to create (*.syx)',
			},
		],
	},
};

module.exports = Operations;
