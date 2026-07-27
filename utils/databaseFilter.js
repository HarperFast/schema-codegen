/**
 * Matches a database name against a list of patterns. Each pattern is either an
 * exact name or a glob using `*` as a wildcard for any run of characters, e.g.
 * `metrics-*` matches both `metrics-github` and `metrics-jira`. Matching is
 * case-sensitive and anchored (the whole name must match).
 * @param {string} name
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function matchesDatabase(name, patterns) {
	return patterns.some((pattern) => {
		// escape regex metacharacters, then turn the wildcard back into `.*`
		const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
		return new RegExp(`^${source}$`).test(name);
	});
}

/**
 * Decides whether a database should be included in codegen given optional
 * include/exclude lists. An empty or absent `include` list includes every
 * database; a non-empty `include` list restricts output to matching databases.
 * `exclude` then removes any matching database. Exclude wins over include.
 * @param {string} name
 * @param {{ include?: string[], exclude?: string[] }} [options]
 * @returns {boolean}
 */
export function shouldIncludeDatabase(name, options = {}) {
	const { include, exclude } = options;
	if (Array.isArray(include) && include.length > 0 && !matchesDatabase(name, include)) {
		return false;
	}
	if (Array.isArray(exclude) && exclude.length > 0 && matchesDatabase(name, exclude)) {
		return false;
	}
	return true;
}
