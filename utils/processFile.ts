import fs from 'fs';
import { generateTS } from './generateTS.ts';
import { getLogger } from './logger.ts';
import type { Table } from './table.ts';

export function processFile(fullPath: string, allTables: Map<string, Table[]>) {
	if (!fullPath.endsWith('.graphql')) return;
	try {
		const content = fs.readFileSync(fullPath, 'utf8');
		const { tsCode, tables } = generateTS(content, fullPath);
		const ref = fullPath + '.ts';
		const existingTs = fs.existsSync(ref) && fs.readFileSync(ref, 'utf8');
		if (tsCode !== existingTs) {
			fs.writeFileSync(ref, tsCode, 'utf8');
			getLogger().debug(`Updated types in ${ref}`);
		}
		allTables.set(fullPath, tables);
	} catch (e: any) {
		getLogger().error(`Error processing ${fullPath}: ${e.message}`);
	}
}
