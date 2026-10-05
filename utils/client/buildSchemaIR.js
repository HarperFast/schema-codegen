/** @import { IRAffinity, IRAttribute, IRDiagnostic, IRNestedAttribute, IRObjectType, IRProfile, IRProjections, IRRelation, IRStorage, IRTable, IRType, SchemaIR } from './irTypes.js' */
import { isNullable } from '../isNullable.js';
import { singularize } from '../singularize.js';
import { hashCanonical } from './canonicalHash.js';
import { createNameAllocator, RESERVED_TYPE_NAMES, toCodeIdentifier } from './naming.js';
import { IR_VERSION, SCALAR_TYPES } from './irConstants.js';
import { compareText, normalizeSyncProfiles } from './syncProfiles.js';

export { IR_VERSION };

/** @type {IRType} */
const ANY_TYPE = { kind: 'scalar', scalar: 'Any' };
const AFFINITY = /** @type {Record<string, IRAffinity>} */ ({
	ID: 'TEXT',
	String: 'TEXT',
	Int: 'INTEGER',
	Long: 'INTEGER',
	Boolean: 'INTEGER',
	Float: 'REAL',
	Date: 'REAL',
	BigInt: 'TEXT',
	Bytes: 'BLOB',
	Blob: 'BLOB',
	Any: 'TEXT',
});

/**
 * The fields of a live Harper table (or a plain description of one) the IR reads.
 * @typedef {Object} SourceTable
 * @property {string} tableName
 * @property {string} [databaseName]
 * @property {string} [primaryKey]
 * @property {boolean} [sealed]
 * @property {any[]} [attributes]
 */

/**
 * A GraphQL type definition as registered in `resources.allTypes`.
 * @typedef {{ attributes?: any[], table?: string | null, database?: string | null, description?: string }} SourceTypeDef
 */

/**
 * @typedef {Object} BuildContext
 * @property {Map<string, SourceTypeDef> | Record<string, SourceTypeDef> | undefined} types
 * @property {Set<string>} tableKeys
 * @property {Map<string, { attributes: any[], description?: string }>} pendingTypes
 * @property {string[]} typeQueue
 * @property {IRDiagnostic[]} diagnostics
 */

/**
 * @param {string} database
 * @param {string} table
 * @returns {string}
 */
function tableKey(database, table) {
	return `${database}\u0000${table}`;
}

/**
 * @param {BuildContext['types']} types
 * @param {string} name
 * @returns {SourceTypeDef | undefined}
 */
function lookupType(types, name) {
	if (!types) return undefined;
	if (types instanceof Map) return types.get(name);
	return Object.prototype.hasOwnProperty.call(types, name) ? types[name] : undefined;
}

/**
 * Builds the schema IR from live tables, the GraphQL type registry and `sync.yaml`.
 * @param {Object} input
 * @param {Iterable<SourceTable>} input.tables the tables to describe (already database-filtered)
 * @param {Map<string, SourceTypeDef> | Record<string, SourceTypeDef>} [input.types] resolves nested object types by name (`scope.resources.allTypes`)
 * @param {unknown} [input.syncProfiles] the parsed `sync.yaml`
 * @param {SchemaIR} [input.previous] the previous IR; tables and types keep their `typeName`
 * @param {string} [input.generator] recorded in the IR, not hashed
 * @returns {SchemaIR}
 */
export function buildSchemaIR({ tables: sourceTables, types, syncProfiles, previous, generator }) {
	const sorted = [...sourceTables].sort(
		(a, b) =>
			compareText(a.databaseName ?? 'data', b.databaseName ?? 'data') ||
			compareText(a.tableName, b.tableName),
	);
	/** @type {BuildContext} */
	const context = {
		types,
		tableKeys: new Set(
			sorted.map((table) => tableKey(table.databaseName ?? 'data', table.tableName)),
		),
		pendingTypes: new Map(),
		typeQueue: [],
		diagnostics: [],
	};

	const tables = sorted.map((source) => describeTable(source, context));

	/** @type {Map<string, IRObjectType>} */
	const objectTypes = new Map();
	while (context.typeQueue.length > 0) {
		const name = /** @type {string} */ (context.typeQueue.shift());
		const pending = /** @type {{ attributes: any[], description?: string }} */ (
			context.pendingTypes.get(name)
		);
		/** @type {IRNestedAttribute[]} */
		const attributes = [];
		for (const source of pending.attributes) {
			if (!source?.name || source.relationship) continue;
			attributes.push({
				name: source.name,
				type: toType(source, context, { table: name, attribute: source.name }),
				nullable: source.nullable !== false,
				...(source.description ? { description: String(source.description) } : {}),
			});
		}
		objectTypes.set(name, {
			name,
			typeName: '',
			...(pending.description ? { description: String(pending.description) } : {}),
			attributes,
		});
	}
	const typeList = [...objectTypes.values()].sort((a, b) => compareText(a.name, b.name));
	const tablesByKey = new Map(tables.map((table) => [tableKey(table.database, table.name), table]));

	for (const table of tables) {
		table.projections = projectionsOf(table, objectTypes, tablesByKey);
	}
	allocateTypeNames(tables, typeList, previous);

	for (const table of tables) {
		table.hash = hashCanonical({ irVersion: IR_VERSION, table: tableContract(table, objectTypes) });
	}
	const schemaHash = hashCanonical({
		irVersion: IR_VERSION,
		tables: tables.map((table) => tableContract(table, objectTypes)),
	});

	/** @type {IRProfile[]} */
	const profiles = normalizeSyncProfiles(syncProfiles, tables, context.diagnostics).map(
		(profile) => ({
			...profile,
			hash: hashCanonical({
				irVersion: IR_VERSION,
				profile: {
					name: profile.name,
					direction: profile.direction,
					retentionMs: profile.retentionMs,
					tables: profile.tables,
				},
			}),
			schemaHash: hashCanonical({
				irVersion: IR_VERSION,
				tables: profile.tables.map((entry) => ({
					database: entry.database,
					table: entry.table,
					hash: tablesByKey.get(tableKey(entry.database, entry.table))?.hash,
				})),
			}),
		}),
	);
	for (const profile of profiles) {
		for (const entry of profile.tables) {
			tablesByKey.get(tableKey(entry.database, entry.table))?.profiles.push(profile.name);
		}
	}

	return {
		irVersion: IR_VERSION,
		...(generator ? { generator } : {}),
		schemaHash,
		tables: tables.map((table) => ({
			database: table.database,
			name: table.name,
			typeName: table.typeName,
			primaryKey: table.primaryKey,
			sealed: table.sealed,
			hash: table.hash,
			profiles: table.profiles,
			attributes: table.attributes,
			relations: table.relations,
			projections: table.projections,
			storage: table.storage,
		})),
		types: typeList,
		profiles,
		diagnostics: context.diagnostics,
	};
}

/**
 * @param {SourceTable} source
 * @param {BuildContext} context
 * @returns {IRTable}
 */
function describeTable(source, context) {
	const database = source.databaseName ?? 'data';
	const sourceAttributes = (source.attributes ?? []).filter((attribute) => attribute?.name);
	const flaggedPrimaryKey = sourceAttributes.find((attribute) => attribute.isPrimaryKey)?.name;
	const primaryKey =
		flaggedPrimaryKey ??
		(sourceAttributes.some((attribute) => attribute.name === source.primaryKey)
			? source.primaryKey
			: undefined) ??
		null;
	const derived = derivedAttributeNames(sourceAttributes);

	/** @type {IRAttribute[]} */
	const attributes = [];
	/** @type {IRRelation[]} */
	const relations = [];
	for (const attribute of sourceAttributes) {
		const where = { table: source.tableName, attribute: attribute.name };
		if (attribute.relationship) {
			relations.push(describeRelation(attribute, context, where));
			continue;
		}
		const isPrimaryKey = attribute.name === primaryKey;
		/** @type {IRAttribute['serverManaged']} */
		const serverManaged =
			attribute.assignCreatedTime || attribute.name === '__createdtime__'
				? 'createdTime'
				: attribute.assignUpdatedTime || attribute.name === '__updatedtime__'
					? 'updatedTime'
					: derived.has(attribute.name)
						? 'derived'
						: null;
		const computed = attribute.computed
			? {
					from:
						typeof attribute.computedFromExpression === 'string'
							? attribute.computedFromExpression
							: null,
					version: attribute.version == null ? null : String(attribute.version),
				}
			: null;
		const type = toType(attribute, context, where);
		const blob = !isPrimaryKey && type.kind === 'scalar' && type.scalar === 'Blob';
		const nullable =
			computed || serverManaged === 'derived' || blob
				? true
				: isPrimaryKey || serverManaged
					? false
					: isNullable({ ...attribute, isPrimaryKey: false });
		attributes.push({
			name: attribute.name,
			type,
			nullable,
			primaryKey: isPrimaryKey,
			indexed: Boolean(attribute.indexed),
			serverManaged,
			computed,
			readOnly: Boolean(serverManaged || computed),
			...(attribute.description ? { description: String(attribute.description) } : {}),
		});
	}

	const sealed = source.sealed === true;
	const attributeNames = new Set(attributes.map((attribute) => attribute.name));
	/** @type {IRStorage} */
	const storage = {
		versionColumn: metadataColumn('_version', attributeNames),
		extraColumn: sealed ? null : metadataColumn('_extra', attributeNames),
		columns: attributes.map((attribute) => ({
			name: attribute.name,
			affinity: affinityOf(attribute.type),
		})),
	};
	return {
		database,
		name: source.tableName,
		typeName: '',
		primaryKey,
		sealed,
		hash: '',
		profiles: [],
		attributes,
		relations,
		projections: /** @type {IRProjections} */ ({}),
		storage,
	};
}

/**
 * `@embed` targets and `@decide` targets (with their confidence and decision fields) are written
 * by the server from a source field, never by the client.
 * @param {any[]} attributes
 * @returns {Set<string>}
 */
function derivedAttributeNames(attributes) {
	const names = new Set();
	for (const attribute of attributes) {
		if (attribute.embed) names.add(attribute.name);
		if (attribute.decide) {
			names.add(attribute.name);
			if (attribute.decide.confidence) names.add(attribute.decide.confidence);
			if (attribute.decide.decision) names.add(attribute.decide.decision);
		}
	}
	return names;
}

/**
 * @param {string} base
 * @param {Set<string>} attributeNames
 * @returns {string}
 */
function metadataColumn(base, attributeNames) {
	let name = base;
	while (attributeNames.has(name)) name = `_${name}`;
	return name;
}

/**
 * The replica column affinity for an attribute type: composite values are stored as JSON text.
 * @param {IRType} type
 * @returns {IRAffinity}
 */
export function affinityOf(type) {
	return type.kind === 'scalar' ? AFFINITY[type.scalar] : 'TEXT';
}

/**
 * @param {any} source an attribute or array-element descriptor
 * @param {BuildContext} context
 * @param {{ table: string, attribute: string }} where
 * @returns {IRType}
 */
function toType(source, context, where) {
	const type = source?.type;
	if (type === 'array' || type === 'Array') {
		const elements = source.elements;
		return {
			kind: 'array',
			element: elements ? toType(elements, context, where) : ANY_TYPE,
			elementNullable: elements?.nullable !== false,
		};
	}
	if (type === undefined || type === null || type === '' || type === 'object' || type === 'Object')
		return ANY_TYPE;
	if (SCALAR_TYPES.has(type)) return { kind: 'scalar', scalar: type };

	const typeDef = lookupType(context.types, type);
	if (typeDef?.table) {
		const database = typeDef.database ?? 'data';
		if (context.tableKeys.has(tableKey(database, typeDef.table))) {
			return { kind: 'record', database, table: typeDef.table };
		}
	}
	const attributes = typeDef?.attributes ?? source.properties;
	if (Array.isArray(attributes)) {
		if (!context.pendingTypes.has(type)) {
			context.pendingTypes.set(type, { attributes, description: typeDef?.description });
			context.typeQueue.push(type);
		}
		return { kind: 'object', type };
	}
	context.diagnostics.push({
		level: 'warning',
		code: 'TYPE_UNRESOLVED',
		...where,
		message: `type "${type}" of ${where.table}.${where.attribute} is not a known schema type; it is generated as Any`,
	});
	return ANY_TYPE;
}

/**
 * @param {any} attribute
 * @param {BuildContext} context
 * @param {{ table: string, attribute: string }} where
 * @returns {IRRelation}
 */
function describeRelation(attribute, context, where) {
	const many = attribute.type === 'array' || attribute.type === 'Array';
	/** @type {IRRelation} */
	const relation = {
		name: attribute.name,
		cardinality: many ? 'many' : 'one',
		...(attribute.relationship.from ? { from: String(attribute.relationship.from) } : {}),
		...(attribute.relationship.to ? { to: String(attribute.relationship.to) } : {}),
		target: relationTarget(attribute),
	};
	if (relation.target.database === null) {
		context.diagnostics.push({
			level: 'warning',
			code: 'RELATION_TARGET_UNRESOLVED',
			...where,
			message: `relationship ${where.table}.${where.attribute} does not resolve to a table`,
		});
	}
	return relation;
}

/**
 * GraphQL relationships carry `relationshipReference`; `defineTable` relations carry a lazy
 * `definition.tableClass`.
 * @param {any} attribute
 * @returns {IRRelation['target']}
 */
function relationTarget(attribute) {
	const reference = attribute.relationshipReference ?? attribute.elements?.relationshipReference;
	if (reference?.table)
		return { database: reference.database ?? 'data', table: String(reference.table) };
	const definition = attribute.definition ?? attribute.elements?.definition;
	/** @type {any} */
	let tableClass;
	try {
		tableClass = definition?.tableClass;
	} catch {
		tableClass = undefined;
	}
	if (tableClass?.tableName)
		return { database: tableClass.databaseName ?? 'data', table: tableClass.tableName };
	if (definition?.table)
		return { database: definition.database ?? 'data', table: String(definition.table) };
	const typeName =
		attribute.type === 'array' || attribute.type === 'Array'
			? attribute.elements?.type
			: attribute.type;
	return { database: null, table: String(typeName ?? '') };
}

/**
 * @param {IRType} type
 * @param {Map<string, IRObjectType>} objectTypes
 * @param {Map<string, IRTable>} tablesByKey
 * @param {Set<string>} [visiting]
 * @returns {boolean}
 */
function containsBlob(type, objectTypes, tablesByKey, visiting = new Set()) {
	switch (type.kind) {
		case 'scalar':
			return type.scalar === 'Blob';
		case 'array':
			return containsBlob(type.element, objectTypes, tablesByKey, visiting);
		case 'object': {
			if (visiting.has(`o:${type.type}`)) return false;
			visiting.add(`o:${type.type}`);
			const attributes = objectTypes.get(type.type)?.attributes ?? [];
			return attributes.some((attribute) =>
				containsBlob(attribute.type, objectTypes, tablesByKey, visiting),
			);
		}
		case 'record': {
			const key = tableKey(type.database, type.table);
			if (visiting.has(`r:${key}`)) return false;
			visiting.add(`r:${key}`);
			const attributes = tablesByKey.get(key)?.attributes ?? [];
			return attributes.some((attribute) =>
				containsBlob(attribute.type, objectTypes, tablesByKey, visiting),
			);
		}
	}
}

/**
 * The defineTable projections over stored attributes, with Blob-bearing attributes kept out of
 * every write: the transport has no blob contract yet, so a write could only delete or corrupt one.
 * @param {IRTable} table
 * @param {Map<string, IRObjectType>} objectTypes
 * @param {Map<string, IRTable>} tablesByKey
 * @returns {IRProjections}
 */
function projectionsOf(table, objectTypes, tablesByKey) {
	const blobBearing = new Set(
		table.attributes
			.filter((attribute) => containsBlob(attribute.type, objectTypes, tablesByKey))
			.map((attribute) => attribute.name),
	);
	const writable = table.attributes.filter(
		(attribute) => !attribute.readOnly && !blobBearing.has(attribute.name),
	);
	const patchable = writable.filter((attribute) => !attribute.primaryKey);
	return {
		record: table.attributes.map((attribute) => ({
			name: attribute.name,
			optional: attribute.nullable,
		})),
		insert: writable.map((attribute) => ({
			name: attribute.name,
			optional: attribute.primaryKey || attribute.nullable,
		})),
		upsert:
			blobBearing.size > 0
				? null
				: writable.map((attribute) => ({
						name: attribute.name,
						optional: !attribute.primaryKey && attribute.nullable,
					})),
		patch: patchable.map((attribute) => ({ name: attribute.name, optional: true })),
		clearable: patchable
			.filter((attribute) => attribute.nullable)
			.map((attribute) => attribute.name),
		unwritable: [...blobBearing],
		query: table.attributes
			.filter((attribute) => attribute.indexed)
			.map((attribute) => ({ name: attribute.name, optional: true })),
	};
}

/**
 * @param {IRTable[]} tables sorted
 * @param {IRObjectType[]} types sorted
 * @param {SchemaIR | undefined} previous
 */
function allocateTypeNames(tables, types, previous) {
	const allocator = createNameAllocator(RESERVED_TYPE_NAMES);
	/** @type {Map<string, string>} */
	const previousNames = new Map();
	for (const table of previous?.tables ?? []) {
		previousNames.set(`t:${tableKey(table.database, table.name)}`, table.typeName);
	}
	for (const type of previous?.types ?? []) {
		previousNames.set(`o:${type.name}`, type.typeName);
	}
	/** @type {{ key: string, base: string, assign: (name: string) => void }[]} */
	const entries = [
		...tables.map((table) => ({
			key: `t:${tableKey(table.database, table.name)}`,
			base: `${table.database === 'data' ? '' : `${toCodeIdentifier(table.database)}_`}${toCodeIdentifier(singularize(table.name))}`,
			assign: (/** @type {string} */ name) => {
				table.typeName = name;
			},
		})),
		...types.map((type) => ({
			key: `o:${type.name}`,
			base: toCodeIdentifier(type.name),
			assign: (/** @type {string} */ name) => {
				type.typeName = name;
			},
		})),
	];
	const assigned = new Set();
	for (const entry of entries) {
		const name = previousNames.get(entry.key);
		if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && allocator.claimExact(name)) {
			entry.assign(name);
			assigned.add(entry.key);
		}
	}
	for (const entry of entries) {
		if (assigned.has(entry.key)) continue;
		entry.assign(
			allocator.claim(RESERVED_TYPE_NAMES.has(entry.base) ? `${entry.base}Record` : entry.base),
		);
	}
}

/**
 * The part of a table that determines what a device stores and sends; its hash is the table's
 * wire/storage identity.
 * @param {IRTable} table
 * @param {Map<string, IRObjectType>} objectTypes
 * @returns {object}
 */
function tableContract(table, objectTypes) {
	return {
		database: table.database,
		name: table.name,
		primaryKey: table.primaryKey,
		sealed: table.sealed,
		versionColumn: table.storage.versionColumn,
		extraColumn: table.storage.extraColumn,
		attributes: [...table.attributes]
			.sort((a, b) => compareText(a.name, b.name))
			.map((attribute) => ({
				name: attribute.name,
				type: contractType(attribute.type, objectTypes, new Set()),
				nullable: attribute.nullable,
				primaryKey: attribute.primaryKey,
				indexed: attribute.indexed,
				serverManaged: attribute.serverManaged,
				computed: attribute.computed,
			})),
		relations: [...table.relations]
			.sort((a, b) => compareText(a.name, b.name))
			.map((relation) => ({
				name: relation.name,
				cardinality: relation.cardinality,
				from: relation.from ?? null,
				to: relation.to ?? null,
				target: relation.target,
			})),
	};
}

/**
 * @param {IRType} type
 * @param {Map<string, IRObjectType>} objectTypes
 * @param {Set<string>} visiting
 * @returns {object}
 */
function contractType(type, objectTypes, visiting) {
	switch (type.kind) {
		case 'scalar':
		case 'record':
			return type;
		case 'array':
			return {
				kind: 'array',
				element: contractType(type.element, objectTypes, visiting),
				elementNullable: type.elementNullable,
			};
		case 'object': {
			if (visiting.has(type.type)) return { kind: 'object', type: type.type, cycle: true };
			const inner = new Set(visiting).add(type.type);
			const attributes = objectTypes.get(type.type)?.attributes ?? [];
			return {
				kind: 'object',
				type: type.type,
				attributes: [...attributes]
					.sort((a, b) => compareText(a.name, b.name))
					.map((attribute) => ({
						name: attribute.name,
						type: contractType(attribute.type, objectTypes, inner),
						nullable: attribute.nullable,
					})),
			};
		}
	}
}
