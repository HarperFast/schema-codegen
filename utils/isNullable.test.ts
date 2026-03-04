import type { Attribute } from 'harperdb';
import { describe, expect, it } from 'vitest';
import { isNullable } from './isNullable.ts';

describe('isNullable', () => {
	it('should return false if it is a primary key', () => {
		expect(isNullable({ isPrimaryKey: true, nullable: true } as Attribute)).toBe(false);
		expect(isNullable({ isPrimaryKey: true, nullable: false } as Attribute)).toBe(false);
		expect(isNullable({ isPrimaryKey: true } as Attribute)).toBe(false);
	});

	it('should return true if nullable is true and not a primary key', () => {
		expect(isNullable({ isPrimaryKey: false, nullable: true } as Attribute)).toBe(true);
		expect(isNullable({ nullable: true } as Attribute)).toBe(true);
	});

	it('should return false if nullable is false and not a primary key', () => {
		expect(isNullable({ isPrimaryKey: false, nullable: false } as Attribute)).toBe(false);
		expect(isNullable({ nullable: false } as Attribute)).toBe(false);
	});

	it('should return true if nullable is undefined and not a primary key', () => {
		expect(isNullable({ isPrimaryKey: false } as Attribute)).toBe(true);
		expect(isNullable({} as Attribute)).toBe(true);
	});
});
