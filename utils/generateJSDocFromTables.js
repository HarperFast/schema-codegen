/** @typedef {import('harperdb').Table} Table */
/** @import { TableMeta } from './tableMeta.js' */
import { generateJSDoc } from './generateJSDoc.js';
import { singularize } from './singularize.js';

/**
 * @param {(Table & { databaseName: string })[]} tablesInput
 * @param {string} label
 */
export function generateJSDocFromTables(
	tablesInput,
	label = 'HarperDB schemas',
) {
	let jsCode = `/**
 Generated from ${label}
 Manual changes will be lost!
 > harper dev .
 */`;
	/** @type {TableMeta[]} */
	const tables = [];

	for (const table of tablesInput) {
		jsCode += generateJSDoc(table);
		const dbPrefix = table.databaseName && table.databaseName !== 'data' ? `${table.databaseName}_` : '';
		const plural = `${dbPrefix}${table.tableName}`;
		const singular = `${dbPrefix}${singularize(table.tableName)}`;
		tables.push({ plural, singular, databaseName: table.databaseName });
	}

	return { jsCode, tables };
}
