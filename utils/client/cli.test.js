import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spikeProfiles, spikeTables } from '../../test/fixtures/clientSchema.js';
import { buildSchemaIR } from './buildSchemaIR.js';
import { serializeSchemaIR } from './clientOutputs.js';
import { runCli } from './cli.js';

describe('schema-codegen CLI', () => {
	/** @type {string} */
	let directory;
	/** @type {string[]} */
	let stdout;
	/** @type {string[]} */
	let stderr;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-cli-'));
		stdout = [];
		stderr = [];
	});
	afterEach(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	const run = (/** @type {string[]} */ argv) =>
		runCli(argv, {
			stdout: (text) => stdout.push(text),
			stderr: (text) => stderr.push(text),
			cwd: directory,
		});
	/**
	 * @param {string} name
	 * @param {any[]} [tables]
	 */
	const writeIR = (name, tables = spikeTables()) => {
		fs.writeFileSync(
			path.join(directory, name),
			serializeSchemaIR(buildSchemaIR({ tables, syncProfiles: spikeProfiles() })),
		);
		return name;
	};

	it('generates Swift and Kotlin from an IR file, then reports nothing to do', () => {
		writeIR('ir.json');
		expect(
			run([
				'generate-client',
				'--ir',
				'ir.json',
				'--swift',
				'ios',
				'--kotlin',
				'android',
				'--kotlin-package',
				'com.example',
			]),
		).toBe(0);
		expect(
			fs.existsSync(path.join(directory, 'ios', 'Sources', 'HarperModels', 'Models.swift')),
		).toBe(true);
		expect(
			fs.existsSync(
				path.join(directory, 'android', 'src', 'main', 'kotlin', 'com', 'example', 'Models.kt'),
			),
		).toBe(true);
		expect(stdout.join('')).toContain(`wrote ${path.join('ios', 'Package.swift')}`);
		stdout = [];
		expect(
			run([
				'generate-client',
				'--ir',
				'ir.json',
				'--swift',
				'ios',
				'--kotlin',
				'android',
				'--kotlin-package',
				'com.example',
			]),
		).toBe(0);
		expect(stdout.join('')).toBe('generated files are up to date\n');
	});

	it('exits 2 with a message for bad input', () => {
		fs.writeFileSync(path.join(directory, 'bad.json'), '{"irVersion": 7}');
		expect(run(['generate-client', '--ir', 'bad.json', '--swift', 'ios'])).toBe(2);
		expect(stderr.join('')).toContain('irVersion');
		expect(run(['generate-client', '--ir', 'missing.json', '--swift', 'ios'])).toBe(2);
		expect(run(['generate-client', '--ir', 'bad.json'])).toBe(2);
		expect(run(['generate-client', '--swfit', 'ios'])).toBe(2);
		expect(run(['explode'])).toBe(2);
		expect(run([])).toBe(2);
	});

	it('diffs two IRs and exits 1 only when an axis in --fail-on breaks', () => {
		const before = writeIR('before.json');
		const added = spikeTables();
		added[0].attributes.push({ name: 'sku', type: 'String', nullable: false });
		const after = writeIR('after.json', added);

		expect(run(['diff', before, before])).toBe(0);
		expect(stdout.join('')).toContain('read: identical, write: identical, storage: identical');
		stdout = [];
		expect(run(['diff', before, after])).toBe(1);
		expect(stdout.join('')).toContain('breaks write: data.Product.sku added');
		expect(run(['diff', before, after, '--fail-on', 'read,storage'])).toBe(0);
		expect(run(['diff', before, after, '--fail-on', 'sideways'])).toBe(2);
	});

	it('prints the diff as JSON', () => {
		const before = writeIR('before.json');
		stdout = [];
		expect(run(['diff', before, before, '--json'])).toBe(0);
		expect(JSON.parse(stdout.join('')).compatibility).toEqual({
			read: 'identical',
			write: 'identical',
			storage: 'identical',
		});
	});

	it('runs as an executable and sets the exit code', () => {
		const bin = fileURLToPath(new URL('../../bin/schema-codegen.js', import.meta.url));
		expect(execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' })).toMatch(
			/^@harperfast\/schema-codegen@/,
		);
		const result = spawnSync(process.execPath, [bin, 'diff', 'a.json'], {
			cwd: directory,
			encoding: 'utf8',
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toContain('diff needs two schema IR files');
	});
});
