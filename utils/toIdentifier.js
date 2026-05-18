/**
 * Converts a name that may contain dashes into a valid TypeScript identifier
 * by converting kebab-case to camelCase.
 * e.g. "blog-posts" → "blogPosts", "my-table-name" → "myTableName"
 * Names without dashes are returned unchanged.
 * @param {string} name
 * @returns {string}
 */
export function toIdentifier(name) {
	return name.replace(/-([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}
