const debug = require('debug')('behringerctl:behringer');
const g_debug = debug;

const DEVICE_ID_ANY = 0x7F;
const SYSEX_COMPANY_ID_BEHRINGER = 0x002032;

const models = {
	deq2496: 0x12,
	ANY: 0x7F,
};

const commands = {
	identify: 0x01,
	identifyResponse: 0x02,
	writeSinglePreset: 0x20,
	writeModulePresets: 0x21,
	writeSingleValue: 0x22,
	setMIDIChannel: 0x24,
	writeFlash: 0x34,
	writeFlashResponse: 0x35,
	screenshotResponse: 0x36,
	readSinglePreset: 0x60,
	readModulePreset: 0x61,
	getScreenshot: 0x76,
	ANY: 0xFF,
};

/*const commandNames = {
	0x01: 'identify',
	0x02: 'identifyResponse',
	0x20: 'writeSinglePreset',
	0x21: 'writeModulePresets',
	0x22: 'writeSingleValue',
	0x24: 'setMIDIChannel',
	0x34: 'writeFlash',
	0x35: 'writeFlashResponse',
	0x60: 'getSinglePreset',
	0x61: 'getModulePreset',
	0x76: 'getScreenshot',
};*/

function getCommandName(c)
{
	const commandId = parseInt(c);
	let commandName = 'unknown';
	for (const i of Object.keys(commands)) {
		if (commands[i] === commandId) {
			commandName = i;
			break;
		}
	}
	return `${commandName}(${commandId})`;
}

function getModelName(m)
{
	const modelId = parseInt(m);
	let modelName = 'unknown';
	for (const i of Object.keys(models)) {
		if (models[i] === modelId) {
			modelName = i;
			break;
		}
	}
	return `${modelName}(${modelId})`;
}

class Behringer
{
	constructor(midiOutputStream)
	{
		// How many milliseconds to wait before giving up on a SysEx that we never
		// received a response to.
		this.defaultTimeout = 2000;

		this.midiOut = midiOutputStream;
		this.listeners = {};
		this.nextListenerId = 1;
		this.modelId = models.ANY;
		this.deviceId = null;
	}

	/// Handle an incoming MIDI message.
	/**
	 * @param Array message
	 *   Raw MIDI message as an array of bytes.
	 */
	onMessage(message)
	{
		const debug = g_debug.extend('receive');

		if (message[0] !== 0xF0) {
			debug('Ignoring non SysEx message');
			return;
		}

		const companyId = (message[1] << 16) | (message[2] << 8) | message[3];
		if (companyId !== SYSEX_COMPANY_ID_BEHRINGER) {
			debug(`Ignoring message for unsupported company: ${companyId}`);
		debug(response.data);
		debug(Buffer.from(response.data).toString('ascii'));
			return;
		}

		let response = {
			deviceId: message[4],
			modelId: message[5],
			command: message[6],
			data: message.slice(7, message.length - 8),
		};

		debug(`${getModelName(response.modelId)}@${response.deviceId}: ${getCommandName(response.command)}`);
		debug(response.data);
		debug(Buffer.from(response.data).toString('ascii'));

		this.callListeners(response);
	}

	/// Find all connected devices.
	/**
	 * @param Number waitTime
	 *   Number of milliseconds to wait until returning responses.  Should be
	 *   large enough to give all connected devices time to respond.
	 *
	 * @param Number modelId
	 *   Restrict the query to devices of specific models only.  Defaults to any.
	 *
	 * @param Number deviceId
	 *   Restrict the query to devices with a specific ID only.  Defaults to any.
	 *
	 * @return Array of discovered devices, e.g. `[ {modelId: 18, deviceId: 0, modelName: 'DEQ2496'} ]`.
	 */
	find(waitTime = 5000, modelId = models.ANY, deviceId = DEVICE_ID_ANY)
	{
		return new Promise((resolve, reject) => {
			let deviceList = [
			];

			const listenerId = this.addListener(
				modelId,
				deviceId,
				commands.identifyResponse,
				msg => {
					deviceList.push({
						modelId: msg.modelId,
						deviceId: msg.deviceId,
						modelName: Buffer.from(msg.data).toString('ascii'),
					});
				}
			);
			this.sendMessage(modelId, deviceId, commands.identify, []);

			const timerHandle = setTimeout(() => {
				this.removeListener(listenerId);
				resolve(deviceList);
			}, waitTime);
		});
	}

	/// Select a device for the other functions to communicate with.
	/**
	 * @param Number modelId
	 *   Model ID of the device to send to, returned by find().
	 *
	 * @param Number deviceId
	 *   Device ID of the device to send to, returned by find().  Specify
	 *   `undefined` to set to any/all devices.
	 *
	 * @return None.
	 */
	selectDevice(modelId = models.ANY, deviceId)
	{
		debug(`Selected model ${modelId}, device ${deviceId}`);
		this.modelId = modelId;
		if (deviceId === undefined) {
			this.deviceId = DEVICE_ID_ANY;
		} else {
			this.deviceId = deviceId;
		}
	}

	sanityCheck()
	{
		if (this.deviceId === null) {
			throw new Error('A device ID was not specified.');
		}
	}

	/// Query the selected device.
	/**
	 * @pre Device has been chosen by selectDevice().
	 *
	 * @return Object Device info, e.g. `{modelName: 'DEQ2496'}`.
	 */
	async identify()
	{
		this.sanityCheck();

		const response = await this.sendMessageAsync(
			this.modelId,
			this.deviceId,
			commands.identify,
			[],
			commands.identifyResponse,
		);

		return {
			modelId: response.modelId,
			deviceId: response.deviceId,
			modelName: Buffer.from(response.data).toString('ascii'),
		};
	}

	/// Read a preset.
	/**
	 * @pre Device has been chosen by selectDevice().
	 *
	 * @return Object Device info, e.g. `{modelName: 'DEQ2496'}`.
	 */
	async readPreset(index)
	{
		this.sanityCheck();

		const response = await this.sendMessageAsync(
			this.modelId,
			this.deviceId,
			commands.readSinglePreset,
			[index],
			commands.writeSinglePreset,
		);

debug('TODO: Preset data is cut off (preset title truncated at 10 chars)');
		return {
			modelId: response.modelId,
			deviceId: response.deviceId,
			presetIndex: response.data[0],
			presetLength: (response.data[1] << 7) | response.data[2],
			presetRaw: response.data.slice(3),
		};
	}

	/// Retrieve a copy of the device's LCD display.
	/**
	 * @pre Device has been chosen by selectDevice().
	 *
	 * @return Array of rows, with each row an array of pixels.  Pixel values are
	 *   0 for off or 255 for on.
	 */
	async getScreenshot()
	{
		this.sanityCheck();

		const response = await this.sendMessageAsync(
			this.modelId,
			this.deviceId,
			commands.getScreenshot,
			[],
			commands.screenshotResponse,
		);

		let width, height, pixels = [], row = [];
		switch (response.modelId) {
			case models.deq2496:
				width = 46 * 7;
				height = 80;
				for (let d of response.data) {
					for (let i = 0; i < 7; i++) {
						const p = (d << i) & 0x40;
						row.push(p ? 255 : 0);
					}
					if (row.length === width) {
						pixels.push(row);
						row = [];
					}
				}
				if (row.length) {
					debug('WARNING: Device returned incomplete final row');
					pixels.push(row);
				}
				break;
		}

		return {
			modelId: response.modelId,
			deviceId: response.deviceId,
			width: width,
			height: height,
			raw: response.data,
			pixels: pixels,
		};
	}

	/// Change the MIDI channel the device will listen on.
	/**
	 * @pre Device has been chosen by selectDevice().
	 *
	 * @param Number channel
	 *   New channel between 0 and 15 inclusive.
	 *
	 * @return None
	 *
	 * @note The device will no longer respond on the original ID, as the MIDI
	 *   channel is the same as the device ID.  Use selectDevice() to continue
	 *   communication with the device after the MIDI channel has been changed.
	 */
	setMIDIChannel(channel)
	{
		this.sanityCheck();

		this.sendMessage(
			this.modelId,
			this.deviceId,
			0x24,
			[channel],
		);
	}

// TESTING
	async readMemory()
	{
		this.sanityCheck();

		for (let i = 0; i < 12; i++) {
			if (i == 0x76) continue;
			this.sendMessage(
				this.modelId,
				this.deviceId,
				i,
				[0, 0, 0, 0, 0],
			);
			await new Promise((resolve, reject) => setTimeout(() => resolve(), 200));
		}
		return;
	}

	/// Add a callback to receive incoming MIDI messages.
	addListener(modelId, deviceId, command, callback)
	{
		const listenerId = this.nextListenerId++;
		this.listeners[listenerId] = {
			modelId: modelId,
			deviceId: deviceId,
			command: command,
			callback: callback,
		};
	}

	/// Stop a callback from receiving further incoming MIDI messages.
	removeListener(listenerId)
	{
		delete this.listeners[listenerId];
	}

	/// Send a message with zero or more expected responses.
	/**
	 * @param Number modelId
	 *   Model ID of the device to send to, returned by find(), or `models.ANY`.
	 *
	 * @param Number deviceId
	 *   Device ID of the device to send to, returned by find(), or `DEVICE_ID_ANY`.
	 *
	 * @param Number command
	 *   Command to send, see `commands` global variable.
	 *
	 * @return Nothing.
	 *
	 * @note Add a listener with addListener() if any responses to this message
	 *   are expected.
	 */
	sendMessage(modelId, deviceId, command, data)
	{
		let content = [
			0xF0, // SysEx start
			(SYSEX_COMPANY_ID_BEHRINGER >> 16) & 0x7F,
			(SYSEX_COMPANY_ID_BEHRINGER >> 8) & 0x7F,
			(SYSEX_COMPANY_ID_BEHRINGER >> 0) & 0x7F,
			deviceId & 0x7F,
			modelId & 0x7F,
			command & 0x7F,
			...data,
			0xF7,
		];
		debug.extend('send')(`${getModelName(modelId)}@${deviceId}: ${getCommandName(command)}`);
		this.midiOut.write(content);
	}

	/// Send a message with exactly one expected response.
	/**
	 * @param Number modelId
	 *   Model ID of the device to send to, returned by find().
	 *
	 * @param Number deviceId
	 *   Device ID of the device to send to, returned by find().
	 *
	 * @param Number command
	 *   Command to send, see `commands` global variable.
	 *
	 * @param Number responseCommand
	 *   Only resolve the returned promise when this command is received from
	 *   the device.  Can be `commands.ANY` to resolve on the next command
	 *   received.
	 *
	 * @param Number timeout
	 *   Optional, defaults to `defaultTimeout`.  Rejects the promise if no
	 *   response is received within this many milliseconds.
	 *
	 * @return Promise, resolving to the received message on success.
	 */
	sendMessageAsync(modelId, deviceId, command, data, responseCommand, timeout)
	{
		return new Promise((resolve, reject) => {
			const timerHandle = setTimeout(() => {
				this.removeListener(listenerId);
				reject(new Error('Timed out waiting for response'));
			}, timeout || this.defaultTimeout);

			const listenerId = this.addListener(modelId, deviceId, responseCommand, msg => {
				clearTimeout(timerHandle);
				this.removeListener(listenerId);
				resolve(msg);
			});

			this.sendMessage(modelId, deviceId, command, data);
		});
	}

	callListeners(message)
	{
		for (const l of Object.values(this.listeners)) {
			if (
				(
					(message.deviceId !== DEVICE_ID_ANY)
					&& (l.deviceId !== DEVICE_ID_ANY)
					&& (message.deviceId !== l.deviceId)
				) || (
					(message.modelId !== models.ANY)
					&& (l.modelId !== models.ANY)
					&& (message.modelId !== l.modelId)
				) || (
					(l.command !== commands.ANY)
					&& (message.command !== l.command)
				)
			) {
				// Doesn't match this device, try the next one.
				continue;
			}
			l.callback(message);
		}
	}
};

Behringer.models = models;

module.exports = Behringer;
