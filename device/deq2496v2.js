/**
 * DEQ2496v2 specific code.
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

const checksumTZ = require('../algo/checksumTZ.js');
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

class DEQ2496v2FirmwareDecoder
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
		if ((blockNum >= 4) && (blockNum < 0x5B)) {
			// Another layer of encryption to remove.
			return midiFirmwareCoder(blockNum, blockData);
		}

		// Other blocks aren't encrypted, only the application is.
		return blockData;
	}
};

class DEQ2496v2
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
		return new DEQ2496v2FirmwareDecoder();
	}

	static encodeFirmware(address, binData, messages, fnCallback)
	{
		// XOR encrypt just the application blocks
		if (address == 0x4000) {
			binData = xor(KEY_FW_APP, binData);
		}
		// XOR encrypt just the application blocks
		// If flashing boot logo, check for .png
		if (address == 0x7E000) {
			try {
				const png = PNG.sync.read(binData);
				debug('Input is in .png format, address is boot logo, converting');
				if ((png.width != 320) || (png.height != 80)) {
					throw new Error('Input .png must be 320x80 pixels');
				}
				let outData = Buffer.alloc(png.height * png.width / 8);
				for (let y = 0; y < png.height; y++) {
					for (let x = 0; x < png.width; x++) {
						let idx = (png.width * y + x) << 2;
						// We're only looking at the red channel but since it's mono it
						// probably doesn't matter.
						if (png.data[idx] == 0xFF) {
							outData[y * 40 + (x / 8) >>> 0] |= 0x80 >> (x % 8);
						}
					}
				}
				binData = outData;
			} catch (e) {
				debug('Not .png, continuing with original data:', e.message);
			}
		}

		// Pad the data up to 4 kB with 0xFF bytes (unflashed data)
		const padding = 4096 - (binData.length % 4096);
		const binPad = Buffer.alloc(padding, 0xFF);
		binData = Buffer.concat([binData, binPad]);

		function packSubblock(binData, midiBlockNum)
		{
			let checksum = checksumTZ(binData);

			let header = Buffer.from([
				midiBlockNum >> 8,
				midiBlockNum & 0xFF,
				checksum,
			]);

			let binBlock = Buffer.concat([header, binData]);

			// Encrypt the data with a simple XOR cipher.
			binBlock = xor(KEY_FW_BLOCK, binBlock);

			// Add the 7/8 coding, turning the 8-bit data into 7-bit clean.
			binBlock = sevenEightCoder.encode(binBlock);

			return Buffer.from(binBlock);
		}

		function insertMessage(strContent)
		{
			if (strContent) {
				// We have a message for this spot
				let msgblock = Buffer.concat([
					Buffer.from(strContent),
					Buffer.alloc(256 - strContent.length, 0x00),
				]);
				msgblock = packSubblock(msgblock, 0xFF00);
				fnCallback(msgblock, 1);
			}
		}

		let subblockCount = 0;

		// blockCount is the number of 4 kB blocks in the input data.
		const blockCount = binData.length >> 12; // ÷ 0x1000
		for (let i = 0; i < blockCount; i++) {
			const blockNum = (address >> 12) + i;

			const offset = i << 12;
			let blockContent = binData.slice(offset, offset + 0x1000);

			// Apply the block-level encryption.
			blockContent = midiFirmwareCoder(blockNum, blockContent);

			// Split the 4 kB block up into 256 byte chunks.
			for (let sub = 0; sub < 16; sub++) {

				// If there should be a message before this block, generate it.
				insertMessage(messages[subblockCount++]);

				// Generate the actual block.
				const offset = sub << 8;
				let subblock = blockContent.slice(offset, offset + 256);
				let midiBlockNum = (blockNum << 4) | sub;

				subblock = packSubblock(subblock, midiBlockNum);

				fnCallback(subblock, 0);
			}
		}

		// If there's a final message at one block larger than the number we have,
		// insert it too.
		insertMessage(messages[subblockCount]);
	}

	static examineFirmware(blocks)
	{
		let info = {
			id: 'DEQ2496v2',
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

DEQ2496v2.modelId = util.models.deq2496;

module.exports = DEQ2496v2;
