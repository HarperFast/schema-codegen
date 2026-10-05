import { describe, expect, it } from 'vitest';
import {
	adversarialTables,
	coverageTables,
	coverageTypes,
	spikeProfiles,
	spikeTables,
} from '../../test/fixtures/clientSchema.js';
import { buildSchemaIR } from './buildSchemaIR.js';
import { GENERATED_MARKER } from './emitSupport.js';
import { emitSwiftPackage } from './emitSwift.js';

const ir = buildSchemaIR({
	tables: [...spikeTables(), ...coverageTables(), ...adversarialTables()],
	types: coverageTypes(),
	syncProfiles: { profiles: { ...spikeProfiles().profiles, init: { tables: ['OnlyId'] } } },
	generator: '@harperfast/schema-codegen@test',
});
const files = emitSwiftPackage(ir);
const source = (/** @type {string} */ name) => {
	const file = files.find((candidate) => candidate.path.endsWith(name));
	if (!file) throw new Error(`no ${name}`);
	return file.content;
};
const models = source('Models.swift');

/**
 * @param {string} typeName
 */
function struct(typeName) {
	const start = models.indexOf(`public struct ${typeName}: `);
	if (start < 0) throw new Error(`no struct ${typeName}`);
	const next = models.indexOf('\n/// ', start + 1);
	return models.slice(start, next < 0 ? undefined : next);
}

describe('emitSwiftPackage', () => {
	it('lays out a Swift package with a user-owned manifest', () => {
		expect(files.map((file) => [file.path, file.scaffold])).toEqual([
			['Package.swift', true],
			['Sources/HarperModels/HarperRuntime.swift', false],
			['Sources/HarperModels/HarperSchema.swift', false],
			['Sources/HarperModels/Models.swift', false],
		]);
		expect(source('Package.swift')).toContain('.target(name: "HarperModels")');
	});

	it('marks every generated source with the generator and schema hash', () => {
		for (const file of files.filter((candidate) => !candidate.scaffold)) {
			expect(
				file.content.startsWith(
					`${GENERATED_MARKER} from @harperfast/schema-codegen@test (schema ${ir.schemaHash}). Do not edit.\n`,
				),
			).toBe(true);
		}
	});

	it('honors the module name and refuses invalid or clashing ones', () => {
		expect(emitSwiftPackage(ir, { module: 'Spike' }).map((file) => file.path)).toContain(
			'Sources/Spike/Models.swift',
		);
		expect(() => emitSwiftPackage(ir, { module: '../Escape' })).toThrow(
			/must be a Swift identifier/,
		);
		expect(() => emitSwiftPackage(ir, { module: 'Order' })).toThrow(/also a generated type name/);
	});

	it('generates the spike model shape: typed columns, overflow bag and version', () => {
		const product = struct('Product');
		expect(product).toContain('public struct Product: HarperRecord, Identifiable {');
		expect(product).toContain('\tpublic let id: String\n');
		expect(product).toContain('\tpublic var name: String?\n');
		expect(product).toContain('\tpublic var price: Double?\n');
		expect(product).toContain('\tpublic let _version: Double?\n');
		expect(product).toContain('\tpublic var _extra: [String: HarperValue]\n');
		expect(product).toContain('self.price = try row.harperOptional("price", of: "Product")');
		expect(product).toContain('self._extra = row.harperExtra(excluding: Self.declaredAttributes)');
	});

	it('makes computed and server-managed attributes read-only and documents the expression', () => {
		const order = struct('Order');
		expect(order).toContain(
			"/// Computed on the client from `Math.round((amount || 0) * (status == 'open' ? 10 : 25))`.\n\tpublic let points: Double?",
		);
		const customer = struct('coverage_Customer');
		expect(customer).toContain('\tpublic let createdAt: Date\n');
		expect(customer).not.toMatch(/if let value = self\.createdAt \{ row\["createdAt"\]/);
	});

	it('maps every Harper type to its Swift type', () => {
		const customer = struct('coverage_Customer');
		for (const declaration of [
			'public var tags: [String]?',
			'public var scores: [Int?]?',
			'public var big: HarperBigInt?',
			'public var raw: Data?',
			'public var meta: HarperValue?',
			'public var visits: Int64?',
			'public var active: Bool?',
			'public var address: Address?',
			'public let updatedAt: Double',
		]) {
			expect(customer).toContain(declaration);
		}
	});

	it('leaves the overflow bag off sealed tables', () => {
		expect(struct('coverage_Purchase')).not.toContain('_extra');
	});

	it('refuses full replacement for tables with a Blob attribute', () => {
		const attachment = struct('coverage_Attachment');
		expect(attachment).toContain('public let file: HarperValue?');
		expect(attachment).toContain(
			'throw HarperEncodingError.replacementUnsupported(type: "coverage_Attachment", attribute: "file")',
		);
		expect(attachment).toContain('replaceable: false');
	});

	it('emits insert and patch types, with clear only for nullable attributes, and skips empty ones', () => {
		const customer = struct('coverage_Customer');
		expect(customer).toContain('public struct New: HarperWritable {');
		expect(customer).toContain('public init(id: String? = nil, name: String, ');
		expect(customer).toContain('public enum Field: String, Sendable, Hashable {');
		expect(customer).not.toContain('case name = "name"');
		expect(customer).toContain('for field in self.clear { row[field.rawValue] = .null }');
		const onlyId = struct('OnlyId');
		expect(onlyId).toContain('public struct New: HarperWritable {');
		expect(onlyId).not.toContain('struct Patch');
	});

	it('keeps raw attribute names on the row while escaping and renaming properties', () => {
		const weird = struct('Weird');
		expect(weird).toContain('public var `default`: String?');
		expect(weird).toContain('public var `Type`: Int?');
		expect(weird).toContain('public var firstName_2: String?');
		expect(weird).toContain('public var _extra_2: String?');
		expect(weird).toContain('public var _version_2: Int?');
		expect(weird).toContain('public var encodeRow_2: Int?');
		expect(weird).toContain('public var self_2: String?');
		expect(weird).toContain('public var o_conn_or__x: String?');
		expect(weird).toContain('public var _9lives: Bool');
		expect(weird).toContain('row["first-name"] = value.harperValue');
		expect(weird).toContain('row["o\\"conn\\\\or $x"] = value.harperValue');
		expect(weird).toContain('extraColumn: "__extra"');
	});

	it('synthesizes Identifiable from a differently named key, and skips it when id is taken', () => {
		expect(struct('SkuItem')).toContain('public var id: String { self.sku }');
		expect(struct('DataRecord')).toMatch(/public struct DataRecord: HarperRecord \{/);
	});

	it('boxes a nested type that contains itself by value', () => {
		const node = struct('Node');
		expect(node).toContain('public var parent: HarperBox<Node>?');
		expect(node).toContain('public var children: [Node]?');
	});

	it('lists tables and named profiles in HarperSchema', () => {
		const schema = source('HarperSchema.swift');
		expect(schema).toContain(`public static let hash = "${ir.schemaHash}"`);
		expect(schema).toContain(
			'public static let profiles: [HarperSyncProfile] = [.init_2, .myOrders, .storefront]',
		);
		expect(schema).toMatch(
			/public static let myOrders = HarperSyncProfile\(name: "my-orders", direction: \.pull, retentionMs: 2592000000, schemaHash: "[0-9a-f]{64}", tables: \[Order\.schema\]\)/,
		);
	});

	it('gives profiles whose names sanitize alike their own constants', () => {
		const schema =
			emitSwiftPackage(
				buildSchemaIR({
					tables: spikeTables(),
					syncProfiles: {
						profiles: { 'my-orders': { tables: ['Order'] }, myOrders: { tables: ['Order'] } },
					},
				}),
			).find((file) => file.path.endsWith('HarperSchema.swift'))?.content ?? '';
		expect(schema).toContain(
			'public static let profiles: [HarperSyncProfile] = [.myOrders_2, .myOrders]',
		);
		expect(schema).toContain('public static let myOrders_2 = HarperSyncProfile(name: "my-orders"');
		expect(schema).toContain('public static let myOrders = HarperSyncProfile(name: "myOrders"');
	});
});
