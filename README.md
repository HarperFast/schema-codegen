# @HarperFast/Schema-Codegen

Schema Codegen will generate TypeScript types for your GraphQL schemas, making it easier to work with your data in TypeScript applications.

## Installation

Drop this in your Harper application's config.yaml:

```yaml
'@harperfast/schema-codegen':
  package: '@harperfast/schema-codegen'
```

When you `harper dev`, it will watch any file ending in .graphql.

## Example

For example, here's a tracks.graphql schema:
```graphql
type Tracks @table @sealed {
	id: ID @primaryKey
	name: String! @indexed
	mp3: Blob
}
```

Next to it, a management.graphql.ts file will get generated with this:

```typescript
/**
 Generated from schemas/music.graphql
 Manual changes will be lost!
 > npm run generate
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

An ambient declaration will also be generated in a top level tables.d.ts to enhance the global `tables` from Harper:
```typescript
/**
 Generated from your schema files
 Manual changes will be lost!
 > npm run generate
 */
import type { Resource } from 'harperdb/v2';
import type { Album, Albums, Track, Tracks } from './schemas/music.graphql';

declare module 'harperdb' {
	export const tables: {
		Tracks: { new(identifier: Id, source: Track): Resource<Track> };
	};
}
```
