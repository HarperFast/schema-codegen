/** @typedef {import('harperdb').Attribute} Attribute */
import { describe, expect, it } from 'vitest';
import { mapType } from './mapType.js';

describe('mapType', () => {
	it('should map primitive types to TypeScript types', () => {
		expect(mapType({ type: 'String' })).toBe('string');
		expect(mapType({ type: 'ID' })).toBe('string');
		expect(mapType({ type: 'Int' })).toBe('number');
		expect(mapType({ type: 'Float' })).toBe('number');
		expect(mapType({ type: 'Long' })).toBe('number');
		expect(mapType({ type: 'BigInt' })).toBe('bigint');
		expect(mapType({ type: 'Boolean' })).toBe('boolean');
		expect(mapType({ type: 'Date' })).toBe('string');
		expect(mapType({ type: 'Any' })).toBe('any');
	});

	it('should handle array types', () => {
		expect(mapType({ type: 'Array' })).toBe('any[]');
		expect(mapType({
			type: 'Array',
			elements: { type: 'String' },
		})).toBe('string[]');
	});

	it('should handle object types', () => {
		expect(mapType({ type: 'Object' })).toBe('Record<string, any>');
		expect(mapType({
			type: 'Object',
			properties: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'name', type: 'String', nullable: true },
			],
		})).toBe('{ id: string; name?: string; }');
	});

	it('should fallback to singularized type name for unknown types', () => {
		expect(mapType({ type: 'Users' })).toBe('User');
	});
});
