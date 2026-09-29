const m = db.getSiblingDB("mobility");
const invalid = m.journey_search.findOne({ _id: "LAB05:A" });

invalid._id = "LAB05:INVALID";

// Change one field so the document becomes invalid. The validator declares
// departureUtc as bsonType 'date', so a string of the same calendar moment
// is still the wrong shape.
invalid.departures[2].departureUtc = "2026-10-02T06:20:00Z";

function attempt(label, doc) {
  try {
    m.journey_search.insertOne(doc);
    print(`FAIL  ${label} — the document was accepted`);
    m.journey_search.deleteOne({ _id: doc._id });
  } catch (e) {
    print(`PASS  ${label} — rejected with code ${e.code} (DocumentValidationFailure)`);
    printjson(e.errInfo);
  }
}

attempt("departureUtc as a string", invalid);

// A second probe, where the type is right but the value breaks the minimum.
const negative = m.journey_search.findOne({ _id: "LAB05:A" });
negative._id = "LAB05:INVALID-SEATS";
negative.departures[2].availableSeats = NumberInt(-1);

attempt("negative availableSeats", negative);