/** @typedef {import('harperdb').Table} Table */
/** @import { TableMeta } from './tableMeta.js' */
import { dbTypePrefix } from './dbTypePrefix.js';
import { generateJSDoc } from './generateJSDoc.js';
import { singularize } from './singularize.js';
import { toIdentifier } from './toIdentifier.js';

/**
 * @param {(Table & { databaseName: string })[]} tablesInput
 * @param {string} label
 */
export function generateJSDocFromTables(tablesInput, label = 'HarperDB schemas') {
	let jsCode = `/**
 Generated from ${label}
 Manual changes will be lost!
 > harper dev .
 */`;
	/** @type {TableMeta[]} */
	const tables = [];

	for (const table of tablesInput) {
		jsCode += generateJSDoc(table);
		const singular = `${dbTypePrefix(table.databaseName)}${toIdentifier(singularize(table.tableName))}`;
		tables.push({ tableName: table.tableName, singular, databaseName: table.databaseName });
	}

	return { jsCode, tables };
}
