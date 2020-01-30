/**
 * Utility functions for handling MIDI data.
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

const debug = require('debug')('behringerctl:midiData');
const g_debug = debug;

const checksumTZ = require('./algo/checksumTZ.js');
const midiFirmwareCoder = require('./algo/midiFirmwareCoder.js');
const sevenEightCoder = require('./algo/sevenEightCoder.js');
const xor = require('./algo/xor.js');

// DEQ2496 v1.x
const KEY_FW_BLOCK_1 = "TZ'02";

// DEQ2496 v2.x
const KEY_FW_BLOCK_2 = "TZ'04";

class MIDIData
{
	/// Figure out what kind of format the SysEx data is in.
	static identifySysEx(block)
	{
		const debug = g_debug.extend('identifySysEx');

		const companyId = (block[1] << 16) | (block[2] << 8) | block[3];
		if (companyId != 0x002032) {
			debug(`Invalid companyId 0x${companyId.toString(16)}, ignoring`);
			return;
		}
		const deviceId = block[4];
		const modelId = block[5];
		const command = block[6];

		if (command === 0x34) {
			// Remove header and final 0xF7 byte.
			let data7bit = block.slice(7, block.length - 1);

			// Remove the 7/8 coding, restoring the full 8-bit bytes.
			let data = sevenEightCoder.decode(data7bit);

			// Decrypt the data with a simple XOR cipher.
			let testData = xor(KEY_FW_BLOCK_2, data);
			//const blockNumber = (testData[0] << 8) | testData[1];
			let crc = testData[2];
			let expectedCRC = checksumTZ(testData.slice(3));

			debug('DEQ2496v2: CRC is 0x' + crc.toString(16) + ', expecting ' + expectedCRC.toString(16));
			if (crc === expectedCRC) {
				debug('SysEx CRC matches DEQ2496v2');
				return {
					id: 'DEQ2496v2',
					midiKey: KEY_FW_BLOCK_2,
				};
			}

			testData = xor(KEY_FW_BLOCK_1, data);
			crc = testData[2];
			expectedCRC = checksumTZ(testData.slice(3));

			debug('DEQ2496v1: CRC is 0x' + crc.toString(16) + ', expecting ' + expectedCRC.toString(16));
			//if (crc === expectedCRC) {
			//	debug('SysEx CRC matches DEQ2496v1');
			if (true) {
				debug('Assuming DEQ2496v1 due to unknown CRC');
				return {
					id: 'DEQ2496v1',
					midiKey: KEY_FW_BLOCK_1,
				};
			}

			return null;
		}
		return null;
	}

	/// Decode the data portion of a SysEx block and return 8-bit data.
	/**
	 * This decodes the 7-bit MIDI data into 8-bit data, verifies that the
	 * message is for a Behringer device, decrypts it, and returns the cleartext
	 * data for that block along with additional info from the header, such as
	 * which flash memory address the block is for.
	 */
	static decodeSysEx(identity, block)
	{
		const debugTrace = debug.extend('trace');

		const companyId = (block[1] << 16) | (block[2] << 8) | block[3];
		if (companyId != 0x002032) {
			debug(`Invalid companyId 0x${companyId.toString(16)}, ignoring`);
			return;
		}
		const deviceId = block[4];
		const modelId = block[5];
		const command = block[6];
		if (command === 0x34) {
			// Remove header and final 0xF7 byte.
			let data7bit = block.slice(7, block.length - 1);

			// Remove the 7/8 coding, restoring the full 8-bit bytes.
			let data = sevenEightCoder.decode(data7bit);

			// Decrypt the data with a simple XOR cipher.
			data = xor(identity.midiKey, data);

			const blockNumber = (data[0] << 8) | data[1];
			const crc = data[2];
			debugTrace(
				`Block 0x${blockNumber.toString(16)},`,
				`CRC 0x${crc.toString(16)},`,
				`targetModel: 0x${modelId.toString(16)}`
			);

			return {
				targetModel: modelId,
				blockNumber: blockNumber,
				crc: crc,
				content: data.slice(3),
			};

		} else {
			debug(`Unexpected command 0x${command.toString(16)}, ignoring.`);
		}
	}

	/// Convert raw MIDI data into firmware blocks.
	/**
	 * This picks out Behringer-specific "write firmware block" commands embedded
	 * within SysEx events, and if they are valid, extracts the data and returns
	 * an array of data blocks.
	 *
	 * @param function fnLCDMessage
	 *   Optional callback for blocks that cause a message to be written to the
	 *   device's LCD screen.  Function signature is `(index, content) => {}`,
	 *   with index being the number of 256-byte sub-blocks processed at the time
	 *   the message came in, e.g. 0 means the message arrived before any firmware
	 *   data.
	 *
	 * @return Array.  `targetModel` is a model ID byte suitable for passing to
	 *   Behringer.getModelName(), and `fwBlocks` is a sparse array with keys
	 *   as block numbers (e.g. 4 means flash offset 0x4000) and values as 4 kB
	 *   data blocks.
	 */
	static blocksFromSysEx(dataIn, fnLCDMessage)
	{
		let targetModel;
		let fwBlocks = [];

		let identity = null;
		let subBlockIndex = 0;
		let pos = 0;
		while (pos < dataIn.length) {
			switch (dataIn[pos]) {
				case 0xF0: // sysex
					let end = pos + 1;
					while (end < dataIn.length) {
						if (dataIn[end] & 0x80) break;
						end++;
					}
					if (dataIn[end] === 0xF7) {
						end++;
						const event = dataIn.slice(pos, end);

						/// Work out what format the data is in (e.g. which key to decrypt)
						if (!identity) {
							identity = this.identifySysEx(event);
							if (!identity) {
								throw new Error('Unable to identify target device from SysEx data');
							}
						}

						const data = this.decodeSysEx(identity, event);
						if (data) {
							targetModel = data.targetModel;
							if (data.blockNumber < 0xFF00) { // skip LCD messages

								const baseBlockNum = data.blockNumber >> 4;
								const subBlockNum = data.blockNumber & 0xF;
								if (!fwBlocks[baseBlockNum]) fwBlocks[baseBlockNum] = [];

								fwBlocks[baseBlockNum][subBlockNum] = data.content;

								if (fwBlocks[baseBlockNum].length === 16) {
									// All blocks received
									let block = Buffer.concat(fwBlocks[baseBlockNum]);

									// Another layer of encryption to remove.
									block = midiFirmwareCoder(baseBlockNum, block);

									fwBlocks[baseBlockNum] = block;
								}
								subBlockIndex++;

							} else {
								// End message at first terminating null
								const trimmed = data.content.slice(0, data.content.indexOf(0));
								const message = trimmed.toString('utf-8');
								debug('Write message to LCD screen:', message);
								if (fnLCDMessage) {
									fnLCDMessage(subBlockIndex, message);
								}
							}
						}
					} else {
						debug(`Unexpected end to SysEx 0x${dataIn[end].toString(16)}`);
					}
					pos = end;
					break;
				default:
					debug(`Unexpected MIDI event 0x${dataIn[pos].toString(16)}`);
					break;
			}
		}
		debug(`Processed ${pos} of ${dataIn.length} bytes`);

		return {
			targetModel: targetModel,
			fwBlocks: fwBlocks,
		};
	}
};

module.exports = MIDIData;
