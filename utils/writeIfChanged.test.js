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
});
