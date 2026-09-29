const m = db.getSiblingDB("mobility");

// $[trip] is a placeholder for every array element that arrayFilters names
// "trip". Without it, $set would have to name a fixed index such as
// departures.2, and LAB05-T-OK sits at a different index in each journey.
function setStatusOfTOK(status) {
  return m.journey_search.updateMany(
    {
      _id: /^LAB05:/,
      "departures.tripId": "LAB05-T-OK",
    },
    {
      $set: {
        "departures.$[trip].status": status,
      },
    },
    {
      arrayFilters: [
        {
          "trip.tripId": "LAB05-T-OK",
        },
      ],
    },
  );
}

// The lab says "reset the fixture" between the experiments below. Doing it
// here rather than by re-running setup.js keeps the whole section reproducible
// in a single run, and makes each experiment independent of the previous one.
function resetFixture() {
  m.journey_search.updateMany(
    {
      _id: /^LAB05:/,
      "departures.tripId": "LAB05-T-OK",
    },
    {
      $set: {
        "departures.$[trip].status": "Scheduled",
        "departures.$[trip].departureUtc": ISODate("2026-10-02T06:20:00Z"),
        "departures.$[trip].arrivalUtc": ISODate("2026-10-02T06:40:00Z"),
      },
    },
    { arrayFilters: [{ "trip.tripId": "LAB05-T-OK" }] },
  );
  m.journey_search.updateMany({}, { $set: { price: NumberDecimal("36.00") } });
}

function showTOK(label) {
  print(`\n${label}`);
  const docs = m.journey_search
    .find({ "departures.tripId": "LAB05-T-OK" }, { _id: 1, departures: 1 })
    .toArray();
  for (const doc of docs) {
    for (const d of doc.departures) {
      if (d.tripId === "LAB05-T-OK") {
        print(`  ${doc._id}  ${d.departureUtc.toISOString()}  ${d.status}`);
      }
    }
  }
}

const winStart = ISODate("2026-10-02T06:00:00Z");
const winEnd = ISODate("2026-10-02T07:00:00Z");

function searchTripIds(fromStopId, toStopId, start = winStart, end = winEnd) {
  return m.journey_search
    .aggregate([
      {
        $match: {
          cityId: "CPH",
          fromStopId,
          toStopId,
          departures: {
            $elemMatch: {
              status: "Scheduled",
              departureUtc: { $gte: start, $lt: end },
            },
          },
        },
      },
      { $unwind: "$departures" },
      {
        $match: {
          "departures.status": "Scheduled",
          "departures.departureUtc": { $gte: start, $lt: end },
        },
      },
      { $project: { _id: 0, tripId: "$departures.tripId" } },
    ])
    .toArray()
    .map((r) => r.tripId);
}

function bothSearches(label) {
  print(label);
  print(`  Norreport to Airport:  [${searchTripIds("STOP-NORREPORT", "STOP-AIRPORT").join(", ")}]`);
  print(`  Norreport to Central:  [${searchTripIds("STOP-NORREPORT", "STOP-CENTRAL").join(", ")}]`);
}

// --- Part 1: matchedCount against modifiedCount -----------------------

resetFixture();

showTOK("Before the update:");
bothSearches("The searches before the cancellation:");

const first = setStatusOfTOK("Cancelled");
print(`\nFirst run:   matched ${first.matchedCount}, modified ${first.modifiedCount}`);

const second = setStatusOfTOK("Cancelled");
print(`Second run:  matched ${second.matchedCount}, modified ${second.modifiedCount}`);

showTOK("After the update:");
bothSearches("The searches after the cancellation:");

const undo = setStatusOfTOK("Scheduled");
print(`\nRestored:    matched ${undo.matchedCount}, modified ${undo.modifiedCount}`);

// --- Part 2: making the data inconsistent, and repairing it -----------

resetFixture();

// A careless cancellation: the operator knew about LAB05:A and stopped there.
const partial = m.journey_search.updateOne(
  { _id: "LAB05:A" },
  { $set: { "departures.$[trip].status": "Cancelled" } },
  { arrayFilters: [{ "trip.tripId": "LAB05-T-OK" }] },
);
print(`\nCancelled in LAB05:A only — matched ${partial.matchedCount}, modified ${partial.modifiedCount}`);
bothSearches("The two searches now disagree about LAB05-T-OK:");

const repair = setStatusOfTOK("Cancelled");
print(`\nRepaired everywhere — matched ${repair.matchedCount}, modified ${repair.modifiedCount}`);
bothSearches("Both searches now agree:");

// --- Part 3: moving the departure -------------------------------------

resetFixture();

const moved = m.journey_search.updateMany(
  {
    _id: /^LAB05:/,
    "departures.tripId": "LAB05-T-OK",
  },
  {
    $set: {
      "departures.$[trip].departureUtc": ISODate("2026-10-02T07:05:00Z"),
      "departures.$[trip].arrivalUtc": ISODate("2026-10-02T07:25:00Z"),
    },
  },
  { arrayFilters: [{ "trip.tripId": "LAB05-T-OK" }] },
);
print(`\nMoved to 07:05-07:25 — matched ${moved.matchedCount}, modified ${moved.modifiedCount}`);
showTOK("LAB05-T-OK now reads:");

// Both halves of the check. That the trip left the old window proves nothing
// on its own: a cancelled or deleted departure would look the same. It has to
// turn up in the new window as well.
const lateStart = ISODate("2026-10-02T07:00:00Z");
const lateEnd = ISODate("2026-10-02T08:00:00Z");
print(`  06:00 to 07:00:  [${searchTripIds("STOP-NORREPORT", "STOP-AIRPORT").join(", ")}]`);
print(`  07:00 to 08:00:  [${searchTripIds("STOP-NORREPORT", "STOP-AIRPORT", lateStart, lateEnd).join(", ")}]`);

// --- Part 4: repricing one route in one city --------------------------

resetFixture();

const priced = m.journey_search.updateMany(
  { cityId: "CPH", routeId: "LINE-M2" },
  { $set: { price: NumberDecimal("40.00") } },
);
print(`\nRepriced CPH / LINE-M2 — matched ${priced.matchedCount}, modified ${priced.modifiedCount}`);

print("\nPrices across the whole collection:");
for (const doc of m.journey_search
  .find({}, { _id: 1, cityId: 1, routeId: 1, price: 1 })
  .sort({ _id: 1 })
  .toArray()) {
  print(`  ${doc._id}  ${doc.cityId}  ${doc.routeId}  ${doc.price}`);
}

// --- Leave the fixture as setup.js left it ----------------------------

resetFixture();
print("\nFixture restored: LAB05-T-OK back to 06:20 Scheduled, all prices back to 36.00.");