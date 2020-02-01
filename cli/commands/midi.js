/**
 * Command line interface implementation for `midi` function.
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
const debug = require('debug')('behringerctl:cli:midi');
const midi = require('midi');

const { OperationsError } = require('../error.js');
const output = require('../output.js');

class Operations
{
	constructor()
	{
	}

	async destructor()
	{
	}

	async list(params)
	{
		let portList = [];

		output(
			chalk.white.inverse('Selected'.padEnd(8)),
			chalk.white.inverse('Direction'.padEnd(9)),
			chalk.white.inverse('Index'.padEnd(5)),
			chalk.white.inverse('Description'.padEnd(32)),
		);

		const midiInput = new midi.Input();
		const inputPortCount = midiInput.getPortCount();
		let defaultPort = undefined;
		for (let i = 0; i < inputPortCount; i++) {
			const portName = midiInput.getPortName(i);
			if (defaultPort === undefined) {
				// Pick first port that doesn't look like a MIDI Through one.
				if (!portName.includes('hrough')) {
					defaultPort = i;
				}
			}
			output(
				chalk.greenBright((i === defaultPort ? '*' : ' ').padEnd(8)),
				'Input'.padEnd(9),
				chalk.whiteBright(('' + i).padStart(5)),
				portName
			);
		}
		midiInput.closePort();

		const midiOutput = new midi.Output();
		const outputPortCount = midiOutput.getPortCount();
		for (let i = 0; i < outputPortCount; i++) {
			const portName = midiOutput.getPortName(i);
			if (defaultPort === undefined) {
				// Pick first port that doesn't look like a MIDI Through one.
				if (!portName.includes('hrough')) {
					defaultPort = i;
				}
			}
			output(
				chalk.greenBright((i === defaultPort ? '*' : ' ').padEnd(8)),
				'Output'.padEnd(9),
				chalk.whiteBright(('' + i).padStart(5)),
				portName
			);
		}
		midiOutput.closePort();
	}

	static async exec(createInstance, args)
	{
		let cmdDefinitions = [
			{ name: 'name', defaultOption: true },
		];
		const cmd = commandLineArgs(cmdDefinitions, { argv: args, stopAtFirstUnknown: true });

		if (!cmd.name) {
			throw new OperationsError(`subcommand required`);
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
	list: {
		summary: 'List available MIDI devices to use for device communication',
		optionList: [],
	},
};

module.exports = Operations;
