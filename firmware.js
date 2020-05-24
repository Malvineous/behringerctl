/**
 * Behringer device control library, firmware component.
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

const debug = require('debug')('behringerctl:firmware');

const device = require('./device/index.js');
const midiData = require('./midiData.js');
const util = require('./util.js');

/// Accessed through `index.js` as `Behringer.firmware`
class BehringerFirmware
{
	/// Work out which device the SysEx data is targeted at.
	/**
	 * This may match multiple device models, e.g. model 0x12 is used for both
	 * DEQ2496v1 and DEQ2496v2.
	 *
	 * Return Array of zero or more Device classes.
	 */
	static identifyMIDITarget(binMIDI)
	{
		if (!midiData.isSysEx(binMIDI)) {
			throw new Error('Supplied data is not in MIDI format.');
		}

		// Just get the first event
		const sysExInfo = midiData.parseSysEx(binMIDI);
		if (!sysExInfo) {
			throw new Error('Supplied MIDI data is not in a known Behringer format.');
		}

		debug(`Device model is 0x${sysExInfo.modelId.toString(16)}, looking for a match`);
		let matchedDevices = [];
		for (let dev in device) {
			if (sysExInfo.modelId === device[dev].modelId) {
				debug(`Matched model ${dev}`);
				matchedDevices.push(device[dev]);
			}
		}

		return matchedDevices;
	}

	/**
	 * Read a firmware file and return information about it.
	 *
	 * @param Buffer dataIn
	 *   Input data buffer, e.g. returned from fs.readFileSync().
	 *
	 * @param string device
	 *   Device type.  Optional if the data is MIDI SysEx as the device can be
	 *   guessed from the MIDI data.
	 *
	 * @return Array containing information about the firmware.
	 */
	static decode(dataIn, deviceName = null)
	{
		let selectedDevice = null;

		// Convert the device string into a Device instance.
		if (deviceName) {
			for (let dev in device) {
				if (dev === deviceName) {
					selectedDevice = device[dev];
					break;
				}
			}
		}

		let isSysEx = midiData.isSysEx(dataIn);

		let detail = {};

		let blocks = [];
		if (isSysEx) {
			const binMIDI = dataIn;
			detail['Format'] = 'Raw MIDI SysEx';

			// Try to guess the device model from the MIDI data.
			if (!selectedDevice) {
				const matchedDevices = this.identifyMIDITarget(binMIDI);
				if (matchedDevices.length === 0) {
					throw new Error('Unknown device model number in MIDI data.');
				}

				if (matchedDevices.length > 1) {
					throw new Error('MIDI device model number matched too many devices!  '
						+ 'Please specify the device model to use.');
				}
				selectedDevice = matchedDevices[0];
			}

			let lcdMessages = {};

			let sysExCount = -1;
			const fwHandler = selectedDevice.getFirmwareDecoder();

			midiData.processMIDI(binMIDI, event => {
				sysExCount++;
				const eventInfo = midiData.parseSysEx(event);

				const fwBlock = fwHandler.addMIDIWrite(eventInfo);
				if (!fwBlock) return; // ignored

				if (fwBlock.message) {
					lcdMessages[sysExCount] = fwBlock.message;
				}
			});

			blocks = fwHandler.getBlocks();
			detail['LCD Messages'] = lcdMessages;
			detail['SysEx target model'] = util.getModelName(selectedDevice.modelId);

		} else {
			detail['Format'] = 'Raw binary';
			const blockCount = dataIn.length >> 12; // ÷ 0x1000
			for (let blockNum = 0; blockNum < blockCount; blockNum++) {
				const offset = blockNum << 12;
				const blockContent = dataIn.slice(offset, offset + 0x1000);

				// If the block only contains 0xFF bytes, drop it as this is
				// an empty flash block.
				blocks[blockNum] = null;
				for (let i = 0; i < blockContent.length; i++) {
					if (blockContent[i] != 0xFF) {
						blocks[blockNum] = blockContent;
						break;
					}
				}
			}

			// Try to see if we can identify the firmware.
			if (!selectedDevice) {
				for (let dev in device) {
					if (device[dev].identifyFirmware(blocks)) {
						selectedDevice = device[dev];
						break;
					}
				}
			}
		}

		return {
			device: selectedDevice,
			blocks: blocks,
			detail: detail,
		};
	}

	static encode(deviceModel, address, dataIn, messages = {})
	{
		if (!device[deviceModel]) throw new Error('Unsupported device model');

		const dev = device[deviceModel];

		let blockCount = 0, messageCount = 0;
		let midiBlocks = [];
		dev.encodeFirmware(address, dataIn, messages, (binSysExContent, blockType) => {
			midiBlocks.push(Buffer.from([
				0xF0,
				0x00,
				0x20,
				0x32,
				0x7F, // any device ID
				dev.modelId,
				0x34, // write fw block
			]));
			midiBlocks.push(binSysExContent);
			midiBlocks.push(Buffer.from([
				0xF7,
			]));
			if (blockType === 0) blockCount++;
			else if (blockType === 1) messageCount++;
		});

		return {
			blockCount: blockCount,
			messageCount: messageCount,
			binFirmware: Buffer.concat(midiBlocks),
		};
	}
};

module.exports = BehringerFirmware;
