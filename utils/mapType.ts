import type { Attribute } from 'harperdb';
import { singularize } from './singularize.ts';

function mapObjectType(properties: Attribute[] | undefined): string {
	if (!properties || properties.length === 0) return 'Record<string, any>';
	const fields = properties
		.map((prop) => {
			const optional = prop.isPrimaryKey ? false : !!prop.nullable;
			return `${prop.name}${optional ? '?' : ''}: ${mapType(prop)};`;
		})
		.join(' ');
	return `{ ${fields} }`;
}

export function mapType(attribute: Attribute): string {
	const name = attribute?.type || 'Any';
	switch (name) {
		case 'String':
		case 'ID':
			return 'string';
		case 'Int':
		case 'Float':
		case 'Long':
			return 'number';
		case 'BigInt':
			return 'bigint';
		case 'Boolean':
			return 'boolean';
		case 'Date':
			return 'string';
		case 'Bytes':
		case 'Blob':
		case 'Any':
			return 'any';
		case 'array':
		case 'Array':
			if (attribute.elements) {
				return `${mapType(attribute.elements)}[]`;
			}
			return 'any[]';
		case 'object':
		case 'Object':
			if (attribute.properties && attribute.properties.length) {
				return mapObjectType(attribute.properties);
			}
			return 'Record<string, any>';
		default:
			// Fallback to using the type name (singularized) as an interface reference
			return singularize(name);
	}
}
