/**
 * DEQ2496v1 specific code.
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

const debug = require('debug')('behringerctl:device:deq2496v1');

const util = require('../util.js');
const xor = require('../algo/xor.js');

// This key is used to encrypt the firmware stored in flash.  The key is
// obtained from the bootloader if it's available (e.g. from a full flash dump)
// but since it's missing from the official firmware releases we fall back to
// this key.
const KEY_FW_APP = "- ORIGINAL BEHRINGER CODE - COPYRIGHT 2002 - BGER/TZ - \u0000";

class DEQ2496v1
{
	static identifyFirmware(blocks)
	{
		if (blocks[0]) {
			const sig = blocks[2].slice(0xC94, 0xC94 + 25).toString('utf8');
//			if (sig === 'DEQ2496V2 BOOTLOADER V2.2') return true;

		} else if (blocks[2]) {
			const sig = blocks[2].slice(0x020, 0x020 + 3).toString('utf8');
			debug('sig', sig);
			if (sig === 'SIG') return true;
		}

		return false;
	}

	static examineFirmware(blocks) {
		let info = {
			id: 'DEQ2496v1',
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

		if (blocks[2] !== undefined) {
			const imgContent = util.blocksToImage(blocks, 2, 0x5F);

			info.images.push({
				title: 'Application (raw)',
				data: imgContent,
				offset: 0x2000,
				capacity: 0x5F000 - 0x2000,
			});

			// Use the default known one if we can't get it from the bootloader.
			if (!appKeyDec) appKeyDec = KEY_FW_APP;

			const imgAppDec = xor(appKeyDec, imgContent);
			info.images.push({
				title: 'Application (decrypted)',
				data: imgAppDec,
				offset: 0x2000,
				capacity: 0x5F000 - 0x2000,
			});
		}

		if (blocks[0x5F] !== undefined) {
			const imgContent = util.blocksToImage(blocks, 0x5F, 0x60);

			info.images.push({
				title: 'Startup screen',
				data: imgContent,
				offset: 0x5F000,
				capacity: 0x60000 - 0x5F000,
			});
		}

		if (blocks[0x60] !== undefined) {
			const imgContent = util.blocksToImage(blocks, 0x60, 0x68);

			info.images.push({
				title: 'Presets',
				data: imgContent,
				offset: 0x60000,
				capacity: 0x68000 - 0x60000,
			});
		}

		if (blocks[0x68] !== undefined) {
			const imgContent = util.blocksToImage(blocks, 0x68, 0x6A);

			info.images.push({
				title: 'Scratch space',
				data: imgContent,
				offset: 0x68000,
				capacity: 0x6A000 - 0x68000,
			});
		}

		if (blocks[0x6A] !== undefined) {
			const imgContent = util.blocksToImage(blocks, 0x6A, 0x80);

			info.images.push({
				title: 'Hardware data',
				data: imgContent,
				offset: 0x6A000,
				capacity: 0x80000 - 0x6A000,
			});
		}

		return info;
	}
};

module.exports = DEQ2496v1;
