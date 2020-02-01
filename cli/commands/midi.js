const chalk = require('chalk');
const commandLineArgs = require('command-line-args');
const debug = require('debug')('behringerctl:midi');
const midi = require('midi');

const { OperationsError } = require('../error.js');
const output = require('../output.js');

class Operations
{
	constructor() {
	}

	async destructor() {
	}

	async list(params) {
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

	static async exec(createInstance, args) {
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
