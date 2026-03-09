/** @typedef {import('harperdb').Table} Table */
/** @import { TableMeta } from './tableMeta.js' */
import { generateInterface } from './generateInterface.js';
import { singularize } from './singularize.js';

/**
 * @param {(Table & { databaseName: string })[]} tablesInput
 * @param {string} label
 * @returns {{ tsCode: string, tables: TableMeta[] }}
 */
export function generateTSFromTables(tablesInput, label = 'HarperDB schemas') {
	let tsCode = `/**
 Generated from ${label}
 Manual changes will be lost!
 > harper dev .
 */`;
	/** @type {TableMeta[]} */
	const tables = [];

	for (const table of tablesInput) {
		tsCode += generateInterface(table);
		const dbPrefix =
			table.databaseName && table.databaseName !== 'data' ? `${table.databaseName}_` : '';
		const plural = `${dbPrefix}${table.tableName}`;
		const singular = `${dbPrefix}${singularize(table.tableName)}`;
		tables.push({ plural, singular, databaseName: table.databaseName });
	}

	return { tsCode, tables };
}
