import { describe, expect, it } from 'vitest';
import { generateInterface } from './generateInterface.js';

describe('generateInterface', () => {
	it('should generate a simple interface', () => {
		const table = {
			tableName: 'Users',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'name', type: 'String', nullable: false },
			],
		};
		const result = generateInterface(table);
		expect(result).toContain('export interface User {');
		expect(result).toContain('id: string;');
		expect(result).toContain('name: string;');
		expect(result).toContain('export type Users = User[];');
		expect(result).toContain('export type { User as UserRecord };');
		expect(result).toContain('export type UserRecords = User[];');
	});

	it('should handle databaseName prefix', () => {
		const table = {
			tableName: 'Posts',
			databaseName: 'blog',
			attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
		};
		const result = generateInterface(table);
		expect(result).toContain('export interface blog_Post {');
		expect(result).toContain('export type blog_Posts = blog_Post[];');
	});

	it('should handle nullable attributes', () => {
		const table = {
			tableName: 'Products',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'description', type: 'String', nullable: true },
			],
		};
		const result = generateInterface(table);
		expect(result).toContain('description?: string;');
	});

	it('should generate New type when primary key is present', () => {
		const table = {
			tableName: 'Tasks',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'title', type: 'String' },
			],
		};
		const result = generateInterface(table);
		expect(result).toContain("export type NewTask = Omit<Task, 'id'>;");
		expect(result).toContain("export type NewTaskRecord = Omit<Task, 'id'>;");
	});

	it('should handle multiple primary keys', () => {
		const table = {
			tableName: 'UserRoles',
			attributes: [
				{ name: 'userId', type: 'ID', isPrimaryKey: true },
				{ name: 'roleId', type: 'ID', isPrimaryKey: true },
			],
		};
		const result = generateInterface(table);
		expect(result).toContain("export type NewUserRole = Omit<UserRole, 'userId' | 'roleId'>;");
	});

	it('should not generate New type when no primary key is present', () => {
		const table = {
			tableName: 'Logs',
			attributes: [{ name: 'message', type: 'String' }],
		};
		const result = generateInterface(table);
		expect(result).not.toContain('export type NewLog =');
	});

	it('should produce valid identifiers for table names containing dashes', () => {
		const table = {
			tableName: 'blog-posts',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'title', type: 'String' },
			],
		};
		const result = generateInterface(table);
		expect(result).toContain('export interface blogPost {');
		expect(result).toContain('export type blogPosts = blogPost[];');
		expect(result).toContain('export type { blogPost as blogPostRecord };');
		expect(result).toContain('export type blogPostRecords = blogPost[];');
		expect(result).toContain("export type NewblogPost = Omit<blogPost, 'id'>;");
		expect(result).not.toContain('blog-post');
	});

	it('should produce valid identifiers for table names starting with a digit', () => {
		const table = {
			tableName: '123_New4',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: '__createdtime__', type: 'Any' },
				{ name: '__updatedtime__', type: 'Any' },
			],
		};
		const result = generateInterface(table);
		expect(result).toContain('export interface _123_New4 {');
		expect(result).toContain("export type New_123_New4 = Omit<_123_New4, 'id'>;");
		expect(result).toContain('export type { _123_New4 as _123_New4Record };');
		expect(result).toContain('export type _123_New4Records = _123_New4[];');
		expect(result).toContain("export type New_123_New4Record = Omit<_123_New4, 'id'>;");
		// the original, invalid `interface 123_New4` must not appear anywhere
		expect(result).not.toMatch(/\b123_New4\b/);
	});

	it('should quote attribute names that are not valid identifiers', () => {
		const table = {
			tableName: 'Things',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'first-name', type: 'String', nullable: false },
				{ name: '123field', type: 'String', nullable: true },
				{ name: 'with space', type: 'String', nullable: false },
				{ name: 'normalField', type: 'String', nullable: false },
			],
		};
		const result = generateInterface(table);
		expect(result).toContain("'first-name': string;");
		expect(result).toContain("'123field'?: string;");
		expect(result).toContain("'with space': string;");
		// valid identifiers stay unquoted
		expect(result).toContain('id: string;');
		expect(result).toContain('normalField: string;');
	});

	it('should quote a primary key attribute name consistently in the interface and Omit', () => {
		const table = {
			tableName: 'Things',
			attributes: [{ name: 'weird-key', type: 'ID', isPrimaryKey: true }],
		};
		const result = generateInterface(table);
		expect(result).toContain("'weird-key': string;");
		expect(result).toContain("export type NewThing = Omit<Thing, 'weird-key'>;");
	});

	it('should handle databaseName prefix with dashed table name', () => {
		const table = {
			tableName: 'audit-logs',
			databaseName: 'mydb',
			attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
		};
		const result = generateInterface(table);
		expect(result).toContain('export interface mydb_auditLog {');
		expect(result).toContain('export type mydb_auditLogs = mydb_auditLog[];');
		expect(result).not.toContain('audit-log');
	});
});
