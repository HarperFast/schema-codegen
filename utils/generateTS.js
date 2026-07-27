/** @typedef {import('harperdb').Table} Table */
/** @import { TableMeta } from './tableMeta.js' */
import { dbTypePrefix } from './dbTypePrefix.js';
import { generateInterface } from './generateInterface.js';
import { singularize } from './singularize.js';
import { toIdentifier } from './toIdentifier.js';

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
		const singular = `${dbTypePrefix(table.databaseName)}${toIdentifier(singularize(table.tableName))}`;
		tables.push({ tableName: table.tableName, singular, databaseName: table.databaseName });
	}

	return { tsCode, tables };
}
