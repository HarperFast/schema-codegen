import path from 'path';
import { collectTables } from './collectTables.ts';
import { generateTablesDTS } from './generateTablesDTS.ts';
import { generateTSFromTables } from './generateTS.ts';
import type { TableMeta } from './tableMeta.ts';
import { writeIfChanged } from './writeIfChanged.ts';

export function regenerateAll(globalTypes: string, schemaTypes: string) {
	const list = collectTables();
	const { tsCode, tables } = generateTSFromTables(list, 'HarperDB schema');
	writeIfChanged(path.resolve(schemaTypes), tsCode);
	generateTablesDTS(path.resolve(globalTypes), path.resolve(schemaTypes), tables as TableMeta[]);
}
