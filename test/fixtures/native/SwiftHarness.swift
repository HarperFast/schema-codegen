// Exercises generated Swift models against the semantics the IR promises. Compiled together with
// the generated sources by utils/client/native.test.js; prints "PASS <n>" or the failures.
import Foundation
import SQLite3

nonisolated(unsafe) var failures: [String] = []
nonisolated(unsafe) var checks = 0

func check(_ condition: @autoclosure () -> Bool, _ message: String, line: Int = #line) {
	checks += 1
	if !condition() { failures.append("line \(line): \(message)") }
}

func expectThrows<T>(_ message: String, line: Int = #line, _ body: () throws -> T, matching: (Error) -> Bool) {
	checks += 1
	do {
		_ = try body()
		failures.append("line \(line): \(message): did not throw")
	} catch {
		if !matching(error) { failures.append("line \(line): \(message): threw \(error)") }
	}
}

func row(_ json: String) -> HarperRow {
	let object = try! JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
	return object.mapValues { HarperValue(any: $0) }
}

func decodedRow(_ json: String) -> HarperRow {
	guard case .object(let row) = try! JSONDecoder().decode(HarperValue.self, from: Data(json.utf8)) else { fatalError() }
	return row
}

// MARK: decoding the spike's models

let orderJSON = #"{"id":"o1","customerId":"alice","status":"open","amount":12.5,"points":125,"coupon":"SPRING","_version":3}"#
let order = try! Order(row: row(orderJSON), version: 1791228562919.5)
check(order.id == "o1" && order.customerId == "alice" && order.amount == 12.5 && order.points == 125, "order fields")
check(order._version == 1791228562919.5, "order version")
check(order._extra == ["coupon": .string("SPRING"), "_version": .int(3)], "undeclared attributes land in _extra: \(order._extra)")
check(try! Order(row: decodedRow(orderJSON), version: 1791228562919.5) == order, "JSONDecoder and JSONSerialization rows decode alike")
check(try! Order(row: order.encodeRow(), version: order._version) == order, "order round trip")
check((try! order.encodeUpsertRow())["points"] == nil, "computed attributes are not upserted")
check(Order.tableName == "Order" && Order.schema.columns.first { $0.name == "points" }?.computedFrom != nil, "schema carries the computed expression")

expectThrows("a missing required attribute", { try coverage_Customer(row: ["id": .string("c1")], version: nil) }) {
	($0 as? HarperDecodingError) == .missingValue(type: "coverage_Customer", attribute: "name")
}
expectThrows("a mismatched type", { try Product(row: ["id": .string("p1"), "price": .string("cheap")], version: nil) }) {
	($0 as? HarperDecodingError) == .typeMismatch(type: "Product", attribute: "price", expected: "double", actual: "string")
}

// MARK: every type mapping

let customerJSON = #"""
{"id":"c1","name":"Ada","email":"ada@example.com","createdAt":"2026-10-05T12:34:56.789Z","updatedAt":1791203696000,
 "address":{"street":"1 Main","city":"Denver","geo":{"lat":39.7,"lng":-104.9},"unit":"4B"},
 "tags":["a","b"],"scores":[1,null,3],"big":"123456789012345678901234567890","raw":"AQID",
 "meta":{"nested":[true,1,"x",null]},"visits":9007199254740991,"active":1,
 "tree":{"label":"root","parent":{"label":"up"},"children":[{"label":"leaf"}]},
 "purchases":[{"id":1}],"loyalty":"gold"}
"""#
let customer = try! coverage_Customer(row: row(customerJSON), version: nil)
check(abs(customer.createdAt.timeIntervalSince1970 - 1791203696.789) < 0.0005, "ISO dates with fractional seconds")
check(customer.updatedAt == 1791203696000, "server-managed Float")
check(customer.address?.city == "Denver" && customer.address?.geo?.lat == 39.7, "nested object types")
check(customer.address?._extra == ["unit": .string("4B")], "nested types keep undeclared attributes")
check(customer.tags == ["a", "b"] && customer.scores == [1, nil, 3], "arrays with and without nullable elements")
check(customer.big?.decimalString == "123456789012345678901234567890" && customer.big?.int64Value == nil, "BigInt beyond Int64")
check(customer.raw == Data([1, 2, 3]), "Bytes from base64")
check(customer.visits == 9007199254740991, "Long at the 2^53 bound")
check(customer.active == true, "Boolean from SQLite's 0/1")
check(customer.tree?.parent?.value.label == "up" && customer.tree?.children?.first?.label == "leaf", "boxed recursion")
check(customer._extra == ["loyalty": .string("gold")], "relations are never extras: \(customer._extra)")
check(try! coverage_Customer(row: customer.encodeRow(), version: nil) == customer, "customer round trip")
check(HarperBigInt("-0010")?.decimalString == "-10" && HarperBigInt("-0")?.decimalString == "0" && HarperBigInt("1e3") == nil, "BigInt canonical form")
check(HarperBigInt("-10")! < HarperBigInt("-9")! && HarperBigInt("99")! < HarperBigInt("100")! && !(HarperBigInt("5")! < HarperBigInt("5")!), "BigInt ordering")

// MARK: writes

var injected = customer
injected._extra["createdAt"] = .double(0)
injected._extra["purchases"] = .array([])
let upsert = try! injected.encodeUpsertRow()
check(upsert["createdAt"] == nil && upsert["updatedAt"] == nil && upsert["purchases"] == nil, "upserts drop read-only, relation and injected keys")
check(upsert["loyalty"] == .string("gold"), "upserts keep undeclared attributes")
check(injected.encodeRow()["createdAt"] == customer.createdAt.harperValue, "typed values win over injected extras")

let insert = coverage_Customer.New(name: "Grace", tags: ["x"], _extra: ["referrer": .string("ada"), "createdAt": .double(1)])
check(insert.encodeRow() == ["name": .string("Grace"), "tags": .array([.string("x")]), "referrer": .string("ada")], "insert body: \(insert.encodeRow())")

let patch = Order.Patch(status: "closed", clear: [.amount, .status])
check(patch.encodeRow() == ["status": .string("closed"), "amount": .null], "patch: set, clear, and set wins over clear")
check(Order.Patch().encodeRow().isEmpty, "an empty patch changes nothing")

let attachment = try! coverage_Attachment(row: ["id": .string("f1"), "label": .string("deck"), "file": .object(["contentType": .string("application/pdf")])], version: nil)
check(attachment.file == .object(["contentType": .string("application/pdf")]), "Blob placeholders pass through untouched")
expectThrows("full replacement of a record holding a Blob", { try attachment.encodeUpsertRow() }) {
	($0 as? HarperEncodingError) == .replacementUnsupported(type: "coverage_Attachment", attribute: "file")
}
check(!coverage_Attachment.schema.replaceable && Order.schema.replaceable, "replaceable flag")

let purchase = try! coverage_Purchase(row: ["id": .int(7), "total": .double(9.5), "lines": .array([.object(["sku": .string("s1"), "qty": .int(2)])]), "rogue": .bool(true)], version: nil)
check(purchase.encodeRow()["rogue"] == nil && purchase.lines.first?.sku == "s1", "sealed tables drop undeclared attributes")

// MARK: raw attribute names

let weirdRow: HarperRow = [
	"id": .string("w1"), "default": .string("d"), "first-name": .string("kebab"), "firstName": .string("camel"),
	"_extra": .string("attribute"), "_version": .int(4), "encodeRow": .int(5), "Type": .int(6), "self": .string("me"),
	"in": .bool(true), "o\"conn\\or $x": .string("quoted"), "9lives": .bool(false), "surprise": .int(1),
]
let weird = try! Weird(row: weirdRow, version: 8)
check(weird.`default` == "d" && weird.firstName_2 == "kebab" && weird.firstName == "camel", "renamed and escaped properties")
check(weird._extra_2 == "attribute" && weird._version_2 == 4 && weird.encodeRow_2 == 5 && weird.`Type` == 6 && weird.self_2 == "me", "attributes named like generated members")
check(weird._extra == ["surprise": .int(1)] && weird._version == 8, "the generated members stay the generated members")
check(weird.o_conn_or__x == "quoted" && weird._9lives == false, "sanitized names")
check(try! Weird(row: weird.encodeRow(), version: 8) == weird, "raw names round trip")
check(Weird.schema.versionColumn == "__version" && Weird.schema.extraColumn == "__extra", "metadata columns move off attribute names")
check(SkuItem(sku: "s", quantity: 1).id == "s", "Identifiable from a differently named key")

// MARK: schema and profiles

check(HarperSchema.irVersion == 1 && HarperSchema.hash.count == 64, "schema identity")
check(HarperSchema.recordTypes.map { $0.tableName }.contains("Order"), "record types")
check(HarperSchema.profiles.map(\.name) == ["my-orders", "storefront"], "valid profiles only: \(HarperSchema.profiles.map(\.name))")
check(HarperSyncProfile.myOrders.tables == [Order.schema] && HarperSyncProfile.myOrders.retentionMs == 2_592_000_000, "profile constants")

// MARK: a reopened SQLite replica built from the descriptors

func sqliteValue(_ statement: OpaquePointer?, _ index: Int32, _ column: HarperColumn) -> HarperValue {
	switch sqlite3_column_type(statement, index) {
	case SQLITE_NULL:
		return .null
	case SQLITE_INTEGER:
		return .int(sqlite3_column_int64(statement, index))
	case SQLITE_FLOAT:
		return .double(sqlite3_column_double(statement, index))
	case SQLITE_BLOB:
		let count = Int(sqlite3_column_bytes(statement, index))
		return .bytes(count == 0 ? Data() : Data(bytes: sqlite3_column_blob(statement, index), count: count))
	default:
		let text = String(cString: sqlite3_column_text(statement, index))
		switch column.type {
		case .array, .object, .any: return try! JSONDecoder().decode(HarperValue.self, from: Data(text.utf8))
		default: return .string(text)
		}
	}
}

func bind(_ statement: OpaquePointer?, _ index: Int32, _ value: HarperValue?, _ column: HarperColumn?) {
	let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
	guard let value, value != .null else {
		sqlite3_bind_null(statement, index)
		return
	}
	if let column, [.array, .object, .any].contains(column.type) {
		sqlite3_bind_text(statement, index, String(data: try! JSONEncoder().encode(value), encoding: .utf8), -1, transient)
		return
	}
	switch value {
	case .bool(let flag): sqlite3_bind_int64(statement, index, flag ? 1 : 0)
	case .int(let integer): sqlite3_bind_int64(statement, index, integer)
	case .double(let double): sqlite3_bind_double(statement, index, double)
	case .string(let text): sqlite3_bind_text(statement, index, text, -1, transient)
	case .bytes(let data): _ = data.withUnsafeBytes { sqlite3_bind_blob(statement, index, $0.baseAddress, Int32(data.count), transient) }
	default: sqlite3_bind_text(statement, index, String(data: try! JSONEncoder().encode(value), encoding: .utf8), -1, transient)
	}
}

func quoted(_ name: String) -> String { "\"\(name.replacingOccurrences(of: "\"", with: "\"\""))\"" }

func store<T: HarperRecord>(_ records: [T], at path: String) {
	var db: OpaquePointer?
	sqlite3_open(path, &db)
	let schema = T.schema
	var definitions = schema.columns.map { "\(quoted($0.name)) \($0.affinity.rawValue)\($0.primaryKey ? " PRIMARY KEY" : "")" }
	definitions.append("\(quoted(schema.versionColumn)) REAL")
	if let extra = schema.extraColumn { definitions.append("\(quoted(extra)) TEXT") }
	sqlite3_exec(db, "CREATE TABLE \(quoted(schema.name)) (\(definitions.joined(separator: ", ")))", nil, nil, nil)
	let names = schema.columns.map(\.name) + [schema.versionColumn] + (schema.extraColumn.map { [$0] } ?? [])
	let sql = "INSERT INTO \(quoted(schema.name)) (\(names.map(quoted).joined(separator: ", "))) VALUES (\(names.map { _ in "?" }.joined(separator: ", ")))"
	for record in records {
		var statement: OpaquePointer?
		sqlite3_prepare_v2(db, sql, -1, &statement, nil)
		let encoded = record.encodeRow()
		var index: Int32 = 1
		for column in schema.columns {
			bind(statement, index, encoded[column.name], column)
			index += 1
		}
		bind(statement, index, record._version.map { .double($0) }, nil)
		index += 1
		if schema.extraColumn != nil {
			let declared = Set(schema.columns.map(\.name))
			bind(statement, index, .object(encoded.filter { !declared.contains($0.key) }), HarperColumn(name: "", type: .object, affinity: .text, nullable: true))
		}
		sqlite3_step(statement)
		sqlite3_finalize(statement)
	}
	sqlite3_close(db)
}

func load<T: HarperRecord>(_ type: T.Type, at path: String) -> [T] {
	var db: OpaquePointer?
	sqlite3_open(path, &db)
	defer { sqlite3_close(db) }
	let schema = T.schema
	var statement: OpaquePointer?
	sqlite3_prepare_v2(db, "SELECT * FROM \(quoted(schema.name))", -1, &statement, nil)
	defer { sqlite3_finalize(statement) }
	var records: [T] = []
	let columns = Dictionary(uniqueKeysWithValues: schema.columns.map { ($0.name, $0) })
	while sqlite3_step(statement) == SQLITE_ROW {
		var row: HarperRow = [:]
		var version: Double?
		for index in 0..<sqlite3_column_count(statement) {
			let name = String(cString: sqlite3_column_name(statement, index))
			if name == schema.versionColumn {
				version = sqlite3_column_type(statement, index) == SQLITE_NULL ? nil : sqlite3_column_double(statement, index)
			} else if name == schema.extraColumn {
				if case .object(let extras) = sqliteValue(statement, index, HarperColumn(name: name, type: .object, affinity: .text, nullable: true)) {
					for (key, value) in extras where row[key] == nil { row[key] = value }
				}
			} else if let column = columns[name] {
				row[name] = sqliteValue(statement, index, column)
			}
		}
		records.append(try! T(row: row, version: version))
	}
	return records
}

let replica = NSTemporaryDirectory() + "harper-replica-\(UUID().uuidString).sqlite"
let storedCustomer = try! coverage_Customer(row: row(customerJSON.replacingOccurrences(of: "\"2026-10-05T12:34:56.789Z\"", with: "1791203696000")), version: 1791228562919.25)
store([storedCustomer], at: replica)
store([purchase], at: replica)
store([weird], at: replica)
check(load(coverage_Customer.self, at: replica) == [storedCustomer], "customer survives a reopened replica")
check(load(coverage_Purchase.self, at: replica) == [purchase], "sealed purchase survives a reopened replica")
check(load(Weird.self, at: replica) == [weird], "raw names survive a reopened replica")
try? FileManager.default.removeItem(atPath: replica)

if failures.isEmpty {
	print("PASS \(checks)")
} else {
	print(failures.joined(separator: "\n"))
	exit(1)
}
