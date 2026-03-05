/** @typedef {import('harperdb').Attribute} Attribute */
import { describe, expect, it } from 'vitest';
import { isNullable } from './isNullable.js';

describe('isNullable', () => {
	it('should return false if it is a primary key', () => {
		expect(isNullable({ isPrimaryKey: true, nullable: true })).toBe(false);
		expect(isNullable({ isPrimaryKey: true, nullable: false })).toBe(false);
		expect(isNullable({ isPrimaryKey: true })).toBe(false);
	});

	it('should return true if nullable is true and not a primary key', () => {
		expect(isNullable({ isPrimaryKey: false, nullable: true })).toBe(true);
		expect(isNullable({ nullable: true })).toBe(true);
	});

	it('should return false if nullable is false and not a primary key', () => {
		expect(isNullable({ isPrimaryKey: false, nullable: false })).toBe(false);
		expect(isNullable({ nullable: false })).toBe(false);
	});

	it('should return true if nullable is undefined and not a primary key', () => {
		expect(isNullable({ isPrimaryKey: false })).toBe(true);
		expect(isNullable({})).toBe(true);
	});
});
