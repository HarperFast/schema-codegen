import { describe, expect, it } from 'vitest';
import { generateTSFromTables } from './generateTS.js';

describe('generateTSFromTables', () => {
	it('should generate TypeScript from multiple tables', () => {
		const tables = [
			{
				tableName: 'Users',
				databaseName: 'data',
				attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
			},
			{
				tableName: 'Posts',
				databaseName: 'blog',
				attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
			},
		];
		const { tsCode, tables: tablesMeta } = generateTSFromTables(tables, 'Test Label');
		expect(tsCode).toContain('Generated from Test Label');
		expect(tsCode).toContain('export interface User {');
		expect(tsCode).toContain('export interface blog_Post {');

		expect(tablesMeta).toHaveLength(2);
		expect(tablesMeta[0]).toEqual({
			plural: 'Users',
			singular: 'User',
			databaseName: 'data',
		});
		expect(tablesMeta[1]).toEqual({
			plural: 'blog_Posts',
			singular: 'blog_Post',
			databaseName: 'blog',
		});
	});

	it('should handle default label', () => {
		const { tsCode } = generateTSFromTables([], undefined);
		expect(tsCode).toContain('Generated from HarperDB schemas');
	});

	it('should produce a valid type identifier when table name starts with a digit', () => {
		const tables = [
			{
				tableName: '123_New4',
				databaseName: 'data',
				attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
			},
		];
		const { tsCode, tables: tablesMeta } = generateTSFromTables(tables);
		expect(tsCode).toContain('export interface _123_New4 {');
		// the runtime key is preserved verbatim, but the type name is a valid identifier
		expect(tablesMeta[0]).toEqual({
			plural: '123_New4',
			singular: '_123_New4',
			databaseName: 'data',
		});
	});

	it('should produce valid identifiers when table name contains dashes', () => {
		const tables = [
			{
				tableName: 'blog-posts',
				databaseName: 'data',
				attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
			},
		];
		const { tsCode, tables: tablesMeta } = generateTSFromTables(tables);
		expect(tsCode).toContain('export interface blogPost {');
		expect(tablesMeta[0]).toEqual({
			plural: 'blog-posts',
			singular: 'blogPost',
			databaseName: 'data',
		});
	});
});
