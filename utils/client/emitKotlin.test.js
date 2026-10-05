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
import { emitKotlinModule } from './emitKotlin.js';

const ir = buildSchemaIR({
	tables: [...spikeTables(), ...coverageTables(), ...adversarialTables()],
	types: coverageTypes(),
	syncProfiles: spikeProfiles(),
	generator: '@harperfast/schema-codegen@test',
});
const files = emitKotlinModule(ir, { packageName: 'dev.harper.in.models' });
const source = (/** @type {string} */ name) => {
	const file = files.find((candidate) => candidate.path.endsWith(name));
	if (!file) throw new Error(`no ${name}`);
	return file.content;
};
const models = source('Models.kt');

/**
 * @param {string} className
 */
function dataClass(className) {
	const start = models.indexOf(`public data class ${className}(`);
	if (start < 0) throw new Error(`no class ${className}`);
	const next = models.indexOf('\n/** ', start + 1);
	return models.slice(start, next < 0 ? undefined : next);
}

describe('emitKotlinModule', () => {
	it('lays out a Kotlin module under the package path with a user-owned build script', () => {
		expect(files.map((file) => [file.path, file.scaffold])).toEqual([
			['build.gradle.kts', true],
			['src/main/kotlin/dev/harper/in/models/HarperRuntime.kt', false],
			['src/main/kotlin/dev/harper/in/models/HarperSchema.kt', false],
			['src/main/kotlin/dev/harper/in/models/Models.kt', false],
		]);
	});

	it('escapes keyword package segments and refuses package names that are not identifiers', () => {
		for (const file of files.filter((candidate) => !candidate.scaffold)) {
			expect(file.content).toContain('\npackage dev.harper.`in`.models\n');
			expect(file.content.startsWith(GENERATED_MARKER)).toBe(true);
		}
		expect(() => emitKotlinModule(ir, { packageName: 'dev/../escape' })).toThrow(
			/dot-separated identifiers/,
		);
		expect(() => emitKotlinModule(ir, { packageName: 'dev..models' })).toThrow(
			/dot-separated identifiers/,
		);
	});

	it('generates the spike model shape as a data class with a decoding companion', () => {
		const product = dataClass('Product');
		expect(product).toContain('\tpublic val id: String,\n');
		expect(product).toContain('\tpublic val price: Double? = null,\n');
		expect(product).toContain('\toverride val _version: Double? = null,\n');
		expect(product).toContain('\tpublic val _extra: Map<String, HarperValue> = emptyMap(),\n');
		expect(product).toContain('public companion object : HarperTable<Product> {');
		expect(product).toContain(
			'price = row.harperOptional("price", "Product", HarperConverters.double),',
		);
	});

	it('maps every Harper type to its Kotlin type and converter', () => {
		const customer = dataClass('coverage_Customer');
		for (const declaration of [
			'public val tags: List<String>? = null',
			'public val scores: List<Int?>? = null',
			'public val big: BigInteger? = null',
			'public val raw: ByteArray? = null',
			'public val meta: HarperValue? = null',
			'public val visits: Long? = null',
			'public val createdAt: Instant,',
			'scores = row.harperOptional("scores", "coverage_Customer", nullableIntListConverter),',
			'address = row.harperOptional("address", "coverage_Customer", Address),',
		]) {
			expect(customer).toContain(declaration);
		}
		expect(models).toContain('import java.math.BigInteger\n');
		expect(models).toContain('import java.time.Instant\n');
	});

	it('keeps members from shadowing the runtime and generated types their bodies name', () => {
		const weird = dataClass('Weird');
		expect(weird).toContain('public val HarperConverters_2: List<String?>? = null,');
		expect(weird).toContain('public val Address_2: Address? = null,');
		expect(weird).toContain('put("Address", Address.encode(it))');
		expect(models).toContain('public data class ModelsKtRecord(');
	});

	it('builds each list converter once, as a file-level value no member can shadow', () => {
		expect(models).toContain(
			'private val nullableIntListConverter = HarperConverters.list(HarperConverters.nullable(HarperConverters.int))\n',
		);
		expect(models).toContain('private val nodeListConverter = HarperConverters.list(Node)\n');
		expect(models.match(/private val stringListConverter = /g)).toHaveLength(1);
		expect(models).not.toMatch(/\(HarperConverters\.list\(/);
	});

	it('compares ByteArray attributes by content', () => {
		const customer = dataClass('coverage_Customer');
		expect(customer).toContain('override fun equals(other: Any?): Boolean {');
		expect(customer).toContain('this.raw.contentEquals(other.raw)');
		expect(customer).toContain('(this.raw?.contentHashCode() ?: 0)');
		expect(dataClass('Product')).not.toContain('override fun equals');
	});

	it('qualifies property reads inside map builders', () => {
		expect(dataClass('Product')).toContain(
			'this@Product.price?.let { put("price", HarperConverters.double.encode(it)) }',
		);
	});

	it('refuses full replacement for tables with a Blob attribute', () => {
		expect(dataClass('coverage_Attachment')).toContain(
			'throw HarperEncodingError.ReplacementUnsupported("coverage_Attachment", "file")',
		);
	});

	it('escapes keywords, soft keywords in enum entries, and $ in strings', () => {
		const weird = dataClass('Weird');
		expect(weird).toContain('public val `in`: Boolean? = null,');
		expect(weird).toContain('public val value: HarperValue? = null,');
		expect(weird).toContain('\t\t\t`value`("value"),\n');
		expect(weird).toContain('"o\\"conn\\\\or \\$x"');
	});

	it('names one constant per profile', () => {
		const schema = source('HarperSchema.kt');
		expect(schema).toContain(
			'public val profiles: List<HarperSyncProfile> = listOf(HarperProfiles.myOrders, HarperProfiles.storefront)',
		);
		expect(schema).toContain('direction = HarperSyncProfile.Direction.PULL,');
		expect(schema).toContain('retentionMs = 2592000000L,');
		expect(schema).toContain(`public const val SCHEMA_HASH: String = "${ir.schemaHash}"`);
	});

	it('gives profiles whose names sanitize alike their own constants', () => {
		const schema =
			emitKotlinModule(
				buildSchemaIR({
					tables: spikeTables(),
					syncProfiles: {
						profiles: { 'my-orders': { tables: ['Order'] }, myOrders: { tables: ['Order'] } },
					},
				}),
			).find((file) => file.path.endsWith('HarperSchema.kt'))?.content ?? '';
		expect(schema).toContain('listOf(HarperProfiles.myOrders_2, HarperProfiles.myOrders)');
		expect(schema).toContain(
			'public val myOrders_2: HarperSyncProfile = HarperSyncProfile(\n\t\tname = "my-orders",',
		);
		expect(schema).toContain(
			'public val myOrders: HarperSyncProfile = HarperSyncProfile(\n\t\tname = "myOrders",',
		);
	});

	it('keeps the runtime package in step with the models', () => {
		const runtime = source('HarperRuntime.kt');
		expect(runtime).not.toContain('package harper.models');
		expect(runtime).toContain('public sealed interface HarperValue');
	});
});
