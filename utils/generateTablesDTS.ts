import fs from 'fs';
import path from 'path';
import { getLogger } from './logger.ts';
import type { Table } from './table.ts';

export function generateTablesDTS(schemasDir: string, allTables: Map<string, Table[]>) {
	let content = `/**
 Generated from your schema files
 Manual changes will be lost!
 > npm run generate
 */
`;
	content += `import type { Resource } from 'harperdb/v2';\n`;
	for (const [fullPath, tables] of allTables.entries()) {
		if (tables.length === 0) continue;
		const relativePath = './' + path.relative(schemasDir, fullPath);
		const namesToImport = new Set();
		for (const table of tables) {
			namesToImport.add(table.singular);
			if (table.plural !== table.singular) {
				namesToImport.add(table.plural);
			}
		}
		content += `import type { ${Array.from(namesToImport).join(', ')} } from '${relativePath}';\n`;
	}
	content += '\n';
	content += `declare module 'harperdb' {\n`;
	content += `\texport const tables: {\n`;
	for (const tables of allTables.values()) {
		for (const table of tables) {
			content += `\t\t${table.plural}: { new(identifier: Id, source: ${table.singular}): Resource<${table.singular}> };\n`;
		}
	}
	content += `\t};\n`;
	content += `}\n`;
	const tablesRef = path.join(schemasDir, 'tables.d.ts');
	const existingContent = fs.existsSync(tablesRef) && fs.readFileSync(tablesRef, 'utf8');
	if (existingContent !== content) {
		fs.writeFileSync(tablesRef, content, 'utf8');
		getLogger().debug(`Updated types in ${tablesRef}`);
	}
}
