/**
 * Implementation of Behringer's 7/8 coder, for passing 8-bit data via MIDI.
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
 * Encode and decode data stored in Behringer 7/8 coding.
 *
 * This works in groups of seven bytes, removing the high bit from all seven
 * bytes and storing them in an eighth 7-bit byte.
 *
 * It is used to encode 8-bit binary firmware data such that it can be
 * transmitted as MIDI System Exclusive (SysEx) events, which require that none
 * of the SysEx data bytes have the high bit set.
 *
 * Algorithm reverse engineered by Adam Nielsen <malvineous@shikadi.net>
 */
class SevenEightCoder
{

	/// Take 8-bit data and return it expanded to fit in 7-bit bytes.
	static encode(input)
	{
		let out = [];
		for (let i = 0; i < input.length; i += 7) {
			let buffer = 0;
			for (let j = 0; j < 7; j++) {
				let d;
				if (i >= input.length) {
					d = 0;
				} else {
					d = input[i + j];
				}
				out.push(d & 0x7F);
				buffer <<= 1;
				buffer |= d >> 7;
			}
			out.push(buffer);
		}
		return out;
	}

	static decode(input)
	{
		let out = [];
		let buffer = [];
		for (let i = 0; i < input.length; i += 8) {
			const highBits = input[i + 7];
			for (let j = 0; j < 7; j++) {
				const dec = input[i + j] | ((highBits << j << 1) & 0x80);
				out.push(dec);
			}
		}
		return out;
	}
};

module.exports = SevenEightCoder;
