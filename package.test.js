import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('published package', () => {
	it('ships the entry points, the client generator and its runtime sources, and no tests', () => {
		const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
		const [pack] = JSON.parse(
			execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
				encoding: 'utf8',
				shell: process.platform === 'win32',
			}),
		);
		const files = pack.files.map((/** @type {{ path: string }} */ file) =>
			file.path.replace(/\\/g, '/'),
		);
		for (const required of [
			'index.js',
			'extensionModule.js',
			'config.yaml',
			'bin/schema-codegen.js',
			'utils/client/buildSchemaIR.js',
			'utils/client/runtime/HarperRuntime.swift',
			'utils/client/runtime/HarperRuntime.kt',
		]) {
			expect(files).toContain(required);
		}
		expect(files.filter((file) => file.endsWith('.test.js'))).toEqual([]);
		expect(files.filter((file) => file.startsWith('test/') || file.startsWith('docs/'))).toEqual(
			[],
		);
	});

	it('exposes the public API from the package root', async () => {
		const api = await import('@harperfast/schema-codegen');
		expect(Object.keys(api).sort()).toEqual([
			'IR_VERSION',
			'assertSchemaIR',
			'buildSchemaIR',
			'diffSchemaIR',
			'emitKotlinModule',
			'emitSwiftPackage',
			'normalizeSyncProfiles',
		]);
	});
});
