function pad(field, width, fnColour) {
	const s = '' + field;
	return fnColour(s) + ''.padEnd(width - s.length);
}

module.exports = console.log;
module.exports.pad = pad;
