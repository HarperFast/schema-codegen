import type { Attribute } from 'harperdb';
import { describe, expect, it } from 'vitest';
import { mapType } from './mapType.ts';

describe('mapType', () => {
	it('should map primitive types to TypeScript types', () => {
		expect(mapType({ type: 'String' } as Attribute)).toBe('string');
		expect(mapType({ type: 'ID' } as Attribute)).toBe('string');
		expect(mapType({ type: 'Int' } as Attribute)).toBe('number');
		expect(mapType({ type: 'Float' } as Attribute)).toBe('number');
		expect(mapType({ type: 'Long' } as Attribute)).toBe('number');
		expect(mapType({ type: 'BigInt' } as Attribute)).toBe('bigint');
		expect(mapType({ type: 'Boolean' } as Attribute)).toBe('boolean');
		expect(mapType({ type: 'Date' } as Attribute)).toBe('string');
		expect(mapType({ type: 'Any' } as Attribute)).toBe('any');
	});

	it('should handle array types', () => {
		expect(mapType({ type: 'Array' } as Attribute)).toBe('any[]');
		expect(mapType({
			type: 'Array',
			elements: { type: 'String' },
		} as Attribute)).toBe('string[]');
	});

	it('should handle object types', () => {
		expect(mapType({ type: 'Object' } as Attribute)).toBe('Record<string, any>');
		expect(mapType({
			type: 'Object',
			properties: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'name', type: 'String', nullable: true },
			],
		} as Attribute)).toBe('{ id: string; name?: string; }');
	});

	it('should fallback to singularized type name for unknown types', () => {
		expect(mapType({ type: 'Users' } as Attribute)).toBe('User');
	});
});
