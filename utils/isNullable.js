/** @typedef {import('harperdb').Attribute} Attribute */

/**
 * @param {Attribute} attribute
 */
export function isNullable(attribute) {
	// Primary keys are always required
	if (attribute.isPrimaryKey) { return false; }
	return !!attribute.nullable || attribute.nullable === undefined;
}
