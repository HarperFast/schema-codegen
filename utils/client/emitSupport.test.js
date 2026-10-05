import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coverageTables, coverageTypes } from '../../test/fixtures/clientSchema.js';
import { buildSchemaIR } from './buildSchemaIR.js';
import {
	commentLines,
	kotlinString,
	readRuntimeSource,
	recursiveValueEdges,
	swiftString,
} from './emitSupport.js';

describe('readRuntimeSource', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns LF line endings from a CRLF checkout', () => {
		vi.spyOn(fs, 'readFileSync').mockReturnValue('package harper.models\r\n\r\nobject X\r\n');
		expect(readRuntimeSource('HarperRuntime.kt')).toBe('package harper.models\n\nobject X\n');
	});
});

describe('swiftString', () => {
	it('escapes quotes, backslashes and control characters', () => {
		expect(swiftString('o"conn\\or')).toBe('"o\\"conn\\\\or"');
		expect(swiftString('a\nb\tc\u0001')).toBe('"a\\nb\\tc\\u{1}"');
		expect(swiftString('\\(interpolation)')).toBe('"\\\\(interpolation)"');
	});

	it('keeps other Unicode and replaces lone surrogates', () => {
		expect(swiftString('naïve 🍕')).toBe('"naïve 🍕"');
		expect(swiftString('a\ud800b')).toBe('"a\\u{FFFD}b"');
	});
});

describe('kotlinString', () => {
	it('escapes $ so nothing is interpolated', () => {
		expect(kotlinString('$price ${total}')).toBe('"\\$price \\${total}"');
	});

	it('escapes quotes, backslashes, control characters and lone surrogates', () => {
		expect(kotlinString('o"conn\\or\n')).toBe('"o\\"conn\\\\or\\n"');
		expect(kotlinString('\u0001\b')).toBe('"\\u0001\\b"');
		expect(kotlinString('a\udc00')).toBe('"a\\uDC00"');
	});
});

describe('commentLines', () => {
	it('breaks block-comment delimiters and splits lines', () => {
		expect(commentLines('ends */ here\nopens /* there')).toEqual([
			'ends * / here',
			'opens / * there',
		]);
		expect(commentLines(undefined)).toEqual([]);
	});
});

describe('recursiveValueEdges', () => {
	it('marks direct self and mutual references, but not references through arrays', () => {
		const types = coverageTypes();
		types.set('Ping', { attributes: [{ name: 'pong', type: 'Pong' }] });
		types.set('Pong', {
			attributes: [
				{ name: 'ping', type: 'Ping' },
				{ name: 'pings', type: 'array', elements: { type: 'Ping' } },
			],
		});
		const tables = [
			...coverageTables(),
			{
				tableName: 'Rally',
				primaryKey: 'id',
				attributes: [
					{ name: 'id', type: 'ID', isPrimaryKey: true },
					{ name: 'start', type: 'Ping' },
				],
			},
		];
		const ir = buildSchemaIR({ tables, types });
		expect([...recursiveValueEdges(ir)].sort()).toEqual(['Node#parent', 'Ping#pong', 'Pong#ping']);
	});
});
