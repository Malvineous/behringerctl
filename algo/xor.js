/**
 * Encode and decode data with a simple XOR cipher.
 *
 * XOR is symmetric, so the same function both encrypts and decrypts.
 *
 * @param String key
 *   Encryption key.
 *
 * @param Buffer|Array dataIn
 *   Input data to encrypt or decrypt.
 *
 * @return Buffer ciphertext or cleartext.
 */
function xor(key, dataIn)
{
	let data = Buffer.from(dataIn);
	if (typeof(key) === 'string') {
		key = key.split('').map(c => c.charCodeAt(0));
	}
	for (let i = 0; i < data.length; i++) {
		data[i] ^= key[i % key.length];
	}
	return data;
}

module.exports = xor;
