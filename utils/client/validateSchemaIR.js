/** @import { SchemaIR } from './irTypes.js' */
import { IR_VERSION, SCALAR_TYPES } from './irConstants.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AFFINITIES = new Set(['TEXT', 'INTEGER', 'REAL', 'BLOB']);
const SERVER_MANAGED = new Set([null, 'createdTime', 'updatedTime', 'derived']);
const DIRECTIONS = new Set(['pull', 'push', 'bidirectional']);

/**
 * Checks that a value is a schema IR this generator can emit from: the supported `irVersion`, the
 * expected shapes, unique identifier-safe type names, and references that resolve. An IR read
 * from a file is untrusted input, so emitters and the diff call this before using one.
 * @param {unknown} ir
 * @returns {asserts ir is SchemaIR}
 */
export function assertSchemaIR(ir) {
	const fail = (/** @type {string} */ path, /** @type {string} */ problem) => {
		throw new Error(`Invalid schema IR at ${path}: ${problem}`);
	};
	if (!isObject(ir)) fail('$', 'expected an object');
	const root = /** @type {Record<string, any>} */ (ir);
	if (root.irVersion !== IR_VERSION) {
		fail(
			'$.irVersion',
			`version ${JSON.stringify(root.irVersion)} is not supported (expected ${IR_VERSION})`,
		);
	}
	if (typeof root.schemaHash !== 'string') fail('$.schemaHash', 'expected a string');
	for (const key of ['tables', 'types', 'profiles', 'diagnostics']) {
		if (!Array.isArray(root[key])) fail(`$.${key}`, 'expected an array');
	}

	const tableKeys = new Set();
	const typeNames = new Set(root.types.map((/** @type {any} */ type) => type?.name));
	const claimed = new Set();
	/**
	 * @param {string} path
	 * @param {unknown} typeName
	 */
	const claimTypeName = (path, typeName) => {
		if (typeof typeName !== 'string' || !IDENTIFIER.test(typeName))
			fail(path, 'expected an identifier');
		if (claimed.has(typeName)) fail(path, `type name "${typeName}" is used twice`);
		claimed.add(typeName);
	};
	root.tables.forEach((/** @type {any} */ table, /** @type {number} */ index) => {
		if (isObject(table) && typeof table.database === 'string' && typeof table.name === 'string') {
			tableKeys.add(`${table.database}\u0000${table.name}`);
		} else {
			fail(`$.tables[${index}]`, 'expected database and name strings');
		}
	});

	/**
	 * @param {string} path
	 * @param {any} type
	 */
	const checkType = (path, type) => {
		if (!isObject(type)) fail(path, 'expected a type');
		switch (type.kind) {
			case 'scalar':
				if (!SCALAR_TYPES.has(type.scalar))
					fail(path, `unknown scalar ${JSON.stringify(type.scalar)}`);
				return;
			case 'array':
				if (typeof type.elementNullable !== 'boolean') fail(path, 'expected elementNullable');
				checkType(`${path}.element`, type.element);
				return;
			case 'object':
				if (!typeNames.has(type.type))
					fail(path, `object type ${JSON.stringify(type.type)} is not in types`);
				return;
			case 'record':
				if (!tableKeys.has(`${type.database}\u0000${type.table}`)) {
					fail(path, `embedded table ${type.database}.${type.table} is not in tables`);
				}
				return;
			default:
				fail(path, `unknown kind ${JSON.stringify(type.kind)}`);
		}
	};

	root.tables.forEach((/** @type {any} */ table, /** @type {number} */ index) => {
		const path = `$.tables[${index}]`;
		claimTypeName(`${path}.typeName`, table.typeName);
		if (table.primaryKey !== null && typeof table.primaryKey !== 'string')
			fail(`${path}.primaryKey`, 'expected a string or null');
		if (typeof table.sealed !== 'boolean') fail(`${path}.sealed`, 'expected a boolean');
		if (typeof table.hash !== 'string') fail(`${path}.hash`, 'expected a string');
		if (!Array.isArray(table.attributes)) fail(`${path}.attributes`, 'expected an array');
		const names = new Set();
		table.attributes.forEach(
			(/** @type {any} */ attribute, /** @type {number} */ attributeIndex) => {
				const at = `${path}.attributes[${attributeIndex}]`;
				if (!isObject(attribute) || typeof attribute.name !== 'string' || attribute.name === '')
					fail(at, 'expected a named attribute');
				if (names.has(attribute.name)) fail(at, `attribute "${attribute.name}" is declared twice`);
				names.add(attribute.name);
				checkType(`${at}.type`, attribute.type);
				for (const flag of ['nullable', 'primaryKey', 'indexed', 'readOnly']) {
					if (typeof attribute[flag] !== 'boolean') fail(`${at}.${flag}`, 'expected a boolean');
				}
				if (!SERVER_MANAGED.has(attribute.serverManaged))
					fail(`${at}.serverManaged`, 'unknown value');
				if (attribute.computed !== null && !isObject(attribute.computed))
					fail(`${at}.computed`, 'expected an object or null');
			},
		);
		if (table.primaryKey !== null && !names.has(table.primaryKey))
			fail(`${path}.primaryKey`, 'is not an attribute');
		if (!Array.isArray(table.relations)) fail(`${path}.relations`, 'expected an array');
		const projections = table.projections;
		if (!isObject(projections)) fail(`${path}.projections`, 'expected an object');
		for (const key of ['record', 'insert', 'patch', 'query']) {
			checkProjection(fail, `${path}.projections.${key}`, projections[key], names);
		}
		if (projections.upsert !== null)
			checkProjection(fail, `${path}.projections.upsert`, projections.upsert, names);
		for (const key of ['clearable', 'unwritable']) {
			if (
				!Array.isArray(projections[key]) ||
				projections[key].some((/** @type {any} */ name) => !names.has(name))
			) {
				fail(`${path}.projections.${key}`, 'expected attribute names');
			}
		}
		if ((projections.upsert === null) !== projections.unwritable.length > 0) {
			fail(`${path}.projections.upsert`, 'must be null exactly when an attribute is unwritable');
		}
		const storage = table.storage;
		if (!isObject(storage) || typeof storage.versionColumn !== 'string')
			fail(`${path}.storage`, 'expected a version column');
		if (storage.extraColumn !== null && typeof storage.extraColumn !== 'string')
			fail(`${path}.storage.extraColumn`, 'expected a string or null');
		if (table.sealed !== (storage.extraColumn === null))
			fail(`${path}.storage.extraColumn`, 'must be null exactly when the table is sealed');
		if (
			names.has(storage.versionColumn) ||
			(storage.extraColumn !== null && names.has(storage.extraColumn))
		) {
			fail(`${path}.storage`, 'a metadata column collides with an attribute');
		}
		if (!Array.isArray(storage.columns) || storage.columns.length !== table.attributes.length) {
			fail(`${path}.storage.columns`, 'expected one column per attribute');
		}
		storage.columns.forEach((/** @type {any} */ column, /** @type {number} */ columnIndex) => {
			if (
				!isObject(column) ||
				column.name !== table.attributes[columnIndex].name ||
				!AFFINITIES.has(column.affinity)
			) {
				fail(
					`${path}.storage.columns[${columnIndex}]`,
					'expected the attribute name and a known affinity',
				);
			}
		});
	});

	root.types.forEach((/** @type {any} */ type, /** @type {number} */ index) => {
		const path = `$.types[${index}]`;
		if (!isObject(type) || typeof type.name !== 'string') fail(path, 'expected a named type');
		claimTypeName(`${path}.typeName`, type.typeName);
		if (!Array.isArray(type.attributes)) fail(`${path}.attributes`, 'expected an array');
		const names = new Set();
		type.attributes.forEach(
			(/** @type {any} */ attribute, /** @type {number} */ attributeIndex) => {
				const at = `${path}.attributes[${attributeIndex}]`;
				if (!isObject(attribute) || typeof attribute.name !== 'string' || attribute.name === '')
					fail(at, 'expected a named attribute');
				if (names.has(attribute.name)) fail(at, `attribute "${attribute.name}" is declared twice`);
				names.add(attribute.name);
				checkType(`${at}.type`, attribute.type);
				if (typeof attribute.nullable !== 'boolean') fail(`${at}.nullable`, 'expected a boolean');
			},
		);
	});

	root.profiles.forEach((/** @type {any} */ profile, /** @type {number} */ index) => {
		const path = `$.profiles[${index}]`;
		if (!isObject(profile) || typeof profile.name !== 'string' || profile.name === '')
			fail(path, 'expected a named profile');
		if (!DIRECTIONS.has(profile.direction)) fail(`${path}.direction`, 'unknown direction');
		if (
			profile.retentionMs !== null &&
			!(Number.isFinite(profile.retentionMs) && profile.retentionMs > 0)
		) {
			fail(`${path}.retentionMs`, 'expected a positive number or null');
		}
		if (typeof profile.schemaHash !== 'string') fail(`${path}.schemaHash`, 'expected a string');
		if (!Array.isArray(profile.tables)) fail(`${path}.tables`, 'expected an array');
		profile.tables.forEach((/** @type {any} */ entry, /** @type {number} */ entryIndex) => {
			if (!isObject(entry) || !tableKeys.has(`${entry.database}\u0000${entry.table}`)) {
				fail(`${path}.tables[${entryIndex}]`, 'does not reference a table in tables');
			}
		});
	});
}

/**
 * @param {(path: string, problem: string) => never} fail
 * @param {string} path
 * @param {unknown} projection
 * @param {Set<string>} names
 */
function checkProjection(fail, path, projection, names) {
	if (!Array.isArray(projection)) fail(path, 'expected an array');
	for (const field of /** @type {any[]} */ (projection)) {
		if (!isObject(field) || !names.has(field.name) || typeof field.optional !== 'boolean') {
			fail(path, 'expected { name, optional } entries naming attributes');
		}
	}
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
