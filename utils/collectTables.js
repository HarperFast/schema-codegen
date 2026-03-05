/** @typedef {import('harperdb').Table} Table */
import { databases as hdbDatabases } from 'harperdb';

/**
 * @returns {(Table & { databaseName: string })[]}
 */
export function collectTables() {
	/** @type {(Table & { databaseName: string })[]} */
	const tablesList = [];
	for (const dbName of Object.keys(hdbDatabases || {})) {
		const tables = hdbDatabases[dbName];
		for (const tableName of Object.keys(tables || {})) {
			const TableClass = tables[tableName];
			if (!TableClass?.attributes) { continue; }
			TableClass.databaseName = dbName;
			tablesList.push(/** @type {Table & { databaseName: string }} */ (TableClass));
		}
	}
	return tablesList;
}
