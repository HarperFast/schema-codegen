import { createHash } from 'node:crypto';

/**
 * Object keys are sorted at every depth; `undefined` members are dropped, as `JSON.stringify` does.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJSON(value) {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJSON(item === undefined ? null : item)).join(',')}]`;
	}
	const record = /** @type {Record<string, unknown>} */ (value);
	const members = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`);
	return `{${members.join(',')}}`;
}

/**
 * @param {unknown} value
 * @returns {string} lowercase hex SHA-256 of the value's canonical JSON
 */
export function hashCanonical(value) {
	return createHash('sha256').update(canonicalJSON(value)).digest('hex');
}
