import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	adversarialTables,
	coverageTables,
	coverageTypes,
	spikeProfiles,
	spikeTables,
} from '../../test/fixtures/clientSchema.js';
import { buildSchemaIR } from './buildSchemaIR.js';
import { emitKotlinModule } from './emitKotlin.js';
import { emitSwiftPackage } from './emitSwift.js';

/**
 * `auto` (default) runs each language when its toolchain is found; `require` fails when one is
 * missing, so a CI host meant to cover them cannot pass vacuously; `skip` runs nothing.
 */
const mode = process.env.SCHEMA_CODEGEN_NATIVE_TESTS ?? 'auto';
const harnesses = new URL('../../test/fixtures/native/', import.meta.url);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-native-'));
afterAll(() => fs.rmSync(workspace, { recursive: true, force: true }));

const ir = buildSchemaIR({
	tables: [...spikeTables(), ...coverageTables(), ...adversarialTables()],
	types: coverageTypes(),
	syncProfiles: spikeProfiles(),
	generator: '@harperfast/schema-codegen@native-test',
});

/**
 * @param {string} command
 * @returns {string | null}
 */
function onPath(command) {
	const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
		encoding: 'utf8',
	});
	return result.status === 0 ? result.stdout.split(/\r?\n/)[0].trim() : null;
}

function swiftAvailable() {
	if (mode === 'skip' || process.platform !== 'darwin') return false;
	return spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' }).status === 0;
}

function kotlinToolchain() {
	if (mode === 'skip') return null;
	const kotlinc = process.env.KOTLINC ?? onPath('kotlinc');
	const java = process.env.JAVA_HOME
		? path.join(process.env.JAVA_HOME, 'bin', 'java')
		: onPath('java');
	return kotlinc && java && fs.existsSync(java) ? { kotlinc, java } : null;
}

/**
 * @param {import('./emitSwift.js').EmittedFile[]} files
 * @param {string} directory
 */
function write(files, directory) {
	for (const file of files) {
		const target = path.join(directory, ...file.path.split('/'));
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, file.content);
	}
}

const swift = swiftAvailable();
const kotlin = kotlinToolchain();

describe('native toolchains', () => {
	it.runIf(mode === 'require')('are present when required', () => {
		expect(swift, 'swiftc (Xcode) is required').toBe(true);
		expect(kotlin, 'kotlinc and java are required').toBeTruthy();
	});
});

describe.runIf(swift)('generated Swift', () => {
	it('compiles in Swift 5 and 6 language modes and keeps the model contract, through a reopened SQLite replica', () => {
		const directory = path.join(workspace, 'swift');
		write(emitSwiftPackage(ir), directory);
		const sources = path.join(directory, 'Sources', 'HarperModels');
		const main = path.join(sources, 'main.swift');
		fs.copyFileSync(new URL('SwiftHarness.swift', harnesses), main);
		const inputs = ['HarperRuntime.swift', 'HarperSchema.swift', 'Models.swift', 'main.swift'].map(
			(name) => path.join(sources, name),
		);
		execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-typecheck', ...inputs], {
			encoding: 'utf8',
			stdio: 'pipe',
		});
		const binary = path.join(directory, 'harness');
		execFileSync(
			'xcrun',
			[
				'swiftc',
				'-swift-version',
				'6',
				'-warnings-as-errors',
				'-o',
				binary,
				...inputs,
				'-lsqlite3',
			],
			{
				encoding: 'utf8',
				stdio: 'pipe',
			},
		);
		const output = spawnSync(binary, { encoding: 'utf8' });
		expect(output.stdout + output.stderr).toMatch(/^PASS \d+\n$/);
		expect(output.status).toBe(0);
	}, 600_000);
});

describe.runIf(kotlin)('generated Kotlin', () => {
	it('compiles without warnings and keeps the model contract', () => {
		const toolchain = /** @type {{ kotlinc: string, java: string }} */ (kotlin);
		const directory = path.join(workspace, 'kotlin');
		write(emitKotlinModule(ir, { packageName: 'harper.harness' }), directory);
		const sources = path.join(directory, 'src', 'main', 'kotlin', 'harper', 'harness');
		fs.copyFileSync(new URL('KotlinHarness.kt', harnesses), path.join(sources, 'KotlinHarness.kt'));
		const jar = path.join(directory, 'harness.jar');
		const compiled = spawnSync(
			toolchain.kotlinc,
			[
				'-Werror',
				'-include-runtime',
				'-d',
				jar,
				...fs.readdirSync(sources).map((name) => path.join(sources, name)),
			],
			{ encoding: 'utf8', shell: process.platform === 'win32' },
		);
		expect(compiled.stderr, compiled.stderr).not.toMatch(/error:/);
		expect(compiled.status).toBe(0);
		const output = spawnSync(toolchain.java, ['-cp', jar, 'harper.harness.KotlinHarnessKt'], {
			encoding: 'utf8',
		});
		expect(output.stdout + output.stderr).toMatch(/^PASS \d+\r?\n$/);
		expect(output.status).toBe(0);
	}, 600_000);
});
