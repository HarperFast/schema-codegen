import { describe, expect, it } from 'vitest';
import { escapeSingleQuoted } from './escapeSingleQuoted.js';

describe('escapeSingleQuoted', () => {
	it('should leave a plain string unchanged', () => {
		expect(escapeSingleQuoted('connor')).toBe('connor');
	});

	it('should escape single quotes', () => {
		expect(escapeSingleQuoted("o'connor")).toBe("o\\'connor");
	});

	it('should escape backslashes', () => {
		expect(escapeSingleQuoted('a\\b')).toBe('a\\\\b');
	});

	it('should escape backslashes before quotes so escapes are not doubled', () => {
		// input: a ' b \ c  ->  a \' b \\ c
		expect(escapeSingleQuoted("a'b\\c")).toBe("a\\'b\\\\c");
	});
});
