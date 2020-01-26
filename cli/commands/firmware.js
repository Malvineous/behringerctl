const chalk = require('chalk');
const commandLineArgs = require('command-line-args');
const debug = require('debug')('behringerctl:firmware');
const fs = require('fs');

const sevenEightCoder = require('../../sevenEightCoder.js');
const { OperationsError } = require('../error.js');
const output = require('../output.js');

function xor(key, dataIn)
{
	let data = Buffer.from(dataIn);
	if (typeof(key) === 'string') {
		key = key.split('').map(c => c.charCodeAt(0));
	}
	for (let i = 0; i < data.length; i++) {
		data[i] ^= key[i % key.length];
	}
	return data;
}

function decodeSysEx(block)
{
	const companyId = (block[1] << 16) | (block[2] << 8) | block[3];
	if (companyId != 0x002032) {
		debug(`Invalid companyId 0x${companyId.toString(16)}, ignoring`);
		return;
	}
	const deviceId = block[4];
	const modelId = block[5];
	const command = block[6];
	if (command === 0x34) {
		// Remove header and final 0xF7 byte.
		let data7bit = block.slice(7, block.length - 1);

		// Remove the 7/8 coding, restoring the full 8-bit bytes.
		let data = sevenEightCoder.decode(data7bit);

		// Decrypt the data with a simple XOR cipher.
		data = xor("TZ'04", data);

		const blockNumber = (data[0] << 8) | data[1];
		const crc = data[2];
		debug(`Block 0x${blockNumber.toString(16)}, CRC 0x${crc.toString(16)}`);

		let content = Buffer.from(data.slice(3));
		return {
			blockNumber: blockNumber,
			crc: crc,
			content: content,
		};

	} else {
		debug(`Unexpected command 0x${command.toString(16)}, ignoring.`);
	}
}

class Operations
{
	constructor() {
	}

	async destructor() {
	}

	async decode(params) {
		if (!params['read']) {
			throw new OperationsError('Missing filename to --read.');
		}
		if (!params['write']) {
			throw new OperationsError('Missing filename to --write.');
		}
		const dataIn = fs.readFileSync(params['read']);
		const dataOut = fs.createWriteStream(params['write']);

		let pos = 0;
		while (pos < dataIn.length) {
			switch (dataIn[pos]) {
				case 0xF0: // sysex
					let end = pos + 1;
					while (end < dataIn.length) {
						if (dataIn[end] & 0x80) break;
						end++;
					}
					if (dataIn[end] === 0xF7) {
						end++;
						const event = dataIn.slice(pos, end);
						const data = decodeSysEx(event);
						if (data) {
							if (data.blockNumber < 0xFF00) { // skip LCD messages
								dataOut.write(data.content);
							} else {
								output(
									'Write message to LCD screen:',
									chalk.yellowBright(data.content)
								);
							}
						}
					} else {
						debug(`Unexpected end to SysEx 0x${dataIn[end].toString(16)}`);
					}
					pos = end;
					break;
				default:
					debug(`Unexpected MIDI event 0x${dataIn[pos].toString(16)}`);
					break;
			}
		}
		debug(`Processed ${pos} of ${dataIn.length} bytes`);
	}

	examineDEQ2496V2(fw) {
		let info = {
			detail: [],
			images: [],
		};

		function cut(offset, length) {
			return fw.slice(offset, offset + length);
		}

		info.id = cut(0x2C94, 25);

		const bootKey = cut(0x3002, 0x38);//0x37);
		info.detail.push({
			title: 'Bootloader encryption key',
			value: bootKey.toString('utf8'),
			preserveTrailing: true,
		});

		const appKeyEnc = cut(0x303A, 0x38);//0x34);
		const appKeyDec = xor(bootKey, appKeyEnc);

		info.detail.push({
			title: 'Application encryption key',
			value: appKeyDec.toString('utf8'),
			preserveTrailing: true,
		});

		info.detail.push({
			title: 'MIDI firmware update encryption key',
			value: cut(0x2C84, 5).toString('utf8'),
			preserveTrailing: true,
		});

		info.detail.push({
			title: 'Bootloader LCD banner',
			value: cut(0x308A, 0x19).toString('utf8'),
		});

		info.images.push({
			title: 'Bootloader',
			data: fw.slice(0, 0x4000),
		});

		const imgApp = fw.slice(0x4000, 0x5B000);
		info.images.push({
			title: 'Application',
			data: imgApp,
		});

		const imgAppDec = xor(appKeyDec, imgApp);
		info.images.push({
			title: 'Application (decrypted)',
			data: imgAppDec,//.slice(0x4FA00, 0x4FA00 + 728),
		});
		return info;
	}

	examine(params) {
		if (!params['read']) {
			throw new OperationsError('Missing filename to --read.');
		}
		const dataIn = fs.readFileSync(params['read']);
		let info;
		const sigDEQ2496 = dataIn.slice(0x2C94, 0x2C94 + 25).toString('utf8');
		debug('DEQ2496 sig:', sigDEQ2496);
		if (sigDEQ2496 === 'DEQ2496V2 BOOTLOADER V2.2') {
			info = this.examineDEQ2496V2(dataIn);
		} else {
			throw new OperationsError('Unrecognised firmware image');
		}

		output(
			chalk.bgBlue(
				chalk.whiteBright(' [ ' + chalk.greenBright(info.id) + ' ] ')
			)
		);
		for (let i of info.detail) {
			const valColour = i.preserveTrailing ? chalk.black.bgGreen : chalk.greenBright;
			output(
				chalk.whiteBright(i.title + ':'),
				valColour(i.value)
			);
		}

		output(
			chalk.bgBlue(
				chalk.whiteBright(' [ ' + chalk.greenBright('Images') + ' ] ')
			)
		);
		for (let i in info.images) {
			const img = info.images[i];
			output(
				chalk.whiteBright(i),
				output.padLeft(img.data.length + ' b', 10, chalk.greenBright),
				chalk.yellowBright(img.title),
			);
		}

		if (params['extract-index'] !== undefined) {
			if (!params['write']) {
				throw new OperationsError('Missing filename to --write.');
			}
			const index = parseInt(params['extract-index']);
			const img = info.images[index];
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

	static async exec(createInstance, args) {
		let cmdDefinitions = [
			{ name: 'name', defaultOption: true },
		];
		const cmd = commandLineArgs(cmdDefinitions, { argv: args, stopAtFirstUnknown: true });

		if (!cmd.name) {
			throw new OperationsError(`subcommand required.`);
		}

		let proc = new Operations();

		try {
			const def = Operations.names[cmd.name].optionList;
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
	decode: {
		summary: 'Decode a SysEx firmware file into a binary image',
		optionList: [
			{
				name: 'read',
				type: String,
				description: '*.syx firmware file to read',
			},
			{
				name: 'write',
				type: String,
				description: 'Binary firmware file to write',
			},
		],
	},
	examine: {
		summary: 'Print details about a raw (fully decoded) firmware binary',
		optionList: [
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
};

module.exports = Operations;
