# Passage alignments format

Private alignments of corresponding places across editions, translations, witnesses, and
interpretations, owned by `openblog_core::alignment` and stored in
`.openblog/private/research/alignments.json`. Decisions:
[ADR 0116](../adr/0116-passage-alignments-record-correspondence-never-equivalence.md) and
[ADR 0117](../adr/0117-alignments-take-their-lock-after-claims-and-guard-what-they-use.md). The
file never reaches a public page, feed, export, or search index, and nothing in it can mark an
alignment public.

An alignment records where its author reads places as corresponding. It does not say they mean
the same thing, and no version is treated as authoritative.

```json
{
  "version": 1,
  "alignments": [
    { "id": "cave-opening", "label": "Opening of the cave image", "correspondence": "partial",
      "members": [
        { "source": "burnet-1902", "passage": "p-burnet-514a",
          "normalized": { "text": "μετὰ ταῦτα", "note": "Accents composed" } },
        { "source": "republic-grube-reeve", "passage": "p-grube-186" },
        { "source": "republic-grube-reeve", "passage": "p-grube-187",
          "note": "The translator splits one sentence in two" },
        { "interpretation": "cave-514a-ada" },
        { "source": "paris-gr-1807", "absent": true, "note": "Folio 12 is lost" }
      ],
      "rationale": "Both translations render 514a.", "confidence": "plausible",
      "recordedBy": { "kind": "author" },
      "evidence": [{ "source": "republic-slings-2003",
                     "locators": [{ "kind": "canonical", "value": "514a" }] }],
      "visibility": "private" }
  ]
}
```

Alignment order and member order are preserved and never sorted. Unknown fields are kept at
every level, but may not reuse a defined field's name. The canonical form writes defaults
(`correspondence`, `confidence`, `recordedBy`, `visibility`) explicitly and omits `absent:
false`. No text is trimmed or Unicode-normalized.

## Alignments

| Field | Rule |
| --- | --- |
| `id` | Required slug, at most 64 bytes, unique among alignments. |
| `label` | Optional one-line private label, at most 200 characters. |
| `correspondence` | `corresponding` (default), `partial`, or `divergent`. There is no "equivalent". |
| `members` | Two to 32 members relating at least two distinct versions or interpretations, at least one of them present. |
| `rationale` | Optional, at most 4,000 characters; line breaks allowed. |
| `confidence` | `tentative` (default), `plausible`, or `strong`: a label on the author's reading. |
| `uncertainty` | Optional, at most 2,000 characters. |
| `recordedBy` | `{ "kind": "author" }` (default), `{ "kind": "source", "source": id }`, or `{ "kind": "named", "name": text }`. |
| `evidence` | Up to 20 `{ "source", "locators"?, "passage"? }`, as in the Knowledge Atlas. |
| `visibility` | Always `private`. |

## Members

Each member is exactly one of:

- **A place in a version.** `source` is an edition, translation, or witness (never a work or a
  reference). It needs `locators` (up to eight notebook locators, as in the notebook) or a
  notebook `passage` quoted from that same source, or both. Pages cannot address a work and
  folios need a witness. Locators beside a passage record where the author found the place when
  aligning it.
- **An interpretation.** `interpretation` names an interpretation in the source library
  (ADR 0115). It carries no source, locators, passage, or `absent`, because the interpretation
  names its own.
- **An absence.** `source` with `absent: true` records that the version lacks the passage. It
  has no locators, passage, or normalization, and the same version may not also be present in
  the alignment.

Any member may have a one-line `note`. A member with a passage or interpretation may have
`normalized: { "text", "note"? }`: the author's normalization of the original wording, at most
20,000 characters with line breaks allowed and control or bidirectional override characters
refused. The original wording is always the passage's excerpt or the interpretation's text.

A member repeated in one alignment (the same source, interpretation, passage, locators, and
absence) is refused. One place may appear in several alignments.

## Diagnostics and notices

Diagnostics have a stable kebab-case `code`, `collection` (`alignments`), the alignment's
`index` and `id`, a `field` path such as `members[1].locators[0].kind`, and a `message` that
never repeats authored text. Codes specific to alignments: `wrong-source-kind`,
`unknown-interpretation`, `duplicate-member`, `conflicting-member`, `missing-counterpart`,
`missing-locator`, `missing-original`, and `unknown-alignment`.

Notices never block a change: `stale-locator` (a member's locators differ from those of the
passage it names, which may have been re-located since it was aligned) and `archived-member` (a
member rests on an archived source or passage). `openblog check` prints them.

## Storage, guards, and Admin API

The file obeys the claims file's storage rules: revision-checked changes, atomic rename, a lock
beside it (`alignments.json.lock`), 4 MiB, and damaged files reported and never replaced. Locks
are taken in the order atlas, claims, alignments, notebook, library. A source, interpretation,
or passage an alignment uses cannot be removed, and a notebook or library change that would make
a valid alignments file invalid is refused.

`GET /admin/api/research/alignments` returns `file`, `revision`, `stored`, `alignments`,
`notices`, and `notice` (the statement above), and, read under the same snapshot for the
comparison workspace ([ADR 0124](../adr/0124-the-comparison-workspace-reads-one-snapshot-and-identifies-every-place.md)):
`sources` (every library record, each version with `rightsStatus` `{ status, label, declared,
note?, license? }` and every record with its `chain` of the records it realizes), `passages`
(notebook passages with their exact excerpts), `interpretations` (each interpreter with a
`display` name, a contributor's registry name or the stated name, and the interpretation's
`rightsStatus`), and `correspondences` (each value with its "The author reads…" label). Every
change returns the same view. `POST` creates and `PUT` updates one alignment
sent as `{ "revision", "alignment" }`; `DELETE` sends `{ "revision", "id" }` and returns the
`removed` alignment. Bodies are limited to 256 KiB. A stale revision returns `409` with
`conflict`, the latest `revision`, and the stored `current` alignment; invalid input returns `422`
with `diagnostics`. Neither writes anything.

## Comparison workspace

Admin Studio's **Compare** view (under Research, beside Notebook and Atlas) reads the view above
and shows one alignment at a time: a column per version or interpretation in the author's member
order, side by side or as a single-column ordered list, collapsing to one column on narrow
screens in the same order. Every place names its version, maker (editor, translator, scribe, or
interpreters, with attribution certainty), and locator in visible text; original wording is shown
exactly with its `lang` and a direction from its language tag (`dir="auto"` without one);
normalizations appear only on request, labelled and under the original; absent members say so in
words. Copy and download take only the places the author selects, with their rights statements,
and ask for confirmation when a selected version's rights are unchecked or reserved
([ADR 0125](../adr/0125-copying-from-a-comparison-takes-only-selected-places-with-their-rights.md)).
Nothing is published and nothing is stored in the browser.
