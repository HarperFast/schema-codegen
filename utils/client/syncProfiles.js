/** @import { IRDiagnostic, IRProfile, IRProfileTable, IRScope, IRScopeCondition, IRTable } from './irTypes.js' */
import fs from 'node:fs';
import path from 'node:path';

const DIRECTIONS = new Set(['pull', 'push', 'bidirectional']);
const PROFILE_KEYS = new Set([
	'description',
	'direction',
	'retention',
	'database',
	'scope',
	'tables',
]);
const TABLE_KEYS = new Set(['database', 'scope']);
const DURATION_UNITS = /** @type {Record<string, number>} */ ({
	ms: 1,
	s: 1000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
});

/**
 * Parses a retention duration such as `14d`, `12h` or `1.5w` into milliseconds.
 * @param {unknown} text
 * @returns {number | null} null when the text is not a positive duration with a unit
 */
export function parseDuration(text) {
	if (typeof text !== 'string') return null;
	const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)\s*$/.exec(text);
	if (!match) return null;
	const milliseconds = Number(match[1]) * DURATION_UNITS[match[2]];
	return milliseconds > 0 && Number.isFinite(milliseconds) ? Math.round(milliseconds) : null;
}

/**
 * Reads a `sync.yaml` (or JSON) file. The YAML parser is loaded only when this is called.
 * @param {string} filePath
 * @returns {Promise<unknown>} the parsed document, or undefined when the file does not exist
 */
export async function loadSyncProfilesFile(filePath) {
	if (!fs.existsSync(filePath)) return undefined;
	const text = fs.readFileSync(filePath, 'utf8');
	if (path.extname(filePath).toLowerCase() === '.json') return JSON.parse(text);
	const { parse } = await import('yaml');
	return parse(text);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isScalar(value) {
	return (
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value))
	);
}

/**
 * Normalizes the `profiles` section of a `sync.yaml` document against the IR's tables.
 *
 * Profiles fail closed: any error invalidates the whole profile, which is then left out of the
 * result and reported as an `error` diagnostic, so a mistyped scope can never widen into `all`.
 * @param {unknown} document the parsed `sync.yaml`
 * @param {IRTable[]} tables the IR tables profiles may reference
 * @param {IRDiagnostic[]} diagnostics receives errors and warnings
 * @returns {Omit<IRProfile, 'hash' | 'schemaHash'>[]} the valid profiles, sorted by name
 */
export function normalizeSyncProfiles(document, tables, diagnostics) {
	if (document === undefined || document === null) return [];
	if (!isPlainObject(document) || !isPlainObject(document.profiles)) {
		diagnostics.push({
			level: 'error',
			code: 'PROFILES_INVALID',
			message: 'sync profiles must be a document with a `profiles` map',
		});
		return [];
	}
	const tablesByKey = new Map(
		tables.map((table) => [`${table.database}\u0000${table.name}`, table]),
	);
	/** @type {Omit<IRProfile, 'hash' | 'schemaHash'>[]} */
	const profiles = [];
	for (const name of Object.keys(document.profiles).sort()) {
		/** @type {IRDiagnostic[]} */
		const errors = [];
		/**
		 * @param {string} code
		 * @param {string} message
		 * @param {{ table?: string, attribute?: string }} [where]
		 */
		const fail = (code, message, where = {}) =>
			errors.push({ level: 'error', code, profile: name, ...where, message });
		const profile = normalizeProfile(name, document.profiles[name], tablesByKey, fail, diagnostics);
		if (errors.length > 0) {
			diagnostics.push(...errors);
		} else if (profile) {
			profiles.push(profile);
		}
	}
	return profiles;
}

/**
 * @param {string} name
 * @param {unknown} definition
 * @param {Map<string, IRTable>} tablesByKey
 * @param {(code: string, message: string, where?: { table?: string, attribute?: string }) => void} fail
 * @param {IRDiagnostic[]} diagnostics
 * @returns {Omit<IRProfile, 'hash' | 'schemaHash'> | null}
 */
function normalizeProfile(name, definition, tablesByKey, fail, diagnostics) {
	if (!isPlainObject(definition)) {
		fail('PROFILE_INVALID', `profile "${name}" must be a map`);
		return null;
	}
	for (const key of Object.keys(definition)) {
		if (!PROFILE_KEYS.has(key))
			fail('PROFILE_UNKNOWN_KEY', `profile "${name}" has an unknown key "${key}"`);
	}
	const direction = definition.direction ?? 'pull';
	if (typeof direction !== 'string' || !DIRECTIONS.has(direction)) {
		fail(
			'PROFILE_DIRECTION_INVALID',
			`profile "${name}" direction must be pull, push or bidirectional`,
		);
	}
	/** @type {string | null} */
	let retention = null;
	/** @type {number | null} */
	let retentionMs = null;
	if (definition.retention !== undefined && definition.retention !== null) {
		retentionMs = parseDuration(definition.retention);
		if (retentionMs === null) {
			fail(
				'PROFILE_RETENTION_INVALID',
				`profile "${name}" retention must be a duration such as 14d`,
			);
		} else {
			retention = String(definition.retention).trim();
		}
	}
	if (definition.description !== undefined && typeof definition.description !== 'string') {
		fail('PROFILE_INVALID', `profile "${name}" description must be a string`);
	}
	const defaultDatabase = definition.database ?? 'data';
	if (typeof defaultDatabase !== 'string' || defaultDatabase === '') {
		fail('PROFILE_DATABASE_INVALID', `profile "${name}" database must be a database name`);
	}

	/** @type {{ table: string, database: unknown, scope: unknown }[]} */
	const entries = [];
	const tablesDefinition = definition.tables;
	if (Array.isArray(tablesDefinition)) {
		for (const tableName of tablesDefinition) {
			if (typeof tableName !== 'string' || tableName === '') {
				fail('PROFILE_TABLES_INVALID', `profile "${name}" lists a table that is not a name`);
				continue;
			}
			entries.push({ table: tableName, database: defaultDatabase, scope: definition.scope });
		}
	} else if (isPlainObject(tablesDefinition)) {
		for (const [tableName, tableDefinition] of Object.entries(tablesDefinition)) {
			if (tableDefinition !== null && !isPlainObject(tableDefinition)) {
				fail('PROFILE_TABLES_INVALID', `profile "${name}" table "${tableName}" must be a map`, {
					table: tableName,
				});
				continue;
			}
			const overrides = tableDefinition ?? {};
			for (const key of Object.keys(overrides)) {
				if (!TABLE_KEYS.has(key)) {
					fail(
						'PROFILE_UNKNOWN_KEY',
						`profile "${name}" table "${tableName}" has an unknown key "${key}"`,
						{
							table: tableName,
						},
					);
				}
			}
			entries.push({
				table: tableName,
				database: overrides.database ?? defaultDatabase,
				scope: 'scope' in overrides ? overrides.scope : definition.scope,
			});
		}
	} else {
		fail('PROFILE_TABLES_INVALID', `profile "${name}" must list its tables`);
	}
	if (entries.length === 0) {
		fail('PROFILE_TABLES_INVALID', `profile "${name}" must list at least one table`);
	}

	/** @type {IRProfileTable[]} */
	const profileTables = [];
	const seen = new Set();
	for (const entry of entries) {
		if (typeof entry.database !== 'string' || entry.database === '') {
			fail(
				'PROFILE_DATABASE_INVALID',
				`profile "${name}" table "${entry.table}" database must be a name`,
				{
					table: entry.table,
				},
			);
			continue;
		}
		const key = `${entry.database}\u0000${entry.table}`;
		if (seen.has(key)) {
			fail(
				'PROFILE_TABLE_DUPLICATE',
				`profile "${name}" lists table "${entry.table}" more than once`,
				{
					table: entry.table,
				},
			);
			continue;
		}
		seen.add(key);
		const table = tablesByKey.get(key);
		if (!table) {
			fail(
				'PROFILE_TABLE_UNKNOWN',
				`profile "${name}" references table "${entry.table}" in database "${entry.database}", which codegen does not see`,
				{ table: entry.table },
			);
			continue;
		}
		const scope = normalizeScope(name, table, entry.scope, fail, diagnostics);
		if (scope) profileTables.push({ database: table.database, table: table.name, scope });
	}
	profileTables.sort(
		(a, b) => compareText(a.database, b.database) || compareText(a.table, b.table),
	);

	return {
		name,
		...(typeof definition.description === 'string' ? { description: definition.description } : {}),
		direction: /** @type {IRProfile['direction']} */ (direction),
		retention,
		retentionMs,
		tables: profileTables,
	};
}

/**
 * @param {string} profileName
 * @param {IRTable} table
 * @param {unknown} scope
 * @param {(code: string, message: string, where?: { table?: string, attribute?: string }) => void} fail
 * @param {IRDiagnostic[]} diagnostics
 * @returns {IRScope | null}
 */
function normalizeScope(profileName, table, scope, fail, diagnostics) {
	if (scope === undefined || scope === 'all') return { type: 'all' };
	const where = { table: table.name };
	if (!isPlainObject(scope) || Object.keys(scope).length === 0) {
		fail(
			'SCOPE_INVALID',
			`profile "${profileName}" scope for "${table.name}" must be "all" or a map of attribute to value`,
			where,
		);
		return null;
	}
	/** @type {IRScopeCondition[]} */
	const conditions = [];
	for (const attributeName of Object.keys(scope).sort()) {
		const attribute = table.attributes.find((candidate) => candidate.name === attributeName);
		const at = { table: table.name, attribute: attributeName };
		if (!attribute) {
			fail(
				'SCOPE_ATTRIBUTE_UNKNOWN',
				`profile "${profileName}" scopes "${table.name}" by "${attributeName}", which is not a stored attribute`,
				at,
			);
			continue;
		}
		if (attribute.type.kind !== 'scalar') {
			fail(
				'SCOPE_ATTRIBUTE_NOT_SCALAR',
				`profile "${profileName}" scopes "${table.name}" by "${attributeName}", which is not a scalar attribute`,
				at,
			);
			continue;
		}
		if (!attribute.indexed && !attribute.primaryKey) {
			diagnostics.push({
				level: 'warning',
				code: 'SCOPE_ATTRIBUTE_NOT_INDEXED',
				profile: profileName,
				...at,
				message: `profile "${profileName}" scopes "${table.name}" by "${attributeName}", which is not @indexed; checkout scans the table`,
			});
		}
		const condition = normalizeCondition(attributeName, scope[attributeName]);
		if (typeof condition === 'string') {
			fail(
				'SCOPE_VALUE_INVALID',
				`profile "${profileName}" scope "${table.name}.${attributeName}": ${condition}`,
				at,
			);
			continue;
		}
		conditions.push(condition);
	}
	return { type: 'match', conditions };
}

/**
 * @param {string} attribute
 * @param {unknown} value
 * @returns {IRScopeCondition | string} the condition, or why the value is invalid
 */
function normalizeCondition(attribute, value) {
	if (Array.isArray(value)) {
		if (value.length === 0) return 'a membership list must not be empty';
		/** @type {(string | number | boolean)[]} */
		const values = [];
		for (const item of value) {
			const literal = literalOf(item);
			if (typeof literal === 'object') return literal.error;
			values.push(literal);
		}
		return { attribute, operator: 'in', source: 'literal', value: values };
	}
	if (typeof value === 'string' && value.startsWith('$') && !value.startsWith('$$')) {
		const reference = /^\$(token|user)\.(.+)$/.exec(value);
		if (!reference) return `"${value}" is not a $token.<claim> or $user.<field> reference`;
		return reference[1] === 'token'
			? { attribute, operator: 'equals', source: 'claim', claim: reference[2] }
			: { attribute, operator: 'equals', source: 'user', field: reference[2] };
	}
	const literal = literalOf(value);
	if (typeof literal === 'object') return literal.error;
	return { attribute, operator: 'equals', source: 'literal', value: literal };
}

/**
 * @param {unknown} value
 * @returns {string | number | boolean | { error: string }}
 */
function literalOf(value) {
	if (!isScalar(value)) return { error: 'values must be strings, numbers or booleans' };
	const scalar = /** @type {string | number | boolean} */ (value);
	if (typeof scalar === 'string' && scalar.startsWith('$')) {
		if (!scalar.startsWith('$$'))
			return { error: 'references are not allowed inside a membership list' };
		return scalar.slice(1);
	}
	return scalar;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareText(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}
