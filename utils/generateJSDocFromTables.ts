import type { Table } from 'harperdb';
import { generateJSDoc } from './generateJSDoc.ts';
import { singularize } from './singularize.ts';
import type { TableMeta } from './tableMeta.ts';

export function generateJSDocFromTables(
	tablesInput: (Table & { databaseName: string })[],
	label: string = 'HarperDB schemas',
) {
	let jsCode = `/**
 Generated from ${label}
 Manual changes will be lost!
 > harper dev .
 */`;
	const tables: TableMeta[] = [];

	for (const table of tablesInput) {
		jsCode += generateJSDoc(table);
		const dbPrefix = table.databaseName && table.databaseName !== 'data' ? `${table.databaseName}_` : '';
		const plural = `${dbPrefix}${table.tableName}`;
		const singular = `${dbPrefix}${singularize(table.tableName)}`;
		tables.push({ plural, singular, databaseName: table.databaseName });
	}

	return { jsCode, tables };
}
