const chalk = require('chalk');
const commandLineArgs = require('command-line-args');
const debug = require('debug')('behringerctl:screenshot');

const { OperationsError } = require('../error.js');
const output = require('../output.js');

class Operations
{
	constructor() {
	}

	async destructor() {
	}

	async show(params) {
		const ss = await this.behringer.getScreenshot();
		if (params['ascii']) {
			for (const row of ss.pixels) {
				process.stdout.write('>' + row.reduce((line, p) => line + (p ? '%' : ' '), '') + '<\n');
			}
		} else {
			for (let row = 0; row < ss.pixels.length; row += 2) {
				let line = '';
				for (let col = 0; col < ss.pixels[row].length; col++) {
					const char =
						(ss.pixels[row][col] ? 1 : 0) +
						(ss.pixels[row + 1][col] ? 2 : 0)
					;
					const chars = [
						' ',
						'\u2580',
						'\u2584',
						'\u2588',
					];
					line += chars[char];
				}
				process.stdout.write('>' + line + '<\n');
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
	show: {
		summary: 'Display the screenshot in the console with Unicode chars',
		optionList: [
			{
				name: 'ascii',
				type: Boolean,
				description: 'Use ASCII instead of Unicode',
			}
		],
	},
};

module.exports = Operations;
