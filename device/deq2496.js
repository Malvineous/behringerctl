/**
 * DEQ2496 specific code.
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

const debug = require('debug')('behringerctl:device:deq2496');

const xor = require('../algo/xor.js');

// This key is used to encrypt the firmware stored in flash.  The key is
// obtained from the bootloader if it's available (e.g. from a full flash dump)
// but since it's missing from the official firmware releases we fall back to
// this key.
const KEY_FW_APP = "- ORIGINAL BEHRINGER CODE - COPYRIGHT 2004 - BGER/TZ - \u0000";

class DEQ2496
{
	static identifyFirmware(blocks)
	{
		if (blocks[2]) {
			const sigDEQ2496 = blocks[2].slice(0xC94, 0xC94 + 25).toString('utf8');
			if (sigDEQ2496 === 'DEQ2496V2 BOOTLOADER V2.2') return true;

		} else if (blocks[4]) {
			const sigDEQ2496 = blocks[4].slice(0x01C, 0x01C + 4).toString('utf8');
			if (sigDEQ2496 === 'COPY') return true;
		}

		return false;
	}

	static examineFirmware(blocks) {
		let info = {
			id: 'DEQ2496',
			detail: [],
			images: [],
		};

		function blocksToImage(firstBlock, endBlock, keepMissing = false) {
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

		// Add a special image for a full firmware dump
		info.images.push({
			offset: 0,
			capacity: 0x80000,
			data: blocksToImage(0, 0x80, true),
			title: '(raw dump of flash chip content, see docs)',
		});

		let appKeyDec;

		// Combine the blocks into images
		if (blocks[0] !== undefined) {
			const imgContent = blocksToImage(0, 4);

			info.images.push({
				title: 'Bootloader',
				data: imgContent,
				offset: 0,
				capacity: 0x4000,
			});

			function cut(offset, length) {
				return imgContent.slice(offset, offset + length);
			}

			info.id = cut(0x2C94, 25);

			const bootKey = cut(0x3002, 0x38);
			info.detail.push({
				title: 'Bootloader encryption key',
				value: bootKey.toString('utf8'),
				preserveTrailing: true,
			});

			const appKeyEnc = cut(0x303A, 0x38);
			appKeyDec = xor(bootKey, appKeyEnc);

			info.detail.push({
				title: 'Application encryption key',
				value: appKeyDec.toString('utf8'),
				preserveTrailing: true,
			});

			info.detail.push({
				title: 'MIDI firmware update encryption key',
				value: cut(0x2C84, 5).toString('utf8'),
				preserveTrailing: true,
			});

			info.detail.push({
				title: 'Bootloader LCD banner',
				value: cut(0x308A, 0x19).toString('utf8'),
			});
		}

		if (blocks[4] !== undefined) {
			const imgContent = blocksToImage(4, 0x5B);

			info.images.push({
				title: 'Application (raw)',
				data: imgContent,
				offset: 0x4000,
				capacity: 0x74000 - 0x4000,
			});

			// Use the default known one if we can't get it from the bootloader.
			if (!appKeyDec) appKeyDec = KEY_FW_APP;

			const imgAppDec = xor(appKeyDec, imgContent);
			info.images.push({
				title: 'Application (decrypted)',
				data: imgAppDec,
				offset: 0x4000,
				capacity: 0x74000 - 0x4000,
			});
		}

		if (blocks[0x5B] !== undefined) {
			const imgContent = blocksToImage(0x5B, 0x74);

			info.images.push({
				title: 'Unused',
				data: imgContent,
				offset: 0x5B000,
				capacity: 0x74000 - 0x5B000,
			});
		}

		if (blocks[0x74] !== undefined) {
			const imgContent = blocksToImage(0x74, 0x7C);

			info.images.push({
				title: 'Presets',
				data: imgContent,
				offset: 0x74000,
				capacity: 0x7C000 - 0x74000,
			});
		}

		if (blocks[0x7C] !== undefined) {
			const imgContent = blocksToImage(0x7C, 0x7E);

			info.images.push({
				title: 'Scratch space',
				data: imgContent,
				offset: 0x7C000,
				capacity: 0x7E000 - 0x7C000,
			});
		}

		if (blocks[0x7E] !== undefined) {
			const imgContent = blocksToImage(0x7E, 0x80);

			info.images.push({
				title: 'Hardware data',
				data: imgContent,
				offset: 0x7E000,
				capacity: 0x80000 - 0x7E000,
			});
		}

		return info;
	}
};

module.exports = DEQ2496;
