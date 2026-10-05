import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coverageTables, coverageTypes, spikeTables } from '../../test/fixtures/clientSchema.js';
import { buildSchemaIR } from './buildSchemaIR.js';
import { loadSyncProfilesFile, normalizeSyncProfiles, parseDuration } from './syncProfiles.js';

const { tables } = buildSchemaIR({
	tables: [...spikeTables(), ...coverageTables()],
	types: coverageTypes(),
});

/**
 * @param {unknown} document
 */
function normalize(document) {
	/** @type {import('./irTypes.js').IRDiagnostic[]} */
	const diagnostics = [];
	const profiles = normalizeSyncProfiles(document, tables, diagnostics);
	return { profiles, diagnostics };
}

describe('parseDuration', () => {
	it('parses durations with units into milliseconds', () => {
		expect(parseDuration('14d')).toBe(14 * 86_400_000);
		expect(parseDuration(' 12h ')).toBe(12 * 3_600_000);
		expect(parseDuration('1.5w')).toBe(1.5 * 604_800_000);
		expect(parseDuration('250ms')).toBe(250);
	});

	it('rejects durations without a unit, zero, and non-strings', () => {
		expect(parseDuration('14')).toBeNull();
		expect(parseDuration('0d')).toBeNull();
		expect(parseDuration(14)).toBeNull();
		expect(parseDuration('14 days')).toBeNull();
	});

	it('rejects durations that round to nothing or exceed an exact integer', () => {
		expect(parseDuration('0.4ms')).toBeNull();
		expect(parseDuration('99999999999999w')).toBeNull();
	});
});

describe('normalizeSyncProfiles', () => {
	it('returns no profiles when there is no document', () => {
		expect(normalize(undefined)).toEqual({ profiles: [], diagnostics: [] });
	});

	it('normalizes the list form with defaults and a profile-level scope', () => {
		const { profiles, diagnostics } = normalize({
			profiles: {
				storefront: { retention: '14d', tables: ['Product'] },
				'my-orders': { retention: '30d', scope: { customerId: '$token.sub' }, tables: ['Order'] },
			},
		});
		expect(diagnostics).toEqual([]);
		expect(profiles).toEqual([
			{
				name: 'my-orders',
				direction: 'pull',
				retention: '30d',
				retentionMs: 30 * 86_400_000,
				tables: [
					{
						database: 'data',
						table: 'Order',
						scope: {
							type: 'match',
							conditions: [
								{ attribute: 'customerId', operator: 'equals', source: 'claim', claim: 'sub' },
							],
						},
					},
				],
			},
			{
				name: 'storefront',
				direction: 'pull',
				retention: '14d',
				retentionMs: 14 * 86_400_000,
				tables: [{ database: 'data', table: 'Product', scope: { type: 'all' } }],
			},
		]);
	});

	it('normalizes the map form with per-table databases and scope overrides', () => {
		const { profiles, diagnostics } = normalize({
			profiles: {
				mixed: {
					direction: 'bidirectional',
					database: 'coverage',
					scope: { email: '$user.email' },
					description: 'customers and their purchases',
					tables: {
						Customer: null,
						Purchase: { scope: { customerId: ['a', 'b', '$$literal'] } },
						Order: { database: 'data', scope: 'all' },
					},
				},
			},
		});
		expect(diagnostics).toEqual([]);
		expect(profiles[0]).toMatchObject({
			name: 'mixed',
			direction: 'bidirectional',
			description: 'customers and their purchases',
		});
		expect(profiles[0].tables).toEqual([
			{
				database: 'coverage',
				table: 'Customer',
				scope: {
					type: 'match',
					conditions: [{ attribute: 'email', operator: 'equals', source: 'user', field: 'email' }],
				},
			},
			{
				database: 'coverage',
				table: 'Purchase',
				scope: {
					type: 'match',
					conditions: [
						{
							attribute: 'customerId',
							operator: 'in',
							source: 'literal',
							value: ['a', 'b', '$literal'],
						},
					],
				},
			},
			{ database: 'data', table: 'Order', scope: { type: 'all' } },
		]);
	});

	it('treats scalars as literal equality and $$ as an escaped dollar', () => {
		const { profiles } = normalize({
			profiles: {
				p: { tables: { Order: { scope: { status: '$$open', amount: 5, customerId: true } } } },
			},
		});
		expect(profiles[0].tables[0].scope).toEqual({
			type: 'match',
			conditions: [
				{ attribute: 'amount', operator: 'equals', source: 'literal', value: 5 },
				{ attribute: 'customerId', operator: 'equals', source: 'literal', value: true },
				{ attribute: 'status', operator: 'equals', source: 'literal', value: '$open' },
			],
		});
	});

	it('warns, but keeps the profile, when a scope attribute is not indexed', () => {
		const { profiles, diagnostics } = normalize({
			profiles: { p: { scope: { amount: 1 }, tables: ['Order'] } },
		});
		expect(profiles).toHaveLength(1);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				level: 'warning',
				code: 'SCOPE_ATTRIBUTE_NOT_INDEXED',
				profile: 'p',
			}),
		]);
	});

	it('does not warn when scoping by the primary key', () => {
		expect(
			normalize({ profiles: { p: { scope: { id: 'x' }, tables: ['Order'] } } }).diagnostics,
		).toEqual([]);
	});

	/** Every profile below has exactly one error; each must be left out entirely (fail closed). */
	const invalid = /** @type {[string, unknown, string][]} */ ([
		[
			'a mistyped scope attribute',
			{ scope: { custmerId: '$token.sub' }, tables: ['Order'] },
			'SCOPE_ATTRIBUTE_UNKNOWN',
		],
		[
			'a mistyped scope key',
			{ scopes: { customerId: '$token.sub' }, tables: ['Order'] },
			'PROFILE_UNKNOWN_KEY',
		],
		[
			'a mistyped table key',
			{ tables: { Order: { scopes: { customerId: 'x' } } } },
			'PROFILE_UNKNOWN_KEY',
		],
		['an unknown table', { tables: ['Orders'] }, 'PROFILE_TABLE_UNKNOWN'],
		['a table in another database', { tables: ['Customer'] }, 'PROFILE_TABLE_UNKNOWN'],
		['an empty scope', { scope: {}, tables: ['Order'] }, 'SCOPE_INVALID'],
		['a null scope', { scope: null, tables: ['Order'] }, 'SCOPE_INVALID'],
		[
			'an unknown reference',
			{ scope: { customerId: '$session.id' }, tables: ['Order'] },
			'SCOPE_VALUE_INVALID',
		],
		[
			'a reference inside a list',
			{ scope: { customerId: ['$token.sub'] }, tables: ['Order'] },
			'SCOPE_VALUE_INVALID',
		],
		[
			'an empty membership list',
			{ scope: { customerId: [] }, tables: ['Order'] },
			'SCOPE_VALUE_INVALID',
		],
		[
			'an object value',
			{ scope: { customerId: { claim: 'sub' } }, tables: ['Order'] },
			'SCOPE_VALUE_INVALID',
		],
		[
			'a non-scalar scope attribute',
			{ tables: { Customer: { database: 'coverage', scope: { tags: 'x' } } } },
			'SCOPE_ATTRIBUTE_NOT_SCALAR',
		],
		[
			'an invalid direction',
			{ direction: 'sideways', tables: ['Order'] },
			'PROFILE_DIRECTION_INVALID',
		],
		['an invalid retention', { retention: '14', tables: ['Order'] }, 'PROFILE_RETENTION_INVALID'],
		['no tables', { tables: [] }, 'PROFILE_TABLES_INVALID'],
		['a missing table list', { scope: 'all' }, 'PROFILE_TABLES_INVALID'],
		['a table that is not a name', { tables: [42] }, 'PROFILE_TABLES_INVALID'],
		['a profile that is not a map', 'Order', 'PROFILE_INVALID'],
	]);
	it.each(invalid)('drops a profile with %s', (_, definition, code) => {
		const { profiles, diagnostics } = normalize({
			profiles: { broken: definition, fine: { tables: ['Report'] } },
		});
		expect(profiles.map((profile) => profile.name)).toEqual(['fine']);
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ level: 'error', code, profile: 'broken' }),
		);
	});

	it('rejects a document without a profiles map', () => {
		const { profiles, diagnostics } = normalize({ storefront: { tables: ['Product'] } });
		expect(profiles).toEqual([]);
		expect(diagnostics).toEqual([
			expect.objectContaining({ level: 'error', code: 'PROFILES_INVALID' }),
		]);
	});

	it('rejects listing the same table twice', () => {
		const { profiles, diagnostics } = normalize({
			profiles: { p: { tables: ['Order', 'Order'] } },
		});
		expect(profiles).toEqual([]);
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ code: 'PROFILE_TABLE_DUPLICATE' }),
		);
	});
});

describe('loadSyncProfilesFile', () => {
	/** @type {string} */
	let directory;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-profiles-'));
	});
	afterEach(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it('parses YAML, including the scope references', async () => {
		const file = path.join(directory, 'sync.yaml');
		fs.writeFileSync(
			file,
			'profiles:\n  my-orders:\n    scope:\n      customerId: $token.sub\n    tables: [Order]\n',
		);
		expect(await loadSyncProfilesFile(file)).toEqual({
			profiles: { 'my-orders': { scope: { customerId: '$token.sub' }, tables: ['Order'] } },
		});
	});

	it('parses JSON by extension and returns undefined for a missing file', async () => {
		const file = path.join(directory, 'sync.json');
		fs.writeFileSync(file, '{"profiles":{}}');
		expect(await loadSyncProfilesFile(file)).toEqual({ profiles: {} });
		expect(await loadSyncProfilesFile(path.join(directory, 'absent.yaml'))).toBeUndefined();
	});

	it('refuses YAML alias expansion bombs', async () => {
		const file = path.join(directory, 'bomb.yaml');
		const lines = ['a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
		for (let level = 1; level < 12; level++) {
			const previous = String.fromCharCode(96 + level);
			const next = String.fromCharCode(97 + level);
			lines.push(`${next}: &${next} [${Array(10).fill(`*${previous}`).join(',')}]`);
		}
		fs.writeFileSync(file, `${lines.join('\n')}\n`);
		await expect(loadSyncProfilesFile(file)).rejects.toThrow();
	});
});
