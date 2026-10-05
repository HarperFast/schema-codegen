import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spikeTables } from '../../test/fixtures/clientSchema.js';
import { setLogger } from '../logger.js';
import { regenerateClient } from './regenerateClient.js';

describe('regenerateClient', () => {
	/** @type {string} */
	let directory;
	const logger = {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		notify: vi.fn(),
		fatal: vi.fn(),
	};
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-regenerate-'));
		setLogger(/** @type {any} */ (logger));
	});
	afterEach(() => {
		vi.clearAllMocks();
		fs.rmSync(directory, { recursive: true, force: true });
	});

	const options = (/** @type {object} */ overrides = {}) => ({
		baseDirectory: directory,
		schemaIR: 'client/harper-schema.json',
		syncProfiles: 'sync.yaml',
		swift: 'ios/HarperModels',
		kotlin: 'android/harper-models',
		...overrides,
	});
	const warnings = () => logger.warn.mock.calls.map((call) => String(call[0]));

	it('publishes nothing once its signal is aborted', async () => {
		fs.writeFileSync(path.join(directory, 'sync.yaml'), 'profiles: {}\n');
		const closing = new AbortController();
		const run = regenerateClient(spikeTables(), options({ signal: closing.signal }));
		closing.abort();
		expect(await run).toBeUndefined();
		expect(fs.readdirSync(directory)).toEqual(['sync.yaml']);
	});

	it('writes the IR, Swift and Kotlin from the app directory, with profiles from sync.yaml', async () => {
		fs.writeFileSync(
			path.join(directory, 'sync.yaml'),
			'profiles:\n  storefront:\n    tables: [Product]\n',
		);
		const ir = await regenerateClient(spikeTables(), options());
		expect(ir.profiles.map((profile) => profile.name)).toEqual(['storefront']);
		const written = JSON.parse(
			fs.readFileSync(path.join(directory, 'client', 'harper-schema.json'), 'utf8'),
		);
		expect(written.schemaHash).toBe(ir.schemaHash);
		expect(written.generator).toMatch(/^@harperfast\/schema-codegen@/);
		expect(
			fs.existsSync(
				path.join(directory, 'ios', 'HarperModels', 'Sources', 'HarperModels', 'Models.swift'),
			),
		).toBe(true);
		expect(
			fs.existsSync(
				path.join(
					directory,
					'android',
					'harper-models',
					'src',
					'main',
					'kotlin',
					'harper',
					'models',
					'Models.kt',
				),
			),
		).toBe(true);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('logs profile errors and warnings', async () => {
		fs.writeFileSync(
			path.join(directory, 'sync.yaml'),
			'profiles:\n  broken:\n    scope: { custmerId: $token.sub }\n    tables: [Order]\n  slow:\n    scope: { amount: 5 }\n    tables: [Order]\n',
		);
		const ir = await regenerateClient(spikeTables(), options());
		expect(ir.profiles.map((profile) => profile.name)).toEqual(['slow']);
		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('"custmerId", which is not a stored attribute'),
		);
		expect(warnings()).toContainEqual(expect.stringContaining('which is not @indexed'));
	});

	it('warns when sync.yaml is configured but missing', async () => {
		await regenerateClient(spikeTables(), options());
		expect(warnings()).toContainEqual(
			expect.stringContaining('does not exist; no profiles are generated'),
		);
	});

	it('warns when a regeneration breaks clients generated from the published IR', async () => {
		await regenerateClient(spikeTables(), options({ syncProfiles: undefined }));
		const changed = spikeTables();
		changed[0].attributes[2].type = 'String';
		await regenerateClient(changed, options({ syncProfiles: undefined }));
		const warning = warnings().find((message) =>
			message.includes('breaks read, write, storage compatibility'),
		);
		expect(warning).toContain(
			'data.Product.price type changed from Float to String (breaks read, write)',
		);
	});

	it('ignores a published IR it cannot read, and says so', async () => {
		fs.mkdirSync(path.join(directory, 'client'));
		fs.writeFileSync(path.join(directory, 'client', 'harper-schema.json'), '{"irVersion": 0}');
		await regenerateClient(spikeTables(), options({ syncProfiles: undefined }));
		expect(warnings()).toContainEqual(expect.stringContaining('ignoring the existing'));
		expect(
			JSON.parse(fs.readFileSync(path.join(directory, 'client', 'harper-schema.json'), 'utf8'))
				.irVersion,
		).toBe(1);
	});

	it('warns when the existing Package.swift does not declare the module, and about stale sources', async () => {
		await regenerateClient(spikeTables(), options({ syncProfiles: undefined }));
		await regenerateClient(
			spikeTables(),
			options({ syncProfiles: undefined, swiftModule: 'SpikeModels' }),
		);
		expect(warnings()).toContainEqual(
			expect.stringContaining('does not declare the "SpikeModels" target'),
		);
		expect(warnings()).toContainEqual(
			expect.stringContaining(
				`${path.join('Sources', 'HarperModels', 'Models.swift')} was generated for a different module`,
			),
		);
	});

	it('writes nothing when an option is invalid', async () => {
		await expect(
			regenerateClient(
				spikeTables(),
				options({ syncProfiles: undefined, kotlinPackage: '../escape' }),
			),
		).rejects.toThrow(/dot-separated identifiers/);
		expect(fs.readdirSync(directory)).toEqual([]);
	});
});
