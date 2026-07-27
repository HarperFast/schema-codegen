/** @typedef {import('harperdb').Table} Table */
import { shouldIncludeDatabase } from './databaseFilter.js';

/**
 * Collects every table from the live `databases` object, optionally scoped to a
 * subset of databases. Without options, every database on the instance is
 * included — on a shared instance that can pull in databases from other
 * applications, so pass `include`/`exclude` to scope output to this app.
 * @param {{ include?: string[], exclude?: string[] }} [options]
 * @returns {(Table & { databaseName: string })[]}
 */
export function collectTables(options = {}) {
	/** @type {(Table & { databaseName: string })[]} */
	const tablesList = [];
	for (const databaseName of Object.keys(databases || {})) {
		if (!shouldIncludeDatabase(databaseName, options)) {
			continue;
		}
		const tables = databases[databaseName];
		for (const tableName of Object.keys(tables || {})) {
			const TableClass = tables[tableName];
			if (!TableClass?.attributes) {
				continue;
			}
			tablesList.push(TableClass);
		}
	}
	return tablesList;
}
