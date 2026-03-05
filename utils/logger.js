/** @typedef {import('harperdb').Logger} Logger */

/** @type {Logger | null} */
let logger = null;

/**
 * @param {Logger} newLogger
 */
export function setLogger(newLogger) {
	logger = newLogger;
}

/**
 * @returns {Logger | null}
 */
export function getLogger() {
	return logger;
}
