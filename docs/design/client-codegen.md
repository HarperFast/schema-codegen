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

**Invariant this change enforces:** every client artifact (Swift, Kotlin, IR JSON, hashes) is a
pure, deterministic function of the IR, and the IR is a pure, deterministic function of the live
schema plus `sync.yaml`. Equal contract hashes therefore mean interchangeable generated models,
and the mapping/projection/nullability rules exist in exactly one module.

## Approaches considered

| Axis | Candidate | Fact that decides |
|---|---|---|
| **Different layer** | (a) Harper core: a `harper generate-client` subcommand and a core IR endpoint beside `defineTable`. (b) The sync gateway (pro, #10), which will own `sync.yaml`. | (a) Core already exposes everything needed on live `Table.attributes` (traced below), so no core change is required, and the design doc's M8 assigns the work to this package ("extends it rather than starting over"); a core subcommand would also force core's release cadence onto emitter iterations. (b) The gateway does not exist yet, but codegen is a phase-0 mechanism (design doc M8: thin and cached strategies need typed models before any sync machinery). Both are served by building the IR here and **exporting** it (`buildSchemaIR`) so the gateway and Studio import one implementation. |
| **Deeper cause** | Make core's schema carry a canonical client contract — e.g. build the IR from `Table.properties` (the JSON-Schema fragments from `resources/jsonSchemaTypes.ts`). | `attributeToFragment` drops facts the client contract needs: it emits `nullable` only when `true` (GraphQL never sets `true`, so undefined-means-nullable is unrecoverable), and omits computed expressions, relationship targets, element nullability and `sealed`. Extending it is a core API change for one consumer; `Table.attributes`, the source those fragments are projected from, loses nothing. |
| **Do less** | (a) Use the `describe_all`/`describe_table` operation output as the IR (works remotely, zero new parsing). (b) Emit only the IR and let the iOS/Android SDKs generate models at build time (SwiftPM/Gradle plugins). (c) Reuse the TS emitter's `mapType` and string-map its output to Swift/Kotlin. | (a) `dataLayer/schemaDescribe.ts` `pushAtt` reduces `elements` to a type name, nested `properties` to `{type, name}`, `computed` to `true`, and drops relationship targets — lossy for every non-scalar attribute. (b) The acceptance requires generated models in the demo app now, and two SDK-side generators would re-implement the naming/type rules twice in two more languages — the opposite of "recorded once". (c) `mapType` collapses `Int`/`Long`/`Float` to `number`, `Bytes`/`Blob`/`Any` to `any` and `Date` to `string`; the native types need exactly the distinctions it erases. |
| **Chosen** | A language-neutral **IR v1** built in this package from live `Table.attributes` plus normalized `sync.yaml` profiles; Swift and Kotlin emitters that read only the IR; contract hashing and an additive/breaking diff in the same module; component options and a small CLI as entry points; a public `index.js` for the gateway and Studio. | Beats (a)/(b) above on the stated facts; keeps one implementation of every rule; needs no core or pro change. |

The existing TS/JSDoc emitters are left byte-for-byte unchanged (users' generated files must not
churn); moving them onto the IR is a follow-up.

## Traced facts this design relies on (core `origin/main` @ 33bea305, 2026-10-05)

- `resources/graphql.ts` `getProperty`: a plain field leaves `nullable` undefined, `!` sets
  `nullable: false`; nothing sets `nullable: true`. List types become `{type: 'array', elements}`
  with the element's own `nullable`. Nested type references get non-enumerable `properties` (the
  target type's attributes) and `definition` (the target typeDef, `.table` set only for `@table`
  types); relationship attributes get a non-enumerable `relationshipReference: {database, table}`.
  `@computed(from:)` keeps the source as `computedFromExpression` and a `version`;
  `@createdTime`/`@updatedTime` set `assignCreatedTime`/`assignUpdatedTime`. `@fullText` fields
  never enter `attributes`.
- `resources/defineTable.ts` projections: nullable → optional; server-managed and relation fields
  read-only on the record and absent from every write; primary key required on read and upsert,
  optional on insert, never patched; query = indexed fields, all optional. `compileTypeDef` leaves
  PK and server-managed fields' `nullable` unmarked "because the PK machinery and server
  assignment own their presence".
- `resources/Table.ts` `validate`: `Int` is int32; `Long` is an integer with |v| ≤ 2^53; `Float`
  any number; `ID` a string (or array of strings); `BigInt` coerced from string/number; `Bytes`
  a `Uint8Array` (strings coerced); `Blob` a `Blob` (strings/Buffers coerced); `Date` coerced from
  string/number; computed and relationship attributes may not be assigned; a `sealed` table
  rejects unknown properties. Nested-object sealing reads `attribute.sealed`, which no schema path
  sets (only the table's primary attribute carries `sealed`, `resources/databases.ts`), so nested
  objects are not sealed in practice.
- Every live table has `tableName`, `databaseName`, `primaryKey`, `attributes`, `sealed`
  statics (`resources/Table.ts`).

## IR v1

JSON, deterministic (tables sorted by database then name, profiles and nested types by name, no
timestamps). Shape:

```jsonc
{
  "irVersion": 1,
  "generator": "@harperfast/schema-codegen@<version>",   // informational, not hashed
  "schemaHash": "<sha256 hex>",
  "tables": [{
    "database": "data", "name": "Order", "typeName": "Order",
    "primaryKey": "id", "sealed": false, "hash": "<sha256 hex>",
    "profiles": ["my-orders"],
    "attributes": [{
      "name": "amount",
      "type": { "kind": "scalar", "scalar": "Float" },
      // or { "kind": "array", "element": <type>, "elementNullable": true }
      // or { "kind": "object", "type": "OrderLine" }            -> "types" entry
      // or { "kind": "record", "database": "data", "table": "Customer" }  (embedded table shape)
      "nullable": true, "primaryKey": false, "indexed": false,
      "serverManaged": null,            // "createdTime" | "updatedTime" | null
      "computed": null,                 // { "from": "<expr>" | null, "version": "<v>" | null }
      "readOnly": false,                // serverManaged || computed
      "description": "…"                // optional, not hashed
    }],
    "relations": [{ "name": "customer", "cardinality": "one", "from": "customerId",
                    "target": { "database": "data", "table": "Customer" } }],
    "projections": { "record": [{ "name": "id", "optional": false }], "insert": [], "upsert": [],
                     "patch": [], "query": [] },
    "storage": { "versionColumn": "_version", "extraColumn": "_extra",
                 "columns": [{ "name": "id", "affinity": "TEXT", "primaryKey": true }] }
  }],
  "types": [{ "name": "OrderLine", "typeName": "OrderLine", "attributes": [] }],
  "profiles": [{
    "name": "my-orders", "direction": "pull", "retention": "30d", "retentionMs": 2592000000,
    "hash": "<sha256 hex>", "schemaHash": "<sha256 hex>",
    "tables": [{ "database": "data", "table": "Order",
                 "scope": { "type": "match", "conditions": [
                   { "attribute": "customerId", "operator": "equals", "source": "claim", "claim": "sub" } ] } }]
  }],
  "diagnostics": [{ "level": "warning", "code": "SCOPE_ATTRIBUTE_NOT_INDEXED", "message": "…" }]
}
```

- **Nullability (read side, "undefined-means-nullable")**: an attribute is optional on read unless
  it is the primary key, server-managed, or `nullable === false`. Computed attributes are always
  optional (an on-device materialization may not have run, issue #18). Array elements follow the
  same rule: `[String]` has nullable elements, `[String!]` does not.
- **Projections** are the defineTable rules over stored attributes: `record` = all stored
  attributes; `insert` = writable (not read-only) attributes, PK optional; `upsert` = writable, PK
  required; `patch` = writable non-PK, all optional; `query` = indexed attributes, all optional.
  Relations are not stored and appear only under `relations`.
- **`typeName`** is a language-neutral identifier: `<db>_` prefix outside `data` (as the TS
  emitter does), singularized table name, characters outside `[A-Za-z0-9_]` sanitized, deduped,
  and kept clear of a reserved set (Swift and Kotlin keywords, the standard types the generated
  code names, the generated runtime's `Harper*` names, `New`, `Patch`). A collision appends
  `Record`, then `_2`, `_3`… in sorted order. Insert and patch shapes are nested (`Order.New`,
  `Order.Patch`), so they can never collide with another table's type.
- **Storage** (the device replica's table shape): one column per stored attribute, plus a version
  column (`REAL`) and, on non-sealed tables, an overflow column (`TEXT` JSON). The version/extra
  column names are `_version`/`_extra` unless an attribute already uses the name, in which case an
  extra leading underscore is added until unique.

## Type mapping (the recorded decisions)

| Harper | Swift | Kotlin | SQLite affinity | Row encoding (`HarperValue`) |
|---|---|---|---|---|
| `ID`, `String` | `String` | `String` | TEXT | string |
| `Int` (int32) | `Int` | `Int` | INTEGER | int |
| `Long` (\|v\| ≤ 2^53) | `Int64` | `Long` | INTEGER | int |
| `Float` | `Double` | `Double` | REAL | double (ints accepted) |
| `BigInt` (arbitrary) | `HarperBigInt` (decimal-string value type) | `java.math.BigInteger` | TEXT | string of digits (ints accepted) |
| `Boolean` | `Bool` | `Boolean` | INTEGER | bool (0/1 accepted) |
| `Date` | `Date` | `java.time.Instant` | REAL (epoch ms) | double epoch ms (ISO-8601 strings accepted) |
| `Bytes` | `Data` | `ByteArray` | BLOB | bytes (base64 strings accepted) |
| `Blob` | `HarperValue?` (opaque) | `HarperValue?` | BLOB | passed through untouched |
| `Any` | `HarperValue` | `HarperValue` | TEXT (JSON) | any |
| `[T]` | `[T]` / `[T?]` | `List<T>` / `List<T?>` | TEXT (JSON) | array |
| nested type | generated `struct` | generated `data class` | TEXT (JSON) | object |
| relation | not a property | not a property | no column | — |

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
- **Blob**: content is fetch-on-demand and not inlined in sync (design doc open question 4), and
  its transport placeholder is undecided, so the model holds whatever the transport delivered as
  an opaque, always-optional `HarperValue` and passes it back unchanged on upsert (dropping it on
  a full-replace `PUT` would delete the blob). A typed blob reference replaces this when blob sync
  is designed.
- **Any → `HarperValue`**: a closed JSON-like enum (`null/bool/int/double/string/bytes/array/
  object`) that is `Sendable`, `Hashable` and (Swift) `Codable`, so models stay value types.
- **Bytes in Kotlin**: `ByteArray` has identity equality, so generated data classes that hold
  one override `equals`/`hashCode` with content comparison.

## Client model shape

Per table (Swift `struct` / Kotlin `data class`), named `typeName`:

- one property per stored attribute, typed per the table above, optional per read nullability;
- `_version: Double?` — the record version (Harper's update timestamp); `nil` for records not
  read from the replica (REST bodies carry it in headers, not the body);
- `_extra: [String: HarperValue]` / `Map<String, HarperValue>` on non-sealed tables — attributes
  the schema does not declare, preserved for round trips (relation and computed names are never
  treated as extras: the server rejects them on write);
- `Order.New` (insert projection) and `Order.Patch` (patch projection) nested types;
- decode `init(row:version:)` (Swift, throwing) / `Order.decode(row, version)` (Kotlin) from a
  `HarperRow` (`[String: HarperValue]`, keyed by attribute name — the logical record, extras at
  the top level); `encodeRow()` (full record, for storage) and `encodeUpsertRow()` (PK + writable
  attributes + `_extra`, for `PUT`). Absent optional values are omitted, never encoded as null.
- Swift: `let` for the PK and read-only attributes, `var` for writable ones (value semantics make
  edit-then-`put` safe); `Hashable`, `Sendable`, and `Identifiable` when the PK can serve as `id`.
  Kotlin: all `val` (`copy()` is the edit idiom). A missing required value or a mismatched type
  throws a `HarperDecodingError` naming table and attribute: the SDK decides whether to skip and
  report the row; the model never guesses.
- Property names: attribute names that are already identifiers are kept verbatim (as the TS
  emitter does); others are sanitized like table names; keywords are escaped with backticks;
  names that collide with the system members (`_version`, `_extra`, `New`, `Patch`) or with each
  other are deduped with a numeric suffix. The raw attribute name is always what goes on the row.
- Nested object types get the same treatment minus `_version`, `New` and `Patch`, and always keep
  `_extra` (nested sealing is not enforced server-side, see traced facts). A nested type that
  contains itself by value (not through an array) is a Swift compile error; that edge is emitted
  as `HarperValue` with a diagnostic.

Generated package layout — fixed file names, so a dropped table never leaves a stale file:

- Swift: `<dir>/Package.swift` (written only if absent, then user-owned) and
  `<dir>/Sources/<Module>/{HarperRuntime,HarperSchema,Models}.swift`.
- Kotlin: `<dir>/build.gradle.kts` (written only if absent) and
  `<dir>/src/main/kotlin/<package path>/{HarperRuntime,HarperSchema,Models}.kt`.

`HarperRuntime` holds the support types (`HarperValue`, `HarperRow`, `HarperRecord`,
`HarperBigInt`, `HarperTableSchema`, `HarperColumn`, `HarperSyncProfile`, decoding helpers). It
lives in the generated package until the iOS/Android SDKs (#12/#13) exist; the SDK then ships it
and the emitter imports it instead. `HarperSchema` holds `irVersion`, `hash`, all table
descriptors (columns with affinity, PK, indexed, read-only, computed expression), and the sync
profiles (name, direction, retention, tables, profile `schemaHash`) with one named constant per
profile (`HarperSyncProfile.storefront`).

## Sync profiles (`sync.yaml`)

No profile format exists in core or pro yet (searched both, 2026-10-05); the spike hard-codes
`server/app/profiles.js`, and the design doc sketches `sync.yaml`. This package parses that
documented format so the gateway (M1) inherits a tested normalizer:

```yaml
profiles:
  storefront:
    direction: pull            # pull (default) | push | bidirectional
    retention: 14d             # ms | s | m | h | d | w
    tables: [Product]          # list form: profile-level scope (default: all)
  my-orders:
    retention: 30d
    scope:
      customerId: $token.sub   # claim reference; $user.<field> for the user record
    tables: [Order]
  bench-seg10:
    tables:
      BenchItem:               # map form: per-table database/scope override
        scope: { seg: s10 }    # literal equality; a list means membership
```

Scope values: a scalar is a literal equality; a string starting with `$token.`/`$user.` is a
claim/user reference (`$$` escapes a literal `$`); a list is literal membership. Normalized to
per-table `{type: 'all'}` or `{type: 'match', conditions: [...]}`. Validation produces
diagnostics, never exceptions: unknown table (table skipped), unknown or non-indexed scope
attribute, invalid direction or retention. Profiles bind tables by name in `sync.yaml` because a
`@sync` type directive does not survive into `Table` (the GraphQL parser keeps only the
directives it knows).

`yaml` (already a Harper core dependency, zero transitive deps) is added to parse it.

## Schema hash and the additive-delta story

- **Contract**: per table — database, name, PK, sealed, and per attribute (sorted by name): name,
  type (nested object types inlined structurally, cycles by reference), read nullability, PK,
  indexed, server-managed, computed `{from, version}`; relations by name/cardinality/key/target.
  Excluded: descriptions, `typeName`, attribute order, profile membership — none of them changes
  what a device stores or sends.
- `tables[].hash` = SHA-256 of the canonical JSON (sorted keys) of the table contract;
  `schemaHash` = hash of `{irVersion, tables: [table contracts]}`; `profiles[].hash` = hash of the
  profile definition (its "version"); `profiles[].schemaHash` = hash of the sorted
  `{database, table, hash}` of the profile's tables — **the value the `hello` frame carries**.
  `irVersion` is inside every hash, so a canonicalization change reads as unknown drift, never a
  false match.
- **`diffSchemaIR(from, to)`** classifies each change by what it breaks for a client generated
  from `from`: `read` (decode can fail or lose meaning), `write` (the server can reject its
  writes or it can drop data on `PUT`), or nothing (additive). Summary:
  `compatibility: {read, write}` each `identical | additive | breaking`, plus a `delta` an old
  client can apply without regenerating: new tables' storage descriptors, added columns, changed
  computed expressions (recompute pass, issue #18 finding).

| Change | read | write |
|---|---|---|
| table added; nullable attribute added; index changed | — | — |
| computed expression/version changed | — (recompute) | — |
| required (`!`) attribute added | — | breaking (old inserts omit it) |
| table removed; PK changed; attribute type changed | breaking | breaking |
| attribute removed that the old model required on read | breaking | — |
| attribute became nullable (old model requires it) | breaking | — |
| attribute became required / writable became read-only | — | breaking |
| `sealed` changed | — | breaking (rejected extras / dropped extras on `PUT`) |

The gateway (#10) chooses by profile direction: `pull` checks `read`, `push` checks `write`,
`bidirectional` both. With no consumer for the hello negotiation yet, the diff has two
consumers today: the dev-mode component warns when a regeneration is breaking against the
previous IR file, and `schema-codegen diff` exits non-zero on a breaking change — the CI check
the design doc's risk (4) asks for.

## Entry points

Component options (dev mode, flat like the existing `schemaTypes`/`jsdoc`), regenerated on the
existing `updateTable`/`dropTable`/`dropDatabase` events and on `sync.yaml` changes:

```yaml
'@harperfast/schema-codegen':
  package: '@harperfast/schema-codegen'
  schemaIR: client/harper-schema.json
  syncProfiles: sync.yaml
  swift: ios/HarperModels
  swiftModule: HarperModels          # default HarperModels
  kotlin: android/harper-models
  kotlinPackage: com.example.harper  # default harper.models
```

CLI (`bin/schema-codegen.js`, `npx @harperfast/schema-codegen …`), working from an IR file so it
runs in CI without a Harper instance:

```
schema-codegen generate-client --ir client/harper-schema.json --swift ios/HarperModels --kotlin android/harper-models
schema-codegen diff old.json new.json [--json] [--fail-on read,write]
```

A remote `--url` mode is deliberately absent: the only remote schema surface today is
`describe_all`, which is lossy (do-less (a) above); the gateway's IR endpoint (#16) is the right
source and will serve `buildSchemaIR` output.

Public module (`index.js`): `buildSchemaIR`, `normalizeSyncProfiles`, `diffSchemaIR`,
`emitSwiftPackage`, `emitKotlinModule`.

## Verification plan

- Unit tests for the IR builder (nullability, projections, nested types, relations, naming
  collisions, storage columns), profile normalization and diagnostics, hashing (stability under
  attribute reordering, sensitivity to contract changes), the diff table above, and both emitters.
- Compile tests: generated Swift (Swift 5 and 6 language modes) with `swiftc`, generated Kotlin
  with `kotlinc`, each with a small program that decodes/encodes rows and asserts round trips;
  run when the toolchain is present (opt-in on CI hosts without it).
- End-to-end: the component in a hermetic `harper dev` instance writes the IR, Swift and Kotlin
  for the spike's schema and profiles; the spike's iOS app is switched to the generated package
  (models deleted, `SpikeStorage` driven by the generated descriptors) and built with
  `xcodebuild` for the simulator.

## Not in scope (follow-ups)

- Porting the TS/JSDoc emitters onto the IR.
- Typed query builders (#7/#12), relation navigation, blob references, invocable functions in the
  IR (#18), the gateway's IR endpoint and hello negotiation (#10/#16).
