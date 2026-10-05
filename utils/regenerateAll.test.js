import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spikeTables } from '../test/fixtures/clientSchema.js';

const regenerateClient = vi.hoisted(() => vi.fn());
vi.mock('./client/regenerateClient.js', () => ({ regenerateClient }));

const { hasClientOutputs, regenerateAll } = await import('./regenerateAll.js');

describe('regenerateAll', () => {
	/** @type {string} */
	let directory;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-all-'));
		/** @type {any} */ (globalThis).databases = {
			data: Object.fromEntries(spikeTables().map((table) => [table.tableName, table])),
		};
	});
	afterEach(() => {
		delete (/** @type {any} */ (globalThis).databases);
		vi.clearAllMocks();
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it('resolves output paths against the application directory, not the working directory', async () => {
		await regenerateAll('schemas/global.d.ts', 'schemas/types.ts', 'schemas/jsdoc.js', {
			baseDirectory: directory,
		});
		expect(fs.readFileSync(path.join(directory, 'schemas', 'types.ts'), 'utf8')).toContain(
			'export interface Product {',
		);
		expect(fs.existsSync(path.join(directory, 'schemas', 'global.d.ts'))).toBe(true);
		expect(fs.existsSync(path.join(directory, 'schemas', 'jsdoc.js'))).toBe(true);
	});

	it('does no client work unless a client output is configured', async () => {
		await regenerateAll('global.d.ts', 'types.ts', undefined, {
			baseDirectory: directory,
			client: { syncProfiles: 'sync.yaml' },
		});
		expect(regenerateClient).not.toHaveBeenCalled();
	});

	it('hands the same filtered tables to client generation', async () => {
		/** @type {any} */ (globalThis).databases.other = { Hidden: spikeTables()[0] };
		const client = { swift: 'ios/HarperModels' };
		await regenerateAll('global.d.ts', 'types.ts', undefined, {
			baseDirectory: directory,
			excludeDatabases: ['other'],
			client,
		});
		expect(regenerateClient).toHaveBeenCalledTimes(1);
		const [tables, options] = regenerateClient.mock.calls[0];
		expect(tables.map((/** @type {any} */ table) => table.tableName)).toEqual([
			'Product',
			'Order',
			'Report',
		]);
		expect(options).toEqual({ baseDirectory: directory, swift: 'ios/HarperModels' });
	});

	it('detects configured client outputs', () => {
		expect(hasClientOutputs(undefined)).toBe(false);
		expect(hasClientOutputs({ syncProfiles: 'sync.yaml' })).toBe(false);
		expect(hasClientOutputs({ schemaIR: 'ir.json' })).toBe(true);
		expect(hasClientOutputs({ kotlin: 'android' })).toBe(true);
	});
});
