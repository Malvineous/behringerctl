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

class MIDIData
{
	/// Is the supplied data in MIDI SysEx format?
	static isSysEx(binMIDI)
	{
		let isSysEx = false;
		if ((binMIDI[0] === 0xF0) && (binMIDI[binMIDI.length - 1] == 0xF7)) {
			isSysEx = true;
			for (const b of binMIDI) {
				if ((b & 0x80) && (b < 0xF0)) {
					isSysEx = false;
					break;
				}
			}
		}
		return isSysEx;
	}

	/// Parse raw MIDI data and dig out SysEx events.
	static processMIDI(binMIDI, fnCallback)
	{
		let pos = 0;
		while (pos < binMIDI.length) {
			switch (binMIDI[pos]) {
				case 0xF0: // sysex
					let end = pos + 1;
					while (end < binMIDI.length) {
						if (binMIDI[end] & 0x80) break;
						end++;
					}
					if (binMIDI[end] === 0xF7) {
						const event = binMIDI.slice(pos, end);
						end++;
						fnCallback(event);
					} else {
						debug(`Unexpected end to SysEx 0x${binMIDI[end].toString(16)}`);
					}
					pos = end;
					break;
				default:
					debug(`Unexpected MIDI event 0x${binMIDI[pos].toString(16)}`);
					break;
			}
		}
	}

	/// Parse a single sysex message and return the header and data chunk.
	static parseSysEx(binSysEx)
	{
		const companyId = (binSysEx[1] << 16) | (binSysEx[2] << 8) | binSysEx[3];
		if (companyId != 0x002032) {
			debug(`Invalid companyId 0x${companyId.toString(16)}, ignoring`);
			return;
		}
		return {
			deviceId: binSysEx[4],
			modelId: binSysEx[5],
			command: binSysEx[6],
			binData: binSysEx.slice(7),
		};
	}
};

module.exports = MIDIData;
