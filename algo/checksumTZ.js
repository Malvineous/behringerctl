/**
 * Implementation of Behringer's SysEx checksum.
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
 * Checksum function for Behringer firmware write blocks.
 *
 * Named TZ as assuming those are the initials of the algorithm designer, given
 * the other XOR keys used.
 *
 * Algorithm reverse engineered by Adam Nielsen <malvineous@shikadi.net>
 *
 * @param data
 *   Array of bytes.
 *
 * @return Number, 8-bit unsigned checksum value.
 */
function checksumTZ(data) {
	let crc = 0;
	for (let b of data) {
		for (let j = 0; j < 8; j++) {
			if (!((b ^ crc) & 1)) crc ^= 0x19;
			b >>= 1;
			// Rotate (shift right, move lost LSB to new MSB)
			crc = ((crc & 1) << 7) | (crc >> 1);
		}
	}
	return crc ^ 0xbf;
}

module.exports = checksumTZ;
