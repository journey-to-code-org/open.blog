# Service areas

A service area is a town you serve. You list them once in `openblog.json`, under `serviceAreas`. A site without
the member builds exactly as it did before ([ADR 0400](adr/0400-service-areas-are-a-versioned-list-of-towns-in-openblog-json-checked-for-duplicates-with-regions-formatted-from-a-bundled-list-and-absent-means-nothing-changes.md)).

```json
{
  "serviceAreas": {
    "version": 1,
    "areas": [
      { "town": "Bend", "region": "OR", "note": "within 30 miles" },
      { "town": "Sisters", "region": "Oregon" }
    ]
  }
}
```

- **`town`** and **`region`** are required and are checked the way a job's `place.town` and `place.region` are
  ([Jobs](jobs.md)): a plain name, with no digits and no commas, so a street address or postal code is refused.
  Nothing finer than a town is ever stored or published.
- **`region`** is formatted from a bundled list of US states (and DC) and Canadian provinces and territories:
  `Oregon`, `oregon` and `OR` are all stored as `OR`. A region the list does not know is kept as you wrote it.
- **`note`** is optional: one line of plain text, at most 120 characters, such as `within 30 miles`. It is shown
  as written.
- A bare list of areas is read as version 1. A newer `version` is refused with a message and the file is not
  changed.

## What is refused

Every problem is a sentence that names the entry and the field, and all of them are shown, in `openblog check`
and `openblog build`:

- the same town and region twice, ignoring case and spelling of the region
  (``serviceAreas entry 2: Bend, OR is already listed as entry 1; list each town once``). The same town in two
  regions is fine.
- a missing town or region, a town that looks like an address, a note over one line or 120 characters, a key this
  release does not know.
- more than 100 areas: a page for every town in a region is thin content.

Each area's address is derived from its town, `/areas/bend/`. A town listed in two regions gets the region added
(`/areas/portland-me/`, `/areas/portland-or/`), so the same list always gives the same addresses in any order.
