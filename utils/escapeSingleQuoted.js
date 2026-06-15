/**
 * Escapes a string so it can be safely embedded inside a single-quoted
 * TypeScript/JavaScript string literal. Backslashes are escaped before quotes
 * so that the backslashes added when escaping quotes are not re-escaped.
 * e.g. o'connor → o\'connor, a\b → a\\b
 * @param {string} value
 * @returns {string}
 */
export function escapeSingleQuoted(value) {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
