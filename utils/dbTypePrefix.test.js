import { describe, expect, it } from 'vitest';
import { dbTypePrefix } from './dbTypePrefix.js';

describe('dbTypePrefix', () => {
	it('returns an empty prefix for the default data database', () => {
		expect(dbTypePrefix('data')).toBe('');
	});

	it('returns an empty prefix when the database name is missing', () => {
		expect(dbTypePrefix(undefined)).toBe('');
		expect(dbTypePrefix('')).toBe('');
	});

	it('namespaces a valid database name unchanged', () => {
		expect(dbTypePrefix('blog')).toBe('blog_');
	});

	it('sanitizes a hyphenated database name into a valid identifier prefix', () => {
		expect(dbTypePrefix('metrics-github')).toBe('metricsGithub_');
	});

	it('sanitizes a database name that starts with a digit', () => {
		expect(dbTypePrefix('9lives')).toBe('_9lives_');
	});

	it('always produces an identifier-safe prefix', () => {
		const names = ['metrics-github', 'my.db', 'weird name', '9lives'];
		for (const name of names) {
			expect(dbTypePrefix(name)).toMatch(/^[a-zA-Z_$][a-zA-Z0-9_$]*_$/);
		}
	});
});
