/**
 * Firmware-related CLI commands.
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
const debug = require('debug')('behringerctl:firmware');
const fs = require('fs');

const Behringer = require('../../index.js');
const { OperationsError } = require('../error.js');
const output = require('../output.js');


class Operations
{
	constructor() {
	}

	async destructor() {
	}

	examine(params) {
		if (!params['read']) {
			throw new OperationsError('Missing filename to --read.');
		}

		const dataIn = fs.readFileSync(params['read']);

		const decoded = Behringer.firmware.decode(dataIn);
		let info = Behringer.firmware.examine(decoded.blocks);

		if (!info) {
			throw new OperationsError('Unrecognised firmware image');
		}

		for (let i of Object.keys(decoded.detail)) {
			let value = decoded.detail[i];
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
				output.padLeft(img.capacity, 10, chalk.cyanBright),
				output.padLeft(img.data.length, 10, chalk.greenBright),
				output.padLeft(Math.round((img.data.length / img.capacity) * 100), 3, chalk.blueBright),
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
