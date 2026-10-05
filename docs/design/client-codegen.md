# Client codegen: schema IR, Swift/Kotlin emitters, sync profiles, schema hash

Status: design note for HarperFast/harper-client-sdk-spike#8 (M8 in the device-sync design,
`docs/DESIGN.md` rev 3 in the spike repo). It is also the decision record the issue asks for:
type-mapping and model-shape decisions are made here once and every emitter follows them.

## Goal

`@harperfast/schema-codegen` already turns the live schema into TypeScript/JSDoc in dev mode.
The client SDK needs, from the same live schema:

1. Swift and Kotlin models shaped like the spike's hand-written `ios/HarperSpike/Harper.swift`:
   typed columns, an `_extra` overflow bag on non-`@sealed` tables, and a version column, with
   core's read/insert/upsert/patch/query projection rules (`resources/defineTable.ts`) ported.
2. Sync-profile awareness in an emitted IR (tables per profile, scope attributes, retention) —
   the same IR the Studio profile editor (#16) and the sync gateway (#10) will consume.
3. Type-mapping decisions recorded once: `Long`/`BigInt` width, `Any`/`Bytes`/`Blob`,
   undefined-means-nullable.
4. A schema hash for the `hello`-frame negotiation, and the additive-delta story.

Acceptance: the codegen component (dev mode) or CLI generates a Swift package and a Kotlin
module; the spike's demo app replaces its hand-written models with the generated package and
builds.

**Invariant this change enforces:** the IR is a deterministic function of the live schema plus
`sync.yaml` (and, for type names only, the previous IR), every client artifact is a deterministic
function of the IR plus emitter options, and the mapping/projection/nullability rules exist in
exactly one module. Equal contract hashes mean an identical **wire and storage contract** — what a
device stores and sends — not identical generated source: type names, the generator version and
emitter options can change public symbols without changing the hash.

## Approaches considered

| Axis                | Candidate                                                                                                                                                                                                                                                                                                                                                                            | Fact that decides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Different layer** | (a) Harper core: a `harper generate-client` subcommand and a core IR endpoint beside `defineTable`. (b) The sync gateway (pro, #10), which will own `sync.yaml`. (c) SwiftPM/Gradle build plugins that shell out to a Node generator.                                                                                                                                                | (a) Core already exposes everything needed — live `Table.attributes` plus the GraphQL type registry a component reaches as `scope.resources.allTypes` (traced below) — so no core change is required, and the design doc's M8 assigns the work to this package ("extends it rather than starting over"); a core subcommand would also tie emitter iterations to core releases. (b) The gateway does not exist yet, but codegen is a phase-0 mechanism (design doc M8: thin and cached strategies need typed models before any sync machinery). Both are served by building the IR here and **exporting** it (`buildSchemaIR`) so the gateway and Studio import one implementation. (c) Needs the same IR and emitters plus two adapters and Node in mobile builds; it removes no deliverable, and the CLI already allows build-time invocation. |
| **Deeper cause**    | Make core's schema carry a canonical client contract — e.g. build the IR from `Table.properties` (the JSON-Schema fragments from `resources/jsonSchemaTypes.ts`).                                                                                                                                                                                                                    | `attributeToFragment` emits `nullable` only when `true` (GraphQL never sets `true`, so undefined-means-nullable and `[T!]` element requiredness are unrecoverable) and omits computed expressions, relationship targets and `sealed`; nested types appear as a bare type name (`address: {type: 'Address'}`, verified live). Extending it is a core API change for one consumer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Do less**         | (a) Use the `describe_all`/`describe_table` operation output as the IR. (b) Emit only the IR and let the iOS/Android SDKs generate models in Swift/Kotlin. (c) Reuse the TS emitter's `mapType` and string-map its output.                                                                                                                                                           | (a) `dataLayer/schemaDescribe.ts` `pushAtt` reduces `elements` to a type name, nested `properties` to `{type, name}`, `computed` to `true`, and drops relationship targets — lossy for every non-scalar attribute. (b) The acceptance requires generated models in the demo app now, and generators written in Swift and Kotlin re-implement the naming/type rules twice more — the opposite of "recorded once". (c) `mapType` collapses `Int`/`Long`/`Float` to `number`, `Bytes`/`Blob`/`Any` to `any` and `Date` to `string`. The smallest sufficient change is the chosen one: extend `regenerateAll` right after its existing filtered `collectTables` call, building one IR from that same list when a client option is set.                                                                                                              |
| **Chosen**          | A language-neutral **IR v1** built in this package from live `Table.attributes`, the GraphQL type registry and normalized `sync.yaml` profiles; Swift and Kotlin emitters that read only the IR; contract hashing and a read/write/storage compatibility diff in the same module; component options and a small CLI as entry points; a public `index.js` for the gateway and Studio. | Beats the rejected options on the stated facts; keeps one implementation of every rule; needs no core or pro change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

The existing TS/JSDoc emitters are left byte-for-byte unchanged (users' generated files must not
churn); moving them onto the IR is a follow-up.

## Traced facts this design relies on

Core `origin/main` @ 33bea305 (2026-10-05), and a live `harper dev` instance (5.3.0-beta.2) with a
schema covering every attribute kind:

- `resources/graphql.ts` `getProperty`: a plain field leaves `nullable` undefined, `!` sets
  `nullable: false`; nothing sets `nullable: true`. List types become `{type: 'array', elements}`
  with the element's own `nullable`. `@computed(from:)` keeps the source as
  `computedFromExpression` and a `version`; `@createdTime`/`@updatedTime` set
  `assignCreatedTime`/`assignUpdatedTime`; `@indexed` sets `indexed` to an object. `@fullText`
  fields never enter `attributes`. Every type definition is registered in `resources.allTypes`
  (graphql.ts:260), with nested references connected via non-enumerable `properties`/`definition`.
- **Live `Table.attributes` keep only the type name of a nested object** (`address: Address` →
  `{type: 'Address'}`; `[PurchaseLine!]!` → `elements: {type: 'PurchaseLine', nullable: false}`).
  Relationship attributes keep `relationship`, a non-enumerable `relationshipReference
{database, table}` (GraphQL), and `definition`. `scope.resources.allTypes` in a component holds
  every GraphQL type with its connected structure, and `scope.directory` is the application
  directory. `defineTable` relations carry `relationship` and a lazy `definition.tableClass`
  instead of `relationshipReference`.
- `resources/defineTable.ts` projections: nullable → optional; server-managed and relation fields
  read-only on the record and absent from every write; primary key required on read and upsert,
  optional on insert, never patched; query = indexed fields, all optional. `compileTypeDef` leaves
  PK and server-managed fields' `nullable` unmarked "because the PK machinery and server
  assignment own their presence".
- `resources/Table.ts` `validate`: `Int` is int32; `Long` an integer with |v| ≤ 2^53; `Float` any
  number; `ID` a string (or array of strings); `BigInt`, `Date` coerced from string/number;
  `Bytes` a `Uint8Array` (strings coerced); `Blob` only a `Blob`, a string or a Buffer (anything
  else is rejected); computed and relationship attributes may not be assigned; array elements are
  validated against the element's `nullable`; a `sealed` table rejects unknown properties.
  Nested-object sealing reads `attribute.sealed`, which no schema path sets on nested attributes
  (only the table's primary attribute carries `sealed`, `resources/databases.ts`), so nested
  objects are not sealed in practice.
- Every live table has `tableName`, `databaseName`, `primaryKey`, `attributes`, `sealed` statics.
- Node refuses to type-strip `.ts` files under `node_modules`, and this package is loaded from
  `node_modules` by Harper's component loader (`componentLoader.ts`: `join(componentDirectory,
config.extensionModule)`); CI also tests Node 20. New modules therefore stay JavaScript with
  JSDoc types, like the rest of the repository.

## IR v1

JSON, deterministic (tables sorted by database then name, profiles and nested types by name, no
timestamps):

```jsonc
{
	"irVersion": 1,
	"generator": "@harperfast/schema-codegen@<version>", // informational, not hashed
	"schemaHash": "<sha256 hex>",
	"tables": [
		{
			"database": "data",
			"name": "Order",
			"typeName": "Order",
			"primaryKey": "id",
			"sealed": false,
			"hash": "<sha256 hex>",
			"profiles": ["my-orders"],
			"attributes": [
				{
					"name": "amount",
					"type": { "kind": "scalar", "scalar": "Float" },
					// or { "kind": "array", "element": <type>, "elementNullable": true }
					// or { "kind": "object", "type": "OrderLine" }                      -> "types" entry
					// or { "kind": "record", "database": "data", "table": "Customer" }  (embedded table shape)
					"nullable": true,
					"primaryKey": false,
					"indexed": false,
					"serverManaged": null, // "createdTime" | "updatedTime" | null
					"computed": null, // { "from": "<expr>" | null, "version": "<v>" | null }
					"readOnly": false, // serverManaged || computed
					"description": "…", // optional, not hashed
				},
			],
			"relations": [
				{
					"name": "customer",
					"cardinality": "one",
					"from": "customerId",
					"target": { "database": "data", "table": "Customer" },
				},
			],
			"projections": {
				"record": [{ "name": "id", "optional": false }],
				"insert": [],
				"patch": [],
				"query": [],
				"upsert": [], // null when a full replacement is unsafe (Blob attributes)
				"clearable": ["note"], // patch attributes that may be set to null
			},
			"storage": {
				"versionColumn": "_version",
				"extraColumn": "_extra",
				"columns": [{ "name": "id", "affinity": "TEXT" }],
			},
		},
	],
	"types": [{ "name": "OrderLine", "typeName": "OrderLine", "attributes": [] }],
	"profiles": [
		{
			"name": "my-orders",
			"direction": "pull",
			"retention": "30d",
			"retentionMs": 2592000000,
			"hash": "<sha256 hex>",
			"schemaHash": "<sha256 hex>",
			"tables": [
				{
					"database": "data",
					"table": "Order",
					"scope": {
						"type": "match",
						"conditions": [
							{
								"attribute": "customerId",
								"operator": "equals",
								"source": "claim",
								"claim": "sub",
							},
						],
					},
				},
			],
		},
	],
	"diagnostics": [
		{ "level": "error", "code": "SCOPE_ATTRIBUTE_UNKNOWN", "profile": "…", "message": "…" },
	],
}
```

- **Inputs**: the filtered live tables (`collectTables` with the existing include/exclude
  options — one collection feeds TS and client output), the GraphQL type registry
  (`scope.resources.allTypes`) to resolve nested object types by name, the `sync.yaml` content,
  and the previous IR (type-name stability only).
- **Nullability (read side, "undefined-means-nullable")**: an attribute is optional on read unless
  it is the primary key, server-managed, or `nullable === false` (the existing `isNullable`
  rule plus the server-managed exemption defineTable makes). Computed attributes are always
  optional (an on-device materialization may not have run, issue #18). Array elements follow the
  same rule: `[String]` has nullable elements, `[String!]` does not. A `Blob` is optional on read
  whatever its declaration, because sync does not deliver blob content; that read rule lives in
  the `record` projection, while the attribute's `nullable` keeps what the server enforces, so a
  `Blob` → `Blob!` change still changes the contract and breaks inserts (which never carry a blob;
  a required Blob also raises a `BLOB_REQUIRED` warning).
- **Projections** are the defineTable rules over stored attributes, plus one client rule: `Blob`
  attributes are excluded from every write projection and make `upsert` `null`, because the
  transport has no blob contract yet and a full replacement would either delete the blob
  (omitted) or be rejected by `validate` (a placeholder object). `record` = all stored attributes;
  `insert` = writable attributes, PK optional; `upsert` = writable, PK required; `patch` =
  writable non-PK, all optional; `clearable` = patch attributes whose read nullability allows
  null; `query` = indexed attributes. Relations are not stored and appear only under `relations`.
- **`typeName`** is a language-neutral identifier: `<db>_` prefix outside `data` (as the TS
  emitter does), singularized table name, characters outside `[A-Za-z0-9_]` sanitized, leading
  digit prefixed. Allocation covers tables and nested types in one namespace, avoids a reserved set
  (Swift and Kotlin keywords, the standard types the generated code names, the generated runtime's
  `Harper*` names, `New`, `Patch`, and the JVM classes Kotlin compiles the generated files'
  top-level declarations into, such as `ModelsKt`), and resolves collisions by appending `Record`, then `_2`,
  `_3`…. A table or nested type keeps the name it had in the previous IR while that name is still
  valid and unclaimed, so adding a colliding table never renames an existing public type; the
  diff reports `typeName` changes as source changes.
- **Storage** (the device replica's table shape): one column per stored attribute, plus a version
  column (`REAL`) and, on non-sealed tables, an overflow column (`TEXT` JSON). The version/extra
  column names are `_version`/`_extra` unless an attribute already uses the name, in which case an
  extra leading underscore is added until unique.
- **Validation**: the CLI validates an imported IR (version, references, descriptors) before
  emitting; unknown `irVersion` is an error, not a best effort.

## Type mapping (the recorded decisions)

| Harper                | Swift                                      | Kotlin                    | SQLite affinity | Row encoding (`HarperValue`)                |
| --------------------- | ------------------------------------------ | ------------------------- | --------------- | ------------------------------------------- |
| `ID`, `String`        | `String`                                   | `String`                  | TEXT            | string                                      |
| `Int` (int32)         | `Int`                                      | `Int`                     | INTEGER         | int                                         |
| `Long` (\|v\| ≤ 2^53) | `Int64`                                    | `Long`                    | INTEGER         | int                                         |
| `Float`               | `Double`                                   | `Double`                  | REAL            | double (ints accepted)                      |
| `BigInt` (arbitrary)  | `HarperBigInt` (decimal-string value type) | `java.math.BigInteger`    | TEXT            | string of digits (ints accepted)            |
| `Boolean`             | `Bool`                                     | `Boolean`                 | INTEGER         | bool (0/1 accepted)                         |
| `Date`                | `Date`                                     | `java.time.Instant`       | REAL (epoch ms) | double epoch ms (ISO-8601 strings accepted) |
| `Bytes`               | `Data`                                     | `ByteArray`               | BLOB            | bytes (base64 strings accepted)             |
| `Blob`                | `HarperValue?`, read-only                  | `HarperValue?`, read-only | BLOB            | whatever the transport delivered            |
| `Any`                 | `HarperValue`                              | `HarperValue`             | TEXT (JSON)     | any                                         |
| `[T]`                 | `[T]` / `[T?]`                             | `List<T>` / `List<T?>`    | TEXT (JSON)     | array                                       |
| nested type           | generated `struct`                         | generated `data class`    | TEXT (JSON)     | object                                      |
| relation              | not a property                             | not a property            | no column       | —                                           |

Reasons for the non-obvious rows:

- **Int → Swift `Int`, not `Int32`**: Swift `Int` is ≥32 bits on every Apple platform, so every
  valid value fits; `Int32` would force conversions at every call site. Server validation stays
  the guard against out-of-range writes. Kotlin `Int` is exactly int32.
- **Long → `Int64`/`Long`**: explicit 64-bit (watchOS `arm64_32` has a 32-bit Swift `Int`).
  Harper bounds `Long` to ±2^53, so the JS core never loses precision in transit.
- **BigInt**: Swift has no arbitrary-precision integer, and `Decimal` silently rounds past 38
  digits; a decimal-string value type is lossless and typed (`int64Value` when it fits). On the
  wire to devices BigInt travels as a decimal string (the gateway's job, #10); decoders also
  accept integers. TEXT storage means local ordering on BigInt columns is lexicographic — local
  query execution (RQL, #7) must compare numerically.
- **Date**: epoch milliseconds in `REAL` matches Harper's own timestamp scale and the version
  column, sorts correctly, and is exact for millisecond values. `java.time.Instant` needs Android
  API 26+ or core-library desugaring.
- **Blob**: content is fetch-on-demand and not inlined in sync (design doc open question 4) and the
  transport placeholder is undecided, so the model exposes what the transport delivered as an
  opaque, optional, read-only `HarperValue`, and the table has no upsert projection (see
  Projections). A typed blob reference replaces this when blob sync is designed.
- **Any → `HarperValue`**: a closed JSON-like enum (`null/bool/int/double/string/bytes/array/
object`) that is `Sendable`, `Hashable` and (Swift) `Codable`, so models stay value types.
- **Bytes in Kotlin**: `ByteArray` has identity equality, so generated data classes that hold one
  directly override `equals`/`hashCode` with content comparison; `HarperValue.BytesValue` compares
  by content.

## Client model shape

Per table (Swift `struct` / Kotlin `data class`), named `typeName`:

- one property per stored attribute, typed per the table above, optional per read nullability;
- `_version: Double?` — the record version (Harper's update timestamp); `nil` for records not
  read from the replica (REST bodies carry it in headers, not the body);
- `_extra: [String: HarperValue]` / `Map<String, HarperValue>` on non-sealed tables — attributes
  the schema does not declare, preserved for round trips. Declared names (stored, computed,
  relation) are filtered out of `_extra` when decoding **and when encoding**, so an injected
  computed or relation key can never reach a write;
- `Order.New` (insert projection) and `Order.Patch` (patch projection) nested types, omitted when
  the projection is empty. A patch distinguishes three states per attribute: unset (absent from
  the body, unchanged), value, and cleared — `clear: Set<Order.Patch.Field>` lists `clearable`
  attributes to set to null; a set value wins over a clear;
- decode `init(row:version:)` (Swift, throwing) / `Order.decode(row, version)` (Kotlin) from a
  `HarperRow` (`[String: HarperValue]`, keyed by attribute name — the logical record, extras at
  the top level); `encodeRow()` (full record, for storage) and `encodeUpsertRow()` (PK + writable
  attributes + `_extra`, for `PUT`; throws `HarperEncodingError.replacementUnsupported` when the
  upsert projection is `null`). Absent optional values are omitted, never encoded as null;
- Swift: `let` for the PK and read-only attributes, `var` for writable ones (value semantics make
  edit-then-`put` safe); `Hashable`, `Sendable`, and `Identifiable` (a computed `id` returns the
  PK when it has another name and no attribute is called `id`). Kotlin: all `val` (`copy()` is the
  edit idiom). A missing required value or a mismatched type throws a `HarperDecodingError`
  naming type and attribute: the SDK decides whether to skip and report the row; the model never
  guesses;
- property names: attribute names that are already identifiers are kept verbatim (claimed first);
  others are sanitized like table names; keywords are escaped with backticks; names that collide
  with the generated members (`_version`, `_extra`, `New`, `Patch`, `Field`, `clear`,
  `encodeRow`, `encodeUpsertRow`, `harperValue`, `hashValue`, `Companion`), with a runtime type or
  the owning type's own name (member bodies name those, and a same-named member would shadow
  them), or with each other get a numeric suffix, rechecked against every claimed name. Other
  generated types are never named inside member bodies (Kotlin reaches their converters through
  file-level values), so adding a table never renames an existing property. The raw attribute
  name is always what goes on the row;
- nested object types get the same treatment minus `_version`, `New` and `Patch`, and always keep
  `_extra` (nested sealing is not enforced server-side). A nested type reachable from itself by
  value (not through an array) cannot be a Swift struct; that edge is boxed in Swift as
  `HarperBox<T>` (an immutable final class) and stays a plain reference in Kotlin.

Generated package layout — fixed file names, so a dropped table never leaves a stale file:

- Swift: `<dir>/Package.swift` (written only if absent, then user-owned) and
  `<dir>/Sources/<Module>/{HarperRuntime,HarperSchema,Models}.swift`.
- Kotlin: `<dir>/build.gradle.kts` (written only if absent) and
  `<dir>/src/main/kotlin/<package path>/{HarperRuntime,HarperSchema,Models}.kt`.

Every generated file starts with the same marker line carrying the IR's `schemaHash` and the
generator version, so a mixed generation is visible. Generated files elsewhere under the package
directory (a renamed module or package) are reported, never deleted, and a user-owned manifest
that does not name the current module is reported too.

`HarperRuntime` holds the support types (`HarperValue`, `HarperRow`, `HarperRecord`,
`HarperBigInt`, `HarperBox`, `HarperTableSchema`, `HarperColumn`, `HarperSyncProfile`,
decoding/encoding errors and helpers). It lives in the generated package until the iOS/Android
SDKs (#12/#13) exist; the SDK then ships it and the emitter imports it instead. `HarperSchema`
holds `irVersion`, the schema hash, all table descriptors (columns with affinity, PK, indexed,
read-only, computed expression), and the valid sync profiles (name, direction, retention, tables,
profile `schemaHash`) with one named constant per profile (`HarperSyncProfile.storefront`).

## Sync profiles (`sync.yaml`)

No profile format exists in core or pro yet (searched both, 2026-10-05); the spike hard-codes
`server/app/profiles.js`, and the design doc sketches `sync.yaml`. This package parses that
documented format so the gateway (M1) inherits a tested normalizer:

```yaml
profiles:
  storefront:
    direction: pull # pull (default) | push | bidirectional
    retention: 14d # ms | s | m | h | d | w
    tables: [Product] # list form: profile-level scope (default: all)
  my-orders:
    retention: 30d
    scope:
      customerId: $token.sub # claim reference; $user.<field> for the user record
    tables: [Order]
  bench-seg10:
    tables:
      BenchItem: # map form: per-table database/scope override
        scope: { seg: s10 } # literal equality; a list means membership
```

Scope values: a scalar is a literal equality; a string starting with `$token.`/`$user.` is a
claim/user reference (`$$` escapes a literal `$`); a list of scalars is literal membership; any
other `$` reference, empty list or object is invalid. Normalized to per-table `{type: 'all'}` or
`{type: 'match', conditions: [...]}`.

**Profiles fail closed.** Any error — unknown table or database, unknown scope attribute, invalid
scope value or reference, empty table list, invalid direction or retention — invalidates the
whole profile: it is left out of `profiles` (and out of generated code), and the IR carries an
`error` diagnostic naming it. A scope that loses a condition can never degrade into `all`.
Warnings (a scope attribute without an index) keep the profile. Profiles bind tables by name in
`sync.yaml` because a `@sync` type directive does not survive into `Table` (the GraphQL parser
keeps only the directives it knows).

`yaml` (already a Harper core dependency, zero transitive dependencies) parses it, with its alias
limit left on; it is loaded only when `syncProfiles` is configured.

## Schema hash and the additive-delta story

- **Contract**: per table — database, name, PK, sealed, the storage metadata column names, and per
  attribute (sorted by name): name, type (object types and embedded tables by name), `nullable`,
  PK, indexed, server-managed, computed `{from, version}`; the shapes of every object type and
  embedded table reachable from the table (an embedded table with its sealing, attributes and
  relations, since the same model decodes it), each listed once by name, so a nested change
  reaches every table that carries it while shared and recursive types hash in linear time;
  relations by name/cardinality/key/target. Excluded: descriptions, `typeName`, attribute order,
  profile membership — none of them changes what a device stores or sends.
- `tables[].hash` = SHA-256 of the canonical JSON (sorted keys) of the table contract;
  `schemaHash` = hash of `{irVersion, tables: [table contracts]}`; `profiles[].hash` = hash of the
  profile definition (its "version"); `profiles[].schemaHash` = hash of the sorted
  `{database, table, hash}` of the profile's tables — **the value the `hello` frame carries**.
  `irVersion` is inside every hash and is bumped whenever a mapping or canonicalization change
  alters what a device stores or sends, so such a change reads as unknown drift, never a false
  match.
- **`diffSchemaIR(from, to)`** classifies each change by what it does to a client generated from
  `from`: `read` (its decode can fail), `write` (the server can reject its writes, or a `PUT`
  can drop data), `storage` (its replica layout cannot be extended in place — rebuild/resync), or
  nothing (additive). Summary: `compatibility: {read, write, storage}`, each
  `identical | additive | breaking`, plus `source` changes (`typeName` renames) and a `delta` an
  old client can apply without regenerating: new tables' storage descriptors, added columns,
  changed computed expressions (recompute pass, issue #18 finding).

| Change (to a table unless noted)                                                                                           | read                            | write                                                                        | storage                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| table added                                                                                                                | —                               | —                                                                            | — (new table)                            |
| table removed; PK changed; attribute type changed                                                                          | breaking                        | breaking                                                                     | breaking                                 |
| nullable attribute added, table not sealed; index changed                                                                  | —                               | —                                                                            | — (add column)                           |
| attribute added to a `@sealed` table                                                                                       | —                               | breaking (old model drops it on `PUT`)                                       | —                                        |
| required (`!`) attribute added                                                                                             | —                               | breaking (old inserts omit it)                                               | —                                        |
| attribute removed that the old model required on read                                                                      | breaking                        | —                                                                            | —                                        |
| attribute removed from a `@sealed` table                                                                                   | —                               | breaking (old writes send it)                                                | —                                        |
| attribute became nullable where the old model required it                                                                  | breaking                        | —                                                                            | —                                        |
| attribute became required on insert, or writable became read-only                                                          | —                               | breaking                                                                     | —                                        |
| element nullability: `[T!]` → `[T]` / `[T]` → `[T!]`                                                                       | breaking / —                    | — / breaking                                                                 | —                                        |
| computed expression/version changed                                                                                        | —                               | —                                                                            | — (recompute)                            |
| computed attribute or relationship added, table not sealed                                                                 | —                               | breaking (old model echoes it from `_extra` on `PUT`; `validate` rejects it) | — (add column)                           |
| stored attribute turned into a relationship                                                                                | —                               | breaking (old writes send it)                                                | —                                        |
| `sealed` changed                                                                                                           | —                               | breaking                                                                     | — (an orphaned `_extra` column is inert) |
| version/extra column relocated (attribute named `_version`/`_extra` added)                                                 | —                               | —                                                                            | breaking                                 |
| nested object type: same rules, never sealed; each type pair is compared once per table, at the first path that reaches it |                                 |                                                                              |                                          |
| contract changed only through an embedded table                                                                            | the embedded table's read break | the embedded table's write break                                             | —                                        |

The gateway (#10) chooses by profile direction: `pull` checks `read`, `push` checks `write`,
`bidirectional` both; `storage` always forces a resync. With no consumer for the hello negotiation
yet, the diff has two consumers today: the dev-mode component warns when a regeneration is
breaking against the previous IR file, and `schema-codegen diff` exits non-zero on a breaking
change — the CI check the design doc's risk (4) asks for.

## Entry points and publication

Component options (dev mode, flat like the existing `schemaTypes`/`jsdoc`):

```yaml
'@harperfast/schema-codegen':
  package: '@harperfast/schema-codegen'
  schemaIR: client/harper-schema.json
  syncProfiles: sync.yaml
  swift: ios/HarperModels
  swiftModule: HarperModels # default HarperModels
  kotlin: android/harper-models
  kotlinPackage: com.example.harper # default harper.models
```

- Client generation runs only when `schemaIR`, `swift` or `kotlin` is set; otherwise nothing new
  is imported, parsed or hashed. The client modules and `yaml` are loaded lazily.
- Paths resolve against `scope.directory` (the application directory). Today's outputs resolve
  against the process working directory, which writes to the wrong place whenever Harper is not
  started from the application directory (observed with `harper dev <dir>`); existing options get
  the same fix.
- Event-driven regenerations (`updateTable`/`dropTable`/`dropDatabase`, and `sync.yaml` edits)
  are coalesced into one trailing run and serialized, so a burst of schema events renders once and
  an older run can never finish after a newer one. Each run reads the type registry afresh, and a
  run still in flight when its scope closes stops before publishing. A scope closed before the initial five-second
  delay installs nothing.
- Everything is rendered and validated in memory before any write. Every changed file is then
  staged beside its target before any is renamed into place, so a failed write (a full disk)
  publishes nothing, and a failed rename restores the files already replaced from the previous
  contents; generated sources are renamed before the IR file, which is the baseline the next run
  diffs against. Renames resolve symlinks (the link survives), and a target Windows holds
  open is overwritten in place. Errors (YAML, IR validation, I/O) are logged at the component
  boundary and leave the previous outputs in place; they never take Harper down.
- An IR read from a file is validated before use, including its hashes: each is recomputed from
  the contents, so a hand-merged IR that kept an old hash is refused rather than diffed as
  unchanged. The fields derived from the contract (`readOnly`, the projections, column
  affinities) must match what the builder derives, and type names may not be reserved, so an
  edited IR cannot emit a model that disagrees with its own hash.
- `swiftModule` must be a Swift identifier and `kotlinPackage` dot-separated identifiers (keyword
  segments are backtick-escaped in source), so neither can traverse out of the output directory.
  Every string emitted into source is escaped for the target language (Kotlin `$` included).

CLI (`bin/schema-codegen.js`, `npx @harperfast/schema-codegen …`), working from an IR file so it
runs in CI without a Harper instance; errors exit non-zero with a one-line message:

```
schema-codegen generate-client --ir client/harper-schema.json --swift ios/HarperModels --kotlin android/harper-models
schema-codegen diff old.json new.json [--json] [--fail-on read,write,storage]
```

A remote `--url` mode is deliberately absent: the only remote schema surface today is
`describe_all`, which is lossy (do-less (a)); the gateway's IR endpoint (#16) is the right
source and will serve `buildSchemaIR` output.

Package: `bin`, and `main` for `index.js`, which exports `buildSchemaIR`, `normalizeSyncProfiles`,
`diffSchemaIR`, `assertSchemaIR`, `emitSwiftPackage` and `emitKotlinModule` for the gateway and
Studio; `files` gains `index.js` and `bin/`. There is deliberately no `exports` map: it would block
the deep imports existing users may have, which is a breaking change for a feature release.
Toolchain floor for generated code: Swift 5.9 (iOS 13,
macOS 10.15), Kotlin 1.9 on the JVM (Android API 26 or desugaring for `java.time`/`Base64`).

## Planning review resolutions (cross-model, codex, 2026-10-05)

Framing verdict: `chosen-approach-sound`. Adopted: coalesced/lazy generation and reuse of the
filtered table list (P2); patch null states, Blob replacement safety, encode-time `_extra`
filtering (P1-2); the read/write/storage diff axes including sealed-table and metadata-relocation
rows, and "hash = wire/storage identity" (P1-3); full member/type/profile namespaces, verbatim
names claimed first, `id` synthesis, previous-IR type-name stability, empty projections skipped,
by-value cycles boxed (P1-4); render-then-atomic-publish, serialized runs, close-before-start,
boundary error handling, CLI exit codes (P1-5); fail-closed profiles, IR import validation,
module/package validation and per-language escaping (P1-6); compile + SQLite round-trip native
tests made mandatory on a macOS CI job, reordered-input byte equality, `defineTable` source in the
e2e (P1-7); packaging metadata and a pack-content test (P1-8). Overruled: "new source modules
must be TypeScript" — the package is loaded from `node_modules`, where Node does not type-strip,
and CI runs Node 20; a compile step for one package is out of scope, so the repository's
JavaScript + JSDoc convention stands.

## Verification plan

- Unit tests for the IR builder (nullability, projections incl. Blob and clearable, nested types
  via the type registry, relations from GraphQL and `defineTable` metadata, naming collisions and
  stability, storage columns), profile normalization and fail-closed diagnostics, hashing
  (stability under input reordering, sensitivity to contract changes), every row of the diff
  table, both emitters (escaping, keywords, empty projections), publication (atomic writes,
  manifests written once, stale-file reports), coalescing and close-before-start, the CLI, and the
  packed file list.
- Native tests (mandatory on the macOS CI job, skipped elsewhere): generated Swift compiled in
  Swift 5 and 6 language modes and Kotlin with `kotlinc`, each driven by a harness that decodes
  rows (JSON, Foundation/JVM maps), round-trips encode/decode, checks null states and extras, and
  (Swift) writes and re-reads a SQLite replica built from the generated descriptors.
- End-to-end: the component in a hermetic `harper dev` instance writes the IR, Swift and Kotlin
  for the spike's schema, a coverage schema and a `defineTable` table; the spike's iOS app is
  switched to the generated package (models deleted, `SpikeStorage` driven by the generated
  descriptors), built with `xcodebuild`, and run in the simulator against the spike gateway.

## Not in scope (follow-ups)

- Porting the TS/JSDoc emitters onto the IR.
- Typed query builders (#7/#12), relation navigation, blob references, invocable functions in the
  IR (#18), the gateway's IR endpoint and hello negotiation (#10/#16).
