/// Take 8-bit data and return it expanded to fit in 7-bit bytes.
function encode8bit7(input)
{
	let out = [];
	let bits = 0;
	let buffer = 0;
	let i = 0;
	while (i < input.length) {
		if (bits < 7) {
			buffer |= input[i] << bits;
			bits += 8;
			i++;
		} else {
			out.push(buffer & 0x7F);
			buffer >>= 7;
			bits -= 7;
		}
	}
	while (bits > 0) {
		// Write out the rest
		out.push(buffer & 0x7F);
		buffer >>= 7;
		bits -= 7;
	}
	return out;
}

module.exports = encode8bit7;
