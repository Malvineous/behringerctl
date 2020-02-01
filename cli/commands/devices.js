/**
 * Command line interface implementation for `devices` function.
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
const debug = require('debug')('behringerctl:cli:devices');

const { OperationsError } = require('../error.js');
const output = require('../output.js');

class Operations
{
	constructor() {
	}

	async destructor() {
	}

	async list(params) {
		let p = 0;
		const throbber = '-/|\\';
		function status() {
			p = (p + 1) % throbber.length;
			process.stdout.write('\rWaiting for devices to respond...' + throbber[p] + '\r');
		}
		let hStatus = setInterval(status, 100);

		const deviceList = await this.behringer.find();

		clearInterval(hStatus);
		process.stdout.write('\r\u001B[J\r');

		if (!deviceList.length) {
			output('No supported devices found!');
			return;
		}

		output(
			chalk.white.inverse('Model ID'.padEnd(8)),
			chalk.white.inverse('Device ID'.padEnd(9)),
			chalk.white.inverse('Model name'.padEnd(24)),
		);
		for (const d of deviceList) {
			output(
				output.pad(d.modelId, 8, chalk.whiteBright),
				output.pad(d.deviceId, 9, chalk.greenBright),
				chalk.yellowBright(d.modelName)
			);
		}
	}

	async identify(params) {
		try {
			const identity = await this.behringer.identify();
			output(
				chalk.yellowBright(identity.modelName)
			);
		} catch (e) {
			throw new OperationsError(`identify failed: ${e.message}`);
		}
	}

	async config(params) {
		if (params['midi-channel'] !== undefined) {
			const channel = parseInt(params['midi-channel']) - 1;
			if (channel < 0) {
				throw new OperationsError('Channel cannot be less than 1.');
			}
			this.behringer.setMIDIChannel(channel);
			output(
				'MIDI channel set to:',
				chalk.greenBright(channel + 1),
				'(device ID',
				chalk.yellowBright(channel) + ')'
			);
			output('There is no confirmation from the device whether this was successful or not.');
		}
	}

	async message(params) {
		//await this.behringer.readMemory();
		if (params['text'] === undefined) {
			throw new OperationsError('Must specify --text.');
		}
		await this.behringer.setLCDMessage(params['text']);
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
			proc.behringer = createInstance();
		} catch (e) {
			throw new OperationsError(`Unable to set up MIDI connection: ${e.message}`);
		}

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
	list: {
		summary: 'Query all connected devices',
		optionList: [],
	},
	identify: {
		summary: 'Identify the selected device',
		optionList: [],
	},
	config: {
		summary: 'Configure the selected device',
		optionList: [
			{
				name: 'midi-channel',
				type: Number,
				description: 'Set the device to listen on a different MIDI channel',
			},
		],
	},
	message: {
		summary: 'Write a message on the device\'s display',
		optionList: [
			{
				name: 'text',
				type: String,
				description: 'Text to show',
			},
		],
	},
};

module.exports = Operations;
