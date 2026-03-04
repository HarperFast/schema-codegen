import type { Table } from 'harperdb';
import { isNullable } from './isNullable.ts';
import { mapType } from './mapType.ts';
import { singularize } from './singularize.ts';

export function generateInterface(table: Table & { databaseName?: string }) {
	const pluralRaw = table.tableName;
	const singularRaw = singularize(pluralRaw);
	const dbPrefix = table.databaseName && table.databaseName !== 'data' ? `${table.databaseName}_` : '';
	const plural = `${dbPrefix}${pluralRaw}`;
	const singular = `${dbPrefix}${singularRaw}`;
	const isDifferent = plural !== singular;

	let code = `\nexport interface ${singular} {\n`;
	const primaryKeys: string[] = [];
	for (const attribute of table.attributes || []) {
		const type = mapType(attribute);
		const primaryKey = !!attribute.isPrimaryKey;
		const nullable = !primaryKey && isNullable(attribute);
		code += `\t${attribute.name}${nullable ? '?' : ''}: ${type};\n`;
		if (primaryKey) {
			primaryKeys.push(attribute.name!);
		}
	}
	code += `}\n\n`;

	const hasPks = primaryKeys.length > 0;
	const pks = hasPks ? primaryKeys.map((pk) => `'${pk}'`).join(' | ') : null;

	if (hasPks) {
		code += `export type ${dbPrefix}New${singularRaw} = Omit<${singular}, ${pks}>;\n`;
	}

	if (isDifferent) {
		code += `export type ${plural} = ${singular}[];\n`;
	}

	// Regardless
	if (singular !== `${singular}Record`) {
		code += `export type { ${singular} as ${singular}Record };\n`;
	}
	code += `export type ${singular}Records = ${singular}[];\n`;
	if (hasPks) {
		code += `export type ${dbPrefix}New${singularRaw}Record = Omit<${singular}, ${pks}>;\n`;
	}

	return code;
}
