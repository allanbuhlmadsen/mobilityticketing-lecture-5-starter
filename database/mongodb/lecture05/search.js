const m = db.getSiblingDB("mobility");

function search(cityId, fromStopId, toStopId, start, end) {
  if (!cityId || !fromStopId || !toStopId) {
    throw new Error("cityId, fromStopId and toStopId are required");
  }
  if (!(start instanceof Date) || !(end instanceof Date)) {
    throw new Error("start and end must be dates");
  }
  if (end <= start) {
    throw new Error("end must be later than start");
  }

  return m.journey_search
    .aggregate([
      {
        $match: {
          cityId,
          fromStopId,
          toStopId,

          // $elemMatch requires both conditions to hold for the SAME array
          // element. Stated as two separate dotted paths they would be
          // checked against the array as a whole — see search_bug.js.
          departures: {
            $elemMatch: {
              status: "Scheduled",
              departureUtc: { $gte: start, $lt: end },
            },
          },
        },
      },

      // One document per departure, so each departure is judged on its own.
      { $unwind: "$departures" },

      // $elemMatch discarded whole journeys; this discards the departures
      // inside the surviving ones that do not match.
      {
        $match: {
          "departures.status": "Scheduled",
          "departures.departureUtc": { $gte: start, $lt: end },
        },
      },

      {
        $project: {
          _id: 0,
          cityId: 1,
          routeId: 1,
          fromStopId: 1,
          toStopId: 1,
          serviceDate: 1,
          tripId: "$departures.tripId",
          departureUtc: "$departures.departureUtc",
          arrivalUtc: "$departures.arrivalUtc",
          availableSeats: "$departures.availableSeats",
          price: 1,
          currency: 1,
        },
      },

      { $sort: { departureUtc: 1 } },
    ])
    .toArray();
}

const start = ISODate("2026-10-02T06:00:00Z");
const end = ISODate("2026-10-02T07:00:00Z");

printjson(search("CPH", "STOP-NORREPORT", "STOP-AIRPORT", start, end));

// --- Test cases from section 2 ----------------------------------------

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

for (const c of cases) {
  const got = search(...c.args).map((r) => r.tripId);
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
    search(...c.args);
    failed++;
    print(`FAIL  ${c.label} — accepted, but should have been rejected`);
  } catch (e) {
    passed++;
    print(`PASS  ${c.label} — rejected: ${e.message}`);
  }
}

print("----------------------------------------");
print(`Passed: ${passed}  Failed: ${failed}`);