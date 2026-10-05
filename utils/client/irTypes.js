/**
 * Shapes of the schema IR (`irVersion` 1). See docs/design/client-codegen.md.
 *
 * @typedef {'ID' | 'String' | 'Int' | 'Long' | 'Float' | 'BigInt' | 'Boolean' | 'Date' | 'Bytes' | 'Blob' | 'Any'} IRScalar
 *
 * @typedef {{ kind: 'scalar', scalar: IRScalar }
 *   | { kind: 'array', element: IRType, elementNullable: boolean }
 *   | { kind: 'object', type: string }
 *   | { kind: 'record', database: string, table: string }} IRType
 *
 * @typedef {Object} IRAttribute
 * @property {string} name
 * @property {IRType} type
 * @property {boolean} nullable optional on read
 * @property {boolean} primaryKey
 * @property {boolean} indexed
 * @property {'createdTime' | 'updatedTime' | 'derived' | null} serverManaged `derived`: an `@embed`/`@decide` output
 * @property {{ from: string | null, version: string | null } | null} computed
 * @property {boolean} readOnly server-managed or computed
 * @property {string} [description]
 *
 * @typedef {Object} IRNestedAttribute
 * @property {string} name
 * @property {IRType} type
 * @property {boolean} nullable
 * @property {string} [description]
 *
 * @typedef {Object} IRRelation
 * @property {string} name
 * @property {'one' | 'many'} cardinality
 * @property {string} [from]
 * @property {string} [to]
 * @property {{ database: string | null, table: string }} target
 *
 * @typedef {{ name: string, optional: boolean }} IRProjectionField
 *
 * @typedef {Object} IRProjections
 * @property {IRProjectionField[]} record
 * @property {IRProjectionField[]} insert
 * @property {IRProjectionField[] | null} upsert null when a full replacement is unsafe
 * @property {IRProjectionField[]} patch
 * @property {string[]} clearable patch attributes that may be set to null
 * @property {string[]} unwritable attributes kept out of every write because they have no client write contract (Blob)
 * @property {IRProjectionField[]} query
 *
 * @typedef {'TEXT' | 'INTEGER' | 'REAL' | 'BLOB'} IRAffinity
 *
 * @typedef {Object} IRStorage
 * @property {string} versionColumn
 * @property {string | null} extraColumn null on sealed tables
 * @property {{ name: string, affinity: IRAffinity }[]} columns
 *
 * @typedef {Object} IRTable
 * @property {string} database
 * @property {string} name
 * @property {string} typeName
 * @property {string | null} primaryKey
 * @property {boolean} sealed
 * @property {string} hash
 * @property {string[]} profiles
 * @property {string} [description]
 * @property {IRAttribute[]} attributes stored attributes, in schema order
 * @property {IRRelation[]} relations
 * @property {IRProjections} projections
 * @property {IRStorage} storage
 *
 * @typedef {Object} IRObjectType
 * @property {string} name the schema type name
 * @property {string} typeName
 * @property {string} [description]
 * @property {IRNestedAttribute[]} attributes
 *
 * @typedef {{ attribute: string, operator: 'equals', source: 'literal', value: string | number | boolean }
 *   | { attribute: string, operator: 'in', source: 'literal', value: (string | number | boolean)[] }
 *   | { attribute: string, operator: 'equals', source: 'claim', claim: string }
 *   | { attribute: string, operator: 'equals', source: 'user', field: string }} IRScopeCondition
 *
 * @typedef {{ type: 'all' } | { type: 'match', conditions: IRScopeCondition[] }} IRScope
 *
 * @typedef {{ database: string, table: string, scope: IRScope }} IRProfileTable
 *
 * @typedef {Object} IRProfile
 * @property {string} name
 * @property {string} [description]
 * @property {'pull' | 'push' | 'bidirectional'} direction
 * @property {string | null} retention
 * @property {number | null} retentionMs
 * @property {string} hash the profile definition's hash (its version)
 * @property {string} schemaHash the hash a device sends in its hello frame for this profile
 * @property {IRProfileTable[]} tables
 *
 * @typedef {Object} IRDiagnostic
 * @property {'error' | 'warning'} level
 * @property {string} code
 * @property {string} message
 * @property {string} [profile]
 * @property {string} [table]
 * @property {string} [attribute]
 *
 * @typedef {Object} SchemaIR
 * @property {number} irVersion
 * @property {string} [generator]
 * @property {string} schemaHash
 * @property {IRTable[]} tables
 * @property {IRObjectType[]} types
 * @property {IRProfile[]} profiles
 * @property {IRDiagnostic[]} diagnostics
 */
export {};
