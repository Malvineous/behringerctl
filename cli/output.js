function pad(field, width, fnColour) {
	const s = '' + field;
	return fnColour(s) + ''.padEnd(width - s.length);
}

function padLeft(field, width, fnColour) {
	const s = '' + field;
	return ''.padEnd(width - s.length)+ fnColour(s);
}

module.exports = console.log;
module.exports.pad = pad;
module.exports.padLeft = padLeft;
