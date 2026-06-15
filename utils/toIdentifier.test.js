import { describe, expect, it } from 'vitest';
import { toIdentifier } from './toIdentifier.js';

describe('toIdentifier', () => {
	it('should leave a valid identifier unchanged', () => {
		expect(toIdentifier('Users')).toBe('Users');
		expect(toIdentifier('blog_Posts')).toBe('blog_Posts');
		expect(toIdentifier('$special')).toBe('$special');
	});

	it('should convert kebab-case to camelCase', () => {
		expect(toIdentifier('blog-posts')).toBe('blogPosts');
		expect(toIdentifier('my-table-name')).toBe('myTableName');
	});

	it('should prefix a leading digit with an underscore', () => {
		expect(toIdentifier('123_New4')).toBe('_123_New4');
		expect(toIdentifier('4chan')).toBe('_4chan');
	});

	it('should replace characters that are invalid in an identifier', () => {
		expect(toIdentifier('my.table')).toBe('my_table');
		expect(toIdentifier('table name')).toBe('table_name');
		expect(toIdentifier('weird@name!')).toBe('weird_name_');
	});

	it('should always produce a valid identifier', () => {
		const names = ['123_New4', 'blog-posts', 'my.table', 'table name', '99 bottles'];
		for (const name of names) {
			expect(toIdentifier(name)).toMatch(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/);
		}
	});
});
