import { describe, expect, it } from 'vitest';
import { safeKey } from './safeKey.js';

describe('safeKey', () => {
	it('should leave valid identifiers unquoted', () => {
		expect(safeKey('id')).toBe('id');
		expect(safeKey('userName')).toBe('userName');
		expect(safeKey('__createdtime__')).toBe('__createdtime__');
		expect(safeKey('$ref')).toBe('$ref');
	});

	it('should quote names containing characters invalid in an identifier', () => {
		expect(safeKey('first-name')).toBe("'first-name'");
		expect(safeKey('with space')).toBe("'with space'");
		expect(safeKey('a.b')).toBe("'a.b'");
	});

	it('should quote names that start with a digit', () => {
		expect(safeKey('123field')).toBe("'123field'");
		expect(safeKey('123_New4')).toBe("'123_New4'");
	});

	it('should escape single quotes and backslashes within a quoted name', () => {
		expect(safeKey("o'connor")).toBe("'o\\'connor'");
		expect(safeKey('a\\b')).toBe("'a\\\\b'");
	});
});
