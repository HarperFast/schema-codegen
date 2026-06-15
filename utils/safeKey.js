/**
 * Wraps a property name in quotes unless it is already a valid unquoted
 * TypeScript identifier. This covers names containing characters that are not
 * valid in an identifier (e.g. dashes or dots) as well as names that start with
 * a digit (e.g. "123_New4"). Valid identifiers are returned unchanged.
 *
 * Use this for object keys and interface property names, which may be quoted.
 * It is not suitable for type names (interfaces, type aliases), which must be
 * real identifiers — use {@link toIdentifier} for those.
 * @param {string} name
 * @returns {string}
 */
export function safeKey(name) {
	return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : `'${name}'`;
}
