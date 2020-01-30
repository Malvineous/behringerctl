/**
 * Behringer device control library, utility functions.
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

const debug = require('debug')('behringerctl:util');

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

class BehringerUtil
{
	/// Convert a SysEx command byte into text.
	static getCommandName(c)
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

	/// Convert a SysEx target model byte into text.
	static getModelName(m)
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

	static blocksToImage(blocks, firstBlock, endBlock, keepMissing = false)
	{
		let imageBlocks = [];
		for (let i = firstBlock; i < endBlock; i++) {
			if (!blocks[i]) {
				// This block doesn't exist
				if (keepMissing) {
					// Simulate an unwritten flash block
					imageBlocks.push(Buffer.alloc(0x1000, 0xFF));
				} else {
					if (imageBlocks.length != 0) {
						// But we've put blocks in before, this is now a gap, so end
						debug(`Blocks ${firstBlock} to ${i - 1} are good, block ${i} is `
							+ `missing, ending early before reaching end block ${endBlock}`);
						break;
					}
				}
			} else {
				imageBlocks.push(blocks[i]);
			}
		}
		return Buffer.concat(imageBlocks);
	}
};

BehringerUtil.commands = commands;
BehringerUtil.models = models;

module.exports = BehringerUtil;
