import { describe, expect, it } from 'vitest';
import { generateJSDoc } from './generateJSDoc.js';

describe('generateJSDoc', () => {
	it('should generate JSDoc for a simple table', () => {
		const table = {
			tableName: 'Tracks',
			databaseName: 'data',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'name', type: 'String', nullable: false },
				{ name: 'mp3', type: 'Blob', nullable: true },
			],
		};
		const code = generateJSDoc(table);
		expect(code).toContain('@typedef {Object} Track');
		expect(code).toContain('@property {string} id');
		expect(code).toContain('@property {string} name');
		expect(code).toContain('@property {any} [mp3]');
		expect(code).toContain("@typedef {Omit<Track, 'id'>} NewTrack");
		expect(code).toContain('@typedef {Track[]} Tracks');
	});

	it('should handle tables in non-data databases', () => {
		const table = {
			tableName: 'Users',
			databaseName: 'auth',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'username', type: 'String' },
			],
		};
		const code = generateJSDoc(table);
		expect(code).toContain('@typedef {Object} auth_User');
		expect(code).toContain('@typedef {auth_User[]} auth_Users');
		expect(code).toContain("@typedef {Omit<auth_User, 'id'>} auth_NewUser");
	});

	it('should handle missing attributes', () => {
		const table = {
			tableName: 'EmptyTable',
			databaseName: 'data',
		};
		const code = generateJSDoc(table);
		expect(code).toContain('@typedef {Object} EmptyTable');
		expect(code).not.toContain('@property');
	});

	it('should handle multiple primary keys', () => {
		const table = {
			tableName: 'UserRoles',
			databaseName: 'data',
			attributes: [
				{ name: 'userId', type: 'ID', isPrimaryKey: true },
				{ name: 'roleId', type: 'ID', isPrimaryKey: true },
			],
		};
		const code = generateJSDoc(table);
		expect(code).toContain("@typedef {Omit<UserRole, 'userId' | 'roleId'>} NewUserRole");
	});
});
