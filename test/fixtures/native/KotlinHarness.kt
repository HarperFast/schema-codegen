// Exercises generated Kotlin models against the semantics the IR promises. Compiled together with
// the generated sources by utils/client/native.test.js; prints "PASS <n>" or the failures.
package harper.harness

import java.math.BigInteger
import java.time.Instant
import kotlin.system.exitProcess

private val failures = mutableListOf<String>()
private var checks = 0

private fun check(condition: Boolean, message: String) {
	checks++
	if (!condition) failures.add(message)
}

private inline fun <reified E : Throwable> expectThrows(message: String, matching: (E) -> Boolean, body: () -> Unit) {
	checks++
	try {
		body()
		failures.add("$message: did not throw")
	} catch (error: Throwable) {
		if (error !is E || !matching(error)) failures.add("$message: threw $error")
	}
}

@Suppress("UNCHECKED_CAST")
private fun row(vararg entries: Pair<String, Any?>): HarperRow =
	(HarperValue.of(mapOf(*entries)) as HarperValue.ObjectValue).value

fun main() {
	val order = Order.decode(
		row("id" to "o1", "customerId" to "alice", "status" to "open", "amount" to 12.5, "points" to 125, "coupon" to "SPRING"),
		1791228562919.5,
	)
	check(order.id == "o1" && order.customerId == "alice" && order.amount == 12.5 && order.points == 125.0, "order fields")
	check(order._version == 1791228562919.5, "order version")
	check(order._extra == mapOf("coupon" to HarperValue.StringValue("SPRING")), "undeclared attributes land in _extra")
	check(Order.decode(order.encodeRow(), order._version) == order, "order round trip")
	check("points" !in order.encodeUpsertRow(), "computed attributes are not upserted")

	expectThrows<HarperDecodingError.MissingValue>("a missing required attribute", { it.type == "coverage_Customer" && it.attribute == "name" }) {
		coverage_Customer.decode(row("id" to "c1"))
	}
	expectThrows<HarperDecodingError.TypeMismatch>("a mismatched type", { it.attribute == "price" && it.expected == "double" && it.actual == "string" }) {
		Product.decode(row("id" to "p1", "price" to "cheap"))
	}
	expectThrows<HarperDecodingError.TypeMismatch>("a date that is not a number", { it.attribute == "createdAt" && it.expected == "date" && it.actual == "out-of-range date" }) {
		coverage_Customer.decode(row("id" to "c1", "name" to "Ada", "createdAt" to Double.NaN, "updatedAt" to 0.0))
	}
	expectThrows<HarperDecodingError.TypeMismatch>("a Long at 2^63", { it.attribute == "visits" && it.expected == "int" && it.actual == "double" }) {
		coverage_Customer.decode(row("id" to "c1", "name" to "Ada", "createdAt" to 0.0, "updatedAt" to 0.0, "visits" to 9.223372036854775808E18))
	}

	val customer = coverage_Customer.decode(
		row(
			"id" to "c1",
			"name" to "Ada",
			"createdAt" to "2026-10-05T12:34:56.789Z",
			"updatedAt" to 1791203696000.0,
			"address" to mapOf("street" to "1 Main", "city" to "Denver", "geo" to mapOf("lat" to 39.7, "lng" to -104.9), "unit" to "4B"),
			"tags" to listOf("a", "b"),
			"scores" to listOf(1, null, 3),
			"big" to "123456789012345678901234567890",
			"raw" to "AQID",
			"files" to listOf("AQID", "BAU="),
			"meta" to mapOf("nested" to listOf(true, 1, "x", null)),
			"visits" to 9007199254740991L,
			"active" to 1,
			"tree" to mapOf("label" to "root", "parent" to mapOf("label" to "up"), "children" to listOf(mapOf("label" to "leaf"))),
			"purchases" to listOf(mapOf("id" to 1)),
			"loyalty" to "gold",
		),
	)
	check(customer.createdAt == Instant.parse("2026-10-05T12:34:56.789Z"), "ISO instants")
	val address = customer.address
	check(address != null && address.city == "Denver" && address.geo?.lat == 39.7, "nested object types")
	check(address?._extra == mapOf("unit" to HarperValue.StringValue("4B")), "nested types keep undeclared attributes")
	check(customer.tags == listOf("a", "b") && customer.scores == listOf(1, null, 3), "lists with and without nullable elements")
	check(customer.big == BigInteger("123456789012345678901234567890"), "BigInt beyond Long")
	check(customer.raw?.contentEquals(byteArrayOf(1, 2, 3)) == true, "Bytes from base64")
	check(customer.files?.map { it?.toList() } == listOf(listOf<Byte>(1, 2, 3), listOf<Byte>(4, 5)), "lists of Bytes")
	check(customer.visits == 9007199254740991L && customer.active == true, "Long and 0/1 booleans")
	val tree = customer.tree
	check(tree != null && tree.parent?.label == "up" && tree.children?.first()?.label == "leaf", "recursive nested types")
	check(customer._extra == mapOf("loyalty" to HarperValue.StringValue("gold")), "relations are never extras")
	val again = coverage_Customer.decode(customer.encodeRow())
	check(again == customer && again.hashCode() == customer.hashCode(), "customer round trip compares ByteArray content, in lists too")

	val injected = customer.copy(_extra = customer._extra + mapOf("createdAt" to HarperValue.DoubleValue(0.0), "purchases" to HarperValue.ArrayValue(emptyList())))
	val upsert = injected.encodeUpsertRow()
	check("createdAt" !in upsert && "updatedAt" !in upsert && "purchases" !in upsert, "upserts drop read-only, relation and injected keys")
	check(upsert["loyalty"] == HarperValue.StringValue("gold"), "upserts keep undeclared attributes")
	check(injected.encodeRow()["createdAt"] == HarperConverters.instant.encode(customer.createdAt), "typed values win over injected extras")

	val insert = coverage_Customer.New(name = "Grace", tags = listOf("x"), _extra = mapOf("referrer" to HarperValue.StringValue("ada"), "createdAt" to HarperValue.DoubleValue(1.0)))
	check(
		insert.encodeRow() == mapOf(
			"name" to HarperValue.StringValue("Grace"),
			"tags" to HarperValue.ArrayValue(listOf(HarperValue.StringValue("x"))),
			"referrer" to HarperValue.StringValue("ada"),
		),
		"insert body",
	)

	val patch = Order.Patch(status = "closed", clear = setOf(Order.Patch.Field.amount, Order.Patch.Field.status))
	check(patch.encodeRow() == mapOf("status" to HarperValue.StringValue("closed"), "amount" to HarperValue.Null), "patch: set, clear, and set wins over clear")
	check(Order.Patch().encodeRow().isEmpty(), "an empty patch changes nothing")

	val attachment = coverage_Attachment.decode(row("id" to "f1", "label" to "deck", "file" to mapOf("contentType" to "application/pdf")))
	check(attachment.file == HarperValue.ObjectValue(mapOf("contentType" to HarperValue.StringValue("application/pdf"))), "Blob placeholders pass through untouched")
	expectThrows<HarperEncodingError.ReplacementUnsupported>("full replacement of a record holding a Blob", { it.attribute == "file" }) {
		attachment.encodeUpsertRow()
	}

	val purchase = coverage_Purchase.decode(row("id" to 7, "total" to 9.5, "lines" to listOf(mapOf("sku" to "s1", "qty" to 2)), "rogue" to true))
	check("rogue" !in purchase.encodeRow() && purchase.lines.first().sku == "s1", "sealed tables drop undeclared attributes")

	val weird = Weird.decode(
		row(
			"id" to "w1",
			"default" to "d",
			"first-name" to "kebab",
			"firstName" to "camel",
			"_extra" to "attribute",
			"_version" to 4,
			"encodeRow" to 5,
			"Type" to 6,
			"self" to "me",
			"in" to true,
			"o\"conn\\or \$x" to "quoted",
			"9lives" to false,
			"surprise" to 1,
		),
		8.0,
	)
	check(weird.default == "d" && weird.firstName_2 == "kebab" && weird.firstName == "camel" && weird.`in` == true, "renamed and escaped properties")
	check(weird._extra_2 == "attribute" && weird._version_2 == 4 && weird.encodeRow_2 == 5 && weird.Type == 6 && weird.self_2 == "me", "attributes named like generated members")
	check(weird._extra == mapOf("surprise" to HarperValue.LongValue(1)) && weird._version == 8.0, "the generated members stay the generated members")
	check(weird.o_conn_or__x == "quoted" && weird._9lives == false, "sanitized names")
	check(Weird.decode(weird.encodeRow(), 8.0) == weird, "raw names round trip")

	check(HarperSchema.IR_VERSION == 1 && HarperSchema.SCHEMA_HASH.length == 64, "schema identity")
	check(HarperSchema.table(Order::class) === Order, "table lookup by class")
	check(HarperSchema.profiles.map { it.name } == listOf("my-orders", "storefront"), "valid profiles only")
	check(HarperProfiles.myOrders.tables == listOf(Order.schema) && HarperProfiles.myOrders.retentionMs == 2_592_000_000L, "profile constants")

	if (failures.isEmpty()) {
		println("PASS $checks")
	} else {
		println(failures.joinToString("\n"))
		exitProcess(1)
	}
}
