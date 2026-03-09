/** @import { TableMeta } from './tableMeta.js' */
import fs from 'fs';
import path from 'path';
import { getLogger } from './logger.js';

/**
 * @param {string} globalTypesPath
 * @param {string} schemaTypesPath
 * @param {TableMeta[]} tables
 */
export function generateTablesDTS(globalTypesPath, schemaTypesPath, tables) {
	let content = `/**
 Generated from your schema files
 Manual changes will be lost!
 > harper dev .
 */
`;
	content += `import type { Table } from 'harperdb';\n`;
	// Build a single import of all relevant types from schemaTypesPath
	/** @type {Set<string>} */
	const namesToImport = new Set();
	for (const table of tables) {
		namesToImport.add(table.singular);
	}
	if (namesToImport.size > 0) {
		const fromPathRaw = path.relative(path.dirname(globalTypesPath), schemaTypesPath);
		const fromPath = fromPathRaw.startsWith('.') ? fromPathRaw : './' + fromPathRaw;
		content += `import type { ${Array.from(namesToImport).join(', ')} } from '${fromPath}';\n`;
	}
	content += '\n';

	/** @type {Map<string, TableMeta[]>} */
	const dbMap = new Map();
	for (const table of tables) {
		if (!dbMap.has(table.databaseName)) {
			dbMap.set(table.databaseName, [table]);
		} else {
			dbMap.get(table.databaseName)?.push(table);
		}
	}

	content += `declare module 'harperdb' {\n`;

	// Export top-level tables for 'data' database
	const dataTables = dbMap.get('data') || [];
	content += `\texport const tables: {\n`;
	for (const table of dataTables) {
		content += `\t\t${table.plural}: { new(...args: any[]): Table<${table.singular}> };\n`;
	}
	content += `\t};\n\n`;

	// Export namespaced databases
	content += `\texport const databases: {\n`;
	for (const [dbName, dbTables] of dbMap.entries()) {
		content += `\t\t${dbName}: {\n`;
		for (const table of dbTables) {
			const pluralRaw = table.plural.startsWith(`${dbName}_`) ? table.plural.slice(dbName.length + 1) : table.plural;
			content += `\t\t\t${pluralRaw}: { new(...args: any[]): Table<${table.singular}> };\n`;
		}
		content += `\t\t};\n`;
	}
	content += `\t};\n`;

	content += `}\n`;
	const outPath = globalTypesPath;
	const dir = path.dirname(outPath);
	fs.mkdirSync(dir, { recursive: true });
	const existingContent = fs.existsSync(outPath) && fs.readFileSync(outPath, 'utf8');
	if (existingContent !== content) {
		fs.writeFileSync(outPath, content, 'utf8');
		getLogger()?.debug?.(`Updated types in ${outPath}`);
	}
}
