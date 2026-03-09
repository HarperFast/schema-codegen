/** @typedef {import('harperdb').Table} Table */
import { isNullable } from './isNullable.js';
import { mapType } from './mapType.js';
import { singularize } from './singularize.js';

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
 *
 * @param {Table & { databaseName?: string }} table
 */
export function generateJSDoc(table) {
	const pluralRaw = table.tableName;
	const singularRaw = singularize(pluralRaw);
	const dbPrefix =
		table.databaseName && table.databaseName !== 'data' ? `${table.databaseName}_` : '';
	const plural = `${dbPrefix}${pluralRaw}`;
	const singular = `${dbPrefix}${singularRaw}`;
	const isDifferent = plural !== singular;

	let code = `\n/**\n * @typedef {Object} ${singular}\n`;
	const primaryKeys = [];
	for (const attribute of table.attributes || []) {
		const type = mapType(attribute);
		const primaryKey = !!attribute.isPrimaryKey;
		const nullable = !primaryKey && isNullable(attribute);
		code += ` * @property {${type}} ${nullable ? '[' : ''}${attribute.name}${nullable ? ']' : ''}\n`;
		if (primaryKey) {
			primaryKeys.push(attribute.name);
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
