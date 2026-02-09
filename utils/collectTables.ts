import { databases as hdbDatabases } from 'harperdb';

export function collectTables() {
	const tablesList: { tableName: string; attributes: any[] }[] = [];
	for (const dbName of Object.keys(hdbDatabases || {})) {
		const tables = (hdbDatabases as any)[dbName];
		for (const tableName of Object.keys(tables || {})) {
			const TableClass = tables[tableName];
			if (!TableClass?.attributes) continue;
			tablesList.push({ tableName, attributes: TableClass.attributes });
		}
	}
	return tablesList;
}
