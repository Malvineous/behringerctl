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
				throw new OperationsError('Channel cannot be less than 1');
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
			}
		],
	},
};

module.exports = Operations;
