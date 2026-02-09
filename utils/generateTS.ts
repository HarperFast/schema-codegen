import type { Table } from 'harperdb';
import { generateInterface } from './generateInterface.ts';
import { singularize } from './singularize.ts';
import type { TableMeta } from './tableMeta.ts';

export function generateTSFromTables(tablesInput: Table[], label: string = 'HarperDB schemas') {
	let tsCode = `/**
 Generated from ${label}
 Manual changes will be lost!
 > harper dev .
 */`;
	const tables: TableMeta[] = [];

	for (const table of tablesInput) {
		tsCode += generateInterface(table);
		tables.push({ plural: table.tableName, singular: singularize(table.tableName) });
	}

	return { tsCode, tables };
}
