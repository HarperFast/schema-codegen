package harper.models

import java.math.BigInteger
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.Base64
import kotlin.reflect.KClass

/** A Harper attribute value: the closed set of shapes a record can hold. */
public sealed interface HarperValue {
	public data object Null : HarperValue

	public data class BoolValue(public val value: Boolean) : HarperValue

	public data class LongValue(public val value: Long) : HarperValue

	public data class DoubleValue(public val value: Double) : HarperValue

	public data class StringValue(public val value: String) : HarperValue

	/** Bytes compared by content; the array is copied in and out, so the value stays immutable. */
	public class BytesValue(value: ByteArray) : HarperValue {
		private val bytes: ByteArray = value.copyOf()
		public val value: ByteArray get() = bytes.copyOf()

		override fun equals(other: Any?): Boolean = other is BytesValue && bytes.contentEquals(other.bytes)

		override fun hashCode(): Int = bytes.contentHashCode()

		override fun toString(): String = "BytesValue(${Base64.getEncoder().encodeToString(bytes)})"
	}

	public data class ArrayValue(public val value: List<HarperValue>) : HarperValue

	public data class ObjectValue(public val value: Map<String, HarperValue>) : HarperValue

	/** The kind name used in decoding errors. */
	public val kindName: String
		get() = when (this) {
			Null -> "null"
			is BoolValue -> "bool"
			is LongValue -> "int"
			is DoubleValue -> "double"
			is StringValue -> "string"
			is BytesValue -> "bytes"
			is ArrayValue -> "array"
			is ObjectValue -> "object"
		}

	public companion object {
		/**
		 * Bridges a JVM value (maps, lists, boxed numbers, strings, byte arrays, instants) into a
		 * `HarperValue`. Instants become epoch milliseconds, the row encoding of `Date` attributes.
		 */
		public fun of(value: Any?): HarperValue = when (value) {
			null -> Null
			is HarperValue -> value
			is Boolean -> BoolValue(value)
			is Byte, is Short, is Int, is Long -> LongValue((value as Number).toLong())
			is Float, is Double -> DoubleValue((value as Number).toDouble())
			is BigInteger -> if (value.bitLength() < 64) LongValue(value.toLong()) else StringValue(value.toString())
			is String -> StringValue(value)
			is ByteArray -> BytesValue(value)
			is Instant -> HarperConverters.instant.encode(value)
			is Map<*, *> -> ObjectValue(value.entries.associate { (key, item) -> key.toString() to of(item) })
			is Iterable<*> -> ArrayValue(value.map { of(it) })
			is Array<*> -> ArrayValue(value.map { of(it) })
			else -> StringValue(value.toString())
		}
	}
}

/** A record or nested object keyed by attribute name: the logical record, undeclared attributes included. */
public typealias HarperRow = Map<String, HarperValue>

/** A conversion failure, before the type and attribute it happened in are known. */
public class HarperValueMismatch(public val expected: String, public val actual: String) :
	Exception("expected $expected but found $actual")

/** A row that does not match the generated model. */
public sealed class HarperDecodingError(message: String) : Exception(message) {
	public class MissingValue(public val type: String, public val attribute: String) :
		HarperDecodingError("$type.$attribute is required but the row has no value")

	public class TypeMismatch(
		public val type: String,
		public val attribute: String,
		public val expected: String,
		public val actual: String,
	) : HarperDecodingError("$type.$attribute expected $expected but the row has $actual")
}

/** A write the generated model refuses to encode. */
public sealed class HarperEncodingError(message: String) : Exception(message) {
	/** A full replacement (`PUT`) would delete or corrupt this attribute; update the record with a patch instead. */
	public class ReplacementUnsupported(public val type: String, public val attribute: String) :
		HarperEncodingError("$type cannot be replaced in full: $attribute has no client write contract yet; use a patch")
}

/** Converts one Kotlin type to and from a `HarperValue`. */
public interface HarperConverter<T> {
	public fun decode(value: HarperValue): T

	public fun encode(value: T): HarperValue
}

public object HarperConverters {
	public val string: HarperConverter<String> = object : HarperConverter<String> {
		override fun decode(value: HarperValue): String =
			(value as? HarperValue.StringValue)?.value ?: throw HarperValueMismatch("string", value.kindName)

		override fun encode(value: String): HarperValue = HarperValue.StringValue(value)
	}

	public val int: HarperConverter<Int> = object : HarperConverter<Int> {
		override fun decode(value: HarperValue): Int = when (value) {
			is HarperValue.LongValue ->
				if (value.value in Int.MIN_VALUE..Int.MAX_VALUE) value.value.toInt() else throw HarperValueMismatch("int", "out-of-range int")
			is HarperValue.DoubleValue ->
				value.value.toInt().takeIf { it.toDouble() == value.value } ?: throw HarperValueMismatch("int", "double")
			else -> throw HarperValueMismatch("int", value.kindName)
		}

		override fun encode(value: Int): HarperValue = HarperValue.LongValue(value.toLong())
	}

	public val long: HarperConverter<Long> = object : HarperConverter<Long> {
		override fun decode(value: HarperValue): Long = when (value) {
			is HarperValue.LongValue -> value.value
			is HarperValue.DoubleValue -> exactLong(value.value) ?: throw HarperValueMismatch("int", "double")
			else -> throw HarperValueMismatch("int", value.kindName)
		}

		override fun encode(value: Long): HarperValue = HarperValue.LongValue(value)
	}

	public val double: HarperConverter<Double> = object : HarperConverter<Double> {
		override fun decode(value: HarperValue): Double = when (value) {
			is HarperValue.DoubleValue -> value.value
			is HarperValue.LongValue -> value.value.toDouble()
			else -> throw HarperValueMismatch("double", value.kindName)
		}

		override fun encode(value: Double): HarperValue = HarperValue.DoubleValue(value)
	}

	public val boolean: HarperConverter<Boolean> = object : HarperConverter<Boolean> {
		override fun decode(value: HarperValue): Boolean = when {
			value is HarperValue.BoolValue -> value.value
			value is HarperValue.LongValue && value.value == 0L -> false
			value is HarperValue.LongValue && value.value == 1L -> true
			else -> throw HarperValueMismatch("bool", value.kindName)
		}

		override fun encode(value: Boolean): HarperValue = HarperValue.BoolValue(value)
	}

	public val instant: HarperConverter<Instant> = object : HarperConverter<Instant> {
		override fun decode(value: HarperValue): Instant = when (value) {
			is HarperValue.DoubleValue -> instantOfMillis(value.value)
			is HarperValue.LongValue ->
				if (value.value in -MAX_DATE_MILLIS..MAX_DATE_MILLIS) Instant.ofEpochMilli(value.value) else throw HarperValueMismatch("date", "out-of-range date")
			is HarperValue.StringValue ->
				try {
					Instant.parse(value.value)
				} catch (error: DateTimeParseException) {
					throw HarperValueMismatch("date", "string")
				}
			else -> throw HarperValueMismatch("date", value.kindName)
		}

		override fun encode(value: Instant): HarperValue =
			HarperValue.DoubleValue(value.epochSecond * 1000.0 + value.nano / 1_000_000.0)
	}

	public val bytes: HarperConverter<ByteArray> = object : HarperConverter<ByteArray> {
		override fun decode(value: HarperValue): ByteArray = when (value) {
			is HarperValue.BytesValue -> value.value
			is HarperValue.StringValue ->
				try {
					Base64.getDecoder().decode(value.value)
				} catch (error: IllegalArgumentException) {
					throw HarperValueMismatch("bytes", "string")
				}
			else -> throw HarperValueMismatch("bytes", value.kindName)
		}

		override fun encode(value: ByteArray): HarperValue = HarperValue.BytesValue(value)
	}

	public val bigInteger: HarperConverter<BigInteger> = object : HarperConverter<BigInteger> {
		override fun decode(value: HarperValue): BigInteger = when (value) {
			is HarperValue.LongValue -> BigInteger.valueOf(value.value)
			is HarperValue.DoubleValue ->
				exactLong(value.value)?.let { BigInteger.valueOf(it) } ?: throw HarperValueMismatch("bigint", "double")
			is HarperValue.StringValue -> value.value.toBigIntegerOrNull() ?: throw HarperValueMismatch("bigint", "string")
			else -> throw HarperValueMismatch("bigint", value.kindName)
		}

		override fun encode(value: BigInteger): HarperValue = HarperValue.StringValue(value.toString())
	}

	public val value: HarperConverter<HarperValue> = object : HarperConverter<HarperValue> {
		override fun decode(value: HarperValue): HarperValue = value

		override fun encode(value: HarperValue): HarperValue = value
	}

	public fun <T : Any> nullable(converter: HarperConverter<T>): HarperConverter<T?> = object : HarperConverter<T?> {
		override fun decode(value: HarperValue): T? = if (value == HarperValue.Null) null else converter.decode(value)

		override fun encode(value: T?): HarperValue = if (value == null) HarperValue.Null else converter.encode(value)
	}

	public fun <T> list(element: HarperConverter<T>): HarperConverter<List<T>> = object : HarperConverter<List<T>> {
		override fun decode(value: HarperValue): List<T> =
			(value as? HarperValue.ArrayValue)?.value?.map { element.decode(it) } ?: throw HarperValueMismatch("array", value.kindName)

		override fun encode(value: List<T>): HarperValue = HarperValue.ArrayValue(value.map { element.encode(it) })
	}

	/** `toLong()` saturates, and 2^63 saturates to a Long that reads back as the same Double. */
	private fun exactLong(value: Double): Long? =
		if (value >= -9.223372036854775808E18 && value < 9.223372036854775808E18 && value == Math.rint(value)) value.toLong() else null

	/** JavaScript's Date range, which is all a Harper date can hold. */
	private const val MAX_DATE_MILLIS: Long = 8_640_000_000_000_000L

	private fun instantOfMillis(milliseconds: Double): Instant {
		if (!(milliseconds >= -MAX_DATE_MILLIS.toDouble() && milliseconds <= MAX_DATE_MILLIS.toDouble())) {
			throw HarperValueMismatch("date", "out-of-range date")
		}
		val seconds = Math.floorDiv(milliseconds.toLong(), 1000L)
		val nanos = ((milliseconds - seconds * 1000.0) * 1_000_000.0).toLong()
		return Instant.ofEpochSecond(seconds, nanos)
	}
}

/** Decodes a required attribute; a missing or null value throws [HarperDecodingError.MissingValue]. */
public fun <T : Any> HarperRow.harperRequired(attribute: String, type: String, converter: HarperConverter<T>): T {
	val value = this[attribute]
	if (value == null || value == HarperValue.Null) throw HarperDecodingError.MissingValue(type, attribute)
	return try {
		converter.decode(value)
	} catch (mismatch: HarperValueMismatch) {
		throw HarperDecodingError.TypeMismatch(type, attribute, mismatch.expected, mismatch.actual)
	}
}

/** Decodes an optional attribute; a missing or null value is `null`. */
public fun <T : Any> HarperRow.harperOptional(attribute: String, type: String, converter: HarperConverter<T>): T? {
	val value = this[attribute]
	if (value == null || value == HarperValue.Null) return null
	return try {
		converter.decode(value)
	} catch (mismatch: HarperValueMismatch) {
		throw HarperDecodingError.TypeMismatch(type, attribute, mismatch.expected, mismatch.actual)
	}
}

/** The entries whose keys the schema does not declare. */
public fun HarperRow.harperExtra(declared: Set<String>): Map<String, HarperValue> = filterKeys { it !in declared }

/** The logical type of a stored column. */
public enum class HarperColumnType { ID, STRING, INT, LONG, FLOAT, BIG_INT, BOOLEAN, DATE, BYTES, BLOB, ANY, ARRAY, OBJECT }

/** The SQLite storage affinity of a replica column. */
public enum class HarperAffinity(public val sql: String) { TEXT("TEXT"), INTEGER("INTEGER"), REAL("REAL"), BLOB("BLOB") }

/** A stored attribute as it appears in the device replica. */
public data class HarperColumn(
	public val name: String,
	public val type: HarperColumnType,
	public val affinity: HarperAffinity,
	public val nullable: Boolean,
	public val primaryKey: Boolean = false,
	public val indexed: Boolean = false,
	public val readOnly: Boolean = false,
	/** The `@computed(from:)` expression the client evaluates when applying a row, if any. */
	public val computedFrom: String? = null,
)

/** A table's replica shape: its columns plus the version and overflow columns. */
public data class HarperTableSchema(
	public val database: String,
	public val name: String,
	public val primaryKey: String?,
	public val sealed: Boolean,
	/** The table's wire and storage contract hash. */
	public val hash: String,
	public val versionColumn: String,
	/** The overflow column holding undeclared attributes as JSON; `null` on `@sealed` tables. */
	public val extraColumn: String?,
	/** Whether the record can be replaced in full (`PUT`); false when an attribute has no client write contract. */
	public val replaceable: Boolean,
	public val columns: List<HarperColumn>,
)

/** A generated table model. */
public interface HarperRecord {
	/** The record version (Harper's last-updated timestamp), when known. */
	public val _version: Double?

	/** Every attribute, undeclared ones included, keyed by attribute name. */
	public fun encodeRow(): HarperRow

	/** The full-replacement (`PUT`) body; throws [HarperEncodingError.ReplacementUnsupported] when the table has none. */
	public fun encodeUpsertRow(): HarperRow
}

/** A generated model's companion: its replica schema and decoder. */
public interface HarperTable<T : HarperRecord> : HarperConverter<T> {
	public val schema: HarperTableSchema
	public val recordClass: KClass<T>

	/** Decodes a stored or fetched record; throws [HarperDecodingError] when the row does not match the schema. */
	public fun decode(row: HarperRow, version: Double? = null): T

	override fun decode(value: HarperValue): T =
		decode((value as? HarperValue.ObjectValue)?.value ?: throw HarperValueMismatch("object", value.kindName), null)

	override fun encode(value: T): HarperValue = HarperValue.ObjectValue(value.encodeRow())
}

/** A generated nested object type. */
public interface HarperObject {
	public fun encodeRow(): HarperRow
}

/** A generated nested object type's companion: its decoder. */
public interface HarperObjectType<T : HarperObject> : HarperConverter<T> {
	public fun decode(row: HarperRow): T

	override fun decode(value: HarperValue): T =
		decode((value as? HarperValue.ObjectValue)?.value ?: throw HarperValueMismatch("object", value.kindName))

	override fun encode(value: T): HarperValue = HarperValue.ObjectValue(value.encodeRow())
}

/** An insert (`POST`) or patch body. */
public interface HarperWritable {
	public fun encodeRow(): HarperRow
}

/** A sync profile from `sync.yaml`: which tables replicate, in which direction, and how long a device may stay offline. */
public data class HarperSyncProfile(
	public val name: String,
	public val direction: Direction,
	public val retentionMs: Long?,
	/** The schema hash a device sends in its `hello` frame for this profile. */
	public val schemaHash: String,
	public val tables: List<HarperTableSchema>,
) {
	public enum class Direction { PULL, PUSH, BIDIRECTIONAL }
}
