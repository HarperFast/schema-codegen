/** @import { IRAffinity, IRObjectType, IRStorage, IRTable, IRType, SchemaIR } from './irTypes.js' */
import { affinityOf, requiredOnInsert } from './buildSchemaIR.js';
import { canonicalJSON } from './canonicalHash.js';
import { compareText } from './syncProfiles.js';
import { assertSchemaIR } from './validateSchemaIR.js';

/** @typedef {'read' | 'write' | 'storage'} BreakAxis */

/**
 * @typedef {Object} SchemaChange
 * @property {string} kind
 * @property {string} database
 * @property {string} table
 * @property {string} [attribute]
 * @property {string} [path] the nested attribute path, for changes inside object types
 * @property {BreakAxis[]} breaks what the change breaks for a client generated from the old IR
 * @property {string} message
 */

/**
 * @typedef {Object} SchemaDelta
 * @property {{ database: string, table: string, storage: IRStorage }[]} addedTables
 * @property {{ database: string, table: string, addColumns: { name: string, affinity: IRAffinity }[], extraColumn: string | null, recompute: { attribute: string, from: string | null, version: string | null }[] }[]} tables
 */

/**
 * @typedef {Object} SchemaDiff
 * @property {string} fromHash
 * @property {string} toHash
 * @property {{ read: Compatibility, write: Compatibility, storage: Compatibility }} compatibility
 * @property {SchemaChange[]} changes
 * @property {{ kind: 'typeRenamed', name: string, from: string, to: string }[]} source changed public type names
 * @property {{ kind: 'added' | 'removed' | 'changed', name: string }[]} profiles
 * @property {SchemaDelta} delta what a client generated from the old IR applies to keep syncing
 */

/** @typedef {'identical' | 'additive' | 'breaking'} Compatibility */

/**
 * @typedef {Object} TypeFinding
 * @property {string} path
 * @property {string} kind
 * @property {boolean} read
 * @property {boolean} write
 * @property {string} message
 */

/**
 * Classifies how moving from one IR to another affects clients generated from the first: whether
 * their decoding (`read`), their writes (`write`) or their replica layout (`storage`) breaks, and
 * what an additive change asks them to apply.
 * @param {SchemaIR} from
 * @param {SchemaIR} to
 * @returns {SchemaDiff}
 */
export function diffSchemaIR(from, to) {
	assertSchemaIR(from);
	assertSchemaIR(to);
	/** @type {SchemaChange[]} */
	const changes = [];
	/** @type {SchemaDiff['source']} */
	const source = [];
	/** @type {SchemaDelta} */
	const delta = { addedTables: [], tables: [] };
	const fromTypes = new Map(from.types.map((type) => [type.name, type]));
	const toTypes = new Map(to.types.map((type) => [type.name, type]));
	const fromTables = new Map(from.tables.map((table) => [keyOf(table), table]));
	const toTables = new Map(to.tables.map((table) => [keyOf(table), table]));
	const keys = [...new Set([...fromTables.keys(), ...toTables.keys()])].sort(compareText);
	/** @type {{ table: IRTable, itemized: boolean }[]} */
	const changedTables = [];

	for (const key of keys) {
		const before = fromTables.get(key);
		const after = toTables.get(key);
		if (!before && after) {
			changes.push({
				kind: 'tableAdded',
				database: after.database,
				table: after.name,
				breaks: [],
				message: `table ${after.database}.${after.name} added`,
			});
			delta.addedTables.push({
				database: after.database,
				table: after.name,
				storage: after.storage,
			});
			continue;
		}
		if (before && !after) {
			changes.push({
				kind: 'tableRemoved',
				database: before.database,
				table: before.name,
				breaks: ['read', 'write', 'storage'],
				message: `table ${before.database}.${before.name} removed`,
			});
			continue;
		}
		if (!before || !after) continue;
		if (before.typeName !== after.typeName) {
			source.push({
				kind: 'typeRenamed',
				name: `${after.database}.${after.name}`,
				from: before.typeName,
				to: after.typeName,
			});
		}
		if (before.hash !== after.hash) {
			const count = changes.length;
			diffTable(before, after, fromTypes, toTypes, changes, delta);
			changedTables.push({ table: after, itemized: changes.length > count });
		}
	}
	const ownChanges = [...changes];
	for (const { table, itemized } of changedTables) {
		const embedded = embeddedTableKeys(table, toTypes, toTables);
		const inherited = new Set(
			ownChanges
				.filter((change) => embedded.has(keyOf({ database: change.database, name: change.table })))
				.flatMap((change) => change.breaks),
		);
		/** @type {BreakAxis[]} */
		const breaks = /** @type {BreakAxis[]} */ (['read', 'write']).filter((axis) =>
			inherited.has(axis),
		);
		if (breaks.length > 0) {
			changes.push({
				kind: 'embeddedTableChanged',
				database: table.database,
				table: table.name,
				breaks,
				message: `${table.database}.${table.name} embeds a table whose change breaks ${breaks.join(', ')}`,
			});
		} else if (!itemized) {
			changes.push({
				kind: 'contractChanged',
				database: table.database,
				table: table.name,
				breaks: [],
				message: `${table.database}.${table.name} changed through a nested type or an embedded table, whose own changes are listed`,
			});
		}
	}
	for (const [name, type] of fromTypes) {
		const next = toTypes.get(name);
		if (next && next.typeName !== type.typeName) {
			source.push({ kind: 'typeRenamed', name, from: type.typeName, to: next.typeName });
		}
	}

	const identical = from.schemaHash === to.schemaHash;
	/**
	 * @param {BreakAxis} axis
	 * @returns {Compatibility}
	 */
	const compatibilityOf = (axis) =>
		identical
			? 'identical'
			: changes.some((change) => change.breaks.includes(axis))
				? 'breaking'
				: 'additive';

	return {
		fromHash: from.schemaHash,
		toHash: to.schemaHash,
		compatibility: {
			read: compatibilityOf('read'),
			write: compatibilityOf('write'),
			storage: compatibilityOf('storage'),
		},
		changes,
		source,
		profiles: diffProfiles(from, to),
		delta,
	};
}

/**
 * @param {{ database: string, name: string }} table
 * @returns {string}
 */
function keyOf(table) {
	return `${table.database}\u0000${table.name}`;
}

/**
 * The tables a table embeds, directly or through nested types and other embedded tables; their
 * models decode and encode inside its rows.
 * @param {IRTable} table
 * @param {Map<string, IRObjectType>} types
 * @param {Map<string, IRTable>} tables
 * @returns {Set<string>} table keys
 */
function embeddedTableKeys(table, types, tables) {
	const found = new Set();
	const visitedTypes = new Set();
	/** @param {IRType} type */
	const visit = (type) => {
		if (type.kind === 'array') visit(type.element);
		else if (type.kind === 'object' && !visitedTypes.has(type.type)) {
			visitedTypes.add(type.type);
			for (const attribute of types.get(type.type)?.attributes ?? []) visit(attribute.type);
		} else if (type.kind === 'record') {
			const key = keyOf({ database: type.database, name: type.table });
			if (found.has(key)) return;
			found.add(key);
			for (const attribute of tables.get(key)?.attributes ?? []) visit(attribute.type);
		}
	};
	for (const attribute of table.attributes) visit(attribute.type);
	return found;
}

/**
 * @param {IRTable} table
 * @returns {Map<string, boolean>} attribute name → optional on read
 */
function readOptionality(table) {
	return new Map(table.projections.record.map((field) => [field.name, field.optional]));
}

/**
 * @param {IRTable} before
 * @param {IRTable} after
 * @param {Map<string, IRObjectType>} fromTypes
 * @param {Map<string, IRObjectType>} toTypes
 * @param {SchemaChange[]} changes
 * @param {SchemaDelta} delta
 */
function diffTable(before, after, fromTypes, toTypes, changes, delta) {
	const table = { database: after.database, table: after.name };
	/**
	 * @param {string} kind
	 * @param {BreakAxis[]} breaks
	 * @param {string} message
	 * @param {{ attribute?: string, path?: string }} [where]
	 */
	const record = (kind, breaks, message, where = {}) =>
		changes.push({ kind, ...table, ...where, breaks, message });
	const name = `${after.database}.${after.name}`;

	if (before.primaryKey !== after.primaryKey) {
		record(
			'primaryKeyChanged',
			['read', 'write', 'storage'],
			`${name} primary key changed from ${before.primaryKey} to ${after.primaryKey}`,
		);
		return;
	}
	const metadataMoved =
		before.storage.versionColumn !== after.storage.versionColumn ||
		(before.storage.extraColumn !== null &&
			after.storage.extraColumn !== null &&
			before.storage.extraColumn !== after.storage.extraColumn);
	if (metadataMoved) {
		record(
			'metadataColumnMoved',
			['storage'],
			`${name} replica metadata columns moved (an attribute now uses ${before.storage.versionColumn} or ${before.storage.extraColumn})`,
		);
	}
	if (before.sealed !== after.sealed) {
		record(
			'sealedChanged',
			['write'],
			after.sealed
				? `${name} became @sealed: clients that send undeclared attributes are rejected`
				: `${name} is no longer @sealed: clients without an overflow bag drop undeclared attributes on PUT`,
		);
	}
	if ((before.projections.upsert === null) !== (after.projections.upsert === null)) {
		record(
			'replacementChanged',
			after.projections.upsert === null ? ['write'] : [],
			after.projections.upsert === null
				? `${name} no longer supports full replacement: an older client's PUT erases Blob content that sync does not deliver`
				: `${name} supports full replacement again`,
		);
	}

	const beforeAttributes = new Map(
		before.attributes.map((attribute) => [attribute.name, attribute]),
	);
	const afterAttributes = new Map(after.attributes.map((attribute) => [attribute.name, attribute]));
	const relationsBefore = new Map(before.relations.map((relation) => [relation.name, relation]));
	const relationsAfter = new Map(after.relations.map((relation) => [relation.name, relation]));
	const optionalBefore = readOptionality(before);
	const optionalAfter = readOptionality(after);
	/** @type {{ name: string, affinity: IRAffinity }[]} */
	const addColumns = [];
	/** @type {{ attribute: string, from: string | null, version: string | null }[]} */
	const recompute = [];
	const oldMetadataColumns = new Set([before.storage.versionColumn, before.storage.extraColumn]);
	const seenTypes = new Set();
	const echoed =
		'older models keep it in their overflow and send it back on PUT, which the server rejects';

	for (const [attributeName, previous] of beforeAttributes) {
		if (afterAttributes.has(attributeName)) continue;
		/** @type {BreakAxis[]} */
		const breaks = [];
		if (!optionalBefore.get(attributeName)) breaks.push('read');
		if (!previous.readOnly && (after.sealed || relationsAfter.has(attributeName))) {
			breaks.push('write');
		}
		record('attributeRemoved', breaks, `${name}.${attributeName} removed`, {
			attribute: attributeName,
		});
	}
	for (const [attributeName, current] of afterAttributes) {
		const previous = beforeAttributes.get(attributeName);
		const where = { attribute: attributeName };
		if (!previous) {
			const echoedComputed =
				current.computed !== null && !before.sealed && !relationsBefore.has(attributeName);
			const dropped = !current.readOnly && (before.sealed || relationsBefore.has(attributeName));
			record(
				'attributeAdded',
				requiredOnInsert(current) || dropped || echoedComputed ? ['write'] : [],
				echoedComputed
					? `${name}.${attributeName} added as a computed attribute: ${echoed}`
					: `${name}.${attributeName} added`,
				where,
			);
			if (!oldMetadataColumns.has(attributeName)) {
				addColumns.push({ name: attributeName, affinity: affinityOf(current.type) });
			}
			if (current.computed) {
				recompute.push({
					attribute: attributeName,
					from: current.computed.from,
					version: current.computed.version,
				});
			}
			continue;
		}

		const findings = compareTypes(
			previous.type,
			current.type,
			fromTypes,
			toTypes,
			attributeName,
			seenTypes,
		);
		for (const finding of findings) {
			/** @type {BreakAxis[]} */
			const breaks = [];
			if (finding.read) breaks.push('read');
			if (finding.write) breaks.push('write');
			record(finding.kind, breaks, `${name}.${finding.message}`, { ...where, path: finding.path });
		}
		if (affinityOf(previous.type) !== affinityOf(current.type)) {
			record(
				'columnAffinityChanged',
				['storage'],
				`${name}.${attributeName} is now stored as ${affinityOf(current.type)}`,
				where,
			);
		}
		const readRelaxed = !optionalBefore.get(attributeName) && optionalAfter.get(attributeName);
		if (readRelaxed || (!previous.nullable && current.nullable)) {
			record(
				'attributeBecameNullable',
				readRelaxed ? ['read'] : [],
				`${name}.${attributeName} became nullable`,
				where,
			);
		}
		if (!requiredOnInsert(previous) && requiredOnInsert(current)) {
			record(
				'attributeBecameRequired',
				['write'],
				`${name}.${attributeName} became required on insert`,
				where,
			);
		}
		if (!previous.readOnly && current.readOnly) {
			record(
				'attributeBecameReadOnly',
				['write'],
				`${name}.${attributeName} became read-only`,
				where,
			);
		}
		if (previous.readOnly && !current.readOnly) {
			record('attributeBecameWritable', [], `${name}.${attributeName} became writable`, where);
		}
		const computedChanged =
			current.computed &&
			(previous.computed?.from !== current.computed.from ||
				previous.computed?.version !== current.computed.version);
		if (computedChanged && current.computed) {
			record('computedChanged', [], `${name}.${attributeName} computed expression changed`, where);
			recompute.push({
				attribute: attributeName,
				from: current.computed.from,
				version: current.computed.version,
			});
		}
		if (
			previous.serverManaged !== current.serverManaged &&
			previous.readOnly === current.readOnly
		) {
			record(
				'serverManagedChanged',
				[],
				current.serverManaged
					? `${name}.${attributeName} is now server-managed (${current.serverManaged})`
					: `${name}.${attributeName} is no longer server-managed`,
				where,
			);
		}
		if (previous.indexed !== current.indexed) {
			record(
				'indexChanged',
				[],
				`${name}.${attributeName} ${current.indexed ? 'is now' : 'is no longer'} indexed`,
				where,
			);
		}
	}

	for (const [relationName, relation] of relationsAfter) {
		const previous = relationsBefore.get(relationName);
		const where = { attribute: relationName };
		if (!previous) {
			const echoedRelation = !before.sealed && !beforeAttributes.has(relationName);
			record(
				'relationAdded',
				echoedRelation ? ['write'] : [],
				echoedRelation
					? `${name}.${relationName} relationship added: ${echoed}`
					: `${name}.${relationName} relationship added`,
				where,
			);
		} else if (canonicalJSON(previous) !== canonicalJSON(relation)) {
			record('relationChanged', [], `${name}.${relationName} relationship changed`, where);
		}
	}
	for (const relationName of relationsBefore.keys()) {
		if (!relationsAfter.has(relationName)) {
			record('relationRemoved', [], `${name}.${relationName} relationship removed`, {
				attribute: relationName,
			});
		}
	}

	const extraColumn = before.storage.extraColumn === null ? after.storage.extraColumn : null;
	if (addColumns.length > 0 || recompute.length > 0 || extraColumn !== null) {
		delta.tables.push({ ...table, addColumns, extraColumn, recompute });
	}
}

/**
 * @param {IRType} before
 * @param {IRType} after
 * @param {Map<string, IRObjectType>} fromTypes
 * @param {Map<string, IRObjectType>} toTypes
 * @param {string} path
 * @param {Set<string>} seen object type pairs already compared for this table; each is reported
 *   once, at the first path that reaches it
 * @returns {TypeFinding[]}
 */
function compareTypes(before, after, fromTypes, toTypes, path, seen) {
	/**
	 * @param {string} kind
	 * @param {boolean} read
	 * @param {boolean} write
	 * @param {string} message
	 * @returns {TypeFinding}
	 */
	const finding = (kind, read, write, message) => ({ path, kind, read, write, message });
	if (before.kind !== after.kind) {
		return [
			finding(
				'attributeTypeChanged',
				true,
				true,
				`${path} type changed from ${before.kind} to ${after.kind}`,
			),
		];
	}
	switch (before.kind) {
		case 'scalar': {
			const next = /** @type {typeof before} */ (after);
			return before.scalar === next.scalar
				? []
				: [
						finding(
							'attributeTypeChanged',
							true,
							true,
							`${path} type changed from ${before.scalar} to ${next.scalar}`,
						),
					];
		}
		case 'record': {
			const next = /** @type {typeof before} */ (after);
			return before.database === next.database && before.table === next.table
				? []
				: [
						finding(
							'attributeTypeChanged',
							true,
							true,
							`${path} now embeds ${next.database}.${next.table}`,
						),
					];
		}
		case 'array': {
			const next = /** @type {typeof before} */ (after);
			const findings = compareTypes(
				before.element,
				next.element,
				fromTypes,
				toTypes,
				`${path}[]`,
				seen,
			);
			if (!before.elementNullable && next.elementNullable) {
				findings.push(
					finding('elementBecameNullable', true, false, `${path} elements became nullable`),
				);
			}
			if (before.elementNullable && !next.elementNullable) {
				findings.push(
					finding('elementBecameRequired', false, true, `${path} elements became non-null`),
				);
			}
			return findings;
		}
		case 'object': {
			const next = /** @type {typeof before} */ (after);
			const pair = `${before.type}\u0000${next.type}`;
			if (seen.has(pair)) return [];
			seen.add(pair);
			const beforeAttributes = new Map(
				(fromTypes.get(before.type)?.attributes ?? []).map((a) => [a.name, a]),
			);
			const afterAttributes = new Map(
				(toTypes.get(next.type)?.attributes ?? []).map((a) => [a.name, a]),
			);
			/** @type {TypeFinding[]} */
			const findings = [];
			for (const [name, attribute] of beforeAttributes) {
				if (!afterAttributes.has(name)) {
					findings.push({
						...finding(
							'nestedAttributeRemoved',
							!attribute.nullable,
							false,
							`${path}.${name} removed`,
						),
						path: `${path}.${name}`,
					});
				}
			}
			for (const [name, attribute] of afterAttributes) {
				const previous = beforeAttributes.get(name);
				const nestedPath = `${path}.${name}`;
				if (!previous) {
					findings.push({
						...finding(
							'nestedAttributeAdded',
							false,
							!attribute.nullable,
							`${nestedPath} added${attribute.nullable ? '' : ' as required'}`,
						),
						path: nestedPath,
					});
					continue;
				}
				findings.push(
					...compareTypes(previous.type, attribute.type, fromTypes, toTypes, nestedPath, seen),
				);
				if (!previous.nullable && attribute.nullable) {
					findings.push({
						...finding(
							'nestedAttributeBecameNullable',
							true,
							false,
							`${nestedPath} became nullable`,
						),
						path: nestedPath,
					});
				}
				if (previous.nullable && !attribute.nullable) {
					findings.push({
						...finding(
							'nestedAttributeBecameRequired',
							false,
							true,
							`${nestedPath} became required`,
						),
						path: nestedPath,
					});
				}
			}
			return findings;
		}
	}
}

/**
 * @param {SchemaIR} from
 * @param {SchemaIR} to
 * @returns {SchemaDiff['profiles']}
 */
function diffProfiles(from, to) {
	const before = new Map(from.profiles.map((profile) => [profile.name, profile.hash]));
	const after = new Map(to.profiles.map((profile) => [profile.name, profile.hash]));
	/** @type {SchemaDiff['profiles']} */
	const result = [];
	for (const name of [...new Set([...before.keys(), ...after.keys()])].sort(compareText)) {
		if (!before.has(name)) result.push({ kind: 'added', name });
		else if (!after.has(name)) result.push({ kind: 'removed', name });
		else if (before.get(name) !== after.get(name)) result.push({ kind: 'changed', name });
	}
	return result;
}
