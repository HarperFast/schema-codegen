import { describe, expect, it } from 'vitest';
import {
	allocateMemberNames,
	createNameAllocator,
	escapeKotlinEnumEntry,
	escapeKotlinIdentifier,
	escapeSwiftIdentifier,
	RESERVED_TYPE_NAMES,
	toCodeIdentifier,
} from './naming.js';

describe('toCodeIdentifier', () => {
	it('keeps identifiers and camelCases kebab-case', () => {
		expect(toCodeIdentifier('customerId')).toBe('customerId');
		expect(toCodeIdentifier('first-name')).toBe('firstName');
	});

	it('drops characters Swift and Kotlin cannot use, including $', () => {
		expect(toCodeIdentifier('a.b c$d')).toBe('a_b_c_d');
		expect(toCodeIdentifier('o"conn\\or')).toBe('o_conn_or');
	});

	it('prefixes leading digits and empty names', () => {
		expect(toCodeIdentifier('9lives')).toBe('_9lives');
		expect(toCodeIdentifier('')).toBe('_');
	});
});

describe('createNameAllocator', () => {
	it('suffixes taken names and rechecks every suffix', () => {
		const allocator = createNameAllocator(['User']);
		expect(allocator.claimExact('User_2')).toBe(true);
		expect(allocator.claim('User')).toBe('User_3');
		expect(allocator.claim('Order')).toBe('Order');
		expect(allocator.claim('Order')).toBe('Order_2');
	});
});

describe('allocateMemberNames', () => {
	it('lets names that are already identifiers keep them over later sanitized collisions', () => {
		const names = allocateMemberNames(['first-name', 'firstName'], []);
		expect(names.get('firstName')).toBe('firstName');
		expect(names.get('first-name')).toBe('firstName_2');
	});

	it('moves attributes off the generated members', () => {
		const names = allocateMemberNames(
			['_extra', '_version', 'encodeRow', 'New', 'id'],
			['_extra', '_version', 'encodeRow', 'New'],
		);
		expect(names.get('_extra')).toBe('_extra_2');
		expect(names.get('_version')).toBe('_version_2');
		expect(names.get('encodeRow')).toBe('encodeRow_2');
		expect(names.get('New')).toBe('New_2');
		expect(names.get('id')).toBe('id');
	});

	it('gives every raw name a distinct identifier', () => {
		const raw = ['a-b', 'aB', 'a_b', 'a.b', 'a b'];
		const names = allocateMemberNames(raw, []);
		expect(new Set(names.values()).size).toBe(raw.length);
	});
});

describe('escaping', () => {
	it('backticks Swift keywords, including the member names Swift reserves', () => {
		expect(escapeSwiftIdentifier('default')).toBe('`default`');
		expect(escapeSwiftIdentifier('Type')).toBe('`Type`');
		expect(escapeSwiftIdentifier('value')).toBe('value');
	});

	it('backticks Kotlin hard keywords, and soft keywords only in enum entries', () => {
		expect(escapeKotlinIdentifier('in')).toBe('`in`');
		expect(escapeKotlinIdentifier('value')).toBe('value');
		expect(escapeKotlinEnumEntry('value')).toBe('`value`');
		expect(escapeKotlinEnumEntry('status')).toBe('status');
	});

	it('reserves standard and runtime type names', () => {
		for (const name of ['Data', 'String', 'Instant', 'HarperValue', 'New', 'Patch', 'class']) {
			expect(RESERVED_TYPE_NAMES.has(name)).toBe(true);
		}
	});
});
