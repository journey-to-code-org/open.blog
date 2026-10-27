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
      "prerequisites": "No background needed.",
      "transition": { "relationship": "background",
                      "why": "The first step assumes some knowledge of the man who wrote the image." } },
    { "id": "stoics", "target": { "kind": "atlas", "id": "stoics" }, "difficulty": "advanced",
      "transition": { "relationship": "influenced", "basis": "r-influence",
                      "why": "The atlas records this influence with its evidence." } },
    { "id": "aside", "target": { "kind": "post", "slug": "other" }, "optional": true,
      "transition": { "relationship": "applies", "why": "A worked example for readers who want one." } }
  ]
}
```

| Field | Rule |
| --- | --- |
| `format`, `version` | Required: `openblog-reading-path` and `1`. Another version is refused. |
| `title` | Required, at most 120 characters. |
| `summary` | Optional, at most 600 characters. |
| `status` | `draft` (the default) or `published`. A draft is never published. |
| `listed` | Optional, `true` by default (written only when `false`): whether discovery (#79) may list a published path. It never publishes or hides a path by itself. |
| `steps` | At most 100. A published path has at least two. |

Every text field is plain text on one line. Control and direction characters and an `atlas:` link
are refused. Fields this release does not define are kept at every level (the file, a step, a target, a
transition), written back after the defined ones in name order and never read or shown, so a round trip
loses nothing and an older release reads a newer file's known fields. A defined field of the wrong type
or outside its values, a repeated key and another `version` are refused; a message names the field and
never the value. `ReadingPath::to_canonical_json` writes two-space JSON in the order above, leaves out
absent optional fields, uses `\n` and ends with a newline; `crates/openblog-core/tests/fixtures/reading-path.json`
is the golden file, tested byte for byte.

### Steps

| Field | Rule |
| --- | --- |
| `id` | Required, a lowercase slug unique in the path. Stable across reorders. |
| `target` | `{"kind": "post", "slug": ...}` or `{"kind": "atlas", "id": ...}`. Nothing else: not a path, not a series. A target appears once. |
| `rationale` | Optional, at most 600 characters: why this step is in the path. |
| `prerequisites` | Optional, at most 400 characters: what to know first, as a note. It is not a dependency and nothing enforces it. |
| `difficulty` | Optional: `introductory`, `intermediate` or `advanced`, the author's judgement. |
| `optional` | Optional, `false` by default: a side step a reader may skip. It never changes the order. The first step is never optional. |
| `transition` | Absent on the first step, required on the others of a published path. |

The list is the order. There are no branches: a step has one predecessor, and a `next` or `branches`
field is an inert extra that is never read. Alternative routes are separate paths.

A step's transition is about the step it follows: the nearest earlier step that is not optional. After
an optional step the next step still follows the last required one, and optional steps in a row follow
the same required step, so a reader who skips any optional steps still reads every step after the step
its transition describes.

### Transitions

`{"relationship": ..., "why": ..., "basis": ...}`. `why` is required, non-blank and the author's own text
(at most 600 characters). `relationship` is required and has no default:

| Value | Reads |
| --- | --- |
| `next` | Comes next, with no further relationship claimed |
| `background` | Gives background for the step it follows |
| `builds-on` | Builds on the step it follows |
| `contrasts-with` | Contrasts with the step it follows |
| `responds-to` | Responds to the step it follows |
| `applies` | Applies the step it follows |
| `influenced` | Was influenced by the step it follows, which a published relationship states |

`background` points backwards (this step is context the followed step assumes); `builds-on` points
forwards (this step extends the followed one).

`influenced` joins two atlas entries only (a post on either end is refused when the file is read) and
requires `basis`, the id of an approved atlas relationship of kind `influenced`. It holds only if that
relationship is published and uncontested and its `(from, to)` equals (followed entry, this entry)
exactly. Chronology and order never imply influence. `basis` is refused on any other label.

## Resolution and missing steps

`PublicPaths::resolve(&[ReadingPath], &PublishedTargets)` reads paths against the posts the build
publishes and the public atlas (`PublishedTargets::from_site`) and nothing else.

- A step whose target is not published (draft, scheduled, deleted, private, withdrawn or never
  existing, all reported alike) is left out and positions are renumbered, when that leaves no trace:
  the step is last, or optional and not the step a shown step follows.
- When a shown step's followed step is left out, or its `influenced` claim does not hold (wrong
  direction, not an influence, contested, missing), the whole path is withheld with a diagnostic rather
  than shown with a step that has lost its transition. Every shown step after the first therefore has
  one.
- A path with fewer than two shown steps is not published. A draft is not published and is not reported.
- `PublishedTargets::from_site` counts a post only if production would publish it (not a draft, not
  dated after the time the site was loaded for), even when the site was loaded with drafts.
- Each of these is a `Diagnostic` for the author: the path, the step id, one sentence naming the
  id the author wrote, never a title or text of the target. The public value carries no trace.
- A path with problems never affects another path, and resolution writes no file.

`load_paths(&[SourceFile])` reads the `paths/*.json` files and returns the paths sorted by slug and every
`PathProblem` (file, step id, rule). One refused file leaves the others loaded.

## Public projection

`PublicPaths` (`openblog-reading-paths`, version 1) is an allowlist. Paths are sorted by slug and carry
`slug`, `url` (`/paths/<slug>/`), `title`, `summary`, `listed` and `steps`. A step carries `position`
(one-based, no gaps), `kind`, `kindLabel`, `target`, `title`, `url`, `rationale`, `prerequisites`,
`difficulty`, `optional` and `transition` (`relationship`, `label`, `why`, `follows`, `basis`).
`follows` is the position of the followed step. The author's step ids are not public, because an id
such as `step-3` beside `step-5` would show where a step was left out. A target's title and address come from the
published item. `to_json` escapes `<`, `>` and `&`. 

## The switch

`readingPaths.publish` in `openblog.json` (off by default, omitted from the written file while off).
`/paths/` is reserved only while it is on: a page `pages/paths.md` or a `postPath` that puts a post
there is then refused by the build and by `check`; while it is off `check` warns when path files
exist beside such a page or post. Editing paths in Admin does not need the switch.

## Limits

100 steps, 200 path files, 256 KiB per file, 64 bytes per slug or id; text limits above.

## Not defined here

Admin editing and saves (#77), pages, navigation and local progress (#78), discovery links, search,
feeds policy, `paths.json`, the publication-manifest entry and export or import (#79).
