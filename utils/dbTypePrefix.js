import { toIdentifier } from './toIdentifier.js';

/**
 * Builds the prefix applied to generated *type names* for tables that live in a
 * non-default database. Tables in the default 'data' database are not
 * namespaced, so they receive no prefix.
 *
 * The database name is passed through {@link toIdentifier} so that databases
 * whose names are not valid identifiers still produce valid TypeScript type
 * names, e.g. a "metrics-github" database yields the prefix "metricsGithub_"
 * (and thus the type "metricsGithub_Repository" rather than the invalid
 * "metrics-github_Repository", which TypeScript parses as a subtraction).
 *
 * This is for type-name positions only. Runtime object keys (the actual
 * database and table names on the `databases` object) must be preserved
 * verbatim — quote those with {@link safeKey} instead.
 * @param {string | undefined} databaseName
 * @returns {string}
 */
export function dbTypePrefix(databaseName) {
	return databaseName && databaseName !== 'data' ? `${toIdentifier(databaseName)}_` : '';
}
