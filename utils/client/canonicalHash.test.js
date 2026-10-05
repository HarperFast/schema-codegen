import { describe, expect, it } from 'vitest';
import { canonicalJSON, hashCanonical } from './canonicalHash.js';

describe('canonicalJSON', () => {
	it('sorts object keys at every depth and keeps array order', () => {
		expect(canonicalJSON({ b: 1, a: { d: [3, 1], c: null } })).toBe(
			'{"a":{"c":null,"d":[3,1]},"b":1}',
		);
	});

	it('drops undefined members like JSON.stringify', () => {
		expect(canonicalJSON({ a: undefined, b: 2 })).toBe('{"b":2}');
		expect(canonicalJSON([undefined])).toBe('[null]');
	});
});

describe('hashCanonical', () => {
	it('is independent of key order and sensitive to values', () => {
		expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
		expect(hashCanonical({ a: 1 })).not.toBe(hashCanonical({ a: 2 }));
		expect(hashCanonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
	});
});
