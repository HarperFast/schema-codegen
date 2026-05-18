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
