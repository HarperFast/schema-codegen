import fs from 'fs';
import path from 'path';
import { processFile } from './processFile.ts';
import type { Table } from './table.ts';

export function processDirectory(dir: string, allTables: Map<string, Table[]>) {
	if (dir.includes('node_modules')) {
		return;
	}
	const files = fs.readdirSync(dir);
	for (const file of files) {
		const fullPath = path.join(dir, file);
		try {
			if (fs.statSync(fullPath).isDirectory()) {
				processDirectory(fullPath, allTables);
			} else {
				processFile(fullPath, allTables);
			}
		} catch (e) {
			// File might have been deleted by processFile (e.g. .d.ts)
		}
	}
}
