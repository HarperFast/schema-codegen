import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spikeProfiles, spikeTables } from '../../test/fixtures/clientSchema.js';
import { buildSchemaIR } from './buildSchemaIR.js';
import {
	findStaleGeneratedFiles,
	publishClientOutputs,
	renderClientOutputs,
	serializeSchemaIR,
} from './clientOutputs.js';

const ir = buildSchemaIR({
	tables: spikeTables(),
	syncProfiles: spikeProfiles(),
	generator: 'test',
});

describe('client outputs', () => {
	/** @type {string} */
	let directory;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-outputs-'));
	});
	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(directory, { recursive: true, force: true });
	});

	const options = () => ({
		baseDirectory: directory,
		schemaIR: 'client/schema.json',
		swift: 'ios/Models',
		kotlin: 'android/models',
		kotlinPackage: 'com.example.models',
	});

	it('renders the requested outputs with the IR file last, writing nothing', () => {
		const outputs = renderClientOutputs(ir, options());
		expect(outputs.at(-1)).toEqual({
			path: path.join(directory, 'client', 'schema.json'),
			content: serializeSchemaIR(ir),
			scaffold: false,
			target: 'ir',
		});
		expect(outputs.filter((output) => output.target === 'swift')).toHaveLength(4);
		expect(outputs.filter((output) => output.target === 'kotlin')).toHaveLength(4);
		expect(fs.readdirSync(directory)).toEqual([]);
	});

	it('renders nothing for an invalid option, before any file exists', () => {
		expect(() => renderClientOutputs(ir, { ...options(), kotlinPackage: 'a/b' })).toThrow();
		expect(fs.readdirSync(directory)).toEqual([]);
	});

	it('writes generated files, creates scaffolds once, and reports only real changes', () => {
		const outputs = renderClientOutputs(ir, options());
		const first = publishClientOutputs(outputs);
		expect(first.createdScaffolds.map((file) => path.basename(file)).sort()).toEqual([
			'Package.swift',
			'build.gradle.kts',
		]);
		expect(first.written).toHaveLength(outputs.length - 2);

		const manifest = path.join(directory, 'ios', 'Models', 'Package.swift');
		fs.writeFileSync(manifest, '// edited by the app developer\n');
		const second = publishClientOutputs(outputs);
		expect(second).toEqual({ written: [], createdScaffolds: [] });
		expect(fs.readFileSync(manifest, 'utf8')).toBe('// edited by the app developer\n');
	});

	it('publishes nothing when any file of the generation cannot be written', () => {
		const outputs = renderClientOutputs(ir, options());
		publishClientOutputs(outputs);
		const changed = renderClientOutputs(
			buildSchemaIR({ tables: spikeTables().slice(0, 1), generator: 'test' }),
			options(),
		);
		const before = outputs.map((output) => fs.readFileSync(output.path, 'utf8'));
		const writeFileSync = fs.writeFileSync;
		let writes = 0;
		vi.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
			if (++writes === 3) {
				throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
			}
			return writeFileSync(...args);
		});
		expect(() => publishClientOutputs(changed)).toThrow(/no space left/);
		expect(outputs.map((output) => fs.readFileSync(output.path, 'utf8'))).toEqual(before);
		const all = /** @type {string[]} */ (fs.readdirSync(directory, { recursive: true }));
		expect(all.filter((file) => file.endsWith('.tmp'))).toEqual([]);
	});

	it('restores the files already moved into place when a later move fails', () => {
		const outputs = renderClientOutputs(ir, options());
		publishClientOutputs(outputs);
		const before = outputs.map((output) => fs.readFileSync(output.path, 'utf8'));
		const changed = renderClientOutputs(
			buildSchemaIR({ tables: spikeTables().slice(0, 1), generator: 'test' }),
			options(),
		);
		const renameSync = fs.renameSync;
		let renames = 0;
		vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
			if (++renames === 3) {
				throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
			}
			return renameSync(...args);
		});
		expect(() => publishClientOutputs(changed)).toThrow(/cross-device/);
		vi.restoreAllMocks();
		expect(outputs.map((output) => fs.readFileSync(output.path, 'utf8'))).toEqual(before);
		const all = /** @type {string[]} */ (fs.readdirSync(directory, { recursive: true }));
		expect(all.filter((file) => file.endsWith('.tmp'))).toEqual([]);
	});

	it('skips build folders and unreadable files when looking for stale sources', () => {
		const outputs = renderClientOutputs(ir, options());
		publishClientOutputs(outputs);
		const packageDirectory = path.join(directory, 'ios', 'Models');
		const runtime = fs.readFileSync(
			path.join(packageDirectory, 'Sources', 'HarperModels', 'HarperRuntime.swift'),
		);
		for (const folder of ['.build/debug', 'build/out']) {
			fs.mkdirSync(path.join(packageDirectory, folder), { recursive: true });
			fs.writeFileSync(path.join(packageDirectory, folder, 'Copied.swift'), runtime);
		}
		expect(findStaleGeneratedFiles(packageDirectory, outputs)).toEqual([]);
		fs.writeFileSync(path.join(packageDirectory, 'Sources', 'Locked.swift'), runtime);
		vi.spyOn(fs, 'openSync').mockImplementation(() => {
			throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
		});
		expect(findStaleGeneratedFiles(packageDirectory, outputs)).toEqual([]);
	});

	it('leaves no temporary files behind', () => {
		publishClientOutputs(renderClientOutputs(ir, options()));
		const all = /** @type {string[]} */ (fs.readdirSync(directory, { recursive: true }));
		expect(all.filter((file) => file.endsWith('.tmp'))).toEqual([]);
	});

	it('finds generated sources a renamed module or package left behind, ignoring other files', () => {
		publishClientOutputs(renderClientOutputs(ir, { ...options(), swiftModule: 'OldModels' }));
		const handWritten = path.join(
			directory,
			'ios',
			'Models',
			'Sources',
			'OldModels',
			'Extensions.swift',
		);
		fs.writeFileSync(handWritten, 'import Foundation\n');
		const outputs = renderClientOutputs(ir, options());
		publishClientOutputs(outputs);
		const stale = findStaleGeneratedFiles(path.join(directory, 'ios', 'Models'), outputs);
		expect(stale.map((file) => path.relative(directory, file).split(path.sep).join('/'))).toEqual([
			'ios/Models/Sources/OldModels/HarperRuntime.swift',
			'ios/Models/Sources/OldModels/HarperSchema.swift',
			'ios/Models/Sources/OldModels/Models.swift',
		]);
		expect(findStaleGeneratedFiles(path.join(directory, 'android', 'models'), outputs)).toEqual([]);
	});
});
