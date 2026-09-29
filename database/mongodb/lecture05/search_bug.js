const m = db.getSiblingDB("mobility");

const query = {
  cityId: "CPH",
  fromStopId: "STOP-NORREPORT",
  toStopId: "STOP-AIRPORT",
  "departures.status": "Scheduled",

  // departures.departureUtc as a separate condition. Each dotted path is
  // evaluated against the array as a whole, so the journey matches when SOME
  // element is Scheduled and SOME element is inside the window — not
  // necessarily the same element.
  "departures.departureUtc": {
    $gte: ISODate("2026-10-02T06:00:00Z"),
    $lt: ISODate("2026-10-02T07:00:00Z"),
  },
};

print("Buggy query, the two conditions stated separately:");
printjson(m.journey_search.find(query, { _id: 1, routeId: 1 }).toArray());

// --- Why LAB05:B is in that result ------------------------------------

const b = m.journey_search.findOne({ _id: "LAB05:B" });
print("\nThe departures inside LAB05:B:");
for (const d of b.departures) {
  print(`  ${d.tripId}  ${d.departureUtc.toISOString()}  ${d.status}`);
}
print("LAB05-T-B1 satisfies the status condition but departs too early.");
print("LAB05-T-B2 departs inside the window but is cancelled.");
print("No single departure satisfies both, yet the journey matched.");

// --- The fix ----------------------------------------------------------

const fixedQuery = {
  cityId: "CPH",
  fromStopId: "STOP-NORREPORT",
  toStopId: "STOP-AIRPORT",
  departures: {
    $elemMatch: {
      status: "Scheduled",
      departureUtc: {
        $gte: ISODate("2026-10-02T06:00:00Z"),
        $lt: ISODate("2026-10-02T07:00:00Z"),
      },
    },
  },
};

print("\nFixed query, both conditions bound to the same array element:");
printjson(m.journey_search.find(fixedQuery, { _id: 1, routeId: 1 }).toArray());

const buggyCount = m.journey_search.countDocuments(query);
const fixedCount = m.journey_search.countDocuments(fixedQuery);
print(`\nBuggy: ${buggyCount} journeys.  Fixed: ${fixedCount} journey.`);