import Foundation

/// A Harper attribute value: the closed set of shapes a record can hold.
public enum HarperValue: Sendable, Hashable {
	case null
	case bool(Bool)
	case int(Int64)
	case double(Double)
	case string(String)
	case bytes(Data)
	case array([HarperValue])
	case object([String: HarperValue])
}

/// A record or nested object keyed by attribute name: the logical record, undeclared attributes included.
public typealias HarperRow = [String: HarperValue]

extension HarperValue {
	/// The kind name used in decoding errors.
	public var kindName: String {
		switch self {
		case .null: return "null"
		case .bool: return "bool"
		case .int: return "int"
		case .double: return "double"
		case .string: return "string"
		case .bytes: return "bytes"
		case .array: return "array"
		case .object: return "object"
		}
	}

	/// Bridges a Foundation value (`JSONSerialization` output, SQLite column values) into a `HarperValue`.
	/// Dates become epoch milliseconds, the row encoding of `Date` attributes.
	public init(any value: Any?) {
		guard let value else {
			self = .null
			return
		}
		switch value {
		case let harperValue as HarperValue:
			self = harperValue
		case is NSNull:
			self = .null
		case let string as String:
			self = .string(string)
		case let number as NSNumber:
			if CFGetTypeID(number) == CFBooleanGetTypeID() {
				self = .bool(number.boolValue)
			} else if CFNumberIsFloatType(number) {
				self = .double(number.doubleValue)
			} else {
				self = .int(number.int64Value)
			}
		case let data as Data:
			self = .bytes(data)
		case let date as Date:
			self = .double(date.timeIntervalSince1970 * 1000)
		case let array as [Any?]:
			self = .array(array.map { HarperValue(any: $0) })
		case let dictionary as [String: Any?]:
			self = .object(dictionary.mapValues { HarperValue(any: $0) })
		default:
			self = .string(String(describing: value))
		}
	}

	/// A `JSONSerialization`-compatible value; bytes become base64 strings and non-finite doubles become null.
	public var jsonObject: Any {
		switch self {
		case .null: return NSNull()
		case .bool(let value): return value
		case .int(let value): return value
		case .double(let value): return value.isFinite ? value : NSNull()
		case .string(let value): return value
		case .bytes(let value): return value.base64EncodedString()
		case .array(let values): return values.map(\.jsonObject)
		case .object(let values): return values.mapValues(\.jsonObject)
		}
	}
}

extension HarperValue: Codable {
	public init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		if container.decodeNil() {
			self = .null
		} else if let value = try? container.decode(Bool.self) {
			self = .bool(value)
		} else if let value = try? container.decode(Int64.self) {
			self = .int(value)
		} else if let value = try? container.decode(Double.self) {
			self = .double(value)
		} else if let value = try? container.decode(String.self) {
			self = .string(value)
		} else if let value = try? container.decode([HarperValue].self) {
			self = .array(value)
		} else {
			self = .object(try container.decode([String: HarperValue].self))
		}
	}

	public func encode(to encoder: Encoder) throws {
		var container = encoder.singleValueContainer()
		switch self {
		case .null: try container.encodeNil()
		case .bool(let value): try container.encode(value)
		case .int(let value): try container.encode(value)
		case .double(let value): try value.isFinite ? container.encode(value) : container.encodeNil()
		case .string(let value): try container.encode(value)
		case .bytes(let value): try container.encode(value.base64EncodedString())
		case .array(let values): try container.encode(values)
		case .object(let values): try container.encode(values)
		}
	}
}

/// An arbitrary-precision integer carried as its canonical decimal string.
public struct HarperBigInt: Sendable, Hashable, Codable, Comparable, CustomStringConvertible, ExpressibleByIntegerLiteral {
	/// Decimal digits with an optional leading `-`, no leading zeros, and no `-0`.
	public let decimalString: String

	public init?(_ text: String) {
		var digits = Substring(text)
		var negative = false
		if digits.first == "-" || digits.first == "+" {
			negative = digits.first == "-"
			digits = digits.dropFirst()
		}
		guard !digits.isEmpty, digits.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return nil }
		let significant = digits.drop(while: { $0 == "0" })
		decimalString = significant.isEmpty ? "0" : (negative ? "-" : "") + significant
	}

	public init(_ value: Int64) {
		decimalString = String(value)
	}

	public init(integerLiteral value: Int64) {
		self.init(value)
	}

	/// The value as an `Int64`, or `nil` when it does not fit.
	public var int64Value: Int64? { Int64(decimalString) }

	public var description: String { decimalString }

	public init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		if let integer = try? container.decode(Int64.self) {
			self.init(integer)
		} else if let value = HarperBigInt(try container.decode(String.self)) {
			self = value
		} else {
			throw DecodingError.dataCorruptedError(in: container, debugDescription: "expected a decimal integer")
		}
	}

	public func encode(to encoder: Encoder) throws {
		var container = encoder.singleValueContainer()
		try container.encode(decimalString)
	}

	public static func < (lhs: HarperBigInt, rhs: HarperBigInt) -> Bool {
		let lhsNegative = lhs.decimalString.hasPrefix("-")
		let rhsNegative = rhs.decimalString.hasPrefix("-")
		if lhsNegative != rhsNegative { return lhsNegative }
		let lhsDigits = lhsNegative ? lhs.decimalString.dropFirst() : Substring(lhs.decimalString)
		let rhsDigits = rhsNegative ? rhs.decimalString.dropFirst() : Substring(rhs.decimalString)
		if lhsDigits == rhsDigits { return false }
		let magnitudeLess = lhsDigits.count != rhsDigits.count ? lhsDigits.count < rhsDigits.count : lhsDigits < rhsDigits
		return lhsNegative ? !magnitudeLess : magnitudeLess
	}
}

/// A value that converts to and from a `HarperValue`.
public protocol HarperValueConvertible: Sendable {
	init(harperValue: HarperValue) throws
	var harperValue: HarperValue { get }
}

/// A conversion failure, before the type and attribute it happened in are known.
public struct HarperValueMismatch: Error, Sendable {
	public let expected: String
	public let actual: String

	public init(expected: String, actual: String) {
		self.expected = expected
		self.actual = actual
	}
}

/// A row that does not match the generated model.
public enum HarperDecodingError: Error, Sendable, Hashable, CustomStringConvertible {
	case missingValue(type: String, attribute: String)
	case typeMismatch(type: String, attribute: String, expected: String, actual: String)

	public var description: String {
		switch self {
		case .missingValue(let type, let attribute):
			return "\(type).\(attribute) is required but the row has no value"
		case .typeMismatch(let type, let attribute, let expected, let actual):
			return "\(type).\(attribute) expected \(expected) but the row has \(actual)"
		}
	}
}

/// A write the generated model refuses to encode.
public enum HarperEncodingError: Error, Sendable, Hashable, CustomStringConvertible {
	/// A full replacement (`PUT`) would delete or corrupt this attribute; update the record with a patch instead.
	case replacementUnsupported(type: String, attribute: String)

	public var description: String {
		switch self {
		case .replacementUnsupported(let type, let attribute):
			return "\(type) cannot be replaced in full: \(attribute) has no client write contract yet; use a patch"
		}
	}
}

extension String: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		guard case .string(let value) = harperValue else {
			throw HarperValueMismatch(expected: "string", actual: harperValue.kindName)
		}
		self = value
	}

	public var harperValue: HarperValue { .string(self) }
}

extension Int: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		switch harperValue {
		case .int(let value):
			guard let exact = Int(exactly: value) else { throw HarperValueMismatch(expected: "int", actual: "out-of-range int") }
			self = exact
		case .double(let value):
			guard let exact = Int(exactly: value) else { throw HarperValueMismatch(expected: "int", actual: "double") }
			self = exact
		default:
			throw HarperValueMismatch(expected: "int", actual: harperValue.kindName)
		}
	}

	public var harperValue: HarperValue { .int(Int64(self)) }
}

extension Int64: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		switch harperValue {
		case .int(let value):
			self = value
		case .double(let value):
			guard let exact = Int64(exactly: value) else { throw HarperValueMismatch(expected: "int", actual: "double") }
			self = exact
		default:
			throw HarperValueMismatch(expected: "int", actual: harperValue.kindName)
		}
	}

	public var harperValue: HarperValue { .int(self) }
}

extension Double: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		switch harperValue {
		case .double(let value): self = value
		case .int(let value): self = Double(value)
		default: throw HarperValueMismatch(expected: "double", actual: harperValue.kindName)
		}
	}

	public var harperValue: HarperValue { .double(self) }
}

extension Bool: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		switch harperValue {
		case .bool(let value): self = value
		case .int(0): self = false
		case .int(1): self = true
		default: throw HarperValueMismatch(expected: "bool", actual: harperValue.kindName)
		}
	}

	public var harperValue: HarperValue { .bool(self) }
}

extension Date: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		switch harperValue {
		case .double(let milliseconds):
			guard milliseconds >= -8.64e15, milliseconds <= 8.64e15 else { throw HarperValueMismatch(expected: "date", actual: "out-of-range date") }
			self = Date(timeIntervalSince1970: milliseconds / 1000)
		case .int(let milliseconds):
			guard milliseconds >= -8_640_000_000_000_000, milliseconds <= 8_640_000_000_000_000 else { throw HarperValueMismatch(expected: "date", actual: "out-of-range date") }
			self = Date(timeIntervalSince1970: Double(milliseconds) / 1000)
		case .string(let text):
			let formatter = ISO8601DateFormatter()
			formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
			if let date = formatter.date(from: text) {
				self = date
				return
			}
			formatter.formatOptions = [.withInternetDateTime]
			guard let date = formatter.date(from: text) else { throw HarperValueMismatch(expected: "date", actual: "string") }
			self = date
		default:
			throw HarperValueMismatch(expected: "date", actual: harperValue.kindName)
		}
	}

	public var harperValue: HarperValue { .double(timeIntervalSince1970 * 1000) }
}

extension Data: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		switch harperValue {
		case .bytes(let value):
			self = value
		case .string(let base64):
			guard let value = Data(base64Encoded: base64) else { throw HarperValueMismatch(expected: "bytes", actual: "string") }
			self = value
		default:
			throw HarperValueMismatch(expected: "bytes", actual: harperValue.kindName)
		}
	}

	public var harperValue: HarperValue { .bytes(self) }
}

extension HarperBigInt: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		switch harperValue {
		case .int(let value):
			self.init(value)
		case .double(let value):
			guard let exact = Int64(exactly: value) else { throw HarperValueMismatch(expected: "bigint", actual: "double") }
			self.init(exact)
		case .string(let text):
			guard let value = HarperBigInt(text) else { throw HarperValueMismatch(expected: "bigint", actual: "string") }
			self = value
		default:
			throw HarperValueMismatch(expected: "bigint", actual: harperValue.kindName)
		}
	}

	public var harperValue: HarperValue { .string(decimalString) }
}

extension HarperValue: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		self = harperValue
	}

	public var harperValue: HarperValue { self }
}

extension Optional: HarperValueConvertible where Wrapped: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		if case .null = harperValue {
			self = nil
		} else {
			self = try Wrapped(harperValue: harperValue)
		}
	}

	public var harperValue: HarperValue { self?.harperValue ?? .null }
}

extension Array: HarperValueConvertible where Element: HarperValueConvertible {
	public init(harperValue: HarperValue) throws {
		guard case .array(let values) = harperValue else {
			throw HarperValueMismatch(expected: "array", actual: harperValue.kindName)
		}
		self = try values.map { try Element(harperValue: $0) }
	}

	public var harperValue: HarperValue { .array(map(\.harperValue)) }
}

/// Holds a nested value by reference, so a generated struct can contain a type that contains it.
public final class HarperBox<Wrapped: HarperValueConvertible & Hashable>: HarperValueConvertible, Hashable, Sendable {
	public let value: Wrapped

	public init(_ value: Wrapped) {
		self.value = value
	}

	public init(harperValue: HarperValue) throws {
		value = try Wrapped(harperValue: harperValue)
	}

	public var harperValue: HarperValue { value.harperValue }

	public static func == (lhs: HarperBox, rhs: HarperBox) -> Bool {
		lhs.value == rhs.value
	}

	public func hash(into hasher: inout Hasher) {
		hasher.combine(value)
	}
}

extension Dictionary where Key == String, Value == HarperValue {
	/// Decodes a required attribute; a missing or null value throws `HarperDecodingError.missingValue`.
	public func harperRequired<T: HarperValueConvertible>(_ attribute: String, of type: String) throws -> T {
		guard let value = self[attribute], value != .null else {
			throw HarperDecodingError.missingValue(type: type, attribute: attribute)
		}
		do {
			return try T(harperValue: value)
		} catch let mismatch as HarperValueMismatch {
			throw HarperDecodingError.typeMismatch(type: type, attribute: attribute, expected: mismatch.expected, actual: mismatch.actual)
		}
	}

	/// Decodes an optional attribute; a missing or null value is `nil`.
	public func harperOptional<T: HarperValueConvertible>(_ attribute: String, of type: String) throws -> T? {
		guard let value = self[attribute], value != .null else { return nil }
		do {
			return try T(harperValue: value)
		} catch let mismatch as HarperValueMismatch {
			throw HarperDecodingError.typeMismatch(type: type, attribute: attribute, expected: mismatch.expected, actual: mismatch.actual)
		}
	}

	/// The entries whose keys the schema does not declare.
	public func harperExtra(excluding declared: Set<String>) -> [String: HarperValue] {
		filter { !declared.contains($0.key) }
	}
}

/// The logical type of a stored column.
public enum HarperColumnType: String, Sendable, Hashable {
	case id, string, int, long, float, bigInt, boolean, date, bytes, blob, any, array, object
}

/// The SQLite storage affinity of a replica column.
public enum HarperAffinity: String, Sendable, Hashable {
	case text = "TEXT"
	case integer = "INTEGER"
	case real = "REAL"
	case blob = "BLOB"
}

/// A stored attribute as it appears in the device replica.
public struct HarperColumn: Sendable, Hashable {
	public let name: String
	public let type: HarperColumnType
	public let affinity: HarperAffinity
	public let nullable: Bool
	public let primaryKey: Bool
	public let indexed: Bool
	public let readOnly: Bool
	/// The `@computed(from:)` expression the client evaluates when applying a row, if any.
	public let computedFrom: String?

	public init(name: String, type: HarperColumnType, affinity: HarperAffinity, nullable: Bool, primaryKey: Bool = false, indexed: Bool = false, readOnly: Bool = false, computedFrom: String? = nil) {
		self.name = name
		self.type = type
		self.affinity = affinity
		self.nullable = nullable
		self.primaryKey = primaryKey
		self.indexed = indexed
		self.readOnly = readOnly
		self.computedFrom = computedFrom
	}
}

/// A table's replica shape: its columns plus the version and overflow columns.
public struct HarperTableSchema: Sendable, Hashable {
	public let database: String
	public let name: String
	public let primaryKey: String?
	public let sealed: Bool
	/// The table's wire and storage contract hash.
	public let hash: String
	public let versionColumn: String
	/// The overflow column holding undeclared attributes as JSON; `nil` on `@sealed` tables.
	public let extraColumn: String?
	/// Whether the record can be replaced in full (`PUT`); false when an attribute has no client write contract.
	public let replaceable: Bool
	public let columns: [HarperColumn]

	public init(database: String, name: String, primaryKey: String?, sealed: Bool, hash: String, versionColumn: String, extraColumn: String?, replaceable: Bool, columns: [HarperColumn]) {
		self.database = database
		self.name = name
		self.primaryKey = primaryKey
		self.sealed = sealed
		self.hash = hash
		self.versionColumn = versionColumn
		self.extraColumn = extraColumn
		self.replaceable = replaceable
		self.columns = columns
	}
}

/// A generated table model.
public protocol HarperRecord: HarperValueConvertible, Hashable {
	static var schema: HarperTableSchema { get }
	/// Decodes a stored or fetched record; throws `HarperDecodingError` when the row does not match the schema.
	init(row: HarperRow, version: Double?) throws
	/// The record version (Harper's last-updated timestamp), when known.
	var _version: Double? { get }
	/// Every attribute, undeclared ones included, keyed by attribute name.
	func encodeRow() -> HarperRow
	/// The full-replacement (`PUT`) body: the primary key, client-writable attributes and undeclared attributes.
	func encodeUpsertRow() throws -> HarperRow
}

extension HarperRecord {
	public static var tableName: String { schema.name }

	public init(row: HarperRow) throws {
		try self.init(row: row, version: nil)
	}

	public init(harperValue: HarperValue) throws {
		guard case .object(let row) = harperValue else {
			throw HarperValueMismatch(expected: "object", actual: harperValue.kindName)
		}
		try self.init(row: row, version: nil)
	}

	public var harperValue: HarperValue { .object(encodeRow()) }
}

/// A generated nested object type.
public protocol HarperObject: HarperValueConvertible, Hashable {
	init(row: HarperRow) throws
	func encodeRow() -> HarperRow
}

extension HarperObject {
	public init(harperValue: HarperValue) throws {
		guard case .object(let row) = harperValue else {
			throw HarperValueMismatch(expected: "object", actual: harperValue.kindName)
		}
		try self.init(row: row)
	}

	public var harperValue: HarperValue { .object(encodeRow()) }
}

/// An insert (`POST`) or patch body.
public protocol HarperWritable: Sendable, Hashable {
	func encodeRow() -> HarperRow
}

/// A sync profile from `sync.yaml`: which tables replicate, in which direction, and how long a device may stay offline.
public struct HarperSyncProfile: Sendable, Hashable {
	public enum Direction: String, Sendable, Hashable {
		case pull, push, bidirectional
	}

	public let name: String
	public let direction: Direction
	public let retentionMs: Int64?
	/// The schema hash a device sends in its `hello` frame for this profile.
	public let schemaHash: String
	public let tables: [HarperTableSchema]

	public init(name: String, direction: Direction, retentionMs: Int64?, schemaHash: String, tables: [HarperTableSchema]) {
		self.name = name
		self.direction = direction
		self.retentionMs = retentionMs
		self.schemaHash = schemaHash
		self.tables = tables
	}
}
