# Reading paths

A reading path is an author-curated, ordered list of published posts and Knowledge Atlas entries.
Each step after the first says, in the author's words, why it follows and how it relates to the step
before. It is owned by `openblog_core::reading_path`. Decisions are in
[ADR 0240](../adr/0240-a-reading-path-is-its-own-content-type-and-never-a-series.md) (its own type, not a series),
[ADR 0241](../adr/0241-a-path-is-one-versioned-plain-text-json-file-written-canonically-and-never-loses-a-field.md) (the file),
[ADR 0242](../adr/0242-a-path-is-one-line-of-steps-with-no-branches-no-repeats-and-no-path-inside-a-path.md) (steps),
[ADR 0243](../adr/0243-a-transition-is-the-authors-own-words-with-a-closed-relationship-that-never-defaults-to-influence.md) (transitions),
[ADR 0244](../adr/0244-a-path-names-only-published-items-and-a-missing-step-is-left-out-and-reported-to-the-author-only.md) (missing steps) and
[ADR 0245](../adr/0245-the-public-paths-value-is-an-allowlisted-deterministic-projection-and-nothing-reads-a-path-yet.md) (the public value).

This task defines the contract and the core types. Admin editing (#77), pages and local progress
(#78) and discovery and export (#79) build on it; until they land nothing renders, indexes or
exports a path, and a site builds exactly as before.

## File

`content/paths/<slug>.json`. The slug is the file name: lowercase ASCII letters, digits and single
hyphens, at most 64 characters. A path never changes a post or a series.

```json
{
  "format": "openblog-reading-path",
  "version": 1,
  "title": "From the cave to the classroom",
  "summary": "A short route through Plato and what later readers made of him.",
  "status": "published",
  "steps": [
    { "id": "cave", "target": { "kind": "post", "slug": "the-cave" },
      "rationale": "Start with the image itself.", "difficulty": "introductory" },
    { "id": "plato", "target": { "kind": "atlas", "id": "plato" },
      "prerequisites": "No background needed.", "optional": true,
      "transition": { "relationship": "background",
                      "why": "The author of the image is worth knowing before the later readers." } },
    { "id": "stoics", "target": { "kind": "atlas", "id": "stoics" }, "difficulty": "advanced",
      "transition": { "relationship": "influenced", "basis": "r-influence",
                      "why": "The atlas records this influence with its evidence." } }
  ]
}
```

| Field | Rule |
| --- | --- |
| `format`, `version` | Required: `openblog-reading-path` and `1`. Another version is refused. |
| `title` | Required, at most 120 characters. |
| `summary` | Optional, at most 600 characters. |
| `status` | `draft` (the default) or `published`. A draft is never published. |
| `steps` | At most 100. A published path has at least two. |

Every text field is plain text on one line. Control and direction characters and an `atlas:` link
are refused. Unknown fields are refused at every level (never dropped), so a round trip loses
nothing. `ReadingPath::to_canonical_json` writes two-space JSON in the order above, leaves out absent
optional fields, uses `\n` and ends with a newline; `crates/openblog-core/tests/fixtures/reading-path.json`
is the golden file, tested byte for byte.

### Steps

| Field | Rule |
| --- | --- |
| `id` | Required, a lowercase slug unique in the path. Stable across reorders. |
| `target` | `{"kind": "post", "slug": ...}` or `{"kind": "atlas", "id": ...}`. Nothing else: not a path, not a series. A target appears once. |
| `rationale` | Optional, at most 600 characters: why this step is in the path. |
| `prerequisites` | Optional, at most 400 characters: what to know first, as a note. It is not a dependency and nothing enforces it. |
| `difficulty` | Optional: `introductory`, `intermediate` or `advanced`, the author's judgement. |
| `optional` | Optional, `false` by default: a side step a reader may skip. It never changes the order. |
| `transition` | Absent on the first step, required on the others of a published path. |

The list is the order. There are no branches: a step has one predecessor, and a `next` or `branches`
field is an unknown field. Alternative routes are separate paths.

### Transitions

`{"relationship": ..., "why": ..., "basis": ...}`. `why` is required, non-blank and the author's own text
(at most 600 characters). `relationship` is required and has no default:

| Value | Reads |
| --- | --- |
| `next` | Comes next, with no further relationship claimed |
| `background` | The previous step is background for this one |
| `builds-on` | Builds on the previous step |
| `contrasts-with` | Contrasts with the previous step |
| `responds-to` | Responds to the previous step |
| `applies` | Applies the previous step |
| `influenced` | Was influenced by the previous step, which a published relationship states |

`influenced` requires `basis`, the id of an approved atlas relationship of kind `influenced`. It
holds only if that relationship is published and, where an end of the transition is an atlas entry,
runs from the earlier entry to the later one. Chronology and order never imply influence. `basis` on
another label is shown only if it holds; otherwise it is dropped alone.

## Resolution and missing steps

`PublicPaths::resolve(&[ReadingPath], &PublishedTargets)` reads paths against the posts the build
publishes and the public atlas (`PublishedTargets::from_site`) and nothing else.

- A step whose target is not published (draft, scheduled, deleted, private, withdrawn or never
  existing, all reported alike) is left out. Later steps are renumbered.
- The transition of a step whose predecessor was left out is dropped.
- A failed `influenced` basis drops the whole transition; any other failed basis is dropped alone.
- A path with fewer than two shown steps is not published. A draft is not published and is not reported.
- Each of these is a `Diagnostic` for the author: the path, the step id, one sentence naming the
  id the author wrote, never a title or text of the target. The public value carries no trace.
- A path with problems never affects another path, and resolution writes no file.

`load_paths(&[SourceFile])` reads the `paths/*.json` files and returns the paths sorted by slug and every
`PathProblem` (file, step id, rule). One refused file leaves the others loaded.

## Public projection

`PublicPaths` (`openblog-reading-paths`, version 1) is an allowlist. Paths are sorted by slug and carry
`slug`, `url` (`/paths/<slug>/`), `title`, `summary` and `steps`. A step carries `id`, `position`,
`kind`, `kindLabel`, `target`, `title`, `url`, `rationale`, `prerequisites`, `difficulty`, `optional` and
`transition` (`relationship`, `label`, `why`, `basis`). A target's title and address come from the
published item. `to_json` escapes `<`, `>` and `&`. The address `/paths/` is reserved.

## Limits

100 steps, 200 path files, 256 KiB per file, 64 bytes per slug or id; text limits above.

## Not defined here

Admin editing and saves (#77), pages, navigation and local progress (#78), discovery links, search,
feeds policy, `paths.json`, the publication-manifest entry and export or import (#79).
