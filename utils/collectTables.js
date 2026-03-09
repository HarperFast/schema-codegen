/** @typedef {import('harperdb').Table} Table */

/**
 * @returns {(Table & { databaseName: string })[]}
 */
export function collectTables() {
	/** @type {(Table & { databaseName: string })[]} */
	const tablesList = [];
	for (const databaseName of Object.keys(databases || {})) {
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
