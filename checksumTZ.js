/**
 * Checksum function for Behringer firmware write blocks
 *
 * Named TZ as assuming those are the initials of the algorithm designer, given
 * the other XOR keys used.
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
