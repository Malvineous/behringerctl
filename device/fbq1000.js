/**
 * FBQ1000 specific code.
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

const debug = require('debug')('behringerctl:device:deq2496v2');
const PNG = require('pngjs').PNG;

const midiFirmwareCoder = require('../algo/midiFirmwareCoder.js');
const sevenEightCoder = require('../algo/sevenEightCoder.js');
const util = require('../util.js');
const xor = require('../algo/xor.js');

// Key used to encrypt MIDI flash writes.
const KEY_FW_BLOCK = "TZ'04";

// This key is used to encrypt the firmware stored in flash.  The key is
// obtained from the bootloader if it's available (e.g. from a full flash dump)
// but since it's missing from the official firmware releases we fall back to
// this key.
const KEY_FW_APP = "- ORIGINAL BEHRINGER CODE - COPYRIGHT 2004 - BGER/TZ - \u0000";

class FBQ1000FirmwareDecoder
{
	constructor()
	{
		this.subblocks = [];
	}

	/// Decode the content of a MIDI sysex firmware write message.
	addMIDIWrite(eventInfo)
	{
		if (eventInfo.command != 0x34) {
			debug(`Ignoring SysEx command ${eventInfo.command.toString(16)}`);
			return null;
		}

		// Remove the 7/8 coding, restoring the full 8-bit bytes.
		const data8bit = sevenEightCoder.decode(eventInfo.binData);

		// Decrypt the data with a simple XOR cipher.
		const data = xor(KEY_FW_BLOCK, data8bit);

		const blockNumber = (data[0] << 8) | data[1];
		const flashContent = data.slice(3);

		if (blockNumber === 0xFF00) {
			const trimmed = flashContent.slice(0, flashContent.indexOf(0));
			const message = trimmed.toString('utf-8');
			return {
				message: message,
			};
		}

		this.subblocks[blockNumber] = flashContent;

		return {
			blockNumber: blockNumber,
			crc: data[2],
			binData: flashContent,
		};
	}

	getBlocks()
	{
		let blocks = [];
		for (let i = 0; i < 0x80; i++) {
			let nextBlock = [];
			for (let s = 0; s < 16; s++) {
				let subblock = this.subblocks[(i << 4) + s];
				if (!subblock) {
					nextBlock = null;
					break;
				}
				nextBlock.push(subblock);
			}
			if (!nextBlock) continue;
			blocks[i] = this.decodeBlock(
				i,
				Buffer.concat(nextBlock)
			);
		}
		return blocks;
	}

	decodeBlock(blockNum, blockData)
	{
		// Another layer of encryption to remove.
		return midiFirmwareCoder(blockNum, blockData);
	}
};

class FBQ1000
{
	static identifyFirmware(blocks)
	{
		if (blocks[2]) {
			const sig = blocks[2].slice(0xC94, 0xC94 + 25).toString('utf8');
			if (sig === 'DEQ2496V2 BOOTLOADER V2.2') return true;

		} else if (blocks[4]) {
			const sig = blocks[4].slice(0x01C, 0x01C + 4).toString('utf8');
			if (sig === 'COPY') return true;
		}

		return false;
	}

	static getFirmwareDecoder()
	{
		return new FBQ1000FirmwareDecoder();
	}

	static examineFirmware(blocks)
	{
		let info = {
			id: 'FBQ1000',
			detail: [],
			images: [],
		};

		// Add a special image for a full firmware dump
		info.images.push({
			offset: 0,
			capacity: 0x80000,
			data: util.blocksToImage(blocks, 0, 0x80, true),
			title: '(raw dump of flash chip content, see docs)',
		});

		let appKeyDec;

		// Combine the blocks into images
		if (blocks[0] !== undefined) {
			const imgContent = util.blocksToImage(blocks, 0, 4);

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
			const imgContent = util.blocksToImage(blocks, 4, 0x5B);

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
			const imgContent = util.blocksToImage(blocks, 0x5B, 0x74);

			info.images.push({
				title: 'Unused',
				data: imgContent,
				offset: 0x5B000,
				capacity: 0x74000 - 0x5B000,
			});
		}

		if (blocks[0x74] !== undefined) {
			const imgContent = util.blocksToImage(blocks, 0x74, 0x7C);

			info.images.push({
				title: 'Presets',
				data: imgContent,
				offset: 0x74000,
				capacity: 0x7C000 - 0x74000,
			});
		}

		if (blocks[0x7C] !== undefined) {
			const imgContent = util.blocksToImage(blocks, 0x7C, 0x7E);

			info.images.push({
				title: 'Scratch space',
				data: imgContent,
				offset: 0x7C000,
				capacity: 0x7E000 - 0x7C000,
			});
		}

		if (blocks[0x7E] !== undefined) {
			const imgContent = util.blocksToImage(blocks, 0x7E, 0x80);

			info.images.push({
				title: 'Boot screen',
				data: imgContent,
				offset: 0x7E000,
				capacity: 0x80000 - 0x7E000,
			});

			let pngBoot = new PNG({
				width: 320,
				height: 80,
				inputColorType: 0, // greyscale
				colorType: 0, // greyscale
			});

			for (let p = 0; p < imgContent.length; p++) {
				const pixelByte = imgContent[p];
				for (let bit = 0; bit < 8; bit++) {
					const pixel = (pixelByte & (0x80 >> bit)) ? 0xFF : 0x00;
					const y = (p / 40) >>> 0, x = (p % 40) * 8 + bit;
					let offset = 4 * (320 * y + x);
					pngBoot.data[offset] = pixel;
					pngBoot.data[offset+1] = pixel;
					pngBoot.data[offset+2] = pixel;
					pngBoot.data[offset+3] = 0xFF;
				}
			}

			info.images.push({
				title: 'Boot screen (converted to .png)',
				data: PNG.sync.write(pngBoot),
				offset: 0x7E000,
			});
		}

		return info;
	}
};

FBQ1000.modelId = util.models.fbq1000;

module.exports = FBQ1000;
