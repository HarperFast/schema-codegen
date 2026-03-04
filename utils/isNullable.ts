import type { Attribute } from 'harperdb';

export function isNullable(attribute: Attribute) {
	// Primary keys are always required
	if (attribute.isPrimaryKey) { return false; }
	return !!attribute.nullable || attribute.nullable === undefined;
}
