const m = db.getSiblingDB("mobility");

if (!m.getCollectionNames().includes("journey_search_by_trip")) {
  m.createCollection("journey_search_by_trip");
} else {
  m.journey_search_by_trip.deleteMany({
    $or: [
      { _id: /^LAB05:/ },
      { tripId: /^LAB05-/ },
    ],
  });
}

const journeys = m.journey_search.find({ _id: /^LAB05:/ }).toArray();

const documents = [];
for (const journey of journeys) {
  for (const departure of journey.departures) {
    // One document per dated trip and stop pair. The _id is derived from the
    // business keys alone, so the same input always produces the same _id:
    // re-running this script replaces documents instead of duplicating them,
    // and any writer can address a departure without looking it up first.
    documents.push({
      _id: [
        "LAB05",
        journey.cityId,
        journey.routeId,
        journey.fromStopId,
        journey.toStopId,
        journey.serviceDate,
        departure.tripId,
      ].join(":"),
      cityId: journey.cityId,
      routeId: journey.routeId,
      fromStopId: journey.fromStopId,
      toStopId: journey.toStopId,
      serviceDate: journey.serviceDate,
      schemaVersion: journey.schemaVersion,
      price: journey.price,
      currency: journey.currency,
      tripId: departure.tripId,
      departureUtc: departure.departureUtc,
      arrivalUtc: departure.arrivalUtc,
      availableSeats: departure.availableSeats,
      status: departure.status,
    });
  }
}

m.journey_search_by_trip.insertMany(documents);

// The index the search actually uses. In the array model an index on
// departures.departureUtc is multikey: one entry per array element, and the
// whole journey still has to be fetched. Here one entry means one departure.
m.journey_search_by_trip.createIndex({
  cityId: 1,
  fromStopId: 1,
  toStopId: 1,
  departureUtc: 1,
});

print(`Documents built: ${m.journey_search_by_trip.countDocuments({ tripId: /^LAB05-/ })}`);

print("\nLAB05-T-OK now has one document per stop pair:");
for (const doc of m.journey_search_by_trip.find({ tripId: "LAB05-T-OK" }).sort({ _id: 1 }).toArray()) {
  print(`  ${doc._id}`);
}

// --- The same search, without an array --------------------------------

function searchByTrip(cityId, fromStopId, toStopId, start, end) {
  if (!cityId || !fromStopId || !toStopId) {
    throw new Error("cityId, fromStopId and toStopId are required");
  }
  if (!(start instanceof Date) || !(end instanceof Date)) {
    throw new Error("start and end must be dates");
  }
  if (end <= start) {
    throw new Error("end must be later than start");
  }

  // No $elemMatch, no $unwind, no second $match: the conditions cannot land
  // on different elements, because there are no elements.
  return m.journey_search_by_trip
    .find(
      {
        cityId,
        fromStopId,
        toStopId,
        status: "Scheduled",
        departureUtc: { $gte: start, $lt: end },
      },
      {
        _id: 0,
        cityId: 1,
        routeId: 1,
        fromStopId: 1,
        toStopId: 1,
        serviceDate: 1,
        tripId: 1,
        departureUtc: 1,
        arrivalUtc: 1,
        availableSeats: 1,
        price: 1,
        currency: 1,
      },
    )
    .sort({ departureUtc: 1 })
    .toArray();
}

print("\nThe first search against the new model:");
printjson(
  searchByTrip(
    "CPH",
    "STOP-NORREPORT",
    "STOP-AIRPORT",
    ISODate("2026-10-02T06:00:00Z"),
    ISODate("2026-10-02T07:00:00Z"),
  ),
);

// --- The test cases from section 2, against the new model -------------

const cases = [
  {
    label: "Norreport to Airport, 06:00 to 07:00",
    args: ["CPH", "STOP-NORREPORT", "STOP-AIRPORT",
      ISODate("2026-10-02T06:00:00Z"), ISODate("2026-10-02T07:00:00Z")],
    expect: ["LAB05-T-OK"],
  },
  {
    label: "End at 06:20, the exclusive boundary",
    args: ["CPH", "STOP-NORREPORT", "STOP-AIRPORT",
      ISODate("2026-10-02T06:00:00Z"), ISODate("2026-10-02T06:20:00Z")],
    expect: [],
  },
  {
    label: "Start at 06:20, the inclusive boundary",
    args: ["CPH", "STOP-NORREPORT", "STOP-AIRPORT",
      ISODate("2026-10-02T06:20:00Z"), ISODate("2026-10-02T07:00:00Z")],
    expect: ["LAB05-T-OK"],
  },
  {
    label: "Airport to Norreport, the reverse direction",
    args: ["CPH", "STOP-AIRPORT", "STOP-NORREPORT",
      ISODate("2026-10-02T06:00:00Z"), ISODate("2026-10-02T07:00:00Z")],
    expect: ["LAB05-T-E"],
  },
  {
    label: "Same search on 3 October",
    args: ["CPH", "STOP-NORREPORT", "STOP-AIRPORT",
      ISODate("2026-10-03T06:00:00Z"), ISODate("2026-10-03T07:00:00Z")],
    expect: ["LAB05-T-F"],
  },
  {
    label: "Destination STOP-NO-MATCH",
    args: ["CPH", "STOP-NORREPORT", "STOP-NO-MATCH",
      ISODate("2026-10-02T06:00:00Z"), ISODate("2026-10-02T07:00:00Z")],
    expect: [],
  },
];

const rejected = [
  {
    label: "end equal to start",
    args: ["CPH", "STOP-NORREPORT", "STOP-AIRPORT",
      ISODate("2026-10-02T06:00:00Z"), ISODate("2026-10-02T06:00:00Z")],
  },
  {
    label: "empty destination stop",
    args: ["CPH", "STOP-NORREPORT", "",
      ISODate("2026-10-02T06:00:00Z"), ISODate("2026-10-02T07:00:00Z")],
  },
];

let passed = 0;
let failed = 0;

print("");
for (const c of cases) {
  const got = searchByTrip(...c.args).map((r) => r.tripId);
  if (JSON.stringify(got) === JSON.stringify(c.expect)) {
    passed++;
    print(`PASS  ${c.label}  ->  [${got.join(", ")}]`);
  } else {
    failed++;
    print(`FAIL  ${c.label}  ->  [${got.join(", ")}]  expected [${c.expect.join(", ")}]`);
  }
}

for (const c of rejected) {
  try {
    searchByTrip(...c.args);
    failed++;
    print(`FAIL  ${c.label} — accepted, but should have been rejected`);
  } catch (e) {
    passed++;
    print(`PASS  ${c.label} — rejected: ${e.message}`);
  }
}

print("----------------------------------------");
print(`Passed: ${passed}  Failed: ${failed}`);

// --- Cancelling LAB05-T-OK in the new model ---------------------------

const cancelled = m.journey_search_by_trip.updateMany(
  { tripId: "LAB05-T-OK" },
  { $set: { status: "Cancelled" } },
);
print(`\nCancelled LAB05-T-OK — matched ${cancelled.matchedCount}, modified ${cancelled.modifiedCount}`);
print("No arrayFilters, no positional placeholder: status is a field of the document itself.");

for (const doc of m.journey_search_by_trip.find({ tripId: "LAB05-T-OK" }).sort({ _id: 1 }).toArray()) {
  print(`  ${doc._id}  ${doc.status}`);
}

const after = searchByTrip(
  "CPH",
  "STOP-NORREPORT",
  "STOP-AIRPORT",
  ISODate("2026-10-02T06:00:00Z"),
  ISODate("2026-10-02T07:00:00Z"),
);
print(`\nThe 06:00 to 07:00 search now returns ${after.length} departures.`);
print("Re-run this file to rebuild the collection from journey_search.");