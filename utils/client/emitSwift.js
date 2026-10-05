/** @import { IRAttribute, IRNestedAttribute, IRObjectType, IRProfile, IRTable, IRType, SchemaIR } from './irTypes.js' */
import {
	commentLines,
	generatedHeader,
	readRuntimeSource,
	recursiveValueEdges,
	swiftString,
} from './emitSupport.js';
import {
	allocateMemberNames,
	escapeSwiftIdentifier,
	RESERVED_MEMBER_NAMES,
	toCodeIdentifier,
} from './naming.js';
import { assertSchemaIR } from './validateSchemaIR.js';

const SCALAR_TYPES = /** @type {Record<string, string>} */ ({
	ID: 'String',
	String: 'String',
	Int: 'Int',
	Long: 'Int64',
	Float: 'Double',
	BigInt: 'HarperBigInt',
	Boolean: 'Bool',
	Date: 'Date',
	Bytes: 'Data',
	Blob: 'HarperValue',
	Any: 'HarperValue',
});
const COLUMN_TYPES = /** @type {Record<string, string>} */ ({
	ID: 'id',
	String: 'string',
	Int: 'int',
	Long: 'long',
	Float: 'float',
	BigInt: 'bigInt',
	Boolean: 'boolean',
	Date: 'date',
	Bytes: 'bytes',
	Blob: 'blob',
	Any: 'any',
});
const FIELD_CASE_RESERVED = ['rawValue', 'hashValue', 'init'];
const PROFILE_RESERVED = ['Direction', 'Type', 'Protocol', 'init', 'self', 'Self'];
const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * @typedef {Object} EmittedFile
 * @property {string} path relative to the package directory, `/`-separated
 * @property {string} content
 * @property {boolean} scaffold written only when absent, then owned by the user
 */

/**
 * @typedef {Object} SwiftContext
 * @property {Map<string, IRObjectType>} typesByName
 * @property {Map<string, IRTable>} tablesByKey
 * @property {Set<string>} boxedEdges
 */

/**
 * Renders a Swift package (manifest, runtime, schema and models) from a schema IR.
 * @param {SchemaIR} ir
 * @param {{ module?: string }} [options]
 * @returns {EmittedFile[]}
 */
export function emitSwiftPackage(ir, { module = 'HarperModels' } = {}) {
	assertSchemaIR(ir);
	if (!MODULE_NAME.test(module)) {
		throw new Error(`swiftModule "${module}" must be a Swift identifier`);
	}
	const clash = [...ir.tables, ...ir.types].find((entry) => entry.typeName === module);
	if (clash) {
		throw new Error(
			`swiftModule "${module}" is also a generated type name; choose a different module name`,
		);
	}
	/** @type {SwiftContext} */
	const context = {
		typesByName: new Map(ir.types.map((type) => [type.name, type])),
		tablesByKey: new Map(ir.tables.map((table) => [`${table.database}\u0000${table.name}`, table])),
		boxedEdges: recursiveValueEdges(ir),
	};
	const header = generatedHeader(ir);
	const sources = `Sources/${module}`;
	return [
		{ path: 'Package.swift', content: packageManifest(module), scaffold: true },
		{
			path: `${sources}/HarperRuntime.swift`,
			content: header + readRuntimeSource('HarperRuntime.swift'),
			scaffold: false,
		},
		{ path: `${sources}/HarperSchema.swift`, content: header + schemaSource(ir), scaffold: false },
		{
			path: `${sources}/Models.swift`,
			content: header + modelsSource(ir, context),
			scaffold: false,
		},
	];
}

/**
 * @param {string} module
 * @returns {string}
 */
function packageManifest(module) {
	return `// swift-tools-version:5.9
import PackageDescription

let package = Package(
	name: ${swiftString(module)},
	platforms: [.iOS(.v13), .macOS(.v10_15), .tvOS(.v13), .watchOS(.v6)],
	products: [.library(name: ${swiftString(module)}, targets: [${swiftString(module)}])],
	targets: [.target(name: ${swiftString(module)})]
)
`;
}

/**
 * @param {IRType} type
 * @param {SwiftContext} context
 * @param {boolean} boxed
 * @returns {string}
 */
function swiftType(type, context, boxed = false) {
	switch (type.kind) {
		case 'scalar':
			return SCALAR_TYPES[type.scalar];
		case 'array':
			return `[${swiftType(type.element, context)}${type.elementNullable ? '?' : ''}]`;
		case 'object': {
			const name = /** @type {IRObjectType} */ (context.typesByName.get(type.type)).typeName;
			return boxed ? `HarperBox<${name}>` : name;
		}
		case 'record': {
			const name = /** @type {IRTable} */ (
				context.tablesByKey.get(`${type.database}\u0000${type.table}`)
			).typeName;
			return boxed ? `HarperBox<${name}>` : name;
		}
	}
}

/**
 * @param {IRType} type
 * @returns {string}
 */
function columnType(type) {
	if (type.kind === 'scalar') return COLUMN_TYPES[type.scalar];
	return type.kind === 'array' ? 'array' : 'object';
}

/**
 * @param {string[]} lines
 * @param {string} indent
 * @returns {string}
 */
function docComment(lines, indent) {
	return lines.map((line) => `${indent}///${line ? ` ${line}` : ''}\n`).join('');
}

/**
 * @typedef {Object} SwiftProperty
 * @property {string} raw the attribute name
 * @property {string} name the escaped Swift identifier
 * @property {string} type the property type, optional marker included
 * @property {boolean} optional
 */

/**
 * @param {IRAttribute | IRNestedAttribute} attribute
 * @param {string} identifier
 * @param {string} ownerTypeName
 * @param {SwiftContext} context
 * @param {boolean} optional
 * @returns {SwiftProperty}
 */
function propertyOf(attribute, identifier, ownerTypeName, context, optional) {
	const boxed = context.boxedEdges.has(`${ownerTypeName}#${attribute.name}`);
	const base = swiftType(attribute.type, context, boxed);
	return {
		raw: attribute.name,
		name: escapeSwiftIdentifier(identifier),
		type: optional ? `${base}?` : base,
		optional,
	};
}

/**
 * @param {SwiftProperty[]} properties
 * @param {string} indent
 * @param {string[]} [trailing] extra parameters
 * @returns {string}
 */
function initializer(properties, indent, trailing = []) {
	const parameters = [
		...properties.map(
			(property) => `${property.name}: ${property.type}${property.optional ? ' = nil' : ''}`,
		),
		...trailing,
	];
	const assignments = properties.map(
		(property) => `${indent}\tself.${property.name} = ${property.name}\n`,
	);
	return `${indent}public init(${parameters.join(', ')}) {\n${assignments.join('')}`;
}

/**
 * @param {SwiftProperty[]} properties
 * @param {string} indent
 * @returns {string}
 */
function encodeAssignments(properties, indent) {
	return properties
		.map((property) =>
			property.optional
				? `${indent}if let value = self.${property.name} { row[${swiftString(property.raw)}] = value.harperValue }\n`
				: `${indent}row[${swiftString(property.raw)}] = self.${property.name}.harperValue\n`,
		)
		.join('');
}

/**
 * @param {SchemaIR} ir
 * @param {SwiftContext} context
 * @returns {string}
 */
function modelsSource(ir, context) {
	let source = 'import Foundation\n';
	for (const table of ir.tables) source += `\n${tableModel(table, context)}`;
	for (const type of ir.types) source += `\n${objectModel(type, context)}`;
	return source;
}

/**
 * @param {IRTable} table
 * @param {SwiftContext} context
 * @returns {string}
 */
function tableModel(table, context) {
	const typeName = table.typeName;
	const names = allocateMemberNames(
		table.attributes.map((attribute) => attribute.name),
		RESERVED_MEMBER_NAMES,
	);
	const identifierOf = (/** @type {string} */ raw) => /** @type {string} */ (names.get(raw));
	const attributesByName = new Map(
		table.attributes.map((attribute) => [attribute.name, attribute]),
	);
	const patchable = new Set(table.projections.patch.map((field) => field.name));
	const record = table.attributes.map((attribute) =>
		propertyOf(attribute, identifierOf(attribute.name), typeName, context, attribute.nullable),
	);
	const recordByName = new Map(record.map((property) => [property.raw, property]));
	const declared = [
		...table.attributes.map((attribute) => attribute.name),
		...table.relations.map((relation) => relation.name),
	];
	const sealed = table.storage.extraColumn === null;
	const typeLabel = swiftString(typeName);

	const primaryKey = table.primaryKey === null ? undefined : recordByName.get(table.primaryKey);
	const hasIdProperty = record.some((property) => property.name === 'id');
	const identifiable = primaryKey !== undefined && (primaryKey.name === 'id' || !hasIdProperty);

	let source = docComment(
		commentLines(`Table \`${table.name}\` in database \`${table.database}\`.`),
		'',
	);
	source += `public struct ${typeName}: HarperRecord${identifiable ? ', Identifiable' : ''} {\n`;
	source += `\tpublic static let schema = ${tableSchemaLiteral(table)}\n`;
	source += `\tprivate static let declaredAttributes: Set<String> = [${declared.map(swiftString).join(', ')}]\n\n`;

	for (const property of record) {
		const attribute = /** @type {IRAttribute} */ (attributesByName.get(property.raw));
		const lines = commentLines(attribute.description);
		if (attribute.computed?.from)
			lines.push(`Computed on the client from \`${attribute.computed.from}\`.`);
		source += docComment(
			lines.flatMap((line) => commentLines(line)),
			'\t',
		);
		const keyword = patchable.has(attribute.name) ? 'var' : 'let';
		source += `\tpublic ${keyword} ${property.name}: ${property.type}\n`;
	}
	source += '\tpublic let _version: Double?\n';
	if (!sealed) source += '\tpublic var _extra: [String: HarperValue]\n';
	if (identifiable && primaryKey && primaryKey.name !== 'id') {
		source += `\tpublic var id: ${primaryKey.type} { self.${primaryKey.name} }\n`;
	}

	const trailing = [
		'_version: Double? = nil',
		...(sealed ? [] : ['_extra: [String: HarperValue] = [:]']),
	];
	source += `\n${initializer(record, '\t', trailing)}`;
	source += '\t\tself._version = _version\n';
	if (!sealed) source += '\t\tself._extra = _extra\n';
	source += '\t}\n\n';

	source += '\tpublic init(row: HarperRow, version: Double?) throws {\n';
	for (const property of record) {
		const call = property.optional ? 'harperOptional' : 'harperRequired';
		source += `\t\tself.${property.name} = try row.${call}(${swiftString(property.raw)}, of: ${typeLabel})\n`;
	}
	source += '\t\tself._version = version\n';
	if (!sealed) source += '\t\tself._extra = row.harperExtra(excluding: Self.declaredAttributes)\n';
	source += '\t}\n\n';

	const startRow = sealed
		? 'var row: HarperRow = [:]'
		: 'var row = self._extra.harperExtra(excluding: Self.declaredAttributes)';
	source += '\tpublic func encodeRow() -> HarperRow {\n';
	source += `\t\t${startRow}\n`;
	source += encodeAssignments(record, '\t\t');
	source += '\t\treturn row\n\t}\n\n';

	source += '\tpublic func encodeUpsertRow() throws -> HarperRow {\n';
	if (table.projections.upsert === null) {
		source += `\t\tthrow HarperEncodingError.replacementUnsupported(type: ${typeLabel}, attribute: ${swiftString(table.projections.unwritable[0])})\n`;
	} else {
		const upsert = table.projections.upsert.map(
			(field) => /** @type {SwiftProperty} */ (recordByName.get(field.name)),
		);
		source += `\t\t${startRow}\n`;
		source += encodeAssignments(upsert, '\t\t');
		source += '\t\treturn row\n';
	}
	source += '\t}\n';

	if (table.projections.insert.length > 0) {
		const insert = table.projections.insert.map((field) =>
			propertyOf(
				/** @type {IRAttribute} */ (attributesByName.get(field.name)),
				identifierOf(field.name),
				typeName,
				context,
				field.optional,
			),
		);
		source += '\n\t/// The insert (`POST`) body; without a primary key the server assigns one.\n';
		source += '\tpublic struct New: HarperWritable {\n';
		for (const property of insert) source += `\t\tpublic var ${property.name}: ${property.type}\n`;
		if (!sealed) source += '\t\tpublic var _extra: [String: HarperValue]\n';
		source += `\n${initializer(insert, '\t\t', sealed ? [] : ['_extra: [String: HarperValue] = [:]'])}`;
		if (!sealed) source += '\t\t\tself._extra = _extra\n';
		source += '\t\t}\n\n';
		source += '\t\tpublic func encodeRow() -> HarperRow {\n';
		source += sealed
			? '\t\t\tvar row: HarperRow = [:]\n'
			: `\t\t\tvar row = self._extra.harperExtra(excluding: ${typeName}.declaredAttributes)\n`;
		source += encodeAssignments(insert, '\t\t\t');
		source += '\t\t\treturn row\n\t\t}\n\t}\n';
	}

	if (table.projections.patch.length > 0) {
		const patch = table.projections.patch.map((field) =>
			propertyOf(
				/** @type {IRAttribute} */ (attributesByName.get(field.name)),
				identifierOf(field.name),
				typeName,
				context,
				true,
			),
		);
		const clearable = table.projections.clearable;
		const caseNames = allocateMemberNames(
			clearable.map((raw) => identifierOf(raw)),
			FIELD_CASE_RESERVED,
		);
		source +=
			'\n\t/// The patch body: unset attributes are left unchanged, `clear` sets attributes to null, and a set value wins over a clear.\n';
		source += '\tpublic struct Patch: HarperWritable {\n';
		if (clearable.length > 0) {
			source += '\t\tpublic enum Field: String, Sendable, Hashable {\n';
			for (const raw of clearable) {
				source += `\t\t\tcase ${escapeSwiftIdentifier(/** @type {string} */ (caseNames.get(identifierOf(raw))))} = ${swiftString(raw)}\n`;
			}
			source += '\t\t}\n\n';
		}
		for (const property of patch) source += `\t\tpublic var ${property.name}: ${property.type}\n`;
		if (clearable.length > 0) source += '\t\tpublic var clear: Set<Field>\n';
		source += `\n${initializer(patch, '\t\t', clearable.length > 0 ? ['clear: Set<Field> = []'] : [])}`;
		if (clearable.length > 0) source += '\t\t\tself.clear = clear\n';
		source += '\t\t}\n\n';
		source += '\t\tpublic func encodeRow() -> HarperRow {\n';
		source += '\t\t\tvar row: HarperRow = [:]\n';
		if (clearable.length > 0)
			source += '\t\t\tfor field in self.clear { row[field.rawValue] = .null }\n';
		source += encodeAssignments(patch, '\t\t\t');
		source += '\t\t\treturn row\n\t\t}\n\t}\n';
	}
	source += '}\n';
	return source;
}

/**
 * @param {IRObjectType} type
 * @param {SwiftContext} context
 * @returns {string}
 */
function objectModel(type, context) {
	const names = allocateMemberNames(
		type.attributes.map((attribute) => attribute.name),
		RESERVED_MEMBER_NAMES,
	);
	const properties = type.attributes.map((attribute) =>
		propertyOf(
			attribute,
			/** @type {string} */ (names.get(attribute.name)),
			type.typeName,
			context,
			attribute.nullable,
		),
	);
	const typeLabel = swiftString(type.typeName);
	let source = docComment(commentLines(type.description ?? `Nested type \`${type.name}\`.`), '');
	source += `public struct ${type.typeName}: HarperObject {\n`;
	source += `\tprivate static let declaredAttributes: Set<String> = [${type.attributes.map((attribute) => swiftString(attribute.name)).join(', ')}]\n\n`;
	type.attributes.forEach((attribute, index) => {
		source += docComment(commentLines(attribute.description), '\t');
		source += `\tpublic var ${properties[index].name}: ${properties[index].type}\n`;
	});
	source += '\tpublic var _extra: [String: HarperValue]\n';
	source += `\n${initializer(properties, '\t', ['_extra: [String: HarperValue] = [:]'])}`;
	source += '\t\tself._extra = _extra\n\t}\n\n';
	source += '\tpublic init(row: HarperRow) throws {\n';
	for (const property of properties) {
		const call = property.optional ? 'harperOptional' : 'harperRequired';
		source += `\t\tself.${property.name} = try row.${call}(${swiftString(property.raw)}, of: ${typeLabel})\n`;
	}
	source += '\t\tself._extra = row.harperExtra(excluding: Self.declaredAttributes)\n\t}\n\n';
	source += '\tpublic func encodeRow() -> HarperRow {\n';
	source += '\t\tvar row = self._extra.harperExtra(excluding: Self.declaredAttributes)\n';
	source += encodeAssignments(properties, '\t\t');
	source += '\t\treturn row\n\t}\n}\n';
	return source;
}

/**
 * @param {IRTable} table
 * @returns {string}
 */
function tableSchemaLiteral(table) {
	const attributesByName = new Map(
		table.attributes.map((attribute) => [attribute.name, attribute]),
	);
	const columns = table.storage.columns.map((column) => {
		const attribute = /** @type {IRAttribute} */ (attributesByName.get(column.name));
		const parts = [
			`name: ${swiftString(column.name)}`,
			`type: .${columnType(attribute.type)}`,
			`affinity: .${column.affinity.toLowerCase()}`,
			`nullable: ${attribute.nullable}`,
		];
		if (attribute.primaryKey) parts.push('primaryKey: true');
		if (attribute.indexed) parts.push('indexed: true');
		if (attribute.readOnly) parts.push('readOnly: true');
		if (attribute.computed?.from)
			parts.push(`computedFrom: ${swiftString(attribute.computed.from)}`);
		return `\t\t\tHarperColumn(${parts.join(', ')}),\n`;
	});
	return `HarperTableSchema(
		database: ${swiftString(table.database)},
		name: ${swiftString(table.name)},
		primaryKey: ${table.primaryKey === null ? 'nil' : swiftString(table.primaryKey)},
		sealed: ${table.sealed},
		hash: ${swiftString(table.hash)},
		versionColumn: ${swiftString(table.storage.versionColumn)},
		extraColumn: ${table.storage.extraColumn === null ? 'nil' : swiftString(table.storage.extraColumn)},
		replaceable: ${table.projections.upsert !== null},
		columns: [${columns.length > 0 ? `\n${columns.join('')}\t\t` : ''}]
	)`;
}

/**
 * @param {SchemaIR} ir
 * @returns {string}
 */
function schemaSource(ir) {
	const profileNames = allocateMemberNames(
		ir.profiles.map((profile) => toCodeIdentifier(profile.name)),
		PROFILE_RESERVED,
	);
	const constantOf = (/** @type {IRProfile} */ profile) =>
		escapeSwiftIdentifier(/** @type {string} */ (profileNames.get(toCodeIdentifier(profile.name))));
	const tablesByKey = new Map(
		ir.tables.map((table) => [`${table.database}\u0000${table.name}`, table]),
	);
	let source = 'import Foundation\n\n';
	source += '/// The schema these models were generated from.\n';
	source += 'public enum HarperSchema {\n';
	source += `\tpublic static let irVersion = ${ir.irVersion}\n`;
	source += `\t/// The wire and storage contract hash of every table below.\n`;
	source += `\tpublic static let hash = ${swiftString(ir.schemaHash)}\n`;
	source += `\tpublic static let tables: [HarperTableSchema] = [${ir.tables.map((table) => `${table.typeName}.schema`).join(', ')}]\n`;
	source += `\tpublic static let recordTypes: [any HarperRecord.Type] = [${ir.tables.map((table) => `${table.typeName}.self`).join(', ')}]\n`;
	source += `\t/// The valid sync profiles from \`sync.yaml\`.\n`;
	source += `\tpublic static let profiles: [HarperSyncProfile] = [${ir.profiles.map((profile) => `.${constantOf(profile)}`).join(', ')}]\n`;
	source += '}\n';
	if (ir.profiles.length > 0) {
		source += '\nextension HarperSyncProfile {\n';
		for (const profile of ir.profiles) {
			const tables = profile.tables.map(
				(entry) =>
					`${/** @type {IRTable} */ (tablesByKey.get(`${entry.database}\u0000${entry.table}`)).typeName}.schema`,
			);
			source += docComment(
				commentLines(profile.description ?? `Sync profile \`${profile.name}\`.`),
				'\t',
			);
			source += `\tpublic static let ${constantOf(profile)} = HarperSyncProfile(name: ${swiftString(profile.name)}, direction: .${profile.direction}, retentionMs: ${profile.retentionMs ?? 'nil'}, schemaHash: ${swiftString(profile.schemaHash)}, tables: [${tables.join(', ')}])\n`;
		}
		source += '}\n';
	}
	return source;
}
