import { describe, expect, it } from 'vitest';
import { generateTSFromTables } from './generateTS.js';

describe('generateTSFromTables', () => {
	it('should generate TypeScript from multiple tables', () => {
		const tables = [
			{
				tableName: 'Users',
				databaseName: 'data',
				attributes: [
					{ name: 'id', type: 'ID', isPrimaryKey: true },
				],
			},
			{
				tableName: 'Posts',
				databaseName: 'blog',
				attributes: [
					{ name: 'id', type: 'ID', isPrimaryKey: true },
				],
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
});
