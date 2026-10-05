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
