/** @import { IRAttribute, IRNestedAttribute, IRObjectType, IRProfile, IRTable, IRType } from './irTypes.js' */
import { hashCanonical } from './canonicalHash.js';
import { IR_VERSION } from './irConstants.js';
import { compareText } from './syncProfiles.js';

/**
 * @param {string} database
 * @param {string} table
 * @returns {string}
 */
function tableKey(database, table) {
	return `${database}\u0000${table}`;
}

/**
 * Hashes each table's wire/storage contract, and all of them together. A table's contract lists
 * every object type and embedded table shape reachable from it once, by name, so a change to a
 * nested shape changes the hash of every table that carries it while shared and recursive types
 * cost linear time.
 * @param {IRTable[]} tables
 * @param {IRObjectType[]} types
 * @returns {{ tableHashes: Map<string, string>, schemaHash: string }} table hashes keyed by `database\0name`
 */
export function hashContracts(tables, types) {
	const objectTypes = new Map(types.map((type) => [type.name, type]));
	const tablesByKey = new Map(tables.map((table) => [tableKey(table.database, table.name), table]));
	const sorted = [...tables].sort(
		(a, b) => compareText(a.database, b.database) || compareText(a.name, b.name),
	);
	const contracts = sorted.map((table) => tableContract(table, objectTypes, tablesByKey));
	return {
		tableHashes: new Map(
			sorted.map((table, index) => [
				tableKey(table.database, table.name),
				hashCanonical({ irVersion: IR_VERSION, table: contracts[index] }),
			]),
		),
		schemaHash: hashCanonical({ irVersion: IR_VERSION, tables: contracts }),
	};
}

/**
 * @param {Omit<IRProfile, 'hash' | 'schemaHash'>} profile
 * @param {Map<string, string>} tableHashes from `hashContracts`
 * @returns {{ hash: string, schemaHash: string }} the definition's hash and the hello-frame hash of its tables
 */
export function hashProfile(profile, tableHashes) {
	const tables = [...profile.tables].sort(
		(a, b) => compareText(a.database, b.database) || compareText(a.table, b.table),
	);
	return {
		hash: hashCanonical({
			irVersion: IR_VERSION,
			profile: {
				name: profile.name,
				direction: profile.direction,
				retentionMs: profile.retentionMs,
				tables,
			},
		}),
		schemaHash: hashCanonical({
			irVersion: IR_VERSION,
			tables: tables.map((entry) => ({
				database: entry.database,
				table: entry.table,
				hash: tableHashes.get(tableKey(entry.database, entry.table)),
			})),
		}),
	};
}

/**
 * @param {IRTable} table
 * @param {Map<string, IRObjectType>} objectTypes
 * @param {Map<string, IRTable>} tablesByKey
 * @returns {object}
 */
function tableContract(table, objectTypes, tablesByKey) {
	const own = `r:${tableKey(table.database, table.name)}`;
	/** @type {Record<string, object[]>} */
	const shapes = {};
	/** @type {{ key: string, attributes: (IRAttribute | IRNestedAttribute)[] }[]} */
	const pending = [];
	/**
	 * @param {string} key
	 * @param {(IRAttribute | IRNestedAttribute)[]} attributes
	 */
	const reach = (key, attributes) => {
		if (key === own || key in shapes) return;
		shapes[key] = [];
		pending.push({ key, attributes });
	};
	/**
	 * @param {IRType} type
	 * @returns {object}
	 */
	const reference = (type) => {
		switch (type.kind) {
			case 'scalar':
				return type;
			case 'array':
				return {
					kind: 'array',
					element: reference(type.element),
					elementNullable: type.elementNullable,
				};
			case 'object':
				reach(`o:${type.type}`, objectTypes.get(type.type)?.attributes ?? []);
				return { kind: 'object', type: type.type };
			case 'record': {
				const key = tableKey(type.database, type.table);
				reach(`r:${key}`, tablesByKey.get(key)?.attributes ?? []);
				return { kind: 'record', database: type.database, table: type.table };
			}
		}
	};

	const attributes = sortedByName(table.attributes).map((attribute) => ({
		name: attribute.name,
		type: reference(attribute.type),
		nullable: attribute.nullable,
		primaryKey: attribute.primaryKey,
		indexed: attribute.indexed,
		serverManaged: attribute.serverManaged,
		computed: attribute.computed,
	}));
	for (let next = pending.pop(); next; next = pending.pop()) {
		shapes[next.key] = sortedByName(next.attributes).map((attribute) => ({
			name: attribute.name,
			type: reference(attribute.type),
			nullable: attribute.nullable,
		}));
	}
	return {
		database: table.database,
		name: table.name,
		primaryKey: table.primaryKey,
		sealed: table.sealed,
		versionColumn: table.storage.versionColumn,
		extraColumn: table.storage.extraColumn,
		attributes,
		relations: sortedByName(table.relations).map((relation) => ({
			name: relation.name,
			cardinality: relation.cardinality,
			from: relation.from ?? null,
			to: relation.to ?? null,
			target: relation.target,
		})),
		shapes,
	};
}

/**
 * @template {{ name: string }} T
 * @param {T[]} entries
 * @returns {T[]}
 */
function sortedByName(entries) {
	return [...entries].sort((a, b) => compareText(a.name, b.name));
}
