import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
