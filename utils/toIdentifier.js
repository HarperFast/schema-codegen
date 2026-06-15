/**
 * Converts an arbitrary table name into a valid TypeScript identifier.
 *
 * - kebab-case is converted to camelCase: "blog-posts" → "blogPosts"
 * - any remaining characters that are not valid in an identifier are replaced
 *   with underscores: "my.table name" → "my_table_name"
 * - a leading digit is prefixed with an underscore, since an identifier cannot
 *   start with a number: "123_New4" → "_123_New4"
 *
 * Names that are already valid identifiers are returned unchanged.
 * @param {string} name
 * @returns {string}
 */
export function toIdentifier(name) {
	let identifier = name
		// kebab-case → camelCase, e.g. "blog-posts" → "blogPosts"
		.replace(/-([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
		// replace any remaining characters that are invalid in an identifier
		.replace(/[^a-zA-Z0-9_$]/g, '_');
	// an identifier cannot start with a digit
	if (/^[0-9]/.test(identifier)) {
		identifier = `_${identifier}`;
	}
	return identifier;
}
