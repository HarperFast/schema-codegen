import { affinityOf, projectionsOf } from './buildSchemaIR.js';
import { canonicalJSON } from './canonicalHash.js';
import { hashContracts, hashProfile } from './contractHash.js';
import { IR_VERSION, SCALAR_TYPES } from './irConstants.js';
import { RESERVED_TYPE_NAMES } from './naming.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HASH = /^[0-9a-f]{64}$/;
const LINE_BREAK_OR_CONTROL = /[\p{Cc}\u2028\u2029]/u;
const AFFINITIES = new Set(['TEXT', 'INTEGER', 'REAL', 'BLOB']);
const SERVER_MANAGED = new Set([null, 'createdTime', 'updatedTime', 'derived']);
const DIRECTIONS = new Set(['pull', 'push', 'bidirectional']);
const CARDINALITIES = new Set(['one', 'many']);

/**
 * Checks that a value is a schema IR this generator can emit from: the supported `irVersion`, the
 * expected shapes, unique identifier-safe type names, references that resolve, and hashes that
 * match the contents. An IR read from a file is untrusted input, so emitters and the diff call
 * this before using one.
 * @param {unknown} ir
 * @returns {asserts ir is import('./irTypes.js').SchemaIR}
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
	if (!isHash(root.schemaHash)) fail('$.schemaHash', 'expected a lowercase hex SHA-256');
	if (
		root.generator !== undefined &&
		(typeof root.generator !== 'string' || LINE_BREAK_OR_CONTROL.test(root.generator))
	) {
		fail('$.generator', 'expected a single-line string');
	}
	for (const key of ['tables', 'types', 'profiles', 'diagnostics']) {
		if (!Array.isArray(root[key])) fail(`$.${key}`, 'expected an array');
	}

	/** @type {Map<string, any>} */
	const tablesByKey = new Map();
	const typeNames = new Set();
	root.types.forEach((/** @type {any} */ type, /** @type {number} */ index) => {
		if (!isObject(type) || typeof type.name !== 'string')
			fail(`$.types[${index}]`, 'expected a named type');
		if (typeNames.has(type.name)) fail(`$.types[${index}]`, `type "${type.name}" is listed twice`);
		typeNames.add(type.name);
	});
	const claimed = new Set();
	/**
	 * @param {string} path
	 * @param {unknown} typeName
	 */
	const claimTypeName = (path, typeName) => {
		if (typeof typeName !== 'string' || !IDENTIFIER.test(typeName))
			fail(path, 'expected an identifier');
		if (RESERVED_TYPE_NAMES.has(/** @type {string} */ (typeName)))
			fail(path, `"${typeName}" is reserved`);
		if (claimed.has(typeName)) fail(path, `type name "${typeName}" is used twice`);
		claimed.add(typeName);
	};
	root.tables.forEach((/** @type {any} */ table, /** @type {number} */ index) => {
		if (!isObject(table) || typeof table.database !== 'string' || typeof table.name !== 'string') {
			fail(`$.tables[${index}]`, 'expected database and name strings');
		}
		const key = `${table.database}\u0000${table.name}`;
		if (tablesByKey.has(key)) {
			fail(`$.tables[${index}]`, `table ${table.database}.${table.name} is listed twice`);
		}
		tablesByKey.set(key, table);
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
				if (!tablesByKey.has(`${type.database}\u0000${type.table}`)) {
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
		if (!isHash(table.hash)) fail(`${path}.hash`, 'expected a lowercase hex SHA-256');
		if (!isStringArray(table.profiles)) fail(`${path}.profiles`, 'expected profile names');
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
				if (
					attribute.computed !== null &&
					!(
						isObject(attribute.computed) &&
						isStringOrNull(attribute.computed.from) &&
						isStringOrNull(attribute.computed.version)
					)
				) {
					fail(`${at}.computed`, 'expected { from, version } or null');
				}
			},
		);
		if (table.primaryKey !== null && !names.has(table.primaryKey))
			fail(`${path}.primaryKey`, 'is not an attribute');
		if (!Array.isArray(table.relations)) fail(`${path}.relations`, 'expected an array');
		table.relations.forEach((/** @type {any} */ relation, /** @type {number} */ relationIndex) => {
			const at = `${path}.relations[${relationIndex}]`;
			if (
				!isObject(relation) ||
				typeof relation.name !== 'string' ||
				relation.name === '' ||
				!CARDINALITIES.has(relation.cardinality) ||
				!isObject(relation.target) ||
				!isStringOrNull(relation.target.database) ||
				typeof relation.target.table !== 'string'
			) {
				fail(at, 'expected a named relation with a cardinality and a target');
			}
			if (names.has(relation.name)) fail(at, `"${relation.name}" is also a stored attribute`);
		});
		const projections = table.projections;
		if (!isObject(projections)) fail(`${path}.projections`, 'expected an object');
		for (const key of ['record', 'insert', 'patch', 'query']) {
			checkProjection(fail, `${path}.projections.${key}`, projections[key], names);
		}
		if (projections.record.length !== names.size)
			fail(`${path}.projections.record`, 'expected every attribute');
		if (projections.upsert !== null)
			checkProjection(fail, `${path}.projections.upsert`, projections.upsert, names);
		const patchNames = new Set(projections.patch.map((/** @type {any} */ field) => field.name));
		checkNames(fail, `${path}.projections.clearable`, projections.clearable, patchNames);
		checkNames(fail, `${path}.projections.unwritable`, projections.unwritable, names);
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

	const profileNames = new Set();
	root.profiles.forEach((/** @type {any} */ profile, /** @type {number} */ index) => {
		const path = `$.profiles[${index}]`;
		if (!isObject(profile) || typeof profile.name !== 'string' || profile.name === '')
			fail(path, 'expected a named profile');
		if (profileNames.has(profile.name)) fail(path, `profile "${profile.name}" is listed twice`);
		profileNames.add(profile.name);
		if (profile.description !== undefined && typeof profile.description !== 'string')
			fail(`${path}.description`, 'expected a string');
		if (!DIRECTIONS.has(profile.direction)) fail(`${path}.direction`, 'unknown direction');
		if (!isStringOrNull(profile.retention)) fail(`${path}.retention`, 'expected a string or null');
		if (
			profile.retentionMs !== null &&
			!(Number.isSafeInteger(profile.retentionMs) && profile.retentionMs > 0)
		) {
			fail(`${path}.retentionMs`, 'expected a positive integer or null');
		}
		if (!isHash(profile.hash)) fail(`${path}.hash`, 'expected a lowercase hex SHA-256');
		if (!isHash(profile.schemaHash)) fail(`${path}.schemaHash`, 'expected a lowercase hex SHA-256');
		if (!Array.isArray(profile.tables) || profile.tables.length === 0)
			fail(`${path}.tables`, 'expected at least one table');
		const listed = new Set();
		profile.tables.forEach((/** @type {any} */ entry, /** @type {number} */ entryIndex) => {
			const at = `${path}.tables[${entryIndex}]`;
			const key = isObject(entry) ? `${entry.database}\u0000${entry.table}` : '';
			const table = tablesByKey.get(key);
			if (!table) fail(at, 'does not reference a table in tables');
			if (listed.has(key)) fail(at, 'lists a table twice');
			listed.add(key);
			checkScope(fail, `${at}.scope`, entry.scope, table);
		});
	});

	const objectTypes = new Map(root.types.map((/** @type {any} */ type) => [type.name, type]));
	root.tables.forEach((/** @type {any} */ table, /** @type {number} */ index) => {
		const path = `$.tables[${index}]`;
		table.attributes.forEach((/** @type {any} */ attribute, /** @type {number} */ at) => {
			if (attribute.readOnly !== (attribute.serverManaged !== null || attribute.computed !== null))
				fail(
					`${path}.attributes[${at}].readOnly`,
					'must hold exactly for server-managed and computed attributes',
				);
			if (table.storage.columns[at].affinity !== affinityOf(attribute.type))
				fail(`${path}.storage.columns[${at}].affinity`, 'does not match the attribute type');
		});
		if (
			canonicalJSON(table.projections) !==
			canonicalJSON(projectionsOf(table, objectTypes, tablesByKey, []))
		) {
			fail(`${path}.projections`, 'do not follow from the attributes');
		}
	});

	const { tableHashes, schemaHash } = hashContracts(root.tables, root.types);
	root.tables.forEach((/** @type {any} */ table, /** @type {number} */ index) => {
		if (table.hash !== tableHashes.get(`${table.database}\u0000${table.name}`))
			fail(`$.tables[${index}].hash`, 'does not match the table');
	});
	if (root.schemaHash !== schemaHash) fail('$.schemaHash', 'does not match the tables');
	root.profiles.forEach((/** @type {any} */ profile, /** @type {number} */ index) => {
		const hashes = hashProfile(profile, tableHashes);
		if (profile.hash !== hashes.hash)
			fail(`$.profiles[${index}].hash`, 'does not match the profile');
		if (profile.schemaHash !== hashes.schemaHash)
			fail(`$.profiles[${index}].schemaHash`, "does not match the profile's tables");
	});
}

/**
 * The shapes `normalizeSyncProfiles` produces, so an imported IR cannot carry a scope it would
 * have refused.
 * @param {(path: string, problem: string) => never} fail
 * @param {string} path
 * @param {any} scope
 * @param {any} table
 */
function checkScope(fail, path, scope, table) {
	if (isObject(scope) && scope.type === 'all' && Object.keys(scope).length === 1) return;
	if (
		!isObject(scope) ||
		scope.type !== 'match' ||
		!Array.isArray(scope.conditions) ||
		scope.conditions.length === 0
	) {
		fail(path, 'expected { type: "all" } or { type: "match" } with conditions');
	}
	const scoped = new Set();
	scope.conditions.forEach((/** @type {any} */ condition, /** @type {number} */ index) => {
		const at = `${path}.conditions[${index}]`;
		const attribute = isObject(condition)
			? table.attributes.find(
					(/** @type {any} */ candidate) => candidate.name === condition.attribute,
				)
			: undefined;
		if (!attribute || attribute.type.kind !== 'scalar')
			fail(at, 'expected a scalar attribute of the table');
		if (scoped.has(condition.attribute)) fail(at, `"${condition.attribute}" is scoped twice`);
		scoped.add(condition.attribute);
		const valid =
			condition.operator === 'in'
				? condition.source === 'literal' &&
					Array.isArray(condition.value) &&
					condition.value.length > 0 &&
					condition.value.every(isLiteral)
				: condition.operator === 'equals' &&
					((condition.source === 'literal' && isLiteral(condition.value)) ||
						(condition.source === 'claim' && isName(condition.claim)) ||
						(condition.source === 'user' && isName(condition.field)));
		if (!valid) {
			fail(at, 'expected an equals condition on a literal, claim or user field, or an in list');
		}
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
	const listed = new Set();
	for (const field of /** @type {any[]} */ (projection)) {
		if (!isObject(field) || !names.has(field.name) || typeof field.optional !== 'boolean') {
			fail(path, 'expected { name, optional } entries naming attributes');
		}
		if (listed.has(field.name)) fail(path, `"${field.name}" is listed twice`);
		listed.add(field.name);
	}
}

/**
 * @param {(path: string, problem: string) => never} fail
 * @param {string} path
 * @param {unknown} list
 * @param {Set<string>} allowed
 */
function checkNames(fail, path, list, allowed) {
	if (
		!isStringArray(list) ||
		new Set(list).size !== list.length ||
		list.some((name) => !allowed.has(name))
	) {
		fail(path, 'expected distinct attribute names');
	}
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isHash(value) {
	return typeof value === 'string' && HASH.test(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isStringOrNull(value) {
	return value === null || typeof value === 'string';
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isStringArray(value) {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isName(value) {
	return typeof value === 'string' && value !== '';
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isLiteral(value) {
	return (
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value))
	);
}
