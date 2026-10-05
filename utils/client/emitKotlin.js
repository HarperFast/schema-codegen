/** @import { IRAttribute, IRNestedAttribute, IRObjectType, IRProfile, IRTable, IRType, SchemaIR } from './irTypes.js' */
/** @import { EmittedFile } from './emitSwift.js' */
import { commentLines, generatedHeader, kotlinString, readRuntimeSource } from './emitSupport.js';
import {
	allocateMemberNames,
	createNameAllocator,
	escapeKotlinEnumEntry,
	escapeKotlinIdentifier,
	reservedMemberNames,
	reservedProfileNames,
} from './naming.js';
import { assertSchemaIR } from './validateSchemaIR.js';

const KOTLIN_TYPES = /** @type {Record<string, string>} */ ({
	ID: 'String',
	String: 'String',
	Int: 'Int',
	Long: 'Long',
	Float: 'Double',
	BigInt: 'BigInteger',
	Boolean: 'Boolean',
	Date: 'Instant',
	Bytes: 'ByteArray',
	Blob: 'HarperValue',
	Any: 'HarperValue',
});
const SCALAR_CONVERTERS = /** @type {Record<string, string>} */ ({
	ID: 'string',
	String: 'string',
	Int: 'int',
	Long: 'long',
	Float: 'double',
	BigInt: 'bigInteger',
	Boolean: 'boolean',
	Date: 'instant',
	Bytes: 'bytes',
	Blob: 'value',
	Any: 'value',
});
const COLUMN_TYPES = /** @type {Record<string, string>} */ ({
	ID: 'ID',
	String: 'STRING',
	Int: 'INT',
	Long: 'LONG',
	Float: 'FLOAT',
	BigInt: 'BIG_INT',
	Boolean: 'BOOLEAN',
	Date: 'DATE',
	Bytes: 'BYTES',
	Blob: 'BLOB',
	Any: 'ANY',
});
const FIELD_ENTRY_RESERVED = [
	'name',
	'ordinal',
	'entries',
	'values',
	'valueOf',
	'attribute',
	'Companion',
];
const GENERATED_LOCALS = ['field', 'it', 'other', 'result', 'row', 'version'];
const PACKAGE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FILE_SUPPRESSIONS =
	'@file:Suppress("PropertyName", "ObjectPropertyName", "ConstructorParameterNaming", "EnumEntryName", "ClassName", "RedundantVisibilityModifier", "RemoveRedundantQualifierName", "unused")\n';

/**
 * @typedef {Object} KotlinContext
 * @property {Map<string, IRObjectType>} typesByName
 * @property {Map<string, IRTable>} tablesByKey
 * @property {Map<string, string>} converters list converter expression → the file-level value holding it
 * @property {ReturnType<typeof createNameAllocator>} converterNames
 */

/**
 * Renders a Kotlin/JVM module (build script, runtime, schema and models) from a schema IR.
 * @param {SchemaIR} ir
 * @param {{ packageName?: string }} [options]
 * @returns {EmittedFile[]}
 */
export function emitKotlinModule(ir, { packageName = 'harper.models' } = {}) {
	assertSchemaIR(ir);
	const segments = packageName.split('.');
	if (!segments.every((segment) => PACKAGE_SEGMENT.test(segment))) {
		throw new Error(`kotlinPackage "${packageName}" must be dot-separated identifiers`);
	}
	/** @type {KotlinContext} */
	const context = {
		typesByName: new Map(ir.types.map((type) => [type.name, type])),
		tablesByKey: new Map(ir.tables.map((table) => [`${table.database}\u0000${table.name}`, table])),
		converters: new Map(),
		converterNames: createNameAllocator(fileScopeNames(ir)),
	};
	const packageLine = `package ${segments.map(escapeKotlinIdentifier).join('.')}\n`;
	const header = generatedHeader(ir) + FILE_SUPPRESSIONS + '\n';
	const directory = `src/main/kotlin/${segments.join('/')}`;
	const runtime = readRuntimeSource('HarperRuntime.kt').replace(
		/^package harper\.models\n/,
		packageLine,
	);
	return [
		{ path: 'build.gradle.kts', content: buildScript(), scaffold: true },
		{ path: `${directory}/HarperRuntime.kt`, content: header + runtime, scaffold: false },
		{
			path: `${directory}/HarperSchema.kt`,
			content: header + packageLine + schemaSource(ir),
			scaffold: false,
		},
		{
			path: `${directory}/Models.kt`,
			content: header + packageLine + modelsSource(ir, context),
			scaffold: false,
		},
	];
}

/**
 * @returns {string}
 */
function buildScript() {
	return `// Created once by @harperfast/schema-codegen; it is never regenerated, so edit it freely.
// Without a Kotlin plugin version on the root project's classpath, add one here.
plugins {
	kotlin("jvm")
}
`;
}

/**
 * @param {IRType} type
 * @param {KotlinContext} context
 * @returns {string}
 */
function kotlinType(type, context) {
	switch (type.kind) {
		case 'scalar':
			return KOTLIN_TYPES[type.scalar];
		case 'array':
			return `List<${kotlinType(type.element, context)}${type.elementNullable ? '?' : ''}>`;
		case 'object':
			return /** @type {IRObjectType} */ (context.typesByName.get(type.type)).typeName;
		case 'record':
			return /** @type {IRTable} */ (context.tablesByKey.get(`${type.database}\u0000${type.table}`))
				.typeName;
	}
}

/**
 * Every name a member, class or local of Models.kt can take, so a file-level converter value is
 * never shadowed where it is used.
 * @param {SchemaIR} ir
 * @returns {Set<string>}
 */
function fileScopeNames(ir) {
	const names = new Set([...reservedProfileNames(ir), ...GENERATED_LOCALS]);
	for (const owner of [...ir.tables, ...ir.types]) {
		const reserved = reservedMemberNames(owner.typeName);
		for (const name of reserved) names.add(name);
		const members = allocateMemberNames(
			owner.attributes.map((attribute) => attribute.name),
			reserved,
		);
		for (const member of members.values()) names.add(member);
	}
	return names;
}

/**
 * @param {IRType} type
 * @param {KotlinContext} context
 * @returns {string}
 */
function converterExpression(type, context) {
	switch (type.kind) {
		case 'scalar':
			return `HarperConverters.${SCALAR_CONVERTERS[type.scalar]}`;
		case 'array': {
			const element = converterExpression(type.element, context);
			return `HarperConverters.list(${type.elementNullable ? `HarperConverters.nullable(${element})` : element})`;
		}
		case 'object':
		case 'record':
			return kotlinType(type, context);
	}
}

/**
 * @param {IRType} type
 * @param {KotlinContext} context
 * @returns {string}
 */
function converterStem(type, context) {
	switch (type.kind) {
		case 'scalar':
			return SCALAR_CONVERTERS[type.scalar];
		case 'array': {
			const element = converterStem(type.element, context);
			return `${type.elementNullable ? `nullable${element[0].toUpperCase()}${element.slice(1)}` : element}List`;
		}
		case 'object':
		case 'record': {
			const name = kotlinType(type, context);
			return `${name[0].toLowerCase()}${name.slice(1)}`;
		}
	}
}

/**
 * Converters other than the runtime's scalar ones are file-level values: a list converter is
 * built once rather than on every decode and encode, and a generated type is never named inside a
 * member body, where a member of the same name would shadow it.
 * @param {IRType} type
 * @param {KotlinContext} context
 * @returns {string}
 */
function converterOf(type, context) {
	const expression = converterExpression(type, context);
	if (type.kind === 'scalar') return expression;
	let name = context.converters.get(expression);
	if (name === undefined) {
		name = context.converterNames.claim(`${converterStem(type, context)}Converter`);
		context.converters.set(expression, name);
	}
	return name;
}

/**
 * @param {IRType} type
 * @returns {string}
 */
function columnType(type) {
	if (type.kind === 'scalar') return COLUMN_TYPES[type.scalar];
	return type.kind === 'array' ? 'ARRAY' : 'OBJECT';
}

/**
 * @param {string[]} lines
 * @param {string} indent
 * @returns {string}
 */
function kdoc(lines, indent) {
	if (lines.length === 0) return '';
	if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
	return `${indent}/**\n${lines.map((line) => `${indent} *${line ? ` ${line}` : ''}\n`).join('')}${indent} */\n`;
}

/**
 * @typedef {Object} KotlinProperty
 * @property {string} raw the attribute name
 * @property {string} name the escaped Kotlin identifier
 * @property {string} type the property type, nullability included
 * @property {boolean} optional
 * @property {string} converter
 * @property {boolean} bytes holds a ByteArray directly
 */

/**
 * @param {IRAttribute | IRNestedAttribute} attribute
 * @param {string} identifier
 * @param {KotlinContext} context
 * @param {boolean} optional
 * @returns {KotlinProperty}
 */
function propertyOf(attribute, identifier, context, optional) {
	const base = kotlinType(attribute.type, context);
	return {
		raw: attribute.name,
		name: escapeKotlinIdentifier(identifier),
		type: optional ? `${base}?` : base,
		optional,
		converter: converterOf(attribute.type, context),
		bytes: base === 'ByteArray',
	};
}

/**
 * @param {KotlinProperty[]} properties
 * @param {string} indent
 * @returns {string}
 */
function constructorParameters(properties, indent) {
	return properties
		.map(
			(property) =>
				`${indent}public val ${property.name}: ${property.type}${property.optional ? ' = null' : ''},\n`,
		)
		.join('');
}

/**
 * @param {KotlinProperty[]} properties
 * @param {string} receiver the class name used to qualify `this`, so builder members never shadow properties
 * @param {string} indent
 * @returns {string}
 */
function encodeStatements(properties, receiver, indent) {
	return properties
		.map((property) =>
			property.optional
				? `${indent}this@${receiver}.${property.name}?.let { put(${kotlinString(property.raw)}, ${property.converter}.encode(it)) }\n`
				: `${indent}put(${kotlinString(property.raw)}, ${property.converter}.encode(this@${receiver}.${property.name}))\n`,
		)
		.join('');
}

/**
 * Data classes compare arrays by identity, so a class holding a ByteArray gets content equality.
 * @param {string} className
 * @param {KotlinProperty[]} properties including the trailing system properties
 * @param {string} indent
 * @returns {string}
 */
function contentEquality(className, properties, indent) {
	if (!properties.some((property) => property.bytes)) return '';
	const comparisons = properties.map((property) => {
		const ours = `this.${property.name}`;
		const theirs = `other.${property.name}`;
		if (!property.bytes) return `${ours} == ${theirs}`;
		return property.optional
			? `(if (${ours} == null) ${theirs} == null else ${theirs} != null && ${ours}.contentEquals(${theirs}))`
			: `${ours}.contentEquals(${theirs})`;
	});
	const hashes = properties.map((property) => {
		const ours = `this.${property.name}`;
		if (property.bytes)
			return property.optional ? `(${ours}?.contentHashCode() ?: 0)` : `${ours}.contentHashCode()`;
		return property.optional ? `(${ours}?.hashCode() ?: 0)` : `${ours}.hashCode()`;
	});
	let source = `\n${indent}override fun equals(other: Any?): Boolean {\n`;
	source += `${indent}\tif (this === other) return true\n`;
	source += `${indent}\tif (other !is ${className}) return false\n`;
	source += `${indent}\treturn ${comparisons.join(` &&\n${indent}\t\t`)}\n`;
	source += `${indent}}\n\n`;
	source += `${indent}override fun hashCode(): Int {\n`;
	source += `${indent}\tvar result = 0\n`;
	for (const hash of hashes) source += `${indent}\tresult = 31 * result + ${hash}\n`;
	source += `${indent}\treturn result\n${indent}}\n`;
	return source;
}

/**
 * @param {SchemaIR} ir
 * @param {KotlinContext} context
 * @returns {string}
 */
function modelsSource(ir, context) {
	const body = [
		...ir.tables.map((table) => tableModel(table, context)),
		...ir.types.map((type) => objectModel(type, context)),
	].join('\n');
	const imports = ['kotlin.reflect.KClass'];
	if (/\bBigInteger\b/.test(body)) imports.push('java.math.BigInteger');
	if (/\bInstant\b/.test(body)) imports.push('java.time.Instant');
	const converters = [...context.converters]
		.map(([expression, name]) => `private val ${name} = ${expression}\n`)
		.join('');
	return `\n${imports
		.sort()
		.map((name) => `import ${name}\n`)
		.join('')}\n${converters ? `${converters}\n` : ''}${body}`;
}

/**
 * @param {IRTable} table
 * @param {KotlinContext} context
 * @returns {string}
 */
function tableModel(table, context) {
	const className = table.typeName;
	const names = allocateMemberNames(
		table.attributes.map((attribute) => attribute.name),
		reservedMemberNames(className),
	);
	const identifierOf = (/** @type {string} */ raw) => /** @type {string} */ (names.get(raw));
	const attributesByName = new Map(
		table.attributes.map((attribute) => [attribute.name, attribute]),
	);
	const record = table.projections.record.map((field) =>
		propertyOf(
			/** @type {IRAttribute} */ (attributesByName.get(field.name)),
			identifierOf(field.name),
			context,
			field.optional,
		),
	);
	const recordByName = new Map(record.map((property) => [property.raw, property]));
	const declared = [
		...table.attributes.map((attribute) => attribute.name),
		...table.relations.map((relation) => relation.name),
	];
	const sealed = table.storage.extraColumn === null;
	const typeLabel = kotlinString(className);
	const extras = sealed
		? ''
		: `putAll(this@${className}._extra.harperExtra(${className}.declaredAttributes))\n`;
	/** @type {KotlinProperty[]} */
	const systemProperties = [
		{
			raw: '_version',
			name: '_version',
			type: 'Double?',
			optional: true,
			converter: '',
			bytes: false,
		},
		...(sealed
			? []
			: [
					{
						raw: '_extra',
						name: '_extra',
						type: 'Map<String, HarperValue>',
						optional: false,
						converter: '',
						bytes: false,
					},
				]),
	];

	let source = kdoc(commentLines(`Table \`${table.name}\` in database \`${table.database}\`.`), '');
	source += `public data class ${className}(\n`;
	for (const property of record) {
		const attribute = /** @type {IRAttribute} */ (attributesByName.get(property.raw));
		const lines = commentLines(attribute.description);
		if (attribute.computed?.from)
			lines.push(...commentLines(`Computed on the client from \`${attribute.computed.from}\`.`));
		source += kdoc(lines, '\t');
		source += `\tpublic val ${property.name}: ${property.type}${property.optional ? ' = null' : ''},\n`;
	}
	source += '\toverride val _version: Double? = null,\n';
	if (!sealed) source += '\tpublic val _extra: Map<String, HarperValue> = emptyMap(),\n';
	source += ') : HarperRecord {\n';

	source += '\toverride fun encodeRow(): HarperRow = buildMap {\n';
	if (extras) source += `\t\t${extras}`;
	source += encodeStatements(record, className, '\t\t');
	source += '\t}\n\n';
	if (table.projections.upsert === null) {
		source += `\toverride fun encodeUpsertRow(): HarperRow =\n\t\tthrow HarperEncodingError.ReplacementUnsupported(${typeLabel}, ${kotlinString(table.projections.unwritable[0])})\n`;
	} else {
		const upsert = table.projections.upsert.map(
			(field) => /** @type {KotlinProperty} */ (recordByName.get(field.name)),
		);
		source += '\toverride fun encodeUpsertRow(): HarperRow = buildMap {\n';
		if (extras) source += `\t\t${extras}`;
		source += encodeStatements(upsert, className, '\t\t');
		source += '\t}\n';
	}
	source += contentEquality(className, [...record, ...systemProperties], '\t');

	if (table.projections.insert.length > 0) {
		const insert = table.projections.insert.map((field) =>
			propertyOf(
				/** @type {IRAttribute} */ (attributesByName.get(field.name)),
				identifierOf(field.name),
				context,
				field.optional,
			),
		);
		const newSystem = sealed
			? []
			: [
					{
						raw: '_extra',
						name: '_extra',
						type: 'Map<String, HarperValue>',
						optional: false,
						converter: '',
						bytes: false,
					},
				];
		source +=
			'\n\t/** The insert (`POST`) body; without a primary key the server assigns one. */\n';
		source += '\tpublic data class New(\n';
		source += constructorParameters(insert, '\t\t');
		if (!sealed) source += '\t\tpublic val _extra: Map<String, HarperValue> = emptyMap(),\n';
		source += '\t) : HarperWritable {\n';
		source += '\t\toverride fun encodeRow(): HarperRow = buildMap {\n';
		if (!sealed)
			source += `\t\t\tputAll(this@New._extra.harperExtra(${className}.declaredAttributes))\n`;
		source += encodeStatements(insert, 'New', '\t\t\t');
		source += '\t\t}\n';
		source += contentEquality('New', [...insert, ...newSystem], '\t\t');
		source += '\t}\n';
	}

	if (table.projections.patch.length > 0) {
		const patch = table.projections.patch.map((field) =>
			propertyOf(
				/** @type {IRAttribute} */ (attributesByName.get(field.name)),
				identifierOf(field.name),
				context,
				true,
			),
		);
		const clearable = table.projections.clearable;
		const entryNames = allocateMemberNames(
			clearable.map((raw) => identifierOf(raw)),
			FIELD_ENTRY_RESERVED,
		);
		source +=
			'\n\t/** The patch body: unset attributes are left unchanged, [clear] sets attributes to null, and a set value wins over a clear. */\n';
		source += '\tpublic data class Patch(\n';
		source += constructorParameters(patch, '\t\t');
		if (clearable.length > 0) source += '\t\tpublic val clear: Set<Field> = emptySet(),\n';
		source += '\t) : HarperWritable {\n';
		if (clearable.length > 0) {
			source += '\t\tpublic enum class Field(public val attribute: String) {\n';
			for (const raw of clearable) {
				const entry = escapeKotlinEnumEntry(
					/** @type {string} */ (entryNames.get(identifierOf(raw))),
				);
				source += `\t\t\t${entry}(${kotlinString(raw)}),\n`;
			}
			source += '\t\t}\n\n';
		}
		source += '\t\toverride fun encodeRow(): HarperRow = buildMap {\n';
		if (clearable.length > 0)
			source += '\t\t\tfor (field in this@Patch.clear) put(field.attribute, HarperValue.Null)\n';
		source += encodeStatements(patch, 'Patch', '\t\t\t');
		source += '\t\t}\n';
		source += contentEquality(
			'Patch',
			[
				...patch,
				...(clearable.length > 0
					? [
							{
								raw: 'clear',
								name: 'clear',
								type: 'Set<Field>',
								optional: false,
								converter: '',
								bytes: false,
							},
						]
					: []),
			],
			'\t\t',
		);
		source += '\t}\n';
	}

	source += `\n\tpublic companion object : HarperTable<${className}> {\n`;
	source += `\t\toverride val schema: HarperTableSchema = ${tableSchemaLiteral(table)}\n`;
	source += `\t\toverride val recordClass: KClass<${className}> = ${className}::class\n`;
	source += `\t\tprivate val declaredAttributes: Set<String> = setOf(${declared.map(kotlinString).join(', ')})\n\n`;
	source += `\t\toverride fun decode(row: HarperRow, version: Double?): ${className} = ${className}(\n`;
	for (const property of record) {
		const call = property.optional ? 'harperOptional' : 'harperRequired';
		source += `\t\t\t${property.name} = row.${call}(${kotlinString(property.raw)}, ${typeLabel}, ${property.converter}),\n`;
	}
	source += '\t\t\t_version = version,\n';
	if (!sealed) source += '\t\t\t_extra = row.harperExtra(declaredAttributes),\n';
	source += '\t\t)\n\t}\n}\n';
	return source;
}

/**
 * @param {IRObjectType} type
 * @param {KotlinContext} context
 * @returns {string}
 */
function objectModel(type, context) {
	const className = type.typeName;
	const names = allocateMemberNames(
		type.attributes.map((attribute) => attribute.name),
		reservedMemberNames(className),
	);
	const properties = type.attributes.map((attribute) =>
		propertyOf(
			attribute,
			/** @type {string} */ (names.get(attribute.name)),
			context,
			attribute.nullable,
		),
	);
	const typeLabel = kotlinString(className);
	let source = kdoc(commentLines(type.description ?? `Nested type \`${type.name}\`.`), '');
	source += `public data class ${className}(\n`;
	type.attributes.forEach((attribute, index) => {
		source += kdoc(commentLines(attribute.description), '\t');
		const property = properties[index];
		source += `\tpublic val ${property.name}: ${property.type}${property.optional ? ' = null' : ''},\n`;
	});
	source += '\tpublic val _extra: Map<String, HarperValue> = emptyMap(),\n';
	source += ') : HarperObject {\n';
	source += '\toverride fun encodeRow(): HarperRow = buildMap {\n';
	source += `\t\tputAll(this@${className}._extra.harperExtra(${className}.declaredAttributes))\n`;
	source += encodeStatements(properties, className, '\t\t');
	source += '\t}\n';
	source += contentEquality(
		className,
		[
			...properties,
			{
				raw: '_extra',
				name: '_extra',
				type: 'Map<String, HarperValue>',
				optional: false,
				converter: '',
				bytes: false,
			},
		],
		'\t',
	);
	source += `\n\tpublic companion object : HarperObjectType<${className}> {\n`;
	source += `\t\tprivate val declaredAttributes: Set<String> = setOf(${type.attributes.map((attribute) => kotlinString(attribute.name)).join(', ')})\n\n`;
	source += `\t\toverride fun decode(row: HarperRow): ${className} = ${className}(\n`;
	for (const property of properties) {
		const call = property.optional ? 'harperOptional' : 'harperRequired';
		source += `\t\t\t${property.name} = row.${call}(${kotlinString(property.raw)}, ${typeLabel}, ${property.converter}),\n`;
	}
	source += '\t\t\t_extra = row.harperExtra(declaredAttributes),\n';
	source += '\t\t)\n\t}\n}\n';
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
	const optional = new Map(table.projections.record.map((field) => [field.name, field.optional]));
	const columns = table.storage.columns.map((column) => {
		const attribute = /** @type {IRAttribute} */ (attributesByName.get(column.name));
		const parts = [
			kotlinString(column.name),
			`HarperColumnType.${columnType(attribute.type)}`,
			`HarperAffinity.${column.affinity}`,
			`nullable = ${optional.get(column.name)}`,
		];
		if (attribute.primaryKey) parts.push('primaryKey = true');
		if (attribute.indexed) parts.push('indexed = true');
		if (attribute.readOnly) parts.push('readOnly = true');
		if (attribute.computed?.from)
			parts.push(`computedFrom = ${kotlinString(attribute.computed.from)}`);
		return `\t\t\t\tHarperColumn(${parts.join(', ')}),\n`;
	});
	return `HarperTableSchema(
			database = ${kotlinString(table.database)},
			name = ${kotlinString(table.name)},
			primaryKey = ${table.primaryKey === null ? 'null' : kotlinString(table.primaryKey)},
			sealed = ${table.sealed},
			hash = ${kotlinString(table.hash)},
			versionColumn = ${kotlinString(table.storage.versionColumn)},
			extraColumn = ${table.storage.extraColumn === null ? 'null' : kotlinString(table.storage.extraColumn)},
			replaceable = ${table.projections.upsert !== null},
			columns = ${columns.length > 0 ? `listOf(\n${columns.join('')}\t\t\t)` : 'emptyList()'},
		)`;
}

/**
 * @param {SchemaIR} ir
 * @returns {string}
 */
function schemaSource(ir) {
	const profileNames = allocateMemberNames(
		ir.profiles.map((profile) => profile.name),
		reservedProfileNames(ir),
	);
	const constantOf = (/** @type {IRProfile} */ profile) =>
		escapeKotlinIdentifier(/** @type {string} */ (profileNames.get(profile.name)));
	const tablesByKey = new Map(
		ir.tables.map((table) => [`${table.database}\u0000${table.name}`, table]),
	);
	let source = '\nimport kotlin.reflect.KClass\n\n';
	source += '/** The schema these models were generated from. */\n';
	source += 'public object HarperSchema {\n';
	source += `\tpublic const val IR_VERSION: Int = ${ir.irVersion}\n\n`;
	source += '\t/** The wire and storage contract hash of every table below. */\n';
	source += `\tpublic const val SCHEMA_HASH: String = ${kotlinString(ir.schemaHash)}\n\n`;
	source += `\tpublic val tables: List<HarperTable<out HarperRecord>> = ${ir.tables.length > 0 ? `listOf(${ir.tables.map((table) => table.typeName).join(', ')})` : 'emptyList()'}\n\n`;
	source += '\t/** The valid sync profiles from `sync.yaml`. */\n';
	source += `\tpublic val profiles: List<HarperSyncProfile> = ${ir.profiles.length > 0 ? `listOf(${ir.profiles.map((profile) => `HarperProfiles.${constantOf(profile)}`).join(', ')})` : 'emptyList()'}\n\n`;
	source += '\t@Suppress("UNCHECKED_CAST")\n';
	source += '\tpublic fun <T : HarperRecord> table(recordClass: KClass<T>): HarperTable<T>? =\n';
	source += '\t\ttables.firstOrNull { it.recordClass == recordClass } as HarperTable<T>?\n';
	source += '}\n\n';
	source += '/** One constant per valid sync profile. */\n';
	source += 'public object HarperProfiles {\n';
	ir.profiles.forEach((profile, index) => {
		const tables = profile.tables.map(
			(entry) =>
				`${/** @type {IRTable} */ (tablesByKey.get(`${entry.database}\u0000${entry.table}`)).typeName}.schema`,
		);
		if (index > 0) source += '\n';
		source += kdoc(commentLines(profile.description ?? `Sync profile \`${profile.name}\`.`), '\t');
		source += `\tpublic val ${constantOf(profile)}: HarperSyncProfile = HarperSyncProfile(\n`;
		source += `\t\tname = ${kotlinString(profile.name)},\n`;
		source += `\t\tdirection = HarperSyncProfile.Direction.${profile.direction.toUpperCase()},\n`;
		source += `\t\tretentionMs = ${profile.retentionMs === null ? 'null' : `${profile.retentionMs}L`},\n`;
		source += `\t\tschemaHash = ${kotlinString(profile.schemaHash)},\n`;
		source += `\t\ttables = ${tables.length > 0 ? `listOf(${tables.join(', ')})` : 'emptyList()'},\n`;
		source += '\t)\n';
	});
	source += '}\n';
	return source;
}
