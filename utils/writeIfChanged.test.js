import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic, writeIfChanged } from './writeIfChanged.js';

describe('writeIfChanged', () => {
	/** @type {string} */
	let directory;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-write-'));
	});
	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it('creates missing directories and reports whether it wrote', () => {
		const file = path.join(directory, 'nested', 'types.ts');
		expect(writeIfChanged(file, 'a')).toBe(true);
		expect(writeIfChanged(file, 'a')).toBe(false);
		expect(writeIfChanged(file, 'b')).toBe(true);
		expect(fs.readFileSync(file, 'utf8')).toBe('b');
	});

	it('keeps the previous content when a write fails part-way', () => {
		const file = path.join(directory, 'types.ts');
		fs.writeFileSync(file, 'previous');
		vi.spyOn(fs, 'renameSync').mockImplementation(() => {
			throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
		});
		expect(() => writeFileAtomic(file, 'next')).toThrow(/no space left/);
		expect(fs.readFileSync(file, 'utf8')).toBe('previous');
		expect(fs.readdirSync(directory)).toEqual(['types.ts']);
	});

	it.skipIf(process.platform === 'win32')(
		'updates the target of a symlink and keeps the link',
		() => {
			const target = path.join(directory, 'shared', 'types.ts');
			fs.mkdirSync(path.dirname(target));
			fs.writeFileSync(target, 'previous');
			const link = path.join(directory, 'types.ts');
			fs.symlinkSync(target, link);
			expect(writeIfChanged(link, 'next')).toBe(true);
			expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
			expect(fs.readFileSync(target, 'utf8')).toBe('next');
		},
	);

	it.skipIf(process.platform === 'win32')(
		'creates the target of a dangling symlink and keeps the link',
		() => {
			const target = path.join(directory, 'shared', 'types.ts');
			fs.mkdirSync(path.dirname(target));
			const link = path.join(directory, 'types.ts');
			fs.symlinkSync(target, link);
			expect(writeIfChanged(link, 'first')).toBe(true);
			expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
			expect(fs.readFileSync(target, 'utf8')).toBe('first');
		},
	);

	it('overwrites in place when the target is locked against renames', () => {
		const file = path.join(directory, 'types.ts');
		fs.writeFileSync(file, 'previous');
		vi.spyOn(fs, 'renameSync').mockImplementation(() => {
			throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
		});
		writeFileAtomic(file, 'next');
		expect(fs.readFileSync(file, 'utf8')).toBe('next');
		expect(fs.readdirSync(directory)).toEqual(['types.ts']);
	});
});
