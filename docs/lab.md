# Lecture 5: journey search in MongoDB

A MongoDB read model for journey search, alongside the PostgreSQL schema from lectures 1 to 4. The scripts are in `database/mongodb/lecture05/`; the output of every run is in `docs/evidence/`, numbered in execution order.

## 1. The search

`journey_search` holds one document per journey — a city, a route and a pair of stops on a service date — with the departures in an array inside it. A search has to find the right document, then the right element.

`search.js` runs three stages. `$match` selects journeys by city, origin and destination and requires at least one departure that is both `Scheduled` and inside the interval, expressed with `$elemMatch`. `$unwind` emits one document per departure. A second `$match` drops the departures that do not qualify. Both are needed: the first discards journeys, the second discards departures inside the journeys that survived.

The interval is half-open — inclusive start, exclusive end — so consecutive searches never return the same departure twice. `LAB05-T-OK` departs at 06:20 and `LAB05-T-EDGE` at 07:00: searching 06:00 to 07:00 returns the first only, 06:20 to 07:00 still returns the first, 07:00 to 08:00 returns the second.

Invalid input raises an error rather than returning `[]`, which would be indistinguishable from a search that legitimately found nothing.

The projection returns `serviceDate` in addition to the ten fields the assignment lists. A UTC timestamp does not say which service day a trip belongs to, and the field is already on the journey.

All six test cases pass, with both rejections. See `docs/evidence/03_search.txt`.

## 2. A query that looks right, but isn't

Stating the two departure conditions separately:

```js
{
  cityId: "CPH",
  fromStopId: "STOP-NORREPORT",
  toStopId: "STOP-AIRPORT",
  "departures.status": "Scheduled",
  "departures.departureUtc": { $gte: start, $lt: end },
}
```

returns `LAB05:A`, correctly, and `LAB05:B`, wrongly. `LAB05:B` holds two departures: `LAB05-T-B1` at 05:55, `Scheduled` but too early, and `LAB05-T-B2` at 06:15, inside the window but `Cancelled`. Neither is both.

A dotted path across an array asks whether *any* element satisfies the condition. Two such paths ask two independent questions, and the document matches when each is answered by some element — not necessarily the same one. `LAB05-T-B1` answers the first, `LAB05-T-B2` the second.

`$elemMatch` binds both conditions to one element:

```js
{
  cityId: "CPH",
  fromStopId: "STOP-NORREPORT",
  toStopId: "STOP-AIRPORT",
  departures: {
    $elemMatch: {
      status: "Scheduled",
      departureUtc: { $gte: start, $lt: end },
    },
  },
}
```

With it, only `LAB05:A` matches.

The danger is that nothing announces the error. No warning, and a plausible result: a journey from Nørreport to the airport, which is what was asked for. The passenger is shown a departure that is cancelled or twenty minutes gone. Hence a fixture built out of near misses rather than data where everything matches.

See `docs/evidence/04_search_bug.txt`.

## 3. Updating data stored twice

`LAB05-T-OK` lives in two journeys, `LAB05:A` to the airport and `LAB05:C` to the central station — one trip, written down twice so two searches can find it.

It sits third in one array and first in the other, so a fixed path such as `departures.2.status` would hit the wrong departure. `arrayFilters` names a condition instead of a position: `{ "trip.tripId": "LAB05-T-OK" }` defines `trip`, and the update writes `departures.$[trip].status`.

**matchedCount and modifiedCount.** Cancelling twice gives `matched 2, modified 2`, then `matched 2, modified 0`. The filter asks which journeys contain the trip, not which ones need changing, so it still finds both; nothing is written because the value is already there. The update is idempotent and safe to retry.

**What duplication costs.** Cancelling in `LAB05:A` alone makes the two searches contradict each other about the same trip at the same minute. No constraint is violated: the validator checks one document at a time and cannot express that two documents must agree. Repairing with `updateMany` reports `matched 2, modified 1` — both hold the trip, one still needed changing.

**Moving a departure.** Moving to 07:05 reports `matched 2, modified 2`. The check has two halves: 06:00 to 07:00 no longer finds the trip, and 07:00 to 08:00 does. The first half alone proves nothing, because a cancelled or deleted departure would look identical. The later search also returns `LAB05-T-EDGE`, which departs at exactly 07:00 — excluded from the earlier window by the exclusive end, included here by the inclusive start, counted once across the two.

**Why document D keeps its price.** Repricing `cityId: "CPH"` and `routeId: "LINE-M2"` changes `LAB05:A`, `LAB05:C`, `LAB05:E` and `LAB05:F`. `LAB05:B` has another route. `LAB05:D` has the same route but another city. `LINE-M2` exists in two cities, so filtering on the route alone would have repriced a city nobody meant to touch — silently, because such an update is perfectly valid. An identifier is only as unique as the scope it is unique within, and the filter has to name that scope.

This price belongs to the search model. Tickets in PostgreSQL keep the price agreed at purchase.

See `docs/evidence/05_updates.txt`.

## 4. How large the document can get

`$bsonSize` on a copy of `LAB05:A`: 227 bytes with an empty array, 12,307 with 100 departures, 123,007 with 1,000.

The per-departure cost is 120.8 bytes across the first hundred and 123.0 across the last nine hundred. Departures are not uniform: `LAB05-GROWTH-742` is longer than `LAB05-GROWTH-7`, and BSON keys an array `"0"`, `"1"`, `"2"`, so element 100 costs two bytes more than element 9 simply to be addressed. That is why the fixed part is measured with an empty array rather than inferred — the line is not straight.

At 123 bytes each, the 16 MB limit is 136,000 departures away: two years for a line running two hundred a day. That is the wrong number to plan against.

What bites first is that every change rewrites the whole document. Cancelling one departure costs 691 bytes at four departures; at a year's worth it costs megabytes read and written to change one word. Reads pay the same way: a twenty-minute window fetches the entire array before discarding almost all of it. And two operators cancelling unrelated departures on the same line contend for the same document.

**The decision.** Bound the array by service date — one document per journey per day, keyed `CPH:LINE-M2:STOP-NORREPORT:STOP-AIRPORT:2026-10-02`. `serviceDate` is already on every document, so the split follows a boundary the data has. The array then holds a few dozen departures and stops growing with time, and past days become whole documents that are easy to archive or delete.

Section 5 removes the array entirely.

See `docs/evidence/06_growth.txt`.

## 5. One departure per document

`alternative.js` builds `journey_search_by_trip`: one document per dated trip and stop pair, carrying the journey's attributes alongside the departure's own. Six journeys become ten documents.

The `_id` is derived from the business keys — city, route, origin, destination, service date, trip. Nothing random goes into it, so the same input always yields the same identifier: rebuilding replaces rather than duplicates, and a writer can address a departure without looking it up first.

`LAB05-T-OK` still appears twice, under both destinations.

The table compares the two collections on the four points the assignment asks about. `journey_search` is the original model, `journey_search_by_trip` the new one; each row is one point, so the columns read against each other line by line.

| | `journey_search` | `journey_search_by_trip` |
|---|---|---|
| Writing the search | `$elemMatch`, `$unwind`, second `$match` | a single `find` |
| Duplication | two documents, at different array positions | two documents, each with a computable identifier |
| Changing a trip | `arrayFilters` and `$[trip]`; two documents | plain `$set` on a top-level field; two documents |
| Growth | array grows without bound inside one document | documents fixed in size; only their number grows |

**Writing the search.** A plain `find`. The section 2 bug is impossible, because there is no array for two conditions to land on different elements of. The eight test cases return identical results against both collections. The index `{ cityId, fromStopId, toStopId, departureUtc }` is no longer multikey: one entry means one departure, and the document it points at is the answer rather than a journey still to be filtered.

**Duplication.** Not removed — made addressable. In the array model a copy is an element at an unknown position inside a document whose identifier says nothing about its contents. Here every copy has an identifier the writer can compute. Duplication is inherent to a search model; the question is whether every copy can be found reliably.

**Changing a trip.** `updateMany({ tripId: "LAB05-T-OK" }, { $set: { status: "Cancelled" } })`, reporting `matched 2, modified 2`. No `arrayFilters`, because `status` is a field of the document. Two documents still have to be reached, but the statement that reaches both is now the simplest one available rather than the most intricate.

The cost falls the other way. Journey attributes are repeated on every departure, so the section 3 price change would touch seven documents here against four in the array model, and repetition costs storage. Cheaper per-departure writes, more work per route-wide change.

**Growth.** Documents no longer grow; only their number does. Changing one departure writes one departure, a search reads only what it returns, and two writers touching different departures touch different documents. Document count and index size grow instead, which is the growth a database is built to absorb.

**Which model to continue with.** `journey_search_by_trip`. A simpler search that structurally cannot exhibit the array bug, ordinary field updates, and document size bounded by construction rather than by a policy someone has to remember to enforce.

Neither collection is the system of record. Both derive from PostgreSQL, which holds the tickets, the payments and the prices actually charged. That is what makes the choice reversible, and deterministic identifiers are what let `alternative.js` rebuild the model in a single run.

See `docs/evidence/07_alternative.txt`.