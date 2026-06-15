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

	/** @param {import('./tableMeta.js').TableMeta[]} tables */
	function generate(tables) {
		generateTablesDTS(globalTypesPath, schemaTypesPath, tables);
		return fs.readFileSync(globalTypesPath, 'utf8');
	}

	it('should import and reference the singular type for each table', () => {
		const content = generate([{ plural: 'Users', singular: 'User', databaseName: 'data' }]);
		expect(content).toContain('import type { User } from');
		expect(content).toContain('Users: { new(...args: any[]): Table<User> };');
	});

	it('should quote a runtime key that starts with a digit', () => {
		const content = generate([{ plural: '123_New4', singular: '_123_New4', databaseName: 'data' }]);
		// the runtime key must be quoted, and the type reference must be a valid identifier
		expect(content).toContain("'123_New4': { new(...args: any[]): Table<_123_New4> };");
		expect(content).toContain('import type { _123_New4 } from');
		// an unquoted leading-digit key would be a TypeScript syntax error
		expect(content).not.toMatch(/\n\t+123_New4:/);
	});

	it('should quote keys with non-word characters but leave valid ones unquoted', () => {
		const content = generate([
			{ plural: 'Users', singular: 'User', databaseName: 'data' },
			{ plural: 'audit-logs', singular: 'auditLog', databaseName: 'data' },
		]);
		expect(content).toContain('Users: {');
		expect(content).toContain("'audit-logs': {");
	});

	it('should quote a database name that starts with a digit', () => {
		const content = generate([
			{ plural: '9lives_Cats', singular: '_9lives_Cat', databaseName: '9lives' },
		]);
		expect(content).toContain("'9lives': {");
	});
});
