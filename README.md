# @HarperFast/Schema-Codegen

Schema Codegen will generate TypeScript types for your GraphQL schemas, making it easier to work with your data in TypeScript and JavaScript applications. It can also generate Swift and Kotlin client models, plus a schema IR that describes your tables and sync profiles for client SDKs — see [Client models](#client-models-swift-and-kotlin).

## Installation

Install this with your favorite package manager!

```bash
npm install --save @harperfast/schema-codegen
```

Drop this in your Harper application's config.yaml:

```yaml
'@harperfast/schema-codegen':
  package: '@harperfast/schema-codegen'
  globalTypes: 'schemas/globalTypes.d.ts'
  schemaTypes: 'schemas/types.ts'
```

Alternatively, if you are using pure JavaScript, you can generate JSDoc instead:

```yaml
'@harperfast/schema-codegen':
  package: '@harperfast/schema-codegen'
  jsdoc: 'schemas/jsdocTypes.js'
```

When you `harper dev`, it will generate types based on the schema that's actually in your Harper database. If you change the schema, we will automatically regenerate the types for you.

## Options

| Option             | Default  | Description                                                                                                                                                |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `globalTypes`      | —        | Path to write the ambient module augmentation (`.d.ts`).                                                                                                   |
| `schemaTypes`      | —        | Path to write the exported interfaces (`.ts`).                                                                                                             |
| `jsdoc`            | —        | Path to write JSDoc types instead, for pure JavaScript projects.                                                                                           |
| `module`           | `harper` | The runtime package to augment. Harper 5.x apps import from `harper`; set this to `harperdb` for Harper 4.x apps.                                          |
| `includeDatabases` | (all)    | List of database names to generate types for. When set, only matching databases are emitted. Supports `*` as a wildcard, e.g. `metrics-*`.                 |
| `excludeDatabases` | (none)   | List of database names to skip. Useful on a shared instance to keep other applications' databases out of your generated types. Supports `*` as a wildcard. |

Output paths are relative to your application directory. Client model options are described
[below](#client-models-swift-and-kotlin).

`includeDatabases`/`excludeDatabases` scope generation to your application's own
databases. On a shared local instance, codegen otherwise sees every database on
the instance — including ones belonging to other projects — so scoping keeps
your generated types focused:

```yaml
'@harperfast/schema-codegen':
  package: '@harperfast/schema-codegen'
  globalTypes: 'schemas/globalTypes.d.ts'
  schemaTypes: 'schemas/types.ts'
  includeDatabases:
    - data
    - 'metrics-*'
```

## Example

For example, here's a tracks.graphql schema:

```graphql
type Tracks @table @sealed {
	id: ID @primaryKey
	name: String! @indexed
	mp3: Blob
}
```

Next to it, a schemas/types.ts file will get generated with this:

```typescript
/**
 Generated from HarperDB schema
 Manual changes will be lost!
 > harper dev .
 */
export interface Track {
	id: string;
	name: string;
	mp3?: any;
}

export type NewTrack = Omit<Track, 'id'>;
export type Tracks = Track[];
export type { Track as TrackRecord };
export type TrackRecords = Track[];
export type NewTrackRecord = Omit<Track, 'id'>;
```

An ambient declaration will also be generated in globalTypes.d.ts to enhance the global `tables` and `databases` from Harper:

```typescript
/**
 Generated from your schema files
 Manual changes will be lost!
 > harper dev .
 */
import type { Table } from 'harper';
import type { Track } from './types.ts';

declare module 'harper' {
	export const tables: {
		Tracks: { new (...args: any[]): Table<Track> };
	};
	export const databases: {
		data: {
			Tracks: { new (...args: any[]): Table<Track> };
		};
	};
}
```

## Client models (Swift and Kotlin)

Schema Codegen can also generate the typed models a mobile client works with: a Swift package and a
Kotlin module, built from a schema IR (a versioned JSON description of your tables, nested types and
sync profiles). Turn it on with any of these options:

| Option          | Default         | Description                                                                                                                                                                                             |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaIR`      | —               | Path to write the schema IR (`.json`). Set it whenever you generate `swift` or `kotlin`: it is the baseline that keeps generated type names stable and lets a regeneration warn about breaking changes. |
| `swift`         | —               | Directory of the Swift package to generate.                                                                                                                                                             |
| `swiftModule`   | `HarperModels`  | The Swift module (and target) name.                                                                                                                                                                     |
| `kotlin`        | —               | Directory of the Kotlin module to generate.                                                                                                                                                             |
| `kotlinPackage` | `harper.models` | The Kotlin package.                                                                                                                                                                                     |
| `syncProfiles`  | —               | Path to a `sync.yaml` describing sync profiles; edits regenerate without a restart.                                                                                                                     |

```yaml
'@harperfast/schema-codegen':
  package: '@harperfast/schema-codegen'
  schemaIR: 'client/harper-schema.json'
  syncProfiles: 'sync.yaml'
  swift: 'ios/HarperModels'
  kotlin: 'android/harper-models'
  kotlinPackage: 'com.example.harper'
```

Each table becomes a Swift `struct` and a Kotlin `data class` with one typed property per attribute,
`_version` (the record's version), and — unless the table is `@sealed` — `_extra`, which keeps
attributes the schema does not declare so they survive a round trip. Every model also has a nested
`New` (insert body) and `Patch` (patch body) type, and a schema descriptor for the device's SQLite
replica. For the `Order` table of a schema like this:

```graphql
type Order @table @export {
	id: ID @primaryKey
	customerId: ID @indexed
	status: String @indexed
	amount: Float
	points: Float @computed(from: "Math.round((amount || 0) * 10)")
}
```

```swift
import HarperModels

var order = try Order(row: row, version: version) // row: HarperRow, e.g. [String: HarperValue]
order.status = "closed"
let body = try order.encodeUpsertRow()             // PUT body: key, writable attributes, _extra
let patch = Order.Patch(status: "closed", clear: [.amount]).encodeRow()
```

```kotlin
val order = Order.decode(row, version)
val patch = Order.Patch(status = "closed", clear = setOf(Order.Patch.Field.amount)).encodeRow()
```

How Harper types map, and why, is recorded in [docs/design/client-codegen.md](docs/design/client-codegen.md):

| Harper         | Swift                     | Kotlin                    |
| -------------- | ------------------------- | ------------------------- |
| `ID`, `String` | `String`                  | `String`                  |
| `Int`          | `Int`                     | `Int`                     |
| `Long`         | `Int64`                   | `Long`                    |
| `Float`        | `Double`                  | `Double`                  |
| `BigInt`       | `HarperBigInt`            | `java.math.BigInteger`    |
| `Boolean`      | `Bool`                    | `Boolean`                 |
| `Date`         | `Date`                    | `java.time.Instant`       |
| `Bytes`        | `Data`                    | `ByteArray`               |
| `Blob`         | `HarperValue?`, read-only | `HarperValue?`, read-only |
| `Any`          | `HarperValue`             | `HarperValue`             |
| `[T]`          | `[T]`                     | `List<T>`                 |
| nested type    | generated `struct`        | generated `data class`    |

Attributes are optional unless they are the primary key, server-managed (`@createdTime`,
`@updatedTime`), or declared non-null (`String!`). Computed attributes are read-only and optional;
relationships are not stored on the model. A table with a `Blob` attribute cannot be replaced in full
(`encodeUpsertRow` throws), because a client has no way to send a blob back yet; use a patch.

The generated Swift package needs Swift 5.9 (iOS 13, macOS 10.15); the Kotlin module targets the JVM
and needs Android API 26 (or core library desugaring) for `java.time`. `Package.swift` and
`build.gradle.kts` are created once and then left to you; the sources are regenerated.

### Sync profiles

A `sync.yaml` declares which tables replicate to devices, scoped to the rows each device may see:

```yaml
profiles:
  storefront:
    retention: 14d # how long a device may stay offline and still catch up
    tables: [Product]
  my-orders:
    direction: pull # pull (default), push or bidirectional
    retention: 30d
    scope:
      customerId: $token.sub # a token claim; $user.<field> reads the user record
    tables: [Order]
  regional:
    tables:
      Store:
        database: retail
        scope: { region: [us-east, us-west] } # literal values; a list means "any of"
```

Profiles fail closed: a profile with any error — an unknown table or attribute, a mistyped key, an
invalid value — is left out entirely and reported, so a typo can never widen a scope to every row.
Scoping by an attribute without `@indexed` works but logs a warning.

### Schema hashes and compatibility

The IR records a SHA-256 hash of each table's wire and storage contract, of the whole schema, and of
the tables in each sync profile (the value a device sends when it connects). When a regeneration
would break clients built from the previous IR — for example, a changed attribute type, a removed
table, or a new required attribute — the component logs which changes break reads, writes or the
device's storage. To enforce this in CI, compare two IR files with the CLI.

### CLI

The `schema-codegen` command generates client packages from an IR file, without a running Harper:

```bash
npx @harperfast/schema-codegen generate-client --ir client/harper-schema.json --swift ios/HarperModels --kotlin android/harper-models --kotlin-package com.example.harper
```

```bash
npx @harperfast/schema-codegen diff previous-schema.json client/harper-schema.json --fail-on read,write
```

`diff` exits with 1 when the change breaks any of the listed axes (`read`, `write`, `storage`; all
three by default), and `--json` prints the full report.

## Development

To use this in an application, first link it:

```bash
git clone git@github.com:HarperFast/schema-codegen.git
cd schema-codegen
npm link
```

Then cd to your awesome application you want to test this with:

```bash
cd ~/my-awesome-app
npm link @harperfast/schema-codegen
```
