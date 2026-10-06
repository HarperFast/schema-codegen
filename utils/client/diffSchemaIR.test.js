import { describe, expect, it } from 'vitest';
import {
	coverageTables,
	coverageTypes,
	sharedChain,
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

	it('reports a removed or changed relationship without breaking anything', () => {
		const removed = diffAfter((tables) => {
			const purchase = find(tables, 'Purchase');
			purchase.attributes = purchase.attributes.filter(
				(/** @type {any} */ attribute) => attribute.name !== 'customer',
			);
		});
		expect(removed.changes).toEqual([
			expect.objectContaining({ kind: 'relationRemoved', attribute: 'customer', breaks: [] }),
		]);
		const changed = diffAfter((tables) => {
			const purchases = find(tables, 'Customer').attributes.find(
				(/** @type {any} */ attribute) => attribute.name === 'purchases',
			);
			purchases.relationship = { to: 'buyerId' };
		});
		expect(changed.changes).toEqual([
			expect.objectContaining({ kind: 'relationChanged', attribute: 'purchases', breaks: [] }),
		]);
	});

	it('breaks writes when an unsealed table gains a relationship or computed attribute older models would echo', () => {
		const relation = {
			name: 'favorite',
			type: 'Purchase',
			relationship: { from: 'favoriteId' },
			relationshipReference: { database: 'coverage', table: 'Purchase' },
		};
		const computed = { name: 'rank', type: 'Int', computed: { from: () => 1 } };
		const unsealed = diffAfter((tables) =>
			find(tables, 'Customer').attributes.push(relation, computed),
		);
		expect(unsealed.compatibility.write).toBe('breaking');
		expect(unsealed.changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'relationAdded',
					attribute: 'favorite',
					breaks: ['write'],
					message: expect.stringContaining('send it back on PUT'),
				}),
				expect.objectContaining({ kind: 'attributeAdded', attribute: 'rank', breaks: ['write'] }),
			]),
		);
		const sealed = diffAfter((tables) =>
			find(tables, 'Purchase').attributes.push({ ...relation, name: 'gift' }, computed),
		);
		expect(sealed.compatibility.write).toBe('additive');
	});

	it('breaks writes when a stored attribute becomes a relationship', () => {
		const result = diffAfter((tables) => {
			const product = find(tables, 'Product');
			const category = product.attributes.find(
				(/** @type {any} */ attribute) => attribute.name === 'category',
			);
			Object.assign(category, {
				type: 'Customer',
				indexed: undefined,
				relationship: { from: 'id' },
				relationshipReference: { database: 'coverage', table: 'Customer' },
			});
		});
		expect(result.changes).toEqual([
			expect.objectContaining({
				kind: 'attributeRemoved',
				attribute: 'category',
				breaks: ['write'],
			}),
			expect.objectContaining({ kind: 'relationAdded', attribute: 'category', breaks: [] }),
		]);
	});

	it('breaks inserts, not reads, when a Blob becomes required', () => {
		/** @param {any[]} tables */
		const requireFile = (tables) => (find(tables, 'Attachment').attributes[2].nullable = false);
		const required = diffAfter(requireFile);
		expect(required.compatibility).toEqual({
			read: 'additive',
			write: 'breaking',
			storage: 'additive',
		});
		expect(required.changes).toEqual([
			expect.objectContaining({ kind: 'attributeBecameRequired', attribute: 'file' }),
		]);
		const relaxed = diffSchemaIR(irOf(requireFile), irOf());
		expect(relaxed.compatibility).toEqual({
			read: 'additive',
			write: 'additive',
			storage: 'additive',
		});
	});

	it('breaks writes when a table stops supporting full replacement', () => {
		/** @param {any[]} tables */
		const addBlob = (tables) =>
			find(tables, 'Product').attributes.push({ name: 'manual', type: 'Blob' });
		const added = diffAfter(addBlob);
		expect(added.compatibility.write).toBe('breaking');
		expect(added.changes).toEqual([
			expect.objectContaining({ kind: 'replacementChanged', table: 'Product', breaks: ['write'] }),
			expect.objectContaining({ kind: 'attributeAdded', attribute: 'manual', breaks: [] }),
		]);
		const nested = diffAfter((_, types) =>
			types.get('Address').attributes.push({ name: 'photo', type: 'Blob' }),
		);
		expect(nested.changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'replacementChanged',
					table: 'Customer',
					breaks: ['write'],
				}),
			]),
		);
		const removed = diffSchemaIR(irOf(addBlob), irOf());
		expect(removed.compatibility.write).toBe('additive');
		expect(removed.changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'replacementChanged', table: 'Product', breaks: [] }),
			]),
		);
	});

	it('itemizes changes that alter a contract without breaking older clients', () => {
		const timestamps = diffAfter((tables) => {
			const createdAt = find(tables, 'Customer').attributes.find(
				(/** @type {any} */ attribute) => attribute.name === 'createdAt',
			);
			createdAt.assignCreatedTime = false;
			createdAt.assignUpdatedTime = true;
		});
		expect(timestamps.changes).toEqual([
			expect.objectContaining({ kind: 'serverManagedChanged', attribute: 'createdAt', breaks: [] }),
		]);
		const nested = diffAfter((_, types) =>
			types.get('Geo').attributes.push({ name: 'alt', type: 'Float' }),
		);
		expect(nested.changes).toEqual([
			expect.objectContaining({
				kind: 'nestedAttributeAdded',
				path: 'address.geo.alt',
				breaks: [],
			}),
		]);
		const snapshot = {
			tableName: 'Snapshot',
			databaseName: 'coverage',
			primaryKey: 'id',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'buyer', type: 'Customer' },
			],
		};
		const embedded = diffSchemaIR(
			irOf((tables) => tables.push({ ...snapshot })),
			irOf((tables) => {
				tables.push({ ...snapshot });
				find(tables, 'Customer').attributes.push({ name: 'nickname', type: 'String' });
			}),
		);
		expect(embedded.changes.map((change) => [change.table, change.kind])).toEqual([
			['Customer', 'attributeAdded'],
			['Snapshot', 'contractChanged'],
		]);
		const required = diffSchemaIR(
			irOf((tables) => tables.push({ ...snapshot })),
			irOf((tables) => {
				tables.push({ ...snapshot });
				find(tables, 'Customer').attributes.push({ name: 'tier', type: 'String', nullable: false });
			}),
		);
		expect(required.changes.find((change) => change.table === 'Snapshot')).toMatchObject({
			kind: 'embeddedTableChanged',
			breaks: ['write'],
		});
		const both = diffSchemaIR(
			irOf((tables) => tables.push({ ...snapshot, attributes: [...snapshot.attributes] })),
			irOf((tables) => {
				tables.push({
					...snapshot,
					attributes: [...snapshot.attributes, { name: 'takenAt', type: 'Date', indexed: {} }],
				});
				find(tables, 'Customer').attributes.push({ name: 'tier', type: 'String', nullable: false });
			}),
		);
		expect(
			both.changes.filter((change) => change.table === 'Snapshot').map((change) => change.kind),
		).toEqual(['attributeAdded', 'embeddedTableChanged']);
	});

	it('keeps tables whose names contain dots apart', () => {
		/** @param {string} database @param {string} name */
		const only = (database, name) =>
			buildSchemaIR({
				tables: [
					{
						tableName: name,
						databaseName: database,
						primaryKey: 'id',
						attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
					},
				],
			});
		const result = diffSchemaIR(only('a.b', 'c'), only('a', 'b.c'));
		expect(result.changes.map((change) => change.kind)).toEqual(['tableAdded', 'tableRemoved']);
	});

	it('compares widely shared nested types once per table', () => {
		/** @param {string} leafType */
		const deep = (leafType) =>
			buildSchemaIR({
				tables: [
					{
						tableName: 'Deep',
						primaryKey: 'id',
						attributes: [
							{ name: 'id', type: 'ID', isPrimaryKey: true },
							{ name: 'root', type: 'T0' },
						],
					},
				],
				types: sharedChain(leafType),
			});
		const result = diffSchemaIR(deep('String'), deep('Int'));
		expect(result.changes).toEqual([
			expect.objectContaining({
				kind: 'attributeTypeChanged',
				path: `root${'.left'.repeat(39)}.leaf`,
				breaks: ['read', 'write'],
			}),
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
