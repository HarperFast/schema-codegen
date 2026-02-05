import type { FieldDefinitionNode, ObjectTypeDefinitionNode } from 'graphql';
import { isNullable } from './isNullable.ts';
import { mapType } from './mapType.ts';
import { singularize } from './singularize.ts';

export function generateInterface(node: ObjectTypeDefinitionNode) {
	const plural = node.name.value;
	const singular = singularize(plural);
	const isDifferent = plural !== singular;

	let code = `\nexport interface ${singular} {\n`;
	const primaryKeys = [];
	if (node.fields) {
		for (const field of node.fields) {
			const type = mapType(field.type as unknown as FieldDefinitionNode);
			const primaryKey = field.directives && field.directives.some(d => d.name.value === 'primaryKey');
			const nullable = !primaryKey && isNullable(field.type as unknown as FieldDefinitionNode);
			code += `\t${field.name.value}${nullable ? '?' : ''}: ${type};\n`;
			if (primaryKey) {
				primaryKeys.push(field.name.value);
			}
		}
	}
	code += `}\n\n`;

	const hasPks = primaryKeys.length > 0;
	const pks = hasPks ? primaryKeys.map(pk => `'${pk}'`).join(' | ') : null;

	if (hasPks) {
		code += `export type New${singular} = Omit<${singular}, ${pks}>;\n`;
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
		code += `export type New${singular}Record = Omit<${singular}, ${pks}>;\n`;
	}

	return code;
}
