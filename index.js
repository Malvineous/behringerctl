/**
 * Behringer device control library.
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

const debug = require('debug')('behringerctl:behringer');
const g_debug = debug;

const sevenEightCoder = require('./algo/sevenEightCoder.js');
const checksumTZ = require('./algo/checksumTZ.js');
const util = require('./util.js');

const DEVICE_ID_ANY = 0x7F;
const SYSEX_COMPANY_ID_BEHRINGER = 0x002032;

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
		this.modelId = util.models.ANY;
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
			return;
		}

		let response = {
			deviceId: message[4],
			modelId: message[5],
			command: message[6],
			data: message.slice(7, message.length - 8),
		};

		debug(`${util.getModelName(response.modelId)}@${response.deviceId}: ${util.getCommandName(response.command)}`);
		debug.extend('trace')(response.data);

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
	find(waitTime = 5000, modelId = util.models.ANY, deviceId = DEVICE_ID_ANY)
	{
		return new Promise((resolve, reject) => {
			let deviceList = [
			];

			const listenerId = this.addListener(
				modelId,
				deviceId,
				util.commands.identifyResponse,
				msg => {
					deviceList.push({
						modelId: msg.modelId,
						deviceId: msg.deviceId,
						modelName: Buffer.from(msg.data).toString('ascii'),
					});
				}
			);
			this.sendMessage(modelId, deviceId, util.commands.identify, []);

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
	selectDevice(modelId = util.models.ANY, deviceId)
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
			util.commands.identify,
			[],
			util.commands.identifyResponse,
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
	 * @return Object Preset details.
	 */
	async readPreset(index)
	{
		this.sanityCheck();

		const response = await this.sendMessageAsync(
			this.modelId,
			this.deviceId,
			util.commands.readSinglePreset,
			[index],
			util.commands.writeSinglePreset,
		);

		const length = (response.data[1] << 7) | response.data[2];

debug('TODO: Preset data is cut off (preset title truncated at 10 chars)');
		return {
			modelId: response.modelId,
			deviceId: response.deviceId,
			presetIndex: response.data[0],
			presetLength: length,
			presetContent: response.data.slice(3, length),
			// Title is whatever is following on from the data
			title: Buffer.from(response.data.slice(length + 3)).toString('ascii'),
			// Omit the index but keep the length field
			presetRaw: response.data.slice(1),
		};
	}

	/// Read a preset.
	/**
	 * @pre Device has been chosen by selectDevice().
	 *
	 * @param Buffer content
	 *   Raw data to write.  Must not contain any bytes >= 0x80.
	 *
	 * @return None.
	 */
	async writePreset(index, content)
	{
		this.sanityCheck();

		const data = [
			index,
			...content,
		];

		this.sendMessage(
			this.modelId,
			this.deviceId,
			util.commands.writeSinglePreset,
			data,
		);
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
			util.commands.getScreenshot,
			[],
			util.commands.screenshotResponse,
		);

		let width, height, pixels = [], row = [];
		switch (response.modelId) {
			case util.models.deq2496:
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

	async setLCDMessage(text)
	{
		this.sanityCheck();

		const textBytes = text.split('').map(c => c.charCodeAt(0));
		const dataBlock = [
			...textBytes,
			...new Array(256 - textBytes.length).fill(0),
		];

		return await this.writeBlock(0xFF00, dataBlock);
	}

	packBlock(offset, content)
	{
		return [
			offset >> 8,
			offset & 0xFF,
			checksumTZ(content),
			...content,
		];
	}

	encodeBlock(offset, content)
	{
		if (!content || (content.length != 256)) {
			throw new Error('Can only write blocks of 256 bytes');
		}

		let packedData = this.packBlock(offset, content);

		// Encrypt the data with a simple XOR cipher.
		const key = "TZ'04";
		for (let i = 0; i < packedData.length; i++) {
			packedData[i] ^= key[i % key.length].charCodeAt(0);
		}

		// Encode the 8-bit data into MIDI SysEx-safe 7-bit bytes.
		const encodedData = sevenEightCoder.encode(packedData);

		return encodedData;
	}

	async writeBlock(offset, content)
	{
		const debug = g_debug.extend('writeBlock');

		this.sendMessage(
			this.modelId,
			this.deviceId,
			util.commands.writeFlash,
			this.encodeBlock(offset, content),
		);

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
		const debug = g_debug.extend('send');
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
		debug(`${util.getModelName(modelId)}@${deviceId}: ${util.getCommandName(command)}`);
		debug.extend('trace')(content);

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
	 *   Command to send, see `util.commands` list.
	 *
	 * @param Number responseCommand
	 *   Only resolve the returned promise when this command is received from
	 *   the device.  Can be `util.commands.ANY` to resolve on the next command
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
					(message.modelId !== util.models.ANY)
					&& (l.modelId !== util.models.ANY)
					&& (message.modelId !== l.modelId)
				) || (
					(l.command !== util.commands.ANY)
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

Behringer.firmware = require('./firmware.js');
Behringer.util = util;

module.exports = Behringer;
