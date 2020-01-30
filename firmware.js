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
	/**
	 * Read a firmware file and return information about it.
	 *
	 * @param Buffer dataIn
	 *   Input data buffer, e.g. returned from fs.readFileSync().
	 *
	 * @return Array containing information about the firmware.
	 */
	static decode(dataIn)
	{
		let isSysex = false;
		if ((dataIn[0] === 0xF0) && (dataIn[dataIn.length - 1] == 0xF7)) {
			isSysex = true;
			for (const b of dataIn) {
				if ((b & 0x80) && (b < 0xF0)) {
					isSysex = false;
					break;
				}
			}
		}

		let detail = {};

		let blocks = [];
		if (isSysex) {
			detail['Format'] = 'Raw MIDI SysEx';

			let lcdMessages = {};
			const sysExContent = midiData.blocksFromSysEx(dataIn, (index, msg) => {
				lcdMessages[index] = msg;
			});
			detail['LCD Messages'] = lcdMessages;

			blocks = sysExContent.fwBlocks;
			detail['SysEx target model'] = util.getModelName(sysExContent.targetModel);
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
		}

		return {
			blocks: blocks,
			detail: detail,
		};
	}

	/// Look for some signatures to identify firmware versions.
	static examine(blocks)
	{
		let fnExamine;
		const debugSig = debug.extend('sigcheck');

		for (let dev in device) {
			debugSig(`Checking firmware for match against: ${dev}`);
			if (device[dev].identifyFirmware(blocks)) {
				return device[dev].examineFirmware(blocks);
			}
		}

		return null;
	}

};

module.exports = BehringerFirmware;
