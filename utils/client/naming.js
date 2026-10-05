/**
 * Swift words that must be backtick-escaped to be used as a property name. Contextual keywords
 * (`get`, `set`, `some`, `async`, …) are valid member names and are left out.
 */
const SWIFT_KEYWORDS = new Set([
	'Any',
	'Protocol',
	'Self',
	'Type',
	'_',
	'as',
	'associatedtype',
	'await',
	'break',
	'case',
	'catch',
	'class',
	'continue',
	'default',
	'defer',
	'deinit',
	'do',
	'else',
	'enum',
	'extension',
	'fallthrough',
	'false',
	'fileprivate',
	'for',
	'func',
	'guard',
	'if',
	'import',
	'in',
	'init',
	'inout',
	'internal',
	'is',
	'let',
	'nil',
	'operator',
	'precedencegroup',
	'private',
	'protocol',
	'public',
	'repeat',
	'rethrows',
	'return',
	'self',
	'static',
	'struct',
	'subscript',
	'super',
	'switch',
	'throw',
	'throws',
	'true',
	'try',
	'typealias',
	'var',
	'where',
	'while',
]);

/** Kotlin hard keywords: valid identifiers only when backtick-escaped. */
const KOTLIN_KEYWORDS = new Set([
	'as',
	'break',
	'class',
	'continue',
	'do',
	'else',
	'false',
	'for',
	'fun',
	'if',
	'in',
	'interface',
	'is',
	'null',
	'object',
	'package',
	'return',
	'super',
	'this',
	'throw',
	'true',
	'try',
	'typealias',
	'typeof',
	'val',
	'var',
	'when',
	'while',
]);

/**
 * Kotlin soft and modifier keywords. They are valid property names, but at the start of an enum
 * entry the parser can read them as modifiers (`value("value")` fails to parse), so enum entries
 * escape them too.
 */
const KOTLIN_SOFT_KEYWORDS = new Set([
	'abstract',
	'actual',
	'annotation',
	'by',
	'catch',
	'companion',
	'const',
	'constructor',
	'crossinline',
	'data',
	'delegate',
	'dynamic',
	'enum',
	'expect',
	'external',
	'field',
	'file',
	'final',
	'finally',
	'get',
	'import',
	'infix',
	'init',
	'inline',
	'inner',
	'internal',
	'lateinit',
	'noinline',
	'open',
	'operator',
	'out',
	'override',
	'param',
	'private',
	'property',
	'protected',
	'public',
	'receiver',
	'reified',
	'sealed',
	'set',
	'setparam',
	'suspend',
	'tailrec',
	'value',
	'vararg',
	'where',
]);

/** Names the generated runtime and emitted code declare at the top level of the package. */
const RUNTIME_TYPE_NAMES = [
	'HarperAffinity',
	'HarperBigInt',
	'HarperBox',
	'HarperColumn',
	'HarperColumnType',
	'HarperConverter',
	'HarperConverters',
	'HarperDecodingError',
	'HarperEncodingError',
	'HarperObject',
	'HarperObjectType',
	'HarperProfiles',
	'HarperRecord',
	'HarperRow',
	'HarperSchema',
	'HarperSyncProfile',
	'HarperTable',
	'HarperTableSchema',
	'HarperValue',
	'HarperValueConvertible',
	'HarperValueMismatch',
	'HarperWritable',
];

/**
 * Type names a table or nested type may not take: keywords and contextual words of either
 * language, the standard types the generated code names unqualified, the runtime's own types,
 * and the names nested inside every generated record.
 */
export const RESERVED_TYPE_NAMES = new Set([
	...SWIFT_KEYWORDS,
	...KOTLIN_KEYWORDS,
	...RUNTIME_TYPE_NAMES,
	// The JVM classes Kotlin compiles the generated files' top-level declarations into.
	'HarperRuntimeKt',
	'HarperSchemaKt',
	'ModelsKt',
	'actor',
	'any',
	'async',
	'some',
	'Array',
	'Base64',
	'BigInteger',
	'Bool',
	'Boolean',
	'Byte',
	'ByteArray',
	'Character',
	'Codable',
	'Comparable',
	'Companion',
	'CustomStringConvertible',
	'Data',
	'Date',
	'DateTimeParseException',
	'Decoder',
	'DecodingError',
	'Dictionary',
	'Direction',
	'Double',
	'Encoder',
	'Enum',
	'Equatable',
	'Error',
	'Exception',
	'ExpressibleByIntegerLiteral',
	'Field',
	'Float',
	'Foundation',
	'Hashable',
	'ISO8601DateFormatter',
	'Identifiable',
	'IllegalArgumentException',
	'Instant',
	'Int',
	'Int64',
	'Iterable',
	'KClass',
	'List',
	'Long',
	'Map',
	'Math',
	'NSNull',
	'NSNumber',
	'Never',
	'New',
	'Nothing',
	'Number',
	'Optional',
	'Patch',
	'Sendable',
	'Set',
	'Short',
	'String',
	'Substring',
	'Suppress',
	'Swift',
	'Throwable',
	'Unit',
	'Void',
]);

/**
 * Member names every generated record, insert, patch or nested type may declare itself. An
 * attribute whose identifier lands on one of these is given a suffixed property name instead.
 */
export const RESERVED_MEMBER_NAMES = [
	'Companion',
	'Field',
	'New',
	'Patch',
	'_extra',
	'_version',
	'clear',
	'encodeRow',
	'encodeUpsertRow',
	'harperValue',
	'hashValue',
	'self',
	'this',
];

/**
 * The names no member generated for `ir` may take: the reserved members, plus every runtime and
 * generated type, which member bodies refer to by name and a same-named member would shadow.
 * @param {{ tables: { typeName: string }[], types: { typeName: string }[] }} ir
 * @returns {string[]}
 */
export function reservedMemberNames(ir) {
	return [
		...RESERVED_MEMBER_NAMES,
		...RUNTIME_TYPE_NAMES,
		...ir.tables.map((table) => table.typeName),
		...ir.types.map((type) => type.typeName),
	];
}

/**
 * Converts any schema name into an identifier valid in Swift, Kotlin and TypeScript: kebab-case
 * becomes camelCase, every other character outside `[A-Za-z0-9_]` becomes `_`, and a leading
 * digit (or an empty name) gains a `_` prefix. Unlike `toIdentifier`, `$` is not kept: neither
 * Swift nor Kotlin allows it.
 * @param {string} name
 * @returns {string}
 */
export function toCodeIdentifier(name) {
	let identifier = String(name)
		.replace(/-([a-zA-Z0-9])/g, (_, character) => character.toUpperCase())
		.replace(/[^a-zA-Z0-9_]/g, '_');
	if (identifier === '' || /^[0-9]/.test(identifier)) {
		identifier = `_${identifier}`;
	}
	return identifier;
}

/**
 * Hands out unique names: a requested name is returned as-is when free, otherwise suffixed
 * `_2`, `_3`, … until the result is free as well. Comparison is case-sensitive.
 * @param {Iterable<string>} [reserved]
 */
export function createNameAllocator(reserved = []) {
	const claimed = new Set(reserved);
	return {
		/**
		 * Claims `name` exactly; returns false when it is already taken.
		 * @param {string} name
		 * @returns {boolean}
		 */
		claimExact(name) {
			if (claimed.has(name)) return false;
			claimed.add(name);
			return true;
		},
		/**
		 * @param {string} name
		 * @returns {string}
		 */
		claim(name) {
			let candidate = name;
			for (let suffix = 2; claimed.has(candidate); suffix++) {
				candidate = `${name}_${suffix}`;
			}
			claimed.add(candidate);
			return candidate;
		},
	};
}

/**
 * Assigns a unique identifier to every raw name. Names that are already identifiers are claimed
 * first, so `aB` keeps its name even when a later `a-b` also sanitizes to `aB`.
 * @param {string[]} names raw names, in declaration order
 * @param {Iterable<string>} reserved
 * @returns {Map<string, string>} raw name → identifier
 */
export function allocateMemberNames(names, reserved) {
	const allocator = createNameAllocator(reserved);
	/** @type {Map<string, string>} */
	const result = new Map();
	for (const name of names) {
		if (toCodeIdentifier(name) === name && allocator.claimExact(name)) {
			result.set(name, name);
		}
	}
	for (const name of names) {
		if (!result.has(name)) {
			result.set(name, allocator.claim(toCodeIdentifier(name)));
		}
	}
	return result;
}

/**
 * @param {string} identifier
 * @returns {string}
 */
export function escapeSwiftIdentifier(identifier) {
	return SWIFT_KEYWORDS.has(identifier) ? `\`${identifier}\`` : identifier;
}

/**
 * @param {string} identifier
 * @returns {string}
 */
export function escapeKotlinIdentifier(identifier) {
	return KOTLIN_KEYWORDS.has(identifier) ? `\`${identifier}\`` : identifier;
}

/**
 * @param {string} identifier
 * @returns {string}
 */
export function escapeKotlinEnumEntry(identifier) {
	return KOTLIN_KEYWORDS.has(identifier) || KOTLIN_SOFT_KEYWORDS.has(identifier)
		? `\`${identifier}\``
		: identifier;
}
