/**
 * Encode and decode data stored in Behringer 7/8 coding.
 *
 * This works in groups of seven bytes, removing the high bit from all seven
 * bytes and storing them in an eighth 7-bit byte.
 *
 * It is used to encode 8-bit binary firmware data such that it can be
 * transmitted as MIDI System Exclusive (SysEx) events, which require that none
 * of the SysEx data bytes have the high bit set.
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
