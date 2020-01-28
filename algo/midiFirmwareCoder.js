/**
 * Implementation of Behringer's 4 kB firmware-via-MIDI cipher.
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

/**
 * Encode and decode data encrypted by Behringer's 4 kB block cipher used before
 * MIDI firmware update data is written to flash.
 *
 * Algorithm reverse engineered by Adam Nielsen <malvineous@shikadi.net>
 *
 * @param Number baseBlockNum
 *   Firmware block address in units of 0x1000.  For firmware address 0x4000,
 *   this value should be 4.  It is the same as `firmwareOffset >> 12` or
 *   `blockNumber >> 4` where `blockNumber` is the two-byte prefix on the
 *   front of the first 256-byte block in the 4 kB page.
 *
 * @return Buffer.
 */
function midiFirmwareCoder(baseBlockNum, dataIn)
{
	let data = Buffer.from(dataIn);

	// If the block is zero, the function won't change the data, so this magic
	// number is used.
	let key = baseBlockNum || 0x545A;

	for (let pos = 0; pos < data.length;) {
		// Let's be fancy and execute the `if` statement without using an `if`.
		//if (key & 1) key ^= 0x8005;
		key ^= (
			((key & 1) << 15)
				| ((key & 1) << 2)
				| (key & 1)
		);

		// This rotate operation is a bit redundant, because the above XOR
		// always clears the lower bit.
		//key = ((key & 1) << 15) | (key >> 1);
		key >>= 1;

		data[pos++] ^= key & 0xFF;
		data[pos++] ^= key >> 8;
	}

	return data;
}

module.exports = midiFirmwareCoder;
