import type { FieldDefinitionNode } from 'graphql';
import type { Kind } from 'graphql/language/kinds';

export function isNullable(type: FieldDefinitionNode) {
	return type.kind !== 'NonNullType' as Kind;
}
