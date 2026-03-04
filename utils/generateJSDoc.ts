import type { Table } from 'harperdb';
import { isNullable } from './isNullable.ts';
import { mapType } from './mapType.ts';
import { singularize } from './singularize.ts';

/**
 * Generates JSDoc types for a given HarperDB table.
 *
 * Example output:
 * /**
 *  * @typedef {Object} Track
 *  * @property {string} id
 *  * @property {string} name
 *  * @property {any} [mp3]
 *  *\/
 */
export function generateJSDoc(table: Table & { databaseName?: string }) {
	const pluralRaw = table.tableName;
	const singularRaw = singularize(pluralRaw);
	const dbPrefix = table.databaseName && table.databaseName !== 'data' ? `${table.databaseName}_` : '';
	const plural = `${dbPrefix}${pluralRaw}`;
	const singular = `${dbPrefix}${singularRaw}`;
	const isDifferent = plural !== singular;

	let code = `\n/**\n * @typedef {Object} ${singular}\n`;
	const primaryKeys: string[] = [];
	for (const attribute of table.attributes || []) {
		const type = mapType(attribute);
		const primaryKey = !!attribute.isPrimaryKey;
		const nullable = !primaryKey && isNullable(attribute);
		code += ` * @property {${type}} ${nullable ? '[' : ''}${attribute.name}${nullable ? ']' : ''}\n`;
		if (primaryKey) {
			primaryKeys.push(attribute.name!);
		}
	}
	code += ` */\n\n`;

	const hasPks = primaryKeys.length > 0;
	const pks = hasPks ? primaryKeys.map((pk) => `'${pk}'`).join(' | ') : null;

	if (hasPks) {
		code += `/** @typedef {Omit<${singular}, ${pks}>} ${dbPrefix}New${singularRaw} */\n`;
	}

	if (isDifferent) {
		code += `/** @typedef {${singular}[]} ${plural} */\n`;
	}

	// Regardless
	if (singular !== `${singular}Record`) {
		code += `/** @typedef {${singular}} ${singular}Record */\n`;
	}
	code += `/** @typedef {${singular}[]} ${singular}Records */\n`;
	if (hasPks) {
		code += `/** @typedef {Omit<${singular}, ${pks}>} ${dbPrefix}New${singularRaw}Record */\n`;
	}

	return code;
}
