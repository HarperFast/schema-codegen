import type { FieldDefinitionNode } from 'graphql';
import type { Kind } from 'graphql/language/kinds';
import { singularize } from './singularize.ts';

export function mapType(type: FieldDefinitionNode): string {
	if (type.kind === 'NonNullType' as Kind) {
		return mapType(type.type as unknown as FieldDefinitionNode);
	}
	if (type.kind === 'ListType' as Kind) {
		return `${mapType(type.type as unknown as FieldDefinitionNode)}[]`;
	}
	const name = type.name.value;
	switch (name) {
		case 'String':
		case 'ID':
			return 'string';
		case 'Int':
		case 'Float':
			return 'number';
		case 'Boolean':
			return 'boolean';
		case 'Date':
			return 'string';
		case 'Blob':
			return 'any';
		default:
			return singularize(name);
	}
}
