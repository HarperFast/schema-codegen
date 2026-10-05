/**
 * Live-table-shaped fixtures for client codegen tests: the device-sync spike's tables, a coverage
 * database exercising every attribute kind, and adversarial names. Attribute objects mirror what
 * Harper puts on `Table.attributes` (verified against a 5.3 instance): nested object types appear
 * only by name and resolve through the GraphQL type registry passed as `types`.
 */

/** @returns {any[]} */
export function spikeTables() {
	return [
		{
			tableName: 'Product',
			databaseName: 'data',
			primaryKey: 'id',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'name', type: 'String' },
				{ name: 'price', type: 'Float' },
				{ name: 'category', type: 'String', indexed: {} },
			],
		},
		{
			tableName: 'Order',
			databaseName: 'data',
			primaryKey: 'id',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'customerId', type: 'ID', indexed: {} },
				{ name: 'status', type: 'String', indexed: {} },
				{ name: 'amount', type: 'Float' },
				{
					name: 'points',
					type: 'Float',
					computed: { from: () => 0 },
					computedFromExpression: "Math.round((amount || 0) * (status == 'open' ? 10 : 25))",
					version: "Math.round((amount || 0) * (status == 'open' ? 10 : 25))",
				},
			],
		},
		{
			tableName: 'Report',
			databaseName: 'data',
			primaryKey: 'id',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'title', type: 'String' },
				{ name: 'body', type: 'String' },
			],
		},
	];
}

/** @returns {any[]} */
export function coverageTables() {
	return [
		{
			tableName: 'Customer',
			databaseName: 'coverage',
			primaryKey: 'id',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'name', type: 'String', nullable: false },
				{ name: 'email', type: 'String', indexed: {} },
				{ name: 'createdAt', type: 'Date', assignCreatedTime: true },
				{ name: 'updatedAt', type: 'Float', assignUpdatedTime: true },
				{
					name: 'purchases',
					type: 'array',
					relationship: { to: 'customerId' },
					relationshipReference: { database: 'coverage', table: 'Purchase' },
					elements: { type: 'Purchase' },
				},
				{ name: 'address', type: 'Address' },
				{ name: 'tags', type: 'array', elements: { type: 'String', nullable: false } },
				{ name: 'scores', type: 'array', elements: { type: 'Int' } },
				{ name: 'big', type: 'BigInt' },
				{ name: 'raw', type: 'Bytes' },
				{ name: 'meta', type: 'Any' },
				{ name: 'visits', type: 'Long' },
				{ name: 'active', type: 'Boolean' },
				{ name: 'tree', type: 'Node' },
			],
		},
		{
			tableName: 'Purchase',
			databaseName: 'coverage',
			primaryKey: 'id',
			sealed: true,
			attributes: [
				{ name: 'id', type: 'Long', isPrimaryKey: true },
				{ name: 'customerId', type: 'ID', indexed: {} },
				{
					name: 'customer',
					type: 'Customer',
					relationship: { from: 'customerId' },
					relationshipReference: { database: 'coverage', table: 'Customer' },
				},
				{ name: 'total', type: 'Float', nullable: false },
				{
					name: 'lines',
					type: 'array',
					nullable: false,
					elements: { type: 'PurchaseLine', nullable: false },
				},
			],
		},
		{
			tableName: 'Attachment',
			databaseName: 'coverage',
			primaryKey: 'id',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'label', type: 'String' },
				{ name: 'file', type: 'Blob' },
			],
		},
	];
}

/** @returns {any[]} */
export function adversarialTables() {
	return [
		{
			tableName: 'Weird',
			databaseName: 'data',
			primaryKey: 'id',
			attributes: [
				{ name: 'id', type: 'ID', isPrimaryKey: true },
				{ name: 'default', type: 'String' },
				{ name: 'first-name', type: 'String' },
				{ name: 'firstName', type: 'String' },
				{ name: '_extra', type: 'String' },
				{ name: '_version', type: 'Int' },
				{ name: 'encodeRow', type: 'Int' },
				{ name: 'Type', type: 'Int' },
				{ name: 'self', type: 'String' },
				{ name: 'row', type: 'String' },
				{ name: 'version', type: 'Long' },
				{ name: 'value', type: 'Any' },
				{ name: 'in', type: 'Boolean' },
				{ name: 'o"conn\\or $x', type: 'String' },
				{ name: '9lives', type: 'Boolean', nullable: false },
			],
		},
		{
			tableName: 'Data',
			databaseName: 'data',
			primaryKey: 'key',
			attributes: [
				{ name: 'key', type: 'String', isPrimaryKey: true },
				{ name: 'id', type: 'Int' },
			],
		},
		{
			tableName: 'OnlyId',
			databaseName: 'data',
			primaryKey: 'id',
			attributes: [{ name: 'id', type: 'ID', isPrimaryKey: true }],
		},
		{
			tableName: 'SkuItems',
			databaseName: 'data',
			primaryKey: 'sku',
			attributes: [
				{ name: 'sku', type: 'String', isPrimaryKey: true },
				{ name: 'quantity', type: 'Int', nullable: false },
			],
		},
	];
}

/** The GraphQL type registry (`resources.allTypes`) for the coverage database. */
export function coverageTypes() {
	return new Map([
		[
			'Address',
			{
				attributes: [
					{ name: 'street', type: 'String' },
					{ name: 'city', type: 'String', nullable: false },
					{ name: 'geo', type: 'Geo' },
				],
			},
		],
		[
			'Geo',
			{
				attributes: [
					{ name: 'lat', type: 'Float' },
					{ name: 'lng', type: 'Float' },
				],
			},
		],
		[
			'PurchaseLine',
			{
				attributes: [
					{ name: 'sku', type: 'String', nullable: false },
					{ name: 'qty', type: 'Int' },
					{ name: 'note', type: 'String' },
				],
			},
		],
		[
			'Node',
			{
				attributes: [
					{ name: 'label', type: 'String' },
					{ name: 'parent', type: 'Node' },
					{ name: 'children', type: 'array', elements: { type: 'Node', nullable: false } },
				],
			},
		],
		['Customer', { table: 'Customer', database: 'coverage', attributes: [] }],
		['Purchase', { table: 'Purchase', database: 'coverage', attributes: [] }],
	]);
}

/** The spike's `profiles.js`, in `sync.yaml` form. */
export function spikeProfiles() {
	return {
		profiles: {
			storefront: { retention: '14d', tables: ['Product'] },
			'my-orders': { retention: '30d', scope: { customerId: '$user.username' }, tables: ['Order'] },
		},
	};
}
