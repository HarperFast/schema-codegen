import { describe, expect, it } from 'vitest';
import { matchesDatabase, shouldIncludeDatabase } from './databaseFilter.js';

describe('matchesDatabase', () => {
	it('matches exact names', () => {
		expect(matchesDatabase('data', ['data'])).toBe(true);
		expect(matchesDatabase('data', ['blog'])).toBe(false);
	});

	it('is anchored (no partial matches)', () => {
		expect(matchesDatabase('metrics-github', ['metrics'])).toBe(false);
		expect(matchesDatabase('metrics-github', ['github'])).toBe(false);
	});

	it('supports the * wildcard', () => {
		expect(matchesDatabase('metrics-github', ['metrics-*'])).toBe(true);
		expect(matchesDatabase('metrics-jira', ['metrics-*'])).toBe(true);
		expect(matchesDatabase('billing', ['metrics-*'])).toBe(false);
		expect(matchesDatabase('anything', ['*'])).toBe(true);
	});

	it('does not treat other regex metacharacters specially', () => {
		// the dot must be a literal, not "any character"
		expect(matchesDatabase('myXdb', ['my.db'])).toBe(false);
		expect(matchesDatabase('my.db', ['my.db'])).toBe(true);
	});

	it('coerces numeric patterns from unquoted YAML without crashing', () => {
		// an unquoted numeric database name in YAML parses as a number
		expect(matchesDatabase('101', [101])).toBe(true);
		expect(matchesDatabase('202', [101])).toBe(false);
	});
});

describe('shouldIncludeDatabase', () => {
	it('includes everything when no options are given', () => {
		expect(shouldIncludeDatabase('anything')).toBe(true);
		expect(shouldIncludeDatabase('anything', {})).toBe(true);
	});

	it('restricts to the include list when provided', () => {
		expect(shouldIncludeDatabase('data', { include: ['data', 'blog'] })).toBe(true);
		expect(shouldIncludeDatabase('other', { include: ['data', 'blog'] })).toBe(false);
	});

	it('treats an empty include list as "include everything"', () => {
		expect(shouldIncludeDatabase('anything', { include: [] })).toBe(true);
	});

	it('removes databases in the exclude list', () => {
		expect(shouldIncludeDatabase('system', { exclude: ['system'] })).toBe(false);
		expect(shouldIncludeDatabase('data', { exclude: ['system'] })).toBe(true);
	});

	it('lets exclude win over include', () => {
		expect(
			shouldIncludeDatabase('metrics-internal', {
				include: ['metrics-*'],
				exclude: ['metrics-internal'],
			}),
		).toBe(false);
	});
});
