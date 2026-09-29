const m = db.getSiblingDB("mobility");

const original = m.journey_search.findOne({
  _id: "LAB05:A",
});

// Build LAB05:GROWTH with `length` synthetic departures. Each one is spread
// from a real departure, so every field the validator requires survives.
function writeGrowth(length) {
  const growth = {
    ...original,
    _id: "LAB05:GROWTH",
  };

  growth.departures = Array.from({ length }, (_, i) => ({
    ...original.departures[0],
    tripId: `LAB05-GROWTH-${i}`,
  }));

  m.journey_search.deleteOne({ _id: "LAB05:GROWTH" });
  m.journey_search.insertOne(growth);
}

// $bsonSize reports the size in bytes of a document as it is stored, which
// is what the 16 MB per-document limit is measured against.
function measure(id) {
  return m.journey_search
    .aggregate([
      {
        $match: {
          _id: id,
        },
      },
      {
        $project: {
          _id: 0,
          bytes: {
            $bsonSize: "$$ROOT",
          },
          departures: {
            $size: "$departures",
          },
        },
      },
    ])
    .toArray()[0];
}

function report(label, r) {
  const each = r.departures === 0 ? "" : `   ${(r.bytes / r.departures).toFixed(1)} bytes each`;
  print(`  ${label.padEnd(14)} ${String(r.departures).padStart(5)} departures   ${String(r.bytes).padStart(8)} bytes${each}`);
}

print("Document sizes:");
report("LAB05:A", measure("LAB05:A"));

// An empty array measures the fixed part directly, rather than inferring it.
writeGrowth(0);
const empty = measure("LAB05:GROWTH");
report("LAB05:GROWTH", empty);

writeGrowth(100);
const small = measure("LAB05:GROWTH");
report("LAB05:GROWTH", small);

writeGrowth(1000);
const large = measure("LAB05:GROWTH");
report("LAB05:GROWTH", large);

const perDeparture = (large.bytes - small.bytes) / (large.departures - small.departures);
const limit = 16 * 1024 * 1024;

print(`\nFixed part, measured with an empty array:  ${empty.bytes} bytes.`);
print(`Average departure in the first 100:        ${((small.bytes - empty.bytes) / small.departures).toFixed(1)} bytes.`);
print(`Marginal departure from 100 to 1000:       ${perDeparture.toFixed(1)} bytes.`);

// The two figures differ because departures are not all the same size. The
// tripId LAB05-GROWTH-742 is longer than LAB05-GROWTH-7, and BSON stores an
// array as a document keyed "0", "1", "2", so the key of element 100 costs
// three bytes where the key of element 9 costs one. Later departures are
// therefore dearer than earlier ones, and a straight line through two points
// cannot describe that.

print(`Departures before the 16 MB limit:         about ${Math.floor((limit - empty.bytes) / perDeparture).toLocaleString("en-US")}.`);

m.journey_search.deleteOne({ _id: "LAB05:GROWTH" });
print("\nLAB05:GROWTH removed. The collection is back to the six fixture journeys.");