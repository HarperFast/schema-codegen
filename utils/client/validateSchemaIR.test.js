import { describe, expect, it } from 'vitest';
import {
	coverageTables,
	coverageTypes,
	spikeProfiles,
	spikeTables,
} from '../../test/fixtures/clientSchema.js';
import { buildSchemaIR } from './buildSchemaIR.js';
import { assertSchemaIR } from './validateSchemaIR.js';

function validIR() {
	return /** @type {any} */ (
		JSON.parse(
			JSON.stringify(
				buildSchemaIR({
					tables: [...spikeTables(), ...coverageTables()],
					types: coverageTypes(),
					syncProfiles: spikeProfiles(),
				}),
			),
		)
	);
}

describe('assertSchemaIR', () => {
	it('accepts what buildSchemaIR produces', () => {
		expect(() => assertSchemaIR(validIR())).not.toThrow();
	});

	/** @type {[string, (ir: any) => void, RegExp][]} */
	const corruptions = [
		['an unsupported version', (ir) => (ir.irVersion = 2), /irVersion: version 2 is not supported/],
		['a missing table list', (ir) => delete ir.tables, /\$\.tables: expected an array/],
		[
			'a type name that is not an identifier',
			(ir) => (ir.tables[0].typeName = '../Escape'),
			/typeName: expected an identifier/,
		],
		[
			'a duplicated type name',
			(ir) => (ir.tables[1].typeName = ir.tables[0].typeName),
			/is used twice/,
		],
		[
			'an object type that is not declared',
			(ir) => (ir.types = ir.types.filter((/** @type {any} */ type) => type.name !== 'Address')),
			/object type "Address" is not in types/,
		],
		[
			'an unknown scalar',
			(ir) => (ir.tables[0].attributes[0].type = { kind: 'scalar', scalar: 'Decimal' }),
			/unknown scalar/,
		],
		[
			'an unknown type kind',
			(ir) => (ir.tables[0].attributes[0].type = { kind: 'union' }),
			/unknown kind/,
		],
		[
			'a duplicated attribute',
			(ir) => ir.tables[0].attributes.push(ir.tables[0].attributes[0]),
			/declared twice/,
		],
		[
			'a primary key that is not an attribute',
			(ir) => (ir.tables[0].primaryKey = 'nope'),
			/primaryKey: is not an attribute/,
		],
		[
			'a projection naming an unknown attribute',
			(ir) => ir.tables[0].projections.record.push({ name: 'ghost', optional: true }),
			/projections\.record/,
		],
		[
			'an upsert that contradicts unwritable',
			(ir) =>
				(ir.tables.find((/** @type {any} */ t) => t.name === 'Attachment').projections.upsert = []),
			/must be null exactly when/,
		],
		[
			'an overflow column on a sealed table',
			(ir) => (ir.tables.find((/** @type {any} */ t) => t.sealed).storage.extraColumn = '_extra'),
			/must be null exactly when the table is sealed/,
		],
		[
			'a metadata column colliding with an attribute',
			(ir) => (ir.tables[0].storage.versionColumn = 'id'),
			/metadata column collides/,
		],
		[
			'columns out of step with attributes',
			(ir) => ir.tables[0].storage.columns.pop(),
			/one column per attribute/,
		],
		[
			'an unknown affinity',
			(ir) => (ir.tables[0].storage.columns[0].affinity = 'NUMERIC'),
			/known affinity/,
		],
		[
			'a profile referencing an unknown table',
			(ir) => (ir.profiles[0].tables[0].table = 'Ghost'),
			/does not reference a table/,
		],
		['an unknown direction', (ir) => (ir.profiles[0].direction = 'sideways'), /unknown direction/],
		[
			'a generator that would break out of the header comment',
			(ir) => (ir.generator = 'x\nimport Evil'),
			/generator: expected a single-line string/,
		],
		[
			'a schema hash that is not a SHA-256',
			(ir) => (ir.schemaHash = `${ir.schemaHash}\nfun evil() {}`),
			/schemaHash: expected a lowercase hex SHA-256/,
		],
		['a table listed twice', (ir) => ir.tables.push({ ...ir.tables[0] }), /is listed twice/],
		[
			'a record projection that leaves out an attribute',
			(ir) => ir.tables[0].projections.record.pop(),
			/expected every attribute/,
		],
		[
			'a clearable attribute listed twice',
			(ir) => {
				const { clearable } = ir.tables.find(
					(/** @type {any} */ t) => t.projections.clearable.length > 0,
				).projections;
				clearable.push(clearable[0]);
			},
			/clearable: expected distinct attribute names/,
		],
		[
			'a relationship that shadows a stored attribute',
			(ir) =>
				(ir.tables.find((/** @type {any} */ t) => t.relations.length > 0).relations[0].name = 'id'),
			/is also a stored attribute/,
		],
		[
			'a match scope without conditions',
			(ir) => (ir.profiles[0].tables[0].scope = { type: 'match', conditions: [] }),
			/scope: expected/,
		],
		[
			'a scope on an attribute the table does not store',
			(ir) => (ir.profiles[0].tables[0].scope.conditions[0].attribute = 'ghost'),
			/expected a scalar attribute of the table/,
		],
		[
			'a scope reference without a field',
			(ir) => (ir.profiles[0].tables[0].scope.conditions[0].field = ''),
			/expected an equals condition/,
		],
		[
			'a fractional retention',
			(ir) => (ir.profiles[0].retentionMs = 1.5),
			/retentionMs: expected a positive integer/,
		],
		[
			'a table hash that does not match the table',
			(ir) => (ir.tables[0].attributes[1].type = { kind: 'scalar', scalar: 'ID' }),
			/tables\[0\]\.hash: does not match the table/,
		],
		[
			'a reserved type name',
			(ir) => (ir.tables[0].typeName = 'HarperValue'),
			/"HarperValue" is reserved/,
		],
		[
			'a read-only flag that contradicts the attribute',
			(ir) => {
				const order = ir.tables.find((/** @type {any} */ t) => t.name === 'Order');
				order.attributes.find((/** @type {any} */ a) => a.computed).readOnly = false;
			},
			/readOnly: must hold exactly for server-managed and computed attributes/,
		],
		[
			'an affinity that contradicts the attribute type',
			(ir) => (ir.tables[0].storage.columns[0].affinity = 'INTEGER'),
			/affinity: does not match the attribute type/,
		],
		[
			'projections that do not follow from the attributes',
			(ir) => ir.tables[0].projections.insert.pop(),
			/projections: do not follow from the attributes/,
		],
		[
			'a schema hash that does not match the tables',
			(ir) => (ir.schemaHash = ir.tables[0].hash),
			/\$\.schemaHash: does not match the tables/,
		],
		[
			'a profile hash that does not match the profile',
			(ir) => (ir.profiles[0].retentionMs += 1),
			/profiles\[0\]\.hash: does not match the profile/,
		],
		[
			'a hello-frame hash that does not match the profile tables',
			(ir) => (ir.profiles[0].schemaHash = ir.schemaHash),
			/profiles\[0\]\.schemaHash: does not match/,
		],
	];
	it.each(corruptions)('rejects %s', (_, corrupt, message) => {
		const ir = validIR();
		corrupt(ir);
		expect(() => assertSchemaIR(ir)).toThrow(message);
	});

	it('rejects values that are not an IR at all', () => {
		expect(() => assertSchemaIR(null)).toThrow(/expected an object/);
		expect(() => assertSchemaIR([])).toThrow(/expected an object/);
	});
});
