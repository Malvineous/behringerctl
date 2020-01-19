const chalk = require('chalk');
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const debug = require('debug')('behringerctl');
const glob = require('glob');
const path = require('path');
const midi = require('midi');

const { OperationsError } = require('./error.js');

const Behringer = require('../index.js');

const print = console.log;

function loadCommands()
{
	let commands = {};
	for (const file of glob.sync(__dirname + '/commands/*.js' )) {
		const filename = path.resolve(file);
		const command = path.basename(filename, '.js');
		commands[command] = require(filename);
	}
	return commands;
}

function findDefaultPort(midiInterface)
{
	const portCount = midiInterface.getPortCount();
	for (let i = 0; i < portCount; i++) {
		const portName = midiInterface.getPortName(i);
		// Pick first port that doesn't look like a MIDI Through one.
		if (!portName.includes('hrough')) {
			return i;
		}
	}

	// No through ports, return the first one.
	if (portCount > 0) return 0;

	// No ports at all!
	return null;
}

async function main()
{
	const commands = loadCommands();

	let cmdDefinitions = [
		{ name: 'debug', type: Boolean },
		{ name: 'midi-in', type: Number },
		{ name: 'midi-out', type: Number },
		{ name: 'model-id', type: Number },
		{ name: 'device-id', type: Number },
		{ name: 'all-devices', type: Boolean },
		{ name: 'name', defaultOption: true },
	];
	let argv = process.argv;

	let cmd = commandLineArgs(cmdDefinitions, { argv, stopAtFirstUnknown: true });

	if (cmd.debug) Debug.mute(false);

	if (!cmd.name || cmd.name === 'help') {
		let help = [];

		let subDef = [
			{ name: 'name', defaultOption: true, multiple: true },
		];

		let helpParams = {};
		try {
			helpParams = commandLineArgs(subDef, { argv: cmd._unknown || [] });
		} catch (e) {
			switch (e.name) {
				case 'UNKNOWN_OPTION':
				case 'UNKNOWN_VALUE':
				case 'ALREADY_SET':
					console.error(e.message);
					process.exit(2);
					break;
				default:
					throw e;
			}
		}

		if (!helpParams.name) {
			help.push({
				header: 'Behringer device control utility',
				content: './behringerctl [options] <command> <subcommand> [parameters]\n' +
					'./behringerctl help <command> <subcommand>',
			});

			help.push({
				header: 'Options',
				content: [
					{
						name: '--midi-in',
						summary: 'Index of MIDI device to receive on, from `midi list`',
					},
					{
						name: '--midi-out',
						summary: 'Index of MIDI device to sent commands to, from `midi list`',
					},
					{
						name: '--model-id',
						summary: 'Optional model number to direct commands to',
					},
					{
						name: '--device-id',
						summary: 'Device number to direct commands to, from `devices list`',
					},
					{
						name: '--all-devices',
						summary: 'Instead of --device-id, send the command to every listening device',
					},
				],
			});

			let subCommands = [];
			for (const c of Object.keys(commands)) {
				const cmdClass = commands[c];

				if (!cmdClass.names) {
					console.error('Malformed class definition for', c);
					return;
				}
				for (const sub of Object.keys(cmdClass.names)) {
					subCommands.push({
						name: `${c} ${sub}`,
						summary: cmdClass.names[sub].summary,
					});
				}
			}
			help.push({
				header: 'Commands',
				content: subCommands,
			});

			help.push({
				header: 'Example',
				content:
					'# Find available MIDI interfaces\n' +
					'./behringerctl midi list\n' +
					'\n' +
					'# Use those MIDI interfaces to find a Behringer device\n' +
					'./behringerctl --midi-in 1 --midi-out 1 devices list\n' +
					'\n' +
					'# Send the device a command\n' +
					'./behringerctl --midi-in 1 --midi-out 1 --device-id 0 devices identify',
			});

		} else if (helpParams.name.length != 2) {
			console.error('missing parameter: help [<command> <subcommand>]');
			return;

		} else {
			if (!commands[helpParams.name[0]]) {
				console.error('Unknown command:', helpParams.name[0]);
				return;
			}

			const subInfo = commands[helpParams.name[0]].names[helpParams.name[1]];
			if (!subInfo) {
				console.error('Unknown subcommand:', helpParams.name[1]);
				return;
			}

			const hasParams = subInfo.optionList.length > 0;

			const strParams = hasParams ? ' [parameters]' : '';
			help.push({
				header: 'Behringer device control utility',
				content: `./behringerctl ${helpParams.name[0]} ${helpParams.name[1]}${strParams}`,
			});

			help.push({
				content: subInfo.summary,
			});

			if (hasParams) {
				help.push({
					header: 'Parameters',
					...subInfo,
				});
			}
		}

		process.stdout.write(commandLineUsage(help));
		process.stdout.write('\n');
		return;
	}

	if (!commands[cmd.name]) {
		console.error(`Unknown command: ${cmd.name}`);
		process.exit(1);
	}

	let cleanup = () => {};

	function createInstance()
	{
		const midiOutput = new midi.Output();
		const outStream = midi.createWriteStream(midiOutput);
		const outPort = cmd['midi-out'] || findDefaultPort(midiOutput);
		if (outPort === null) {
			console.error('No output MIDI ports detected!');
			process.exit(2);
		}
		midiOutput.openPort(outPort);

		const midiInput = new midi.Input();
		const inPort = cmd['midi-in'] || findDefaultPort(midiInput);
		if (inPort === null) {
			console.error('No input MIDI ports detected!');
			process.exit(2);
		}
		midiInput.openPort(inPort);

		// Get sysex, ignore timing + active sense
		midiInput.ignoreTypes(false, true, true);

		debug(`Using MIDI ports: in=${inPort} out=${outPort}`);

		const b = new Behringer(outStream);
		midiInput.on('message', (deltaTime, message) => b.onMessage(message));

		let deviceId = null;
		if (cmd['device-id'] === undefined) {
			if (cmd['all-devices']) {
				deviceId = undefined; // any/all
			}
			// else leave is null (treated as device ID is unset)
		} else {
			deviceId = parseInt(cmd['device-id']);
		}
		b.selectDevice(cmd['model-id'], deviceId);

		// Close the ports when we're done or the app will never exit as it's
		// waiting to receive more MIDI messages.
		cleanup = () => {
			midiOutput.closePort();
			midiInput.closePort();
		};
		return b;
	}

	try {
		await commands[cmd.name].exec(createInstance, cmd._unknown || []);
	} catch (e) {
		if (e instanceof OperationsError) {
			console.error(chalk.redBright(cmd.name + ':'), e.message);
			process.exit(2);
		}
		switch (e.name) {
			case 'UNKNOWN_OPTION':
			case 'UNKNOWN_VALUE':
			case 'ALREADY_SET':
				console.error(chalk.redBright(cmd.name + ':'), e.message);
				process.exit(2);
				break;
			default:
				console.error(chalk.redBright('Unhandled error:'), e.message);
				process.exit(2);
				break;
		}
	}
	cleanup();
}

module.exports = main;
