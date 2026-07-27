import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTablesDTS } from './generateTablesDTS.js';

describe('generateTablesDTS', () => {
	/** @type {string} */
	let tmpDir;
	/** @type {string} */
	let globalTypesPath;
	/** @type {string} */
	let schemaTypesPath;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-dts-'));
		globalTypesPath = path.join(tmpDir, 'global.d.ts');
		schemaTypesPath = path.join(tmpDir, 'schemas', 'types.ts');
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	/**
	 * @param {import('./tableMeta.js').TableMeta[]} tables
	 * @param {string} [moduleName]
	 */
	function generate(tables, moduleName) {
		generateTablesDTS(globalTypesPath, schemaTypesPath, tables, moduleName);
		return fs.readFileSync(globalTypesPath, 'utf8');
	}

	it('should import and reference the singular type for each table', () => {
		const content = generate([{ tableName: 'Users', singular: 'User', databaseName: 'data' }]);
		expect(content).toContain('import type { User } from');
		expect(content).toContain('Users: { new(...args: any[]): Table<User> };');
	});

	it('should quote a runtime key that starts with a digit', () => {
		const content = generate([
			{ tableName: '123_New4', singular: '_123_New4', databaseName: 'data' },
		]);
		// the runtime key must be quoted, and the type reference must be a valid identifier
		expect(content).toContain("'123_New4': { new(...args: any[]): Table<_123_New4> };");
		expect(content).toContain('import type { _123_New4 } from');
		// an unquoted leading-digit key would be a TypeScript syntax error
		expect(content).not.toMatch(/\n\t+123_New4:/);
	});

	it('should quote keys with non-word characters but leave valid ones unquoted', () => {
		const content = generate([
			{ tableName: 'Users', singular: 'User', databaseName: 'data' },
			{ tableName: 'audit-logs', singular: 'auditLog', databaseName: 'data' },
		]);
		expect(content).toContain('Users: {');
		expect(content).toContain("'audit-logs': {");
	});

	it('should quote a database name that starts with a digit', () => {
		const content = generate([
			{ tableName: 'Cats', singular: '_9lives_Cat', databaseName: '9lives' },
		]);
		expect(content).toContain("'9lives': {");
	});

	it('should quote a hyphenated database key while referencing a sanitized type', () => {
		const content = generate([
			{
				tableName: 'Repository',
				singular: 'metricsGithub_Repository',
				databaseName: 'metrics-github',
			},
		]);
		// runtime key is quoted verbatim; the type reference is a valid identifier
		expect(content).toContain("'metrics-github': {");
		expect(content).toContain(
			'Repository: { new(...args: any[]): Table<metricsGithub_Repository> };',
		);
		expect(content).toContain('import type { metricsGithub_Repository } from');
		expect(content).not.toContain('metrics-github_Repository');
	});

	it('should augment the harper module by default', () => {
		const content = generate([{ tableName: 'Users', singular: 'User', databaseName: 'data' }]);
		expect(content).toContain("import type { Table } from 'harper';");
		expect(content).toContain("declare module 'harper' {");
		expect(content).not.toContain('harperdb');
	});

	it('should augment a configurable module for Harper 4.x compatibility', () => {
		const content = generate(
			[{ tableName: 'Users', singular: 'User', databaseName: 'data' }],
			'harperdb',
		);
		expect(content).toContain("import type { Table } from 'harperdb';");
		expect(content).toContain("declare module 'harperdb' {");
	});
});
