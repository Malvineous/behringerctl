const chalk = require('chalk');
const commandLineArgs = require('command-line-args');
const debug = require('debug')('behringerctl:devices');

const { OperationsError } = require('../error.js');
const output = require('../output.js');

class Operations
{
	constructor() {
	}

	async destructor() {
	}

	async list(params) {
		output(
			chalk.white.inverse('Index'.padEnd(5)),
			chalk.white.inverse('Title'.padEnd(16)),
		);

		// Reduce the timeout a bit because the DEQ2496 doesn't respond if the
		// preset is empty, even if there are valid presets later on.
		this.behringer.defaultTimeout = 500;

		for (let i = 0; i < 65; i++) {
			try {
				const preset = await this.behringer.readPreset(i);
				output(
					output.pad(i, 5, chalk.whiteBright),
					chalk.greenBright(preset.title)
				);
			} catch (e) {
				output(
					output.pad(i, 5, chalk.whiteBright),
					chalk.blueBright('empty')
				);
			}
		}
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
			proc.behringer = createInstance();
		} catch (e) {
			throw new OperationsError(`Unable to set up MIDI connection: ${e.message}`);
		}

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
	list: {
		summary: 'List all presets',
		optionList: [],
	},
};

module.exports = Operations;
