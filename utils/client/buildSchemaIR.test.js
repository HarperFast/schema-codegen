import { describe, expect, it } from 'vitest';
import {
	adversarialTables,
	coverageTables,
	coverageTypes,
	sharedChain,
	spikeProfiles,
	spikeTables,
} from '../../test/fixtures/clientSchema.js';
import { buildSchemaIR, IR_VERSION } from './buildSchemaIR.js';
import { serializeSchemaIR } from './clientOutputs.js';
import { assertSchemaIR } from './validateSchemaIR.js';

/**
 * @param {any[]} tables
 * @param {Partial<Parameters<typeof buildSchemaIR>[0]>} [rest]
 */
function build(tables, rest = {}) {
	const ir = buildSchemaIR({ tables, types: coverageTypes(), ...rest });
	assertSchemaIR(ir);
	return ir;
}

/**
 * @param {import('./irTypes.js').SchemaIR} ir
 * @param {string} name
 */
function table(ir, name) {
	const found = ir.tables.find((candidate) => candidate.name === name);
	if (!found) throw new Error(`no table ${name}`);
	return found;
}

/**
 * @param {import('./irTypes.js').IRTable} irTable
 * @param {string} name
 */
function attribute(irTable, name) {
	const found = irTable.attributes.find((candidate) => candidate.name === name);
	if (!found) throw new Error(`no attribute ${name}`);
	return found;
}

describe('buildSchemaIR', () => {
	const ir = build([...spikeTables(), ...coverageTables(), ...adversarialTables()], {
		syncProfiles: spikeProfiles(),
	});

	it('sorts tables by database then name and records the IR version', () => {
		expect(ir.irVersion).toBe(IR_VERSION);
		expect(ir.tables.map((entry) => `${entry.database}.${entry.name}`)).toEqual([
			'coverage.Attachment',
			'coverage.Customer',
			'coverage.Purchase',
			'data.Data',
			'data.ModelsKt',
			'data.OnlyId',
			'data.Order',
			'data.Product',
			'data.Report',
			'data.SkuItems',
			'data.Weird',
		]);
	});

	describe('nullability (undefined means nullable)', () => {
		const customer = table(ir, 'Customer');

		it('makes plain attributes optional and `!` attributes required', () => {
			expect(attribute(customer, 'email').nullable).toBe(true);
			expect(attribute(customer, 'name').nullable).toBe(false);
		});

		it('requires the primary key and server-managed timestamps on read', () => {
			expect(attribute(customer, 'id').nullable).toBe(false);
			expect(attribute(customer, 'createdAt')).toMatchObject({
				nullable: false,
				serverManaged: 'createdTime',
				readOnly: true,
			});
			expect(attribute(customer, 'updatedAt')).toMatchObject({
				nullable: false,
				serverManaged: 'updatedTime',
				readOnly: true,
			});
		});

		it('keeps computed attributes optional and read-only, with their expression', () => {
			expect(attribute(table(ir, 'Order'), 'points')).toMatchObject({
				nullable: true,
				readOnly: true,
				computed: {
					from: "Math.round((amount || 0) * (status == 'open' ? 10 : 25))",
					version: "Math.round((amount || 0) * (status == 'open' ? 10 : 25))",
				},
			});
		});

		it('applies the same rule to array elements', () => {
			expect(attribute(customer, 'tags').type).toEqual({
				kind: 'array',
				element: { kind: 'scalar', scalar: 'String' },
				elementNullable: false,
			});
			expect(attribute(customer, 'scores').type).toEqual({
				kind: 'array',
				element: { kind: 'scalar', scalar: 'Int' },
				elementNullable: true,
			});
		});

		it('reads a required Blob as optional but keeps it required, and warns that inserts fail', () => {
			const withRequiredBlob = build([
				{
					tableName: 'Files',
					primaryKey: 'id',
					attributes: [
						{ name: 'id', type: 'ID', isPrimaryKey: true },
						{ name: 'file', type: 'Blob', nullable: false },
					],
				},
			]);
			const files = table(withRequiredBlob, 'Files');
			expect(attribute(files, 'file').nullable).toBe(false);
			expect(files.projections.record).toContainEqual({ name: 'file', optional: true });
			expect(withRequiredBlob.diagnostics).toContainEqual(
				expect.objectContaining({ code: 'BLOB_REQUIRED', table: 'Files', attribute: 'file' }),
			);
		});

		it('treats @embed and @decide outputs and legacy timestamps as server-written', () => {
			const derived = build([
				{
					tableName: 'Docs',
					primaryKey: 'id',
					attributes: [
						{ name: 'id', type: 'ID', isPrimaryKey: true },
						{ name: 'body', type: 'String' },
						{
							name: 'vector',
							type: 'array',
							elements: { type: 'Float' },
							embed: { source: 'body', model: 'm' },
						},
						{
							name: 'label',
							type: 'String',
							decide: { source: 'body', confidence: 'labelConfidence', decision: 'labelDecision' },
						},
						{ name: 'labelConfidence', type: 'Float' },
						{ name: 'labelDecision', type: 'String' },
						{ name: '__createdtime__', type: 'Float' },
					],
				},
			]);
			const docs = table(derived, 'Docs');
			for (const name of ['vector', 'label', 'labelConfidence', 'labelDecision']) {
				expect(attribute(docs, name)).toMatchObject({
					serverManaged: 'derived',
					readOnly: true,
					nullable: true,
				});
			}
			expect(attribute(docs, '__createdtime__')).toMatchObject({
				serverManaged: 'createdTime',
				nullable: false,
			});
			expect(docs.projections.insert.map((field) => field.name)).toEqual(['id', 'body']);
		});
	});

	describe('projections (the defineTable rules)', () => {
		const customer = table(ir, 'Customer');

		it('reads every stored attribute and never includes relations', () => {
			expect(customer.projections.record.map((field) => field.name)).not.toContain('purchases');
			expect(customer.projections.record.find((field) => field.name === 'name')).toEqual({
				name: 'name',
				optional: false,
			});
		});

		it('inserts writable attributes with the primary key optional', () => {
			expect(customer.projections.insert).toContainEqual({ name: 'id', optional: true });
			expect(customer.projections.insert).toContainEqual({ name: 'name', optional: false });
			expect(customer.projections.insert.map((field) => field.name)).not.toContain('createdAt');
		});

		it('upserts writable attributes with the primary key required', () => {
			expect(customer.projections.upsert).toContainEqual({ name: 'id', optional: false });
			expect(customer.projections.upsert?.map((field) => field.name)).not.toContain('updatedAt');
		});

		it('patches writable non-key attributes, all optional, and lists the clearable ones', () => {
			expect(customer.projections.patch.map((field) => field.name)).toEqual([
				'name',
				'email',
				'address',
				'tags',
				'scores',
				'big',
				'raw',
				'meta',
				'visits',
				'active',
				'tree',
			]);
			expect(customer.projections.patch.every((field) => field.optional)).toBe(true);
			expect(customer.projections.clearable).not.toContain('name');
			expect(customer.projections.clearable).toContain('email');
		});

		it('queries indexed attributes only', () => {
			expect(customer.projections.query).toEqual([{ name: 'email', optional: true }]);
		});

		it('keeps Blob attributes out of every write and makes full replacement unavailable', () => {
			const attachment = table(ir, 'Attachment');
			expect(attachment.projections.unwritable).toEqual(['file']);
			expect(attachment.projections.upsert).toBeNull();
			expect(attachment.projections.insert.map((field) => field.name)).toEqual(['id', 'label']);
			expect(attachment.projections.patch.map((field) => field.name)).toEqual(['label']);
		});
	});

	describe('nested types and relations', () => {
		it('resolves nested object types through the type registry, transitively', () => {
			expect(attribute(table(ir, 'Customer'), 'address').type).toEqual({
				kind: 'object',
				type: 'Address',
			});
			expect(ir.types.map((type) => type.name)).toEqual(['Address', 'Geo', 'Node', 'PurchaseLine']);
			const address = /** @type {import('./irTypes.js').IRObjectType} */ (
				ir.types.find((type) => type.name === 'Address')
			);
			expect(address.attributes).toEqual([
				{ name: 'street', type: { kind: 'scalar', scalar: 'String' }, nullable: true },
				{ name: 'city', type: { kind: 'scalar', scalar: 'String' }, nullable: false },
				{ name: 'geo', type: { kind: 'object', type: 'Geo' }, nullable: true },
			]);
		});

		it('records relationships from GraphQL references without storing them', () => {
			expect(table(ir, 'Purchase').relations).toEqual([
				{
					name: 'customer',
					cardinality: 'one',
					from: 'customerId',
					target: { database: 'coverage', table: 'Customer' },
				},
			]);
			expect(table(ir, 'Customer').relations).toEqual([
				{
					name: 'purchases',
					cardinality: 'many',
					to: 'customerId',
					target: { database: 'coverage', table: 'Purchase' },
				},
			]);
			expect(table(ir, 'Purchase').storage.columns.map((column) => column.name)).not.toContain(
				'customer',
			);
		});

		it('resolves defineTable relation targets through the lazy table class', () => {
			const defined = build([
				...spikeTables(),
				{
					tableName: 'Note',
					primaryKey: 'id',
					attributes: [
						{ name: 'id', type: 'ID', isPrimaryKey: true },
						{ name: 'productId', type: 'ID', indexed: true, nullable: false },
						{
							name: 'product',
							relationship: { from: 'productId' },
							get type() {
								return 'Product';
							},
							definition: {
								get tableClass() {
									return { tableName: 'Product', databaseName: 'data' };
								},
							},
						},
					],
				},
			]);
			expect(table(defined, 'Note').relations).toEqual([
				{
					name: 'product',
					cardinality: 'one',
					from: 'productId',
					target: { database: 'data', table: 'Product' },
				},
			]);
			expect(defined.diagnostics).toEqual([]);
		});

		it('embeds a table-typed attribute as a record reference when that table is generated', () => {
			const embedded = build([
				...coverageTables(),
				{
					tableName: 'Snapshot',
					primaryKey: 'id',
					attributes: [
						{ name: 'id', type: 'ID', isPrimaryKey: true },
						{ name: 'buyer', type: 'Customer' },
					],
				},
			]);
			expect(attribute(table(embedded, 'Snapshot'), 'buyer').type).toEqual({
				kind: 'record',
				database: 'coverage',
				table: 'Customer',
			});
		});

		it('falls back to Any with a warning for an unknown type', () => {
			const unknown = build([
				{
					tableName: 'Things',
					primaryKey: 'id',
					attributes: [
						{ name: 'id', type: 'ID', isPrimaryKey: true },
						{ name: 'shape', type: 'Mystery' },
					],
				},
			]);
			expect(attribute(table(unknown, 'Things'), 'shape').type).toEqual({
				kind: 'scalar',
				scalar: 'Any',
			});
			expect(unknown.diagnostics).toEqual([
				expect.objectContaining({ level: 'warning', code: 'TYPE_UNRESOLVED', attribute: 'shape' }),
			]);
		});

		it('uses inline nested properties when there is no type registry', () => {
			const inline = buildSchemaIR({
				tables: [
					{
						tableName: 'Things',
						primaryKey: 'id',
						attributes: [
							{ name: 'id', type: 'ID', isPrimaryKey: true },
							{
								name: 'point',
								type: 'Point',
								properties: [{ name: 'x', type: 'Float', nullable: false }],
							},
						],
					},
				],
			});
			expect(inline.types).toEqual([
				{
					name: 'Point',
					typeName: 'Point',
					attributes: [{ name: 'x', type: { kind: 'scalar', scalar: 'Float' }, nullable: false }],
				},
			]);
		});
	});

	describe('type names', () => {
		it('singularizes, prefixes non-data databases, and avoids reserved names', () => {
			expect(table(ir, 'Customer').typeName).toBe('coverage_Customer');
			expect(table(ir, 'SkuItems').typeName).toBe('SkuItem');
			expect(table(ir, 'Data').typeName).toBe('DataRecord');
		});

		it('dedupes tables and nested types that share a name', () => {
			const clashing = build([
				{
					tableName: 'Users',
					primaryKey: 'id',
					attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
				},
				{
					tableName: 'User',
					primaryKey: 'id',
					attributes: [
						{ name: 'id', type: 'ID', isPrimaryKey: true },
						{ name: 'geo', type: 'Geo' },
					],
				},
				{
					tableName: 'Geos',
					primaryKey: 'id',
					attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
				},
			]);
			expect(clashing.tables.map((entry) => entry.typeName)).toEqual(['Geo', 'User', 'User_2']);
			expect(clashing.types.map((type) => type.typeName)).toEqual(['Geo_2']);
		});

		it('keeps names from the previous IR so an added table never renames an existing type', () => {
			const before = build([
				{
					tableName: 'Users',
					primaryKey: 'id',
					attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
				},
			]);
			expect(before.tables[0].typeName).toBe('User');
			const after = build(
				[
					{
						tableName: 'Users',
						primaryKey: 'id',
						attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
					},
					{
						tableName: 'User',
						primaryKey: 'id',
						attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
					},
				],
				{ previous: before },
			);
			expect(table(after, 'Users').typeName).toBe('User');
			expect(table(after, 'User').typeName).toBe('User_2');
		});
	});

	describe('storage', () => {
		it('maps affinities and adds version and overflow columns', () => {
			const customer = table(ir, 'Customer');
			expect(customer.storage.versionColumn).toBe('_version');
			expect(customer.storage.extraColumn).toBe('_extra');
			expect(
				Object.fromEntries(
					customer.storage.columns.map((column) => [column.name, column.affinity]),
				),
			).toEqual({
				id: 'TEXT',
				name: 'TEXT',
				email: 'TEXT',
				createdAt: 'REAL',
				updatedAt: 'REAL',
				address: 'TEXT',
				tags: 'TEXT',
				scores: 'TEXT',
				big: 'TEXT',
				raw: 'BLOB',
				meta: 'TEXT',
				visits: 'INTEGER',
				active: 'INTEGER',
				tree: 'TEXT',
			});
		});

		it('has no overflow column on sealed tables', () => {
			expect(table(ir, 'Purchase').storage.extraColumn).toBeNull();
		});

		it('moves metadata columns off attribute names', () => {
			const weird = table(ir, 'Weird');
			expect(weird.storage.versionColumn).toBe('__version');
			expect(weird.storage.extraColumn).toBe('__extra');
		});
	});

	describe('primary keys', () => {
		it('falls back to the table primaryKey when no attribute is flagged', () => {
			const unflagged = build([
				{
					tableName: 'Legacy',
					primaryKey: 'code',
					attributes: [
						{ name: 'code', type: 'String' },
						{ name: 'label', type: 'String' },
					],
				},
			]);
			expect(table(unflagged, 'Legacy').primaryKey).toBe('code');
			expect(attribute(table(unflagged, 'Legacy'), 'code')).toMatchObject({
				primaryKey: true,
				nullable: false,
			});
		});

		it('allows a table without a primary key', () => {
			const keyless = build([
				{ tableName: 'Log', attributes: [{ name: 'message', type: 'String' }] },
			]);
			expect(table(keyless, 'Log').primaryKey).toBeNull();
		});
	});

	describe('profiles', () => {
		it('lists valid profiles and records membership on tables', () => {
			expect(ir.profiles.map((profile) => profile.name)).toEqual(['my-orders', 'storefront']);
			expect(table(ir, 'Order').profiles).toEqual(['my-orders']);
			expect(table(ir, 'Report').profiles).toEqual([]);
		});

		it('hashes the profile definition and the tables it covers separately', () => {
			const changedScope = build([...spikeTables()], {
				syncProfiles: {
					profiles: {
						...spikeProfiles().profiles,
						'my-orders': {
							retention: '30d',
							scope: { customerId: '$token.sub' },
							tables: ['Order'],
						},
					},
				},
			});
			const before = /** @type {import('./irTypes.js').IRProfile} */ (
				ir.profiles.find((profile) => profile.name === 'my-orders')
			);
			const after = /** @type {import('./irTypes.js').IRProfile} */ (
				changedScope.profiles.find((profile) => profile.name === 'my-orders')
			);
			expect(after.hash).not.toBe(before.hash);
			expect(after.schemaHash).toBe(before.schemaHash);
		});
	});
});

describe('contract hashes', () => {
	const base = () => [...spikeTables(), ...coverageTables()];

	it('are byte-for-byte deterministic regardless of input order', () => {
		const forward = buildSchemaIR({
			tables: base(),
			types: coverageTypes(),
			syncProfiles: spikeProfiles(),
		});
		const reversed = buildSchemaIR({
			tables: base().reverse(),
			types: new Map([...coverageTypes()].reverse()),
			syncProfiles: {
				profiles: Object.fromEntries(Object.entries(spikeProfiles().profiles).reverse()),
			},
		});
		expect(serializeSchemaIR(reversed)).toBe(serializeSchemaIR(forward));
	});

	it('ignore attribute order, descriptions and type names', () => {
		const original = buildSchemaIR({ tables: spikeTables() });
		const shuffled = spikeTables();
		shuffled[1].attributes.reverse();
		shuffled[1].attributes[0].description = 'documentation only';
		const reordered = buildSchemaIR({ tables: shuffled });
		expect(table(reordered, 'Order').hash).toBe(table(original, 'Order').hash);
		expect(reordered.schemaHash).toBe(original.schemaHash);
	});

	/** @type {[string, (tables: any[]) => void][]} */
	const contractChanges = [
		['a type change', (tables) => (tables[0].attributes[2].type = 'String')],
		['a nullability change', (tables) => (tables[0].attributes[1].nullable = false)],
		['an index change', (tables) => (tables[0].attributes[1].indexed = {})],
		['sealing', (tables) => (tables[0].sealed = true)],
		['a new attribute', (tables) => tables[0].attributes.push({ name: 'sku', type: 'String' })],
	];
	it.each(contractChanges)('change with %s', (_, mutate) => {
		const original = buildSchemaIR({ tables: spikeTables() });
		const tables = spikeTables();
		mutate(tables);
		const changed = buildSchemaIR({ tables });
		expect(table(changed, 'Product').hash).not.toBe(table(original, 'Product').hash);
		expect(table(changed, 'Order').hash).toBe(table(original, 'Order').hash);
		expect(changed.schemaHash).not.toBe(original.schemaHash);
	});

	it('change when a computed expression changes', () => {
		const tables = spikeTables();
		tables[1].attributes[4].computedFromExpression = 'amount * 2';
		expect(table(buildSchemaIR({ tables }), 'Order').hash).not.toBe(
			table(buildSchemaIR({ tables: spikeTables() }), 'Order').hash,
		);
	});

	it('change when an embedded table changes, and survive a table that embeds itself', () => {
		const snapshot = () => ({
			tableName: 'Snapshot',
			primaryKey: 'id',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'buyer', type: 'Customer' },
			],
		});
		const original = buildSchemaIR({
			tables: [...coverageTables(), snapshot()],
			types: coverageTypes(),
		});
		const changedTables = coverageTables();
		changedTables[0].attributes.push({ name: 'nickname', type: 'String' });
		changedTables[0].attributes.push({ name: 'referrer', type: 'Customer' });
		const changed = buildSchemaIR({
			tables: [...changedTables, snapshot()],
			types: coverageTypes(),
		});
		expect(table(changed, 'Snapshot').hash).not.toBe(table(original, 'Snapshot').hash);
		expect(table(changed, 'Purchase').hash).toBe(table(original, 'Purchase').hash);
	});

	it('change when an embedded table is sealed', () => {
		const snapshot = () => ({
			tableName: 'Snapshot',
			primaryKey: 'id',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'buyer', type: 'Customer' },
			],
		});
		const original = buildSchemaIR({
			tables: [...coverageTables(), snapshot()],
			types: coverageTypes(),
		});
		const sealed = coverageTables();
		sealed[0].sealed = true;
		const changed = buildSchemaIR({ tables: [...sealed, snapshot()], types: coverageTypes() });
		expect(table(changed, 'Snapshot').hash).not.toBe(table(original, 'Snapshot').hash);
	});

	it('change when a Blob becomes required', () => {
		const tables = coverageTables();
		tables[2].attributes[2].nullable = false;
		const original = buildSchemaIR({ tables: coverageTables(), types: coverageTypes() });
		const changed = buildSchemaIR({ tables, types: coverageTypes() });
		expect(table(changed, 'Attachment').hash).not.toBe(table(original, 'Attachment').hash);
	});

	it('cover widely shared nested types in linear time', () => {
		const tables = [
			{
				tableName: 'Deep',
				primaryKey: 'id',
				attributes: [
					{ name: 'id', type: 'ID', isPrimaryKey: true },
					{ name: 'root', type: 'T0' },
				],
			},
		];
		const original = buildSchemaIR({ tables, types: sharedChain('String') });
		const changed = buildSchemaIR({ tables, types: sharedChain('Int') });
		expect(table(changed, 'Deep').hash).not.toBe(table(original, 'Deep').hash);
	});

	it('change when a nested type changes', () => {
		const types = coverageTypes();
		/** @type {any} */ (types.get('Geo')).attributes.push({ name: 'alt', type: 'Float' });
		const original = buildSchemaIR({ tables: coverageTables(), types: coverageTypes() });
		const changed = buildSchemaIR({ tables: coverageTables(), types });
		expect(table(changed, 'Customer').hash).not.toBe(table(original, 'Customer').hash);
		expect(table(changed, 'Purchase').hash).toBe(table(original, 'Purchase').hash);
	});
});
