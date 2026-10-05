/**
 * The schema IR format version. Bump it whenever a mapping or canonicalization change alters what
 * a device stores or sends: it is part of every hash, so the change then reads as unknown drift
 * instead of a false match.
 */
export const IR_VERSION = 1;

/** The Harper attribute types the IR represents as scalars. */
export const SCALAR_TYPES = new Set([
	'ID',
	'String',
	'Int',
	'Float',
	'Long',
	'BigInt',
	'Boolean',
	'Date',
	'Bytes',
	'Blob',
	'Any',
]);
