import { describe, expect, it } from 'vitest';
import {
	coverageTables,
	coverageTypes,
	spikeProfiles,
	spikeTables,
} from '../../test/fixtures/clientSchema.js';
import { buildSchemaIR } from './buildSchemaIR.js';
import { diffSchemaIR } from './diffSchemaIR.js';

/**
 * @param {(tables: any[], types: Map<string, any>) => void} [mutate]
 * @param {unknown} [syncProfiles]
 */
function irOf(mutate, syncProfiles = spikeProfiles()) {
	const tables = [...spikeTables(), ...coverageTables()];
	const types = coverageTypes();
	mutate?.(tables, types);
	return buildSchemaIR({ tables, types, syncProfiles });
}

/**
 * @param {any[]} tables
 * @param {string} name
 */
function find(tables, name) {
	return tables.find((table) => table.tableName === name);
}

/**
 * @param {(tables: any[], types: Map<string, any>) => void} mutate
 */
function diffAfter(mutate) {
	return diffSchemaIR(irOf(), irOf(mutate));
}

describe('diffSchemaIR', () => {
	it('reports identical schemas', () => {
		const result = diffSchemaIR(irOf(), irOf());
		expect(result.compatibility).toEqual({
			read: 'identical',
			write: 'identical',
			storage: 'identical',
		});
		expect(result.changes).toEqual([]);
		expect(result.delta).toEqual({ addedTables: [], tables: [] });
	});

	it('treats an added table as additive and ships its storage', () => {
		const result = diffAfter((tables) =>
			tables.push({
				tableName: 'Review',
				primaryKey: 'id',
				attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
			}),
		);
		expect(result.compatibility).toEqual({
			read: 'additive',
			write: 'additive',
			storage: 'additive',
		});
		expect(result.delta.addedTables).toEqual([
			{
				database: 'data',
				table: 'Review',
				storage: {
					versionColumn: '_version',
					extraColumn: '_extra',
					columns: [{ name: 'id', affinity: 'TEXT' }],
				},
			},
		]);
	});

	it('breaks everything when a table is removed', () => {
		const result = diffAfter((tables) => tables.splice(tables.indexOf(find(tables, 'Report')), 1));
		expect(result.compatibility).toEqual({
			read: 'breaking',
			write: 'breaking',
			storage: 'breaking',
		});
		expect(result.changes).toEqual([
			expect.objectContaining({
				kind: 'tableRemoved',
				table: 'Report',
				breaks: ['read', 'write', 'storage'],
			}),
		]);
	});

	it('breaks everything when the primary key changes', () => {
		const result = diffAfter((tables) => {
			const report = find(tables, 'Report');
			report.attributes[0].isPrimaryKey = false;
			report.attributes[1].isPrimaryKey = true;
			report.primaryKey = 'title';
		});
		expect(result.changes).toEqual([
			expect.objectContaining({ kind: 'primaryKeyChanged', breaks: ['read', 'write', 'storage'] }),
		]);
	});

	it('treats a nullable attribute added to an unsealed table as additive and ships the column', () => {
		const result = diffAfter((tables) =>
			find(tables, 'Product').attributes.push({ name: 'sku', type: 'String', indexed: {} }),
		);
		expect(result.compatibility).toEqual({
			read: 'additive',
			write: 'additive',
			storage: 'additive',
		});
		expect(result.delta.tables).toEqual([
			{
				database: 'data',
				table: 'Product',
				addColumns: [{ name: 'sku', affinity: 'TEXT' }],
				extraColumn: null,
				recompute: [],
			},
		]);
	});

	it('breaks writes when a required attribute is added', () => {
		const result = diffAfter((tables) =>
			find(tables, 'Product').attributes.push({ name: 'sku', type: 'String', nullable: false }),
		);
		expect(result.compatibility).toEqual({
			read: 'additive',
			write: 'breaking',
			storage: 'additive',
		});
	});

	it('breaks writes when any writable attribute is added to a sealed table', () => {
		const result = diffAfter((tables) =>
			find(tables, 'Purchase').attributes.push({ name: 'note', type: 'String' }),
		);
		expect(result.compatibility.write).toBe('breaking');
		expect(result.changes).toEqual([
			expect.objectContaining({ kind: 'attributeAdded', attribute: 'note', breaks: ['write'] }),
		]);
	});

	it('breaks reads when an attribute the old model required is removed', () => {
		const result = diffAfter((tables) => {
			const customer = find(tables, 'Customer');
			customer.attributes = customer.attributes.filter(
				(/** @type {any} */ attribute) => attribute.name !== 'name',
			);
		});
		expect(result.changes).toEqual([
			expect.objectContaining({ kind: 'attributeRemoved', attribute: 'name', breaks: ['read'] }),
		]);
	});

	it('treats removing an optional attribute from an unsealed table as additive', () => {
		const result = diffAfter((tables) => {
			const product = find(tables, 'Product');
			product.attributes = product.attributes.filter(
				(/** @type {any} */ attribute) => attribute.name !== 'category',
			);
		});
		expect(result.compatibility).toEqual({
			read: 'additive',
			write: 'additive',
			storage: 'additive',
		});
	});

	it('breaks writes when an attribute is removed from a sealed table', () => {
		const result = diffAfter((tables) => {
			const purchase = find(tables, 'Purchase');
			purchase.attributes = purchase.attributes.filter(
				(/** @type {any} */ attribute) => attribute.name !== 'customerId',
			);
		});
		expect(result.changes).toContainEqual(
			expect.objectContaining({
				kind: 'attributeRemoved',
				attribute: 'customerId',
				breaks: ['write'],
			}),
		);
	});

	it('breaks reads, writes and storage when an attribute type changes', () => {
		const result = diffAfter((tables) => (find(tables, 'Product').attributes[2].type = 'String'));
		expect(result.compatibility).toEqual({
			read: 'breaking',
			write: 'breaking',
			storage: 'breaking',
		});
		expect(result.changes.map((change) => change.kind)).toEqual([
			'attributeTypeChanged',
			'columnAffinityChanged',
		]);
	});

	it('does not break storage for a type change within the same affinity', () => {
		const result = diffAfter((tables) => (find(tables, 'Product').attributes[1].type = 'ID'));
		expect(result.compatibility).toEqual({
			read: 'breaking',
			write: 'breaking',
			storage: 'additive',
		});
	});

	it('breaks reads when an attribute the old model required becomes nullable', () => {
		const result = diffAfter((tables) => delete find(tables, 'Customer').attributes[1].nullable);
		expect(result.changes).toEqual([
			expect.objectContaining({
				kind: 'attributeBecameNullable',
				attribute: 'name',
				breaks: ['read'],
			}),
		]);
	});

	it('breaks writes when an attribute becomes required on insert', () => {
		const result = diffAfter((tables) => (find(tables, 'Product').attributes[1].nullable = false));
		expect(result.changes).toEqual([
			expect.objectContaining({ kind: 'attributeBecameRequired', breaks: ['write'] }),
		]);
		expect(result.compatibility.read).toBe('additive');
	});

	it('breaks writes when a writable attribute becomes server-managed', () => {
		const result = diffAfter(
			(tables) => (find(tables, 'Product').attributes[2].assignUpdatedTime = true),
		);
		expect(result.changes).toContainEqual(
			expect.objectContaining({ kind: 'attributeBecameReadOnly', breaks: ['write'] }),
		);
	});

	it('classifies array element nullability changes by direction', () => {
		const loosened = diffAfter(
			(tables) =>
				(find(tables, 'Customer').attributes.find(
					(/** @type {any} */ a) => a.name === 'tags',
				).elements.nullable = undefined),
		);
		expect(loosened.changes).toEqual([
			expect.objectContaining({ kind: 'elementBecameNullable', breaks: ['read'] }),
		]);
		const tightened = diffAfter(
			(tables) =>
				(find(tables, 'Customer').attributes.find(
					(/** @type {any} */ a) => a.name === 'scores',
				).elements.nullable = false),
		);
		expect(tightened.changes).toEqual([
			expect.objectContaining({ kind: 'elementBecameRequired', breaks: ['write'] }),
		]);
	});

	it('asks for a recompute when a computed expression changes', () => {
		const result = diffAfter(
			(tables) => (find(tables, 'Order').attributes[4].computedFromExpression = 'amount * 2'),
		);
		expect(result.compatibility).toEqual({
			read: 'additive',
			write: 'additive',
			storage: 'additive',
		});
		expect(result.delta.tables).toEqual([
			{
				database: 'data',
				table: 'Order',
				addColumns: [],
				extraColumn: null,
				recompute: [
					{
						attribute: 'points',
						from: 'amount * 2',
						version: "Math.round((amount || 0) * (status == 'open' ? 10 : 25))",
					},
				],
			},
		]);
	});

	it('treats an index change as additive', () => {
		const result = diffAfter((tables) => (find(tables, 'Product').attributes[1].indexed = {}));
		expect(result.compatibility).toEqual({
			read: 'additive',
			write: 'additive',
			storage: 'additive',
		});
		expect(result.changes).toEqual([expect.objectContaining({ kind: 'indexChanged', breaks: [] })]);
	});

	it('breaks writes when sealing changes, and ships the overflow column when unsealing', () => {
		const sealed = diffAfter((tables) => (find(tables, 'Product').sealed = true));
		expect(sealed.changes).toEqual([
			expect.objectContaining({ kind: 'sealedChanged', breaks: ['write'] }),
		]);
		const unsealed = diffAfter((tables) => (find(tables, 'Purchase').sealed = false));
		expect(unsealed.changes).toEqual([
			expect.objectContaining({ kind: 'sealedChanged', breaks: ['write'] }),
		]);
		expect(unsealed.delta.tables).toEqual([
			{
				database: 'coverage',
				table: 'Purchase',
				addColumns: [],
				extraColumn: '_extra',
				recompute: [],
			},
		]);
	});

	it('breaks storage when an attribute takes over a metadata column name', () => {
		const result = diffAfter((tables) =>
			find(tables, 'Product').attributes.push({ name: '_version', type: 'Int' }),
		);
		expect(result.compatibility.storage).toBe('breaking');
		expect(result.changes).toContainEqual(
			expect.objectContaining({ kind: 'metadataColumnMoved', breaks: ['storage'] }),
		);
		expect(result.delta.tables).toEqual([]);
	});

	it('applies the attribute rules inside nested types, which are never sealed', () => {
		const added = diffAfter((_, types) =>
			types.get('Address').attributes.push({ name: 'zip', type: 'String' }),
		);
		expect(added.compatibility).toEqual({
			read: 'additive',
			write: 'additive',
			storage: 'additive',
		});
		const required = diffAfter((_, types) =>
			types.get('Address').attributes.push({ name: 'zip', type: 'String', nullable: false }),
		);
		expect(required.changes).toEqual([
			expect.objectContaining({
				kind: 'nestedAttributeAdded',
				attribute: 'address',
				path: 'address.zip',
				breaks: ['write'],
			}),
		]);
		const retyped = diffAfter((_, types) => (types.get('Geo').attributes[0].type = 'String'));
		expect(retyped.changes).toEqual([
			expect.objectContaining({
				kind: 'attributeTypeChanged',
				path: 'address.geo.lat',
				breaks: ['read', 'write'],
			}),
		]);
		expect(retyped.compatibility.storage).toBe('additive');
	});

	it('reports relation changes without breaking anything', () => {
		const result = diffAfter((tables) => {
			const purchase = find(tables, 'Purchase');
			purchase.attributes = purchase.attributes.filter(
				(/** @type {any} */ attribute) => attribute.name !== 'customer',
			);
		});
		expect(result.changes).toEqual([
			expect.objectContaining({ kind: 'relationsChanged', breaks: [] }),
		]);
	});

	it('reports type renames as source changes', () => {
		const before = irOf();
		const after = irOf();
		const customer = after.tables.find((table) => table.name === 'Customer');
		if (customer) customer.typeName = 'Buyer';
		expect(diffSchemaIR(before, after).source).toEqual([
			{ kind: 'typeRenamed', name: 'coverage.Customer', from: 'coverage_Customer', to: 'Buyer' },
		]);
	});

	it('reports profile additions, removals and changes', () => {
		const result = diffSchemaIR(
			irOf(),
			irOf(undefined, {
				profiles: {
					storefront: { retention: '7d', tables: ['Product'] },
					reports: { tables: ['Report'] },
				},
			}),
		);
		expect(result.profiles).toEqual([
			{ kind: 'removed', name: 'my-orders' },
			{ kind: 'added', name: 'reports' },
			{ kind: 'changed', name: 'storefront' },
		]);
	});

	it('rejects an IR it cannot read', () => {
		expect(() => diffSchemaIR({ ...irOf(), irVersion: 99 }, irOf())).toThrow(/irVersion/);
	});
});
