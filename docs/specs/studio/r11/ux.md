# Studio UX, retirement slices R11 and R12: Research I and II

By `studio-ux`, 2026-11-14. One spec for both slices; every section says what ships in **R11** and what in **R12**. Sources: `studio-ux`, `studio-architecture`, `words/spec.md` (ids, `say()`, `{helper}` `{product}` `{owner}`, persona rule, `HER_BANNED`), `docs/studio-words.md`, `retirement-plan.md` (§1 A "Kept panels across the research workspace", §1 B "Pane: Evidence", "Publication review", "Beside the draft", §1 F, §2 test rules, §4 R11–R12, Decided 5 "port all"), `docs/research-profile.md`, `r5/ux.md` (DOI/License in details, `citations`/`citationLocale` read-only, kind picker), `r6/ux.md` (cards in place, Add something, "Cite, Claim, Research panel → R11/R12", Abstract/References, `word-blocks.js`), `r7/ux.md` (Research checks in Before you publish, "Open it buttons in R11/R12", site cases → R12), `r8/ux.md` (disclosure pattern, `research: off`), `r10/ux.md` (shape, strangers' text, "R12 links Evidence"); old Admin `web/admin/admin.js`: `RESEARCH_PANELS`/`WORKSPACE_VISIBILITY`/`canonicalAdminHash` l.247–317, source library helpers l.1344–1622, notebook helpers l.1624–1810, citations l.1811–2290, draft-side panel l.2186–2985 (`literalMarkdownLine`, `quotationMarkdown`, `convertedNoteMarkdown`, `contextLinkMarkdown`, `insertMarkdownBlock`, `draftResearchItems`, `contextLinkWarning`, `createDraftResearchPanel`), curation l.2930–3540, `citationChip` 3555, `createCaptureForm` 3612, atlas l.3895–5500 (`createAtlasForm` 4924), alignments/compare l.5506–6300 (`RIGHTS_NEEDING_CONFIRMATION` 5515, `comparisonExportText` 5710), claims l.6310–7110 (`createClaimsStudio` 6607), `createBoundaryPreview` 8520, `createPublicationReview` 8649, `evidenceStudioState`/`citationExportStatus`/`citationEvidenceRows` 8825–8865, views `showSources` 16119, `showResearchOverview` 16627, `showPublicPreview` 16720, `showResearch` 16798, `showAtlas` 17300, `showCompare` 17847, editor `updateEvidence` 25046, `exportCitedReferences` 25102, `openCitationDialog`/`applyCitation` 25505–25620, `insertFromResearch` 25778, `openResearchCapture` 25910; Admin API `crates/openblog-cli/src/admin.rs` route table l.981–1022 and 1205–1216, `list_sources`…`export_sources` l.1404–1600, `citation_library`/`check_citation_request` l.1673–1766, `draft_research` l.1821, notebook l.2060–2420, `meta` l.4475 (`siteUses`), `admin/curation.rs`; core `source_library.rs` (`SourceDiagnosticCode`), `citations.rs` (`CitationDiagnosticCode`, CSL labels), `research_notes.rs`, `knowledge_atlas.rs` (one code enum for atlas and claims), `curated_selection.rs` (`Code`), `config.rs` (`knowledge_atlas`, `claim_evidence`, `comparisons`, `curated_context`, `interpretations`); tests `tests/web/admin-{sources,research-notebook,citations,draft-research,research-workspace,research-atlas,research-compare,research-claims,curation,boundary,readiness-report,publication-review}.test.mjs`, browser `research-workspace, citations, draft-research, atlas, chronology, compare, claims, curation, public-boundary, research-readiness, curated-context`; Studio `router.js` (`NOT_YET`, `legacyRoute`), `parts/{word-box,word-blocks,research-sections,add-words}.js`.

**Studio is a product.** The owner is any subscriber; personas judge screens, and no shipped default names a person, family, food, site or source. Every string below is a word id read with `say(id, vars)`. Wireframe data ("Plato, Republic", "Ruth") is data, never a default.

## Who this is for

- **The research owner** ("Ruth" in tests): a historian, teacher or independent scholar who writes research posts on her own blog. She knows what a source, an edition, a translation, a manuscript, a citation, a DOI and Zotero are; she does not know or want JSON, file paths, revisions, front matter, Markdown or `openblog.json`. **Her layer is the first layer of every research screen.** Scholarly words are her words; system words are not (§Her words).
- **The developer** ("Mikey"): file names under `.openblog/private/research/`, revisions, raw records, diagnostic codes and fields, keys, what each insertion writes, the projections and config switches. One step deeper, under **For {helper}** (`common.forHelper`).
- **A non-research owner** (the recipe writer, the roofer): **sees nothing.** No Research navigation, no Cite or quotation in Add something, no research group in About this post, no research entries in Find, no research sentences anywhere. Her Studio is byte-for-byte what it was before R11. The gate is `meta.siteUses.research` (G92); the only door is the developer's Find entry (⚑ 1).

**The jobs.** R11: "From a source to a cited post" — keep my sources, keep the exact words I read with where they are, and cite them while I write. R12: "What am I claiming, how do my sources relate, and what will readers see?" After R12, nothing about research opens the old Admin.

**Decided (owner, 2026-11-13):** Decided 5 — port all of research (R11–R14). This spec covers R11 and R12; comparisons pages and reading paths are R13, shared reflections R14.

**Decisions in this spec the owner should check** (⚑ where they appear):
1. ⚑ **Research shows only where it's used** (G92 `meta.siteUses.research`). A site starts using research when the developer opens Find › **Start research (for {helper})** (always listed, like R10's setup entry) and adds a first source, or a post is a research post or cites. Write's kind picker offers "Research" on such sites (R5 offered it only on posts already research).
2. ⚑ **Scholarly words are her words.** Source, edition, translation, witness, reference, citation, quotation, passage, DOI, ISBN, CSL JSON, BibTeX, Zotero, archive and a source's **key** appear on her layer; nothing from `HER_BANNED` does. "Capture" is banned, so the old **Capture** is **Keep a passage**.
3. ⚑ **A citation is inline, so it stays in her words as she or Studio typed it** (`[@plato-republic, page 514]`), exactly as R6 left links in words. It is never a block card (that would split her paragraph); each words box lists its citations directly under it as a **Cited here** row of chips with **Change**, **Show me** and **Take it out**. A **quotation from her notebook** is a block, so it is a **card in place** (new R6 card kind `quotation`). No rich-text editor is added.
4. ⚑ **The first citation in a post turns on numbered notes** (`citations: notes`), says so in its status, and its Undo takes both back. Without it, the build shows `[@…]` as plain text.
5. ⚑ **How sources show and the notes' language move to her layer**, in About this post › **Sources in this post** (R5 had `citations` and `citationLocale` as the developer's read-only lines).
6. ⚑ **Your research docks beside Write on a desktop** (≥ 70rem, non-modal, like the old panel) and is a side sheet below that.
7. ⚑ **Unsaved research forms are kept in memory while she moves between research screens** (§1 A "kept panels"); leaving research or the app asks. Nothing private is written to storage, except a form she couldn't send with no signal, which is kept in this tab's `sessionStorage` and says so.
8. ⚑ **Undo where the old Admin only asked:** editing or removing a passage, note, source, atlas entry, relationship, alignment or claim gives **Undo** (Studio writes the previous record back). Imports have no Undo: the preview is the one question, and an import never removes anything.
9. ⚑ **Rights statements and interpretations stay edited in the file** (the old Admin had no editor for either); Studio shows them read-only where they matter and names the field in details.
10. ⚑ **Nothing is looked up online.** No Zotero sync, no DOI or ISBN lookup, no link previews; CSL JSON files cover Zotero, Mendeley and others. BibTeX is offered for export only (the server has no BibTeX import).
11. ⚑ **The old bare `#/research` (it meant the notebook) opens Research home**, Studio's own address; `#/research/notebook` still opens the notebook.
12. ⚑ (R12) **Claims are checked against the saved post.** A draft autosaves, so this is invisible; a published post with unsaved changes says "Press Update first."
13. ⚑ (R12) **Historical years are typed as plain years with BCE/CE**, never as negative numbers.

## What ships when

| | R11 — Research I (XL) | R12 — Research II (XL) |
| --- | --- | --- |
| Screens | Research home (steps 1, 2, 4), Sources, Notebook | Atlas (entries, links, datings, Chronology), Compare, What readers see; home steps 3 and 5 |
| Write | Cite (Add something), Cited here chips, quotation cards, Your research (passages, sources, interpretations, notes), Keep these words as a passage, Sources in this post | Claims and evidence sheet; Your research: atlas/comparison links, datings, **For readers** |
| Elsewhere | gate (G92), nav, `legacyRoute`, Find, kept forms, R7 "Open it" for sources/passages/notes | R7 "Open it" for the rest + per-post "What readers will see"; R10 claim links; notebook concepts ↔ atlas |
| API | `sources*`, `research/notebook`, `search`, `backlinks`, `archive`, `import`, `export`, `passages`, `notes`, `citations/*`, `research/draft`, `preview.citations` | `research/atlas*`, `research/alignments`, `research/claims*`, `research/boundary`, `research/readiness`, `research/curation*` |
| Gaps | G92, G93 (its routes), G94, G95 | G93 (its routes) |
| Until it ships | `#/research/{atlas,compare,public}` open "Not in Studio yet" | — |

## Her words

**Her layer (research screens):** source, work, edition, translation, witness ("a manuscript or other surviving copy"), reference ("a place in a source"), key, passage, "the exact words", "where it is", page, folio, line, section, chapter, "canonical place", time, note, question, observation, concept, cite, citation, quotation, "your notebook", "your library", archive, import, export, CSL JSON, BibTeX, Zotero, DOI, ISBN, rights, "readers see", "private", R12: atlas, entry, person, movement, event, link between entries, "who says so", "how firmly", evidence, dating, "about (c.)", BCE/CE, claim, supports, contradicts, "gives context", alignment, version, "side by side", "what readers will see".

**Never on her layer:** `HER_BANNED` (incl. capture, metadata, profile, contributor, markdown, syntax, block, front matter, slug, JSON alone, storage, sync), plus: revision, file, `.openblog`, record, payload, projection, manifest, boundary, curation, diagnostic, anchor, offset, schema, `openblog.json`, ADR. Those live under **For {helper}**. Format names are allowed only as the name of a file kind she picks ("CSL JSON", "BibTeX").

## Navigation, routes and what each owner sees

| Job | Lands in | Route | Slice | Replaces |
| --- | --- | --- | --- | --- |
| Where is my research, what's next | **Research** home | `#/research` | R11 | old `#/research/overview` (Workflow) |
| Keep and find sources; import, export | **Sources** | `#/research/sources[/<key>]` | R11 | old `#/research/sources`, `#/sources` |
| Keep passages and notes; search; import, export | **Notebook** | `#/research/notebook[/<id>]` | R11 | old `#/research/notebook`, `#/research` |
| Cite, quote, turn a note into my words | Write: **Cite**, quotation cards, **Your research** | `#/write/<path>[?sheet=research\|?add=cite]` | R11 | old Insert citation dialog, draft-side Research panel |
| Keep words from my post as a passage | Write › More › **Keep these words as a passage** | sheet | R11 | old Capture research |
| How sources show; download what a post cites | About this post › **Sources in this post** | `?sheet=about` | R11 | old Evidence pane citation rows and exports |
| Relate people, works, ideas; datings | **Atlas** | `#/research/atlas[/<id>\|/relationships/<id>\|/chronology]` | R12 | old `#/research/atlas`, `#/atlas` |
| Read versions side by side | **Compare** | `#/research/compare[/<id>]` | R12 | old `#/research/compare`, `#/compare` |
| What readers will see | **What readers see** | `#/research/public` | R12 | old `#/research/public` |
| Claims and evidence for this post | Write: **Claims and evidence** sheet | `#/write/<path>?sheet=claims` | R12 | old Evidence pane (claims) |
| Choose context for readers of this post | **Your research** › **For readers** | sheet | R12 | old "Selected for readers" |

- **Nav:** "Research" (`research.nav`), after Posts, shown when `meta.siteUses.research`. **Area tabs** (links; `research.tab*`): Overview · Sources · Notebook (R11) · Atlas · Compare · What readers see (R12). Under 30rem the tabs are a `select-field` labelled `research.tabsLabel` "Part of your research" (six links don't fit at 320 px).
- **`legacyRoute`:** `#/research/overview` → `#/research`; `#/sources[/<id>]` → `#/research/sources[/<id>]`; `#/atlas[/…]` → `#/research/atlas[/…]`; `#/compare[/<id>]` → `#/research/compare[/<id>]`; an unknown `#/research/<x>` → `#/research`; `#/edit/<path>?pane=evidence` → `#/write/<path>?sheet=claims` (R12; in R11 `?sheet=research`). Bare `#/research` is Studio's own (⚑ 11). R11 removes `research` from `NOT_YET` and adds `RESEARCH_NOT_YET = atlas, compare, public`, which open `#/not-yet/research` until R12 (never a blank screen). Query strings are kept.
- **Find:** always: "Start research (for {helper})" (`research.findStart`). With research: "Research", "Sources", "Add a source", "Notebook", "Keep a passage", "Write a note", "Search your notebook", "Import sources", "Export your library", "Save a copy of your notebook"; in Write: "Cite", "Your research", "Put in a quotation", "Keep these words as a passage", "Sources in this post"; R12: "Atlas", "Add an entry", "Chronology", "Compare", "What readers see", "Claims and evidence", "Make a claim from the selected words", "For readers".

| | Non-research owner | Research owner | Developer |
| --- | --- | --- | --- |
| Navigation | nothing | Research, tabs | + Find › Start research |
| Write | unchanged | Cite, quotation cards, Cited here chips, Your research, Sources in this post; R12 Claims and evidence, For readers | + What it writes, keys, the words as written |
| Research screens | — | forms in her words, Undo, import/export, rights shown | + file, revision, raw record, codes, rights field, interpretations' fields, projection switches |
| Errors | — | one sentence on the field; "nothing changed" | + code, field path, server sentence |

## Flows

```
R11
Research home ──> Sources ──[Add a source]──> source form ──> "Source added." Undo
      │               └─ More: Import sources (preview → Import n) · Export your library
      ├──> Notebook ──[Keep a passage]──> passage form (+ a note about it) ──> "Kept in your notebook." Undo
      │       └─ search · filters · Also about this · More: Save a copy · Bring in a copy
      └──> "Back to your post" ──> Write
Write ── caret in words ──[Add something › A citation]  or  [Cite] on a chip  or  "/" "cite"
      └─> Cite form (sheet step 2): find source · start from a passage · where in it ──[Cite it]
            ──> citations/check ──> marker at the caret; "Cited here" chip; toast "Cited." Undo
Write ── More › Your research (desktop: docked right) ── search ── passage ──[Put the quotation in]
            ──(rights unknown: asks once)──> quotation card after this paragraph; Undo
                                   note ──[Turn into my own words…]──(asks once)──> paragraphs; Undo
R12
Research home ──> Atlas (entries · links · datings · chronology) ──> Compare (alignments, side by side, copy)
             └──> What readers see (each store: published / held back, why; site research checks)
Write ──[Claims and evidence]──> Make a claim from the selected words ──> Link evidence ──> readers can see it
Your research ──> atlas entry / comparison ──[Put in a link]   ·  For readers: select · see what readers get · order
```

**Getting back:** breadcrumb `Home > Research > …` everywhere; every research screen has the area tabs; sheets close with ✕/Escape to the control that opened them; **Back to your post** on Research home and in each research screen's header when a post was open (the old `workspaceDraft`). Nothing depends on browser Back.

## Inventory: every research feature the old Admin had

| Old Admin | Does | API | Decision | Layer | Slice |
| --- | --- | --- | --- | --- | --- |
| Workflow panel (4 steps, counts, unreadable states, "Back to the draft") | overview | `sources`, `research/notebook` | **Research home** (steps, counts, unsaved banner) | her | R11 (steps 3, 5 in R12) |
| Panel visibility labels "Private research"/"Publishable" | | — | `status-badge` per step and item: **Private** / **Readers see this** | her | R11 |
| Kept unsaved panels across the workspace | `keepCurrentView` | — | in-memory kept forms + banner ⚑ 7 | her | R11 |
| Sources list, search, type filter, archived filter, counts | | `GET sources` | **Sources** list | her | R11 |
| Source form: id, kind, title, of, basedOn, language, issued, location (scheme, value, volume), creators (`Name \| role` lines), identifiers (`scheme: value` lines) | | `POST/PUT sources` | form in her words; creators and identifiers as **rows**, not typed syntax; id is **Key** | her (+ raw in details) | R11 |
| Kind detail sentences | `SOURCE_KINDS` | | help under Type (ids) | her | R11 |
| Dependents line | `sourceDependents` | | kept; + "Cited in" (G94) | her | R11 |
| Archive / restore | | `sources/archive` | More › Archive, with Undo | her | R11 |
| Conflict: use stored / keep my draft on latest | 409 `current` | | `conflict` block, her words | her | R11 |
| Damaged or newer library: "Repair <file> by hand" | 422 `invalid-json`, `unsupported-version` | | her sentence + `common.tell`; file and diagnostics in details | her / Mikey | R11 |
| Import CSL JSON (file or paste), preview rows, apply, conflicts block | | `sources/import` | **Import sources** sheet ⚑ 8, 10 | her | R11 |
| Export CSL JSON / BibTeX with losses | | `sources/export?format=` | **Export your library** sheet | her | R11 |
| Rights statement on a version | file only | `research/draft` `rights` | read-only line where she quotes or copies; field in details ⚑ 9 | her / Mikey | R11 |
| Interpretations (renderings, readings) | file only | `research/draft` `library.interpretations` | read-only in Your research; R12 in Compare | her / Mikey | R11/R12 |
| Notebook lists (passages, notes), archived toggle | | `GET research/notebook` | **Notebook** | her | R11 |
| Search (text, source, locator kind, concept, question state, archived) in POST body | | `research/search` | search + filters, POST body kept | her | R11 |
| Backlinks (notes about this passage, other research on source, notes tagged concept) | | `research/backlinks` | **Also about this** | her | R11 |
| Capture form: passage (source, excerpt, language, locators lines) + optional follow-up note; note (kind, status, text, passages, sources, concepts) | | `research/passages`, `research/notes` | **Keep a passage** / **Write a note**; places as rows | her | R11 |
| Suggest entry id | `suggestEntryId` | | automatic; shown in details | Mikey | R11 |
| Archive / restore entry; remove (confirm) | | `research/archive`, `DELETE` | More › Archive; **Take it out** with Undo ⚑ 8 | her | R11 |
| Partial save (passage saved, note not) | | | her sentence on the note field | her | R11 |
| Notebook export (confirm about privacy) / import bundle (preview) | | `research/export`, `research/import` | **Save a copy of your notebook** (asks once) / **Bring in a notebook copy** (preview) | her | R11 |
| Concepts linked to atlas entries; missing concepts | | `research/atlas` | R11: concept as text; **R12**: links to entries, "Add it to the atlas" | her | R12 |
| Insert citation dialog (search, source list, start from passage, locators lines, preview, check) | | `citations/library`, `citations/check` | **Cite** form (Add something step 2) | her | R11 |
| Citation chip in Visual mode; Edit citation | `citationChip` | | **Cited here** chips under each words box ⚑ 3 | her | R11 |
| Refused targets (code, HTML, link) | `citationInsertionProblem` | | refusal sentence before sending | her | R11 |
| Undo citation (Ctrl Z restores draft and caret) | `citationUndo` | | toast **Undo** (R6 rule) | her | R11 |
| Draft-side Research panel: search, filters (all, passages, sources, context, interpretations, my notes) | | `research/draft` | **Your research** (docked / sheet) ⚑ 6 | her | R11 (context R12) |
| Insert quotation with citation (+ rights confirm checkbox) | `quotationMarkdown` | `citations/check` | **Put the quotation in**; rights → dialog | her | R11 |
| Insert citation only (passage / source) | | `citations/check` | **Cite it only** / **Cite it** | her | R11 |
| Interpretation: never inserted; cite the interpreted source; comparison links | | | same words; links R12 | her | R11/R12 |
| Convert private note (checkbox confirm) | `convertedNoteMarkdown` | | **Turn into my own words…** (dialog) | her | R11 |
| Insert link to published atlas entry / comparison / dating; why-not warnings | `contextLinkMarkdown`, `contextLinkWarning` | `research/draft` | **Put in a link** | her | R12 |
| Research checks line + Review research checks | | `research/review` | line + link to R7 Before you publish | her | R11 |
| Make a claim / Open Evidence Studio buttons | | | **Claims and evidence** sheet | her | R12 |
| "Selected for readers" (select, fields, see what readers get, order, withdraw, select again, unselect, comment on a source, explanation of an entry, rebuild) | `createCurationSection` | `research/curation*` | **For readers** in Your research | her | R12 |
| Capture research dialog from the editor (selected text prefill) | `openResearchCapture` | `research/notebook`, `passages`, `notes` | Write › More › **Keep these words as a passage** | her | R11 |
| Evidence pane: findings by outcome, DOI, license, linked references | `updateEvidence` | `preview` | **R7** Before you publish (findings) and **R5** details (DOI, license, count) — already specified | her / Mikey | — |
| Evidence pane: citation counts, style, "nothing looked up online" | `citationEvidenceRows` | `preview.citations` | **Sources in this post** count line | her | R11 |
| Download cited references (CSL JSON, BibTeX) | `exportCitedReferences` | `preview.citations.exports` | **Download the works this post cites** | her | R11 |
| `citations`, `citationLocale` front matter | file / R5 read-only | `document` | **How sources show**, **Language of the notes** ⚑ 5 | her | R11 |
| Abstract / References toolbar actions | | `preview` | **R6** (Add something), unchanged | her | — |
| Evidence pane: claims, anchors (verified/moved/stale/ambiguous/none), re-anchor, links by relation, findings, approve, undo remove | `createClaimsStudio` | `research/claims*` | **Claims and evidence** sheet | her | R12 |
| Atlas: entries (kind, label, id, aliases, summary, source work, approved), filters, notices, missing concepts | `showAtlas`, `createAtlasForm` | `research/atlas*` | **Atlas** | her | R12 |
| Atlas: relationships (kind, from, to, asserted by, confidence, evidence, unsourced, uncertainty, dissents, approved), explore outgoing/incoming | | `research/atlas/relationships`, `explore` | entry page + relationship form | her | R12 |
| Atlas: datings (aspect, at/range/window/unknown/relative, precision, circa, BCE, asserted by, confidence, evidence, note, visibility) | | (in entries / relationships) | **When** on entry and relationship | her | R12 |
| Chronology (filters, window with eras, zoom, competing only, prompted only, timeline, unplaced, relative, datings to check) | | `research/atlas` | **Chronology** | her | R12 |
| Compare: alignments list, version filter, layout, normalizations toggle, columns (rights, makers), absent places, notices, publication state | `showCompare` | `research/alignments` | **Compare** | her | R12 |
| Compare: copy/download selected places with rights confirm and "include my notes" | `comparisonExportText` | — (client) | **Copy or download places** (rights → dialog) | her | R12 |
| Alignment form (members, correspondence, rationale, confidence, uncertainty, approved) | `createAlignmentForm` | `research/alignments` | **Edit alignment** | her | R12 |
| Remove alignment + Undo | | `DELETE`/`POST` | same | her | R12 |
| What will be public: per store published/withheld with fields, counts, refresh, site readiness report | `createBoundaryPreview`, `createPublicationReview` site | `research/boundary`, `research/readiness` | **What readers see** | her | R12 |
| Per-post boundary beside review | `research/boundary` POST | | R7 Before you publish › Research checks gains **What readers will see from this post** | her | R12 |
| Saves that rebuild published comparisons/atlas ("build" text) | `comparisonBuildText`, `atlasBuildText` | `build` | status sentence; failure in details | her / Mikey | R11 (sources) / R12 |
| Keyboard Alt+9 (Evidence) and pane shortcuts | | | drop: Find and `?sheet=` replace pane keys (R7 rule) | — | — |
| Editor Visual/Markdown claim selection mapping (`claimSelectionAnchor` visual cases) | | | drop the visual half: Studio boxes are the Markdown, offsets map directly | — | R12 |
| Online Zotero sync, DOI lookup | — (never existed) | | **none** ⚑ 10 | — | — |

## Research home (`#/research`) — R11

- **Job:** "Where is my research, and what's next?" **Primary:** the first step not done (as old: "Add your first source" when the library is empty, else "Keep a passage" when no passages, else **Back to your post** / **Start a research post**).
- **Loads:** `GET sources` and `GET research/notebook` in parallel (`allSettled`; a 401 ends the session). R12 adds `GET research/atlas` and `GET research/alignments` counts.

```
400 px                                       Desktop (>= 48rem): one 44rem column; steps in a 2-column grid at 70rem
+------------------------------------------+
| Home > Research                          |
| Overview | Sources | Notebook  [v]        |  tabs (select under 30rem)
| From a source to a cited post            |  h2 research.title
| ! You have an unsaved source: “Plato,    |  alert-banner info (kept form), only when any
|   Republic”. [Go back to it]             |
| 1  Add a source              (Private)   |  ol > li, h3 + status-badge
|    Record the work you read, then the    |
|    edition, translation or manuscript…   |
|    12 sources in your library.           |  state line
|    [ Open Sources ]                      |
| 2  Keep a passage            (Private)   |
|    …  31 passages and 9 notes.           |
|    [ Open your notebook ]                |
| 3  Relate and compare (optional) R12     |
| 4  Cite it in a post (Readers see this)  |
|    Your post: “The cave”                 |
|    [ Back to your post ]   (primary)     |
| 5  Check what readers will see   R12     |
| Everything here is private. A post shows |  research.privateLine
| a source only when it cites it…          |
| > For {helper}                           |  files, revisions, counts incl. archived
+------------------------------------------+
```

Words (`parts/research-words.js`):

| Id | Default |
| --- | --- |
| `research.nav` | Research |
| `research.tabOverview` / `tabSources` / `tabNotebook` / `tabAtlas` / `tabCompare` / `tabPublic` | Overview / Sources / Notebook / Atlas / Compare / What readers see |
| `research.tabsLabel` | Part of your research |
| `research.title` | From a source to a cited post |
| `research.titleEmpty` | Start your research |
| `research.ledeEmpty` | These steps take you from a source to a cited post. Everything before the post stays private. |
| `research.stepSource` / `stepSourceText` | Add a source / Record the work you read, then the edition, translation or manuscript you quote from. Each gets a key your citations use. |
| `research.stepSourceDone` / `stepSourceNone` | {count} sources in your library. / Not started: your library is empty. |
| `research.stepPassage` / `stepPassageText` | Keep a passage / Copy the exact words with where they are in the source, and keep your own notes and questions beside them. |
| `research.stepPassageDone` / `stepPassageNone` | {passages} passages and {notes} notes. / Not started: no passages kept yet. |
| `research.stepRelate` / `stepRelateText` (R12) | Relate and compare / Optional. Note who says what about the people, works and ideas you study, and read versions of a passage side by side. |
| `research.stepCite` / `stepCiteText` | Cite it in a post / In Write, choose Cite to point to a source and the place in it. Readers see only what you cite; your passages and notes stay private. |
| `research.stepCitePost` / `stepCiteNoPost` | Your post: “{title}” / No post open yet. |
| `research.stepPublic` / `stepPublicText` (R12) | Check what readers will see / See exactly what your published posts, atlas and comparisons show, and why everything else stays private. |
| `research.private` / `research.readersSee` | Private / Readers see this |
| `research.addFirst` / `openSources` / `openNotebook` / `openAtlas` / `openCompare` / `openPublic` | Add your first source / Open Sources / Open your notebook / Open the atlas / Compare versions / See what readers see |
| `research.backToPost` / `startPost` | Back to your post / Start a research post |
| `research.privateLine` | Everything here is private. A post shows a source only when it cites it; atlas entries, links, claims and comparisons only when you approve them. |
| `research.kept` / `research.keptMany` / `research.keptGo` | You have an unsaved {what}: “{name}”. / You have {count} unsaved changes in your research. / Go back to it |
| `research.unreadable` | Your {what} can't be read, so nothing here changed. |
| `research.findStart` (details) | Start research (for {helper}) |
| `research.notYet` | This part of your research comes in the next update. |

`{what}` takes `research.whatLibrary` "source library", `whatNotebook` "notebook", `whatAtlas` "atlas", `whatAlignments` "comparisons", `whatClaims` "claims"; `research.unreadable` is followed by `common.tell`. **For {helper}:** each store's file (`.openblog/private/research/sources.json`, `notebook.json`, …), revision, counts with archived, the first diagnostic code, field and message verbatim, "Repair it by hand, then reload. Nothing was changed."

**Kept forms** ⚑ 7: `parts/research-kept.js` (pure map, no storage) keeps each research screen's dirty form by `{screen, id}` when she moves to another `#/research/*` screen or Write; the router's leave-guard does not ask inside research; it asks when leaving to any other area and on unload. Returning restores the form, caret and scroll; the banner lists kept forms on every research screen.

## Sources (`#/research/sources[/<key>]`) — R11

- **Job:** "What have I read, and how do I point to it?" **Primary:** **Add a source**.
- **Loads:** `GET sources` (with G94 `citedBy`/`usedBy` when present).

```
400 px: list, then a source opens full width       Desktop (>= 60rem): list 24rem | source 1fr
+------------------------------------------+       +----------------------+---------------------------+
| Home > Research > Sources                |       | Find a source [   ]  | Plato, Republic           |
| Overview | Sources | Notebook  [v]        |       | Type [All types v]   | Work · key plato-republic |
| Your sources                [More v]     |  h2   | Show [Active    v]   | Title  [Republic        ] |
| [ Add a source ]                         |       | 12 of 14 shown       | People who made it        |
| Find a source [plato               ]     |       | > Plato, Republic    |  [Plato   ] [Author  v] x |
| Type [All types v]  Show [Active v]      |       |   Work · grc · c.375 |  [ + Add a person ]       |
| 2 of 14 shown.                           |       |   Republic, tr. Sl…  | Identifiers               |
| +--------------------------------------+ |       |   Translation · en   |  [DOI v] [10.1000/1   ] x |
| | Plato, Republic                      | |       |                      | Cited in 3 posts: …       |
| | Work · Ancient Greek · c. 375 BCE    | |       |                      | [Save changes] [More v]   |
| +--------------------------------------+ |       +----------------------+---------------------------+
| | Republic, tr. Slings                 | |
| | Translation · English · 2003         | |
| +--------------------------------------+ |
| > For {helper}                           |
+------------------------------------------+
```

### The list
- Search `sources.find` "Find a source" (help `sources.findHelp` "Title, person, key or identifier."), filters **Type** (`sources.typeAll` "All types", then plural kind names) and **Show** (`sources.showActive` "Active", `showArchived` "Archived", `showBoth` "Active and archived"). Count `sources.count` "{shown} of {total} shown." (polite). Rows are buttons: label (`sourceLabel`), "{kind} · {language name} · {issued}", `status-badge` "Archived".
- Empty: `sources.emptyTitle` "Your library is empty" / `sources.emptyText` "Add a work first, then the editions, translations, manuscripts and places in them that you quote from." + **Add a source**. No match: `sources.noMatch` "No sources match. Clear the search or choose another type." All archived: `sources.allArchived` "Every source is archived. Show archived ones to open one."
- **More** (screen): **Import sources…**, **Export your library…**.

### A source (form)
`createSourceForm` in `parts/source-form.js`, fields in this order; a field shows only for the kinds that have it (`sourceFieldsForKind`):

| Field (id) | Control | Help / words | Writes |
| --- | --- | --- | --- |
| **Type** `sources.type` | `choice-cards`, new only; fixed after | Work "A creation, apart from any copy of it." · Edition "A published form of a work or a translation." · Translation "A work in another language." · Witness "A manuscript, recording or other surviving copy." · Reference "A place in one of your sources." (`sources.kind*`, `sources.kind*Help`) | `kind` |
| **Title** `sources.title` (+ `sources.optional` " (optional)" when not required) | `text-field` | — | `title` |
| **It's a form of** `sources.of` (edition, translation, witness) / **It points at** `sources.ofReference` | `select-field` of allowed parents; `sources.choose` "Choose a source" | — | `of` |
| **Translated from** `sources.basedOn` (translation, optional) | `select-field`, "None" | `sources.basedOnHelp` "An edition, witness or translation it was made from." | `basedOn` |
| **Language** `sources.language` | `combo-box` of language names, writes the tag; an unknown tag shows as typed | `sources.languageHelp` "Like English or Ancient Greek." | `language` |
| **Date** `sources.issued` (optional) | `text-field` | `sources.issuedHelp` "Kept as you write it, like 1992 or c. 375 BCE." | `issued` |
| **Where in it** (reference) | **Kind of place** `select-field` (Page, Folio, Line, Section, Chapter, Canonical place, Time; `place.*`) + **Place** + **Volume** (only when the target has volumes or a volume is set) | `sources.placeHelp` "Like 514a, 12r or 1:02:30." / `sources.volumeHelp` "Pages restart in each volume, so name it, like 2." | `location` (`mergeSourceLocation`) |
| **People who made it** `sources.people` (optional) | rows: **Name** + **Role** (Author, Editor, Translator, Compiler, Scribe, Other; `sources.role*`) + **Take out**; **Add a person** | `sources.peopleHelp` "Who wrote, edited or translated it. They aren't the people credited on your posts." | `creators` (`mergeSourceCreators`; structured name parts kept unless the row changed) |
| **Identifiers** `sources.ids` (optional) | rows: **Kind** (DOI, ISBN, ISSN, Web address, Other…) + **Value** | `sources.idsHelp` "A DOI, ISBN or web address. Nothing looks them up." | `identifiers` |
| **Key** `sources.key` | `text-field`, new only, filled from the title (`suggestKey`) until typed; read-only after | `sources.keyHelp` "The short name your citations use, like plato-republic. Lowercase letters, numbers and dashes. It can't change later." / after: `sources.keyFixed` "Your citations use this key, so it stays." | `id` |

- **Under the form:** `sources.dependents` "{count} other sources point at this one. They keep working while it's archived."; G94: `sources.citedIn` "Cited in {count} posts:" + links to each post's Write; `sources.usedIn` "Your notebook has {passages} passages and {notes} notes from it."; R11 shows the rights statement read-only when present: `sources.rights` "Rights: {label}" (+ note, licence as text) and `sources.rightsHelp` "Your own statement, not permission. {helper} can change it." ⚑ 9.
- **Buttons:** new: **Add the source** (`sources.add`) → `sources.added` "Source added." (focus to the new row; no Undo: archive is the way back, said by `sources.addedHelp` "To set it aside, archive it."); existing: **Save changes** → `sources.saved` "Saved." + **Undo** (PUT the record as it was, on the new revision). **Close** when clean (`sources.close`), **Never mind** when dirty (asks once, below). More: **Archive this source** → `sources.archived` "Archived. Posts that cite it still show it." + Undo; **Restore** → `sources.restored` "Restored." + Undo; **Copy its key** → `sources.keyCopied` "Key copied.".
- **Leaving a dirty form** inside research keeps it (⚑ 7); **Never mind** asks `sources.dropTitle` "Leave out your changes to this source?" **Leave them out** / **Keep editing** (focused).
- **Conflict (409 `changed`, G93; today 409 `conflict`)**: `alert-banner` `sources.conflict` "Your library changed somewhere else, so nothing was saved. Your changes are still here." with **Use the newer copy** (`sources.useNewer`) and **Keep mine, on the newer library** (`sources.keepMine`) → `sources.keptMine` "Your changes now sit on the newer library. Check them, then save." When the source was removed elsewhere: `sources.goneElsewhere` "This source was taken out somewhere else." **Leave my changes out**.
- **For {helper}:** file, revision, `stored`, the raw record (`pre`), rights and interpretation fields with their names, `sources.detailsRights` "Rights statements and interpretations are edited in the library file."

### Import sources (sheet) ⚑ 8, 10
`side-sheet` `sources.importTitle` "Import sources"; lede `sources.importLede` "From Zotero, Mendeley or another reference manager: export your items as CSL JSON, then choose the file here or paste it. Importing adds and updates sources, never removes any, and keeps details you already wrote." Then `file-drop` **CSL JSON file** (`.json`, ≤ 3 MiB, read locally with `File.text()`) or **Or paste it** (`text-field` multiline, mono). **Check what it would do** (`sources.importCheck`) → `POST sources/import {revision, content, apply: false}` → preview:

- Summary `sources.importSummary` "{new} new, {updated} updated, {same} already here, {conflicts} can't be imported." (zero parts left out; none: `sources.importNothing` "Everything is already in your library.").
- Groups (`h3`, each a list; `sourceImportRows` → ids): **New**; **Updated** with "Changes {field}" per change (`sources.importChanges`), "Keeps {fields} as you wrote them" (`sources.importKeeps`); **Not kept** "{field}: {reason}" (`sources.importLoss`, reason verbatim, `bdi`); **Can't be imported** with the item's problem (`sources.importProblem`). Item names: key, "(from {cslId})" when different, else `sources.importItem` "Item {n}".
- **Import {count}** (primary, `sources.importDo`) only when applicable and something changes; else with conflicts `sources.importBlocked` "Fix the items that can't be imported in your reference manager, then try again. Nothing was imported." Editing the pasted text after a check hides **Import** and says `sources.importAgain` "The text changed. Check it again."
- Done: `sources.imported` "Imported: {summary}." (sheet stays to show the result; list reloads). No Undo ⚑ 8.
- Not JSON / unreadable file: `sources.importNotJson` "That file isn't CSL JSON. Export it again from your reference manager."; 409: `sources.importChanged` "Your library changed while you were checking. Check again."; 413: `sources.importTooBig` "That file is bigger than 3 MB. Export fewer items at a time."

### Export your library (sheet)
`sources.exportTitle` "Export your library"; `radio-group` **CSL JSON** ("For Zotero and most reference managers.") / **BibTeX** ("For LaTeX."); help `sources.exportHelp` "Includes archived sources. The file is saved where your downloads go." **Export** → `GET sources/export?format=` → Blob download (`filename` from server) → `sources.exported` "Saved {filename}: {count} sources." + `sources.exportLoss` "It can't carry: {list}." when `losses`.

## Notebook (`#/research/notebook[/<id>]`) — R11

- **Job:** "What did I read, and what do I think about it?" **Primary:** **Keep a passage**; secondary **Write a note**.
- **Loads:** `GET research/notebook` (passages, notes, sources). Search: `POST research/search` with `notebookSearchBody` (text never in the address).

```
400 px                                          Desktop (>= 60rem): list 24rem | entry 1fr
+------------------------------------------+
| Home > Research > Notebook               |
| Your notebook                [More v]    |  h2 notebook.title
| [ Keep a passage ]  [ Write a note ]     |
| Search your notebook [shadows        ]   |  search (POST)
| > Filters (2)                            |  details: Source, Kind of place, Concept,
|                                          |  Questions (All/Open/Answered), [ ] Show archived
| Passages · Notes            (segmented)  |  segmented-control when not searching
| +--------------------------------------+ |
| | Plato, Republic, page 514            | |  passage row
| | “…and they see only their own        | |
| |  shadows…”                           | |
| +--------------------------------------+ |
| | Question · open                      | |  note row
| | Is the fire the sun?                 | |
| +--------------------------------------+ |
+------------------------------------------+
Entry (opens full width at 400 px):
| Passage                    (Private)     |
| From [Republic, tr. Slings          v]   |  fixed when editing (notebook.sourceFixed)
| The exact words                          |
| [ and they see only their own shadows  ] |
| Language [English            ]           |
| Where it is                              |
|  [Page v] [514  ] to [520  ]   [x]       |
|  [ + Add another place ]                 |
| [Save changes]  [More v]                 |
| Also about this passage (2)              |  backlinks
|  Question · open: Is the fire the sun?   |
```

Words and fields (`parts/research-words.js`, `notebook.*`):

| Part | Words |
| --- | --- |
| Title, empty | `notebook.title` "Your notebook"; `notebook.emptyTitle` "Nothing kept yet" / `notebook.emptyText` "Keep the exact words you read, with where they are, and your own notes and questions beside them." + **Keep a passage**; no source yet: `notebook.needSource` "Add a source first, then keep passages from it." + **Add a source** |
| Search, filters | `notebook.search` "Search your notebook" (help "Words you kept, your notes, a source or a key."); `notebook.filters` "Filters ({count})"; `notebook.source` "Source" / `anySource` "Any source"; `notebook.placeKind` "Kind of place" / `anyPlace` "Any"; `notebook.concept` "Concept"; `notebook.questions` "Questions" / `all` "Everything" / `open` "Open questions" / `answered` "Answered questions"; `notebook.showArchived` "Show archived"; results `notebook.results` "{count} found" / `notebook.noResults` "Nothing matches. Clear a filter or try other words."; `notebook.matchedIn` "Found in: {where}" (`notebook.inWords` "the exact words", `inNote` "your note", `inSource` "the source") |
| Lists | `notebook.passages` "Passages" / `notebook.notes` "Notes"; row: passage `"{source}, {place}"` + 90-letter preview; note `notebook.observation` "Observation" / `questionOpen` "Question · open" / `questionAnswered` "Question · answered"; `notebook.aboutMissing` "About a passage that's gone" |
| Keep a passage | heading `notebook.newPassage` "Keep a passage"; **From** `notebook.from` (help new `notebook.fromHelp` "A source in your library."; editing `notebook.sourceFixed` "A passage stays with its source. Keep words from another source as a new passage."); **The exact words** `notebook.words` (help `notebook.wordsHelp` "Kept exactly as you type them, as someone else's words."); **Language** (optional; as Sources); **Where it is** rows: kind + **At** + **To** (optional), up to 8 (`notebook.where`, `notebook.addPlace` "Add another place", `notebook.placeLimit` "A passage can have up to 8 places."); new only: `fieldset` **A note about it (optional)**: kind + text (`notebook.followHelp` "Your own words. Leave it empty to keep the passage alone.") |
| Write a note | `notebook.newNote` "Write a note"; **Kind** `segmented-control` Observation · Question; **Answered?** (question) `toggle-switch` `notebook.answered` "It's answered"; **Your note** (help `notebook.noteHelp` "Your own words. Quoted words belong in a passage."); **About these passages** (checklist, preview + id), **About these sources**; **Concepts** `tag-input` (help `notebook.conceptsHelp` "Lowercase words, like allegory or the-good.") |
| Buttons, statuses | **Keep it** (`notebook.keep`) → `notebook.kept` "Kept in your notebook."; **Save changes** → `notebook.saved` "Saved." + Undo; partial: on the note field `notebook.notePartial` "The passage is kept, but the note isn't. Fix the note and save, or leave it out."; More: **Archive** → `notebook.archived` "Archived. It stays in your notebook and in copies, out of the lists." + Undo / **Restore** → `notebook.restored`; **Take it out** → `notebook.takenOut` "Taken out of your notebook." + **Undo** ⚑ 8 (re-POST); **Cite it in your post** (passages, when a post is open: opens Write with the Cite form filled from it) |
| Entry header | `notebook.privateLine` "Private. Readers never see this."; archived `notebook.archivedLine` "Archived: kept, but left out of lists and search unless you show archived ones." |
| Also about this | `notebook.alsoPassage` "Also about this passage ({count})", `alsoSource` "Other research on {source} ({count})", `alsoConcept` "Notes on {concept} ({count})"; items open the entry; none: `notebook.alsoNone` "Nothing else yet." |
| Concepts (R12) | `notebook.conceptEntry` "In your atlas: {label}" link; missing: `notebook.conceptMissing` "{concept} isn't in your atlas yet." **Add it to the atlas** |
| Save a copy | dialog `notebook.copyTitle` "Save a copy of your notebook?" / `notebook.copyText` "The file holds every passage and note, archived ones too. Keep it somewhere private, never in your blog's folders." **Save the copy** / **Not now** (focused) → `POST research/export {includePrivate: true}` → Blob → `notebook.copied` "Saved {filename}: {passages} passages and {notes} notes." |
| Bring in a copy | sheet `notebook.bringTitle` "Bring in a notebook copy"; lede `notebook.bringLede` "Adds what your notebook doesn't have. It never changes or removes anything here."; `file-drop`; **Check what it would do** → `notebook.bringSummary` "{add} to add, {same} already here, {conflicts} in conflict." + rows (`notebookImportRows`; never entry text) → **Bring in {count}** → `notebook.broughtIn` "Brought in: {summary}."; not a copy: `notebook.bringNotCopy` "That file isn't a notebook copy."; conflicts: `notebook.bringBlocked` "Some entries clash with ones you have. Nothing was brought in." |

**Removing** asks nothing (Undo instead) except a passage that notes point to: the server refuses (`still-linked`) → `notebook.stillLinked` "{count} notes are about this passage. Take them out or unlink them first." + **Show them**.

## Write: Cite, quotations and Your research — R11

### What changes on Write (research sites only)

```
400 px                                          Desktop >= 70rem: words 1fr | Your research 24rem (docked)
+------------------------------------------+    +-----------------------------+--------------------------+
| Words                                    |    | Words                       | Your research        [x] |
| +--------------------------------------+ |    | +-------------------------+ | Search [cave          ]  |
| | The prisoners see only shadows       | |    | | The prisoners see only  | | Show [Everything    v]   |
| | [@republic-slings, page 514].        | |    | | shadows [@republic-sl…  | | > Passage               |
| +--------------------------------------+ |    | +-------------------------+ |   Republic, tr. Slings,  |
| Cited here: [Republic, tr. Slings,      ]|    | Cited here: [Republic, p.…] |   page 514  (Private)    |
|             [p. 514               v]     |    | +-------------------------+ |   “and they see only…”   |
| +--------------------------------------+ |    | | (Quotation)             | |   [Put the quotation in] |
| | (Quotation)                          | |    | | and they see only their | |   [Cite it only]         |
| | and they see only their own shadows… | |    | | own shadows…            | | > Source                 |
| | From Republic, tr. Slings, p. 514    | |    | | [Change]     [Move v]   | |   Plato, Republic        |
| | [Change]              [Move v]       | |    | +-------------------------+ | Research checks: 1 to    |
| +--------------------------------------+ |    | [Put a photo in][Add some…] |   look at. Before you…   |
| [Put a photo in]  [Add something]        |    +-----------------------------+--------------------------+
|==========================================|
| [See how it looks] [Save draft] [Publish]|
+------------------------------------------+
```

1. **Add something** gains two items (`parts/add-words.js`), shown when `meta.siteUses.research`; first group on research posts, "More things" otherwise: **A citation** (`add.citation`, blurb `add.citationBlurb` "Point to a source in your library, and where in it.") and **A quotation** (`add.quotation`, blurb `add.quotationBlurb` "Exact words from your notebook, with their citation."). `?add=cite` and `?add=quotation` open them; `/` then "cite" filters to them.
2. **Cited here** row under every words box that holds citations (⚑ 3).
3. **Quotation cards** in place.
4. Write › More: **Your research…** (`yours.open`), **Keep these words as a passage…** (`notebook.keepFromPost`), and **Sources in this post…** (opens About this post at that group).

### The Cite form (Add something, step 2)
Frame and footer as R6 (heading, **‹ Everything you can add**, where it goes, **Cite it** / **Done**, **Never mind**). Loads `GET citations/library` (sources, passages, revision, `notebookAvailable`).

| Field | Control | Words |
| --- | --- | --- |
| Where it goes | lede (live) | R6 `add.whereAfter`; refused here (`citationInsertionProblem`): `cite.refusedCode` "A citation can't go inside code. Put your cursor in plain words first." / `cite.refusedLink` "A citation can't go inside a link. Put your cursor after it." / `cite.refusedKept` "A citation can't go inside a part kept as written." (**Cite it** disabled; reason linked) |
| **Find a source** `cite.find` | search, filters label, creators, keys, identifiers | count `cite.count` "{count} sources" (polite) |
| **Source** `cite.source` | `radio-group` list (max 8 visible, scrolls inside its region): label, "{kind}, {year}", key in details; archived only when it's the current one (`cite.archived` "archived") | help `cite.sourceHelp` "From your library. Only its key goes into your post." |
| **Start from a passage** `cite.fromPassage` (optional) | `select-field` "{source} — “{preview}” ({place})"; none: `cite.noPassages` "No passages yet"; notebook unreadable: `cite.noNotebook` "Your notebook can't be read, so passages aren't offered. You can still cite any source." | after choosing: `cite.copiedFromPassage` "The source and where it is were copied. The exact words and your notes stay private." |
| **Where in the source** `cite.where` (optional) | rows: kind (`place.*`) + **At** + **To**; **Add another place** (≤ 8) | `cite.whereHelp` "Like page 514, or canonical place 514a to 520a." |
| **How it reads** | live line `cite.reads` "Reads as: {label}" (`citationLabel`; G95 `note` when present) | details: `cite.writes` "What it writes: {markdown}" |

- **Cite it** → client check (`validateCitationDraft` → ids `cite.needSource` "Choose the source to cite." / `cite.notInLibrary` "That source isn't in your library. Choose another." / `cite.tooManyPlaces` "A citation can have up to 8 places." / `cite.badPlace` "Place {n} needs a kind and a value, like page 514.") → `POST citations/check {revision, citation}` → `insertCitationText` at the caret (or replacing the marker being changed) → `cite.done` "Cited." / `cite.changed` "Citation changed." + **Undo**.
- **First citation** in a post with no `citations` ⚑ 4: also sets `citations: notes` and says `cite.notesOn` "Cited. Your sources will show as numbered notes at the end. Change that in About this post." **Undo** restores the words and the setting.
- **Changing:** caret inside a marker (or chip › Change) → the form opens as **Change this citation** (`cite.changeTitle`), filled by `parseCitationText`; **Done** with nothing changed writes nothing.

### Cited here (chips) ⚑ 3
- Under each words box with ≥ 1 marker outside code (`citationSpans`): label `cite.citedHere` "Cited here:" then one `action-button` (quiet) per marker in reading order, text = `citationLabel` (e.g. "Republic, tr. Slings, p. 514"), name `cite.chipName` "Citation: {label}". Menu (`dropdown-menu`): **Change**, **Show me** (`cite.showMe`: focuses the box and selects the marker), **Take it out** (`cite.takeOut` → removes the marker and one adjoining space → `cite.takenOut` "Citation taken out." + Undo).
- A key not in the library: chip shows ⚠ + `cite.unknownKey` "Not in your library: {key}" (also the name); **Change** fixes it. A malformed marker (`[@` that doesn't parse): `cite.malformed` "This citation can't be read." **Show me** only.
- Words help on research sites adds `cite.wordsHelp` "A citation shows in your words as [@ and its source's key. Change it with its button under the words."
- **Show the words as written** hides chips and quotation cards (R6 rule).

### Quotation cards
- `word-blocks.js` gains kind `quotation`: a block quote (`> …`) whose last line ends with exactly one citation marker and nothing after it. Hand-written ones become cards too; `joinBlocks` round-trip stays byte-for-byte.
- Card: badge `card.quotation` "Quotation", first 3 lines of the quoted words (`dir="auto"`, `lang` from the passage when known), `card.quotationFrom` "From {label}". Name `card.quotationName` "Quotation from {source}". Buttons R6: **Change** (opens the Cite form for its citation only; help `quotation.changeHelp` "The quoted words stay exactly as you kept them. Change them in your notebook."), **Move**, **Take it out** (+ Undo).

### Your research (docked / sheet) ⚑ 6
- **Opens from:** Write › More › Your research; Add something › A quotation (filtered to passages); Find; `?sheet=research`. ≥ 70rem: a region beside the words (`aside`, `aria-labelledby` its heading), Write stays editable, insertions go at the last caret in the last focused box; < 70rem: `side-sheet` full screen under 30rem, inserting where the caret was.
- **Loads:** `GET research/draft` (each part may fail alone: `yours.partFailed` "Your {what} can't be read, so it isn't offered here. Nothing changed." with the others still listed). **Refresh** (`yours.refresh` "Check again").

| Part | Words / behaviour |
| --- | --- |
| Heading, lede | `yours.title` "Your research"; `yours.lede` "Only what you put in goes into this post. Quotations go in with their citation; your notes go in only if you turn one into your own words." |
| Search, show | `yours.search` "Search your research"; **Show** `select-field`: `yours.showAll` "Everything" (never notes), `showPassages` "Passages", `showSources` "Sources", `showInterpretations` "Interpretations", `showNotes` "My notes", R12 `showContext` "Atlas entries and comparisons"; empty `yours.none` "Nothing in your research matches." / notes `yours.noNotes` "No notes match." |
| Result row | type badge (`yours.type*`: Passage, Source, Interpretation, Note; R12 Atlas entry, Comparison), title, 80-letter preview, `status-badge` Private / R12 Published / Not published |
| Passage | heading `yours.passageFrom` "Passage from {source}"; quote (`blockquote`, `lang`, `dir`); `yours.where` "{place}" or `yours.noPlace` "No place recorded."; rights line `yours.rights` "Rights: {label}"; linked notes `yours.linkedNotes` "{count} of your notes are about it. They never go in with it."; help `yours.quoteHelp` "The words go in exactly as kept, as a quotation after the paragraph you're in, with its citation. The rights statement is yours; it isn't permission."; **Put the quotation in** (primary) / **Cite it only**; details: `cite.writes` with the exact Markdown; link **Open in your notebook** |
| Rights dialog | when rights are `unknown` or `rightsReserved` (`RIGHTS_NEEDING_CONFIRMATION`): `yours.rightsTitle` "Quote words whose rights {state}?" (`yours.rightsUnknown` "nobody has checked" / `yours.rightsReserved` "are reserved") / `yours.rightsText` "Quoting them on your blog is your decision." **Quote them** / **Not now** (focused) |
| Source | `yours.sourceKey` "{kind}, key {key}"; **Where in it** rows (as Cite); help `yours.sourceHelp` "Only the key and the places you give go into your post."; **Cite it** (primary); **Open in Sources** |
| Interpretation | heading `yours.reading` "Reading of {source}" / `yours.rendering` "Rendering of {source}"; text; `yours.interpretationNever` "An interpretation is never cited or put in a post. Readers see it only inside a comparison you publish."; **Cite the source it interprets**; R12: `yours.inComparisons` "In {count} comparisons, none published yet." / one **Put in a link to “{label}”** per published one |
| Note | `yours.noteLine` "Your own unpublished thinking. It never goes in unless you turn it into your own words."; **Turn into my own words…** → dialog `yours.convertTitle` "Put this note in your post as your own words?" / `yours.convertText` "It stops being private there: readers see it once you publish." **Put it in** / **Not now** (focused) |
| After insertions | `yours.quoted` "Quotation put in after “{words}…”." / `cite.done` / `yours.converted` "Your note is in your post as your own words." — each + **Undo** (whole box text, R6 rule); refused place: the Cite refusal sentences; server returned no citation: `yours.noCitation` "That didn't go in: no citation came back. Your post didn't change." |
| Research checks | `yours.checks` "Research checks: {count} to look at." + **Before you publish** (R7 sheet); none: `yours.checksNone` "The research checks found nothing for this post. Checks can't see everything."; not research: `yours.checksNot` "Research checks run on research posts and posts that cite." |
| Footer | **Keep a new passage** (opens Keep a passage with selected words) |

### Keep these words as a passage (sheet)
Write › More, enabled always; selected words prefill **The exact words**. `side-sheet` with the Notebook passage form; lede `notebook.fromPostLede` "Saved to your notebook. Your post doesn't change." **Keep it** → `notebook.kept` and the sheet closes; focus returns to the box at the caret.

### Sources in this post (About this post group) ⚑ 5
Shown on research posts, posts with `citations` set, and posts holding any marker. Fields (they save with the post, R5 rule):
- **How sources show** `cite.style` `radio-group`: `cite.styleNotes` "Numbered notes at the end" (`citations: notes`) · `cite.styleList` "A list of works at the end, with places in the text" (`bibliography`) · `cite.styleOff` "Not yet: citations stay as you typed them" (removes the key). Help `cite.styleHelp` "Readers see only each source's public description and your places, never your notes."
- **Language of the notes** `cite.locale` `select-field`: `cite.localeSite` "Your blog's language" (no key) · English · Deutsch · Français · Español (`en`, `de`, `fr`, `es`).
- Count line from `POST preview` `citations`: `cite.countLine` "{citations} citations of {works} works." (`cite.countOne*` singular forms).
- **Download the works this post cites:** **CSL JSON** / **BibTeX** (from `preview.citations.exports`) → `cite.downloaded` "Saved {filename}: {count} works. Nothing was looked up online." + `sources.exportLoss`; before a preview: `cite.previewFirst` "Check the post first: press See how it looks, then download."

### No signal (R11)
- Research screens need the server to load and save; nothing is queued. Status 0 → `research.noSignal` "{product} can't reach your research right now. Nothing changed. Try again when you have a signal." A form she tried to save stays filled, and is kept in this tab's `sessionStorage` (`studio-research-unsent:<screen>`) with `research.keptHere` "Kept on this phone until you save it or close {product}." ⚑ 7; it is removed on save or **Leave it out**.
- Write: typing a marker by hand works offline; **Cite it** waits like R6's server-built pieces: `cite.waiting` "Waiting for a signal. What you chose is kept here. Press Cite it when you have one." (values in `sessionStorage` `studio-add:<path>:cite`). Quotations and note conversion need `research/draft` loaded and `citations/check`: same waiting words. Chips and quotation cards draw offline from the last library loaded this visit; with none, chips show the key.

## R12: Atlas (`#/research/atlas[/<id>|/relationships/<id>|/chronology]`)

- **Job:** "Who said what about whom, and when?" **Primary:** **Add an entry**.
- **Loads:** `GET research/atlas` (entries, relationships, `kinds` table, notices, `missingConcepts`, sources, passages); explore: `POST research/atlas/explore {id}`.

```
400 px                                          Desktop (>= 60rem): entries 24rem | entry 1fr
+------------------------------------------+
| Home > Research > Atlas                  |
| Your atlas              [Chronology][Mo…]|  h2 atlas.title
| [ Add an entry ]                         |
| Find an entry [plato            ]  Kind v|
| Concepts your notes use, not here yet:   |  only when any
|  [the-good] [allegory]                   |
| > Plato                (Person)          |
|   Republic             (Work)            |
| ---------------------------------------- |
| Plato                      (Private)     |  entry page
| Person · also called Aristocles          |
| Readers can see it    [off]              |  toggle; consent help
| Links from Plato (2)                     |  Outgoing
|  Plato taught Aristotle — Strong — you   |
|   say so, on 2 pieces of evidence        |
|   [Edit] [Explore Aristotle]             |
| Links to Plato (1)                       |  Incoming
| [Add a link from Plato] [Add a link to…] |
| When (2)                                 |  datings
|  Born c. 428 BCE — Diogenes Laërtius     |
|  Born 427 BCE — you, tentative  ⚠ check  |
| [Edit entry]  [More v]                   |
+------------------------------------------+
```

- **Entry form** (`atlas.*`): **Kind** (Person, Work, Concept, Movement, Event), **Name** (`atlas.label`), **Key** (new only, from the name), **Also called** (rows), **Summary** (help `atlas.summaryHelp` "Your own words. Quoted words belong in a passage."), **The work in your library** (work entries, optional, works only), **What's uncertain** (optional), **Readers can see it** (`toggle-switch`; help `atlas.approveHelp` "You agree to show this entry on your blog's atlas pages once {product} publishes the atlas."; site not publishing: `atlas.notPublished` "Your blog doesn't publish the atlas yet. {helper} can turn it on.").
- **Link form** (relationship): **What kind of link** (`select-field` from the server's `kinds`, with its reading as help), **From** / **To** (only entries the kind allows; `atlas.endsHelp` "Only entries this kind of link can join are offered."), **Who says so** (`radio-group`: `atlas.byYou` "You" · `atlas.bySource` "A source in your library" (+ select) · `atlas.byNamed` "A named person or group" (+ name)), **How firmly they hold it** (`atlas.firm*` Tentative · Plausible · Strong; help `atlas.firmHelp` "How firmly they hold it, not how widely it's accepted."), **Evidence** rows (source or passage + places; ≤ 20), **No evidence yet** (`toggle-switch`, only with no rows; `atlas.unsourced` "A draft with no evidence yet"), **What's uncertain**, **Who disagrees** rows (who + evidence + note; ≤ 20), **Readers can see it** (help `atlas.linkApproveHelp` "Shown only while both entries are shown too, with who says so and who disagrees.").
- **When** (datings, on entries and links; ≤ 20): per dating `fieldset` "Dating {n}": **What it dates** (aspect from `kinds.aspects` for the owner: `atlas.aspect*` Span, Birth, Death, Activity, Composition, Publication, Emergence), **How it's dated** (`atlas.form*`: "On a date" · "Between two dates" · "Sometime within a window" · "Unknown: they say it isn't known" · "Before, after or during another entry's date"), per date: **Year** (digits only) + **Era** (`segmented-control` BCE · CE) + **Month**, **Day** (optional) or **Decade**/**Century** precision (`atlas.precision*`), **About** (`toggle-switch` "c."), **Who says so**, **How firmly**, **Evidence** / **No evidence yet**, **Note**, **Readers can see it**. Read back in her words (`atlasPointText`): "c. 428 BCE", "the 380s BCE", "between 399 and 387 BCE". ⚑ 13: no year 0; "BCE years count down" said once in help `atlas.yearHelp` "Whole years, with BCE or CE. There is no year 0."
- **Explore:** `atlas.linksFrom` "Links from {name} ({count})" / `linksTo`; each line `atlas.linkLine` "{from} {reading} {to} — {firmness} — {who} say so, on {count} pieces of evidence" (+ `atlas.contested` "Disputed by {who}." / `atlas.noEvidence` "No evidence yet."); `atlas.exploreNote` "Only links someone asserted. Nothing is worked out from dates or order."; notes on a concept: `atlas.notesHere` "Notes in your notebook on this concept ({count})".
- **Chronology** (`#/research/atlas/chronology`): heading `atlas.chronology` "Chronology"; lede `atlas.chronologyLede` "Every dating in your atlas, as words. Competing datings stand side by side; nothing is preferred, merged or averaged."; filters (`fieldset`): **Entry or link**, **What it dates**, **From year** + era, **To year** + era (help `atlas.windowHelp` "Leave either end empty to keep it open."), **Group by** Century · Decade · Year, **Only competing datings**, **Only datings to check**, **Clear**. Sections: **Timeline** (`atlas.timelineNote` "Order is for reading only. It never relates two datings."), **Not placed in time ({count})**, **Relative datings ({count})**, **Datings to check ({count})** with `atlas.checkNote` "Prompts, never verdicts: these datings can't all hold as stated. None says which is right." and **Check dating {n} of {name}**. Empty: `atlas.noDatings` "No datings yet. Add one under When on an entry or link."
- **Statuses:** `atlas.saved` "Saved to your atlas." (+ `atlas.rebuilt` "Your published atlas was updated." / `atlas.rebuildFailed` "Saved, but your published atlas didn't update. Tell {helper}." when `build`), `atlas.removed` "Taken out of your atlas." + Undo ⚑ 8 (`atlas.removedNotes` "{count} notes now name a concept with no entry: {list}." when the server says so).

## R12: Compare (`#/research/compare[/<id>]`)

- **Job:** "How do versions of this passage line up?" **Primary:** **Add an alignment**.
- **Loads:** `GET research/alignments` (alignments, versions, interpretations, rights, notices, publish state).

```
400 px: columns follow one another             Desktop (>= 70rem): one column per version, side by side
+------------------------------------------+
| Home > Research > Compare                |
| Compare versions            [More v]     |
| The cave, three versions   [Edit][More v]|
| Private: not published.                  |  publication line
| Layout (•) Side by side ( ) One after… |  radio; side by side only >= 70rem
| [ ] Show your normalizations             |
| -- Republic (Greek, Burnet) -------------|  h3 per version
| Made by: Burnet · Rights: public domain  |
| 1  ἰδὲ γὰρ ἀνθρώπους…   [ ] select       |
| 2  Absent: this version doesn't have it  |
| -- Republic, tr. Slings -----------------|
| 1  Picture men in an underground…        |
| Copy or download places (0 selected)     |
| [Select all] [Copy] [Download]           |
| An alignment records where you read      |  compare.notice
| these places as corresponding…           |
+------------------------------------------+
```

- **List:** filter **Version** (`compare.allVersions` "All versions"); empty `compare.emptyText` "Add your first alignment: the places in two or more versions you read as corresponding." Notices `compare.check` "Check this place: {message}".
- **Reading:** per column facts (`compare.madeBy` "Made by: {names}", `compare.anonymous` "Made by: nobody named", `compare.rights` "Rights: {label}", `compare.interprets` "Interprets {source}"); per place: exact wording (`lang`, `dir`, `bdi`), `compare.absent` "This version doesn't have this passage.", `compare.locatedOnly` "No words kept for this place; only where it is.", `compare.missingPassage` "The passage this place names is gone.", normalization (`compare.normalized` "Your normalization, not the source's words") only with the toggle, else `compare.normalizedHidden` "You wrote a normalization. Turn on Show your normalizations to read it.", `compare.placeNote` "Your note: {note}".
- **Publication line:** `compare.private` "Private: not published." / `compare.approvedNotPublished` "Approved, but your blog doesn't publish comparisons yet. {helper} can turn it on." / `compare.published` "Published at {address}." (text + Open) + `compare.rightsYours` "Rights statements are your own."
- **Copy or download places:** checkboxes "Select place {n}" per place; `compare.selected` "{count} places selected."; **Include my notes on places** (help `compare.notesHelp` "Your notes are private, so they're left out unless you include them."); rights statements listed for selected columns; when any is unknown/reserved **Copy**/**Download** first asks `compare.rightsTitle` "Copy words whose rights aren't cleared?" / `compare.rightsText` "These are your own statements, not permission. Copying them is your decision." **Copy them** / **Not now** (focused). `compare.copied` "Copied {count} places." / clipboard refused: text area + `compare.copyYourself` "Your {app} didn't allow copying. Select the text below and copy it." (`{app}` = the browser name, R3 rule) / `compare.downloaded` "Saved alignment-{id}.txt.". Nothing selected: `compare.selectFirst` "Select at least one place first."
- **Edit alignment:** **Name**, **Versions and places** rows (version or interpretation `select-field`; passage from the notebook or places; **Normalized wording** (optional) + **Its note**; **Absent here** toggle), **How they correspond** (server's kinds), **Your reasoning**, **How firmly**, **What's uncertain**, **Readers can see it**; lede `compare.editLede` "Aligning places records where you read them as corresponding, never that they mean the same thing." Statuses `compare.saved`, `compare.removed` + Undo (as old), `compare.rebuilt`/`rebuildFailed`.
- `compare.notice` = the old `ALIGNMENT_NOTICE_TEXT` sentence, reworded: "An alignment records where you read these places as corresponding. It doesn't say they mean the same thing, and no version is treated as the right one."

## R12: What readers see (`#/research/public`)

- **Job:** "What will readers see from my research?" No primary action; **Check again** is secondary.
- **Loads:** `GET research/boundary`, `GET documents?kind=posts` (paths for links), `GET research/readiness` (its failure never hides the boundary).

```
400 px                                          Desktop: one 48rem column
+------------------------------------------+
| Home > Research > What readers see       |
| What readers see from your research      |  h2 public.title
| 4 sources, 2 atlas entries and 1         |  public.counts (polite)
| comparison are shown. 37 things stay     |
| private.                     [Check again]|
| -- Sources your posts cite (4) ----------|  h3 per store
| > Plato, Republic                        |  details: the fields readers get
|     Title · Republic                     |
|     People · Plato (author)              |
| -- Held back (3) ------------------------|
|   Republic, tr. Bloom — no published     |
|   post cites it.                         |
| -- Atlas ... -- Claims ... -- Compare ...|
| -- Research checks ----------------------|  R7 review, site mode, Open it buttons
+------------------------------------------+
```

- Groups (`BOUNDARY_STORES` → ids `public.store*`): **Sources your posts cite**, **Atlas entries**, **Links between entries**, **Datings**, **Claims and evidence**, **Comparisons**, **Chosen for readers**. Each shown item opens to rows (`curationItemRows` → `public.field*` names: "Title", "People", "Who says so", "How firmly", "The evidence", …) with the exact public value; each held-back item says why (`public.why*`, from the old `CURATION_WHY` and boundary reasons: "No published post cites it.", "You haven't let readers see it.", "Your blog doesn't publish the atlas yet.", "Something it needs is held back.", "It changed after you chose it. Choose it again to show it as it is now.").
- `public.counts` "{shown} shown. {held} stay private." (+ per-store parts); **Check again** → `public.checked` "Checked again. " + counts.
- **Research checks** (site): R7's `parts/research-review.js` in site mode with each finding's **Open it** (below). Failure: `public.checksFailed` "The research checks didn't run. What readers see is still listed above." (+ **Check again**).
- Every item that has a screen has **Open it**: source → Sources; entry, link, dating → Atlas; claim, evidence link → that post's Write `?sheet=claims&claim=<id>`; alignment → Compare.

## R12: Write — Claims and evidence, links, For readers

### Claims and evidence (`?sheet=claims`)
`side-sheet` (desktop: docked like Your research, the two share the column with a `segmented-control` "Your research · Claims"). Loads `GET research/claims?path=`.

- Lede `claims.lede` "Private to you. A claim is your statement in this post; evidence records how one source bears on it. Nothing here scores evidence or decides what's true, and a citation alone links nothing."
- **Make a claim from the selected words** (primary) → needs a saved post ⚑ 12: unsaved draft: waits for autosave then continues; published with changes: `claims.saveFirst` "Press Update first: claims are checked against your saved post." → `POST research/claims/anchor` with the selection mapped to body offsets (`segmentAt` + box offset) → form: **The claim, in your words** (required, ≤ 2000), `claims.words` "About the words: “{text}”", **What's doubtful** (optional), **Readers can see it** (help `claims.approveHelp` "You agree to show this claim and what's doubtful in the post's Claims and evidence section."). No selection: `claims.selectFirst` "Select the words of the claim in your post first." Selection over two paragraphs: `claims.onePart` "Select words inside one paragraph, heading, list or quote."; twice in the post: `claims.twice` "Those words are in your post twice. Select the one you mean."
- **Claim card:** statement, words, anchor state (`claimAnchorStatusText` → `claims.inPlace` "In place." / `claims.moved` "The words moved. **Follow them**" / `claims.lost` "The words aren't in your post any more. Select them again." / `claims.ambiguous` "The words are in your post twice. Select the one you mean." / `claims.whole` "About the whole post."), three columns never combined: **Supporting ({n})**, **Contradicting ({n})**, **Giving context ({n})** (`claims.none*` "No supporting evidence recorded."), **Gaps and prompts ({n})** with "Next: {repair}", buttons **Link evidence** (disabled until the words are found: `claims.findFirst` "Find the words again before adding evidence, so evidence never lands on words you didn't choose."), **Follow them** / **Select again**, **Change**, **Take it out** (+ Undo).
- **Evidence form:** **How does this source bear on the claim?** (`radio-group` Supports · Contradicts · Gives context; help `claims.relationHelp` "Your reading of the source. Nothing checks whether it's true."), **Passage** (optional; `claims.passageHelp` "Stays private; it's pointed to, never copied."), **Source**, **Where in it**, **Why you read it this way**, **How firmly**, **What's uncertain**, **What you've checked** (`claims.review*` "Not compared with the source yet" · "Checked the place in the source" · "Read it, and I stand behind this"), **Readers can see it** (help `claims.linkApproveHelp` "You agree to show its source, places, how it bears, your reasoning, how firmly and what's uncertain beside the claim."; with a passage: `claims.noPassagePublic` "Evidence readers see cites the source and places, never a private passage. Take the passage out or keep it private.").
- Statuses `claims.saved` "Saved privately.", `claims.linkSaved`, `claims.removed` + Undo, `claims.followed` "The claim now follows its words."; findings summary `claims.summary` "{detected} found, {potential} possible, {review} to review." / `claims.summaryNone` "No gaps or prompts for this post's claims from the checks that ran."

### Your research additions (R12)
- **Show › Atlas entries and comparisons**; entry detail: kind, key, published state; **Put in a link to this entry** (published only) / why not (`contextLinkWarning` → `yours.notApproved` "Not published: you haven't let readers see this entry. Nothing private is linked." / `yours.siteOff` "Your blog doesn't publish the atlas yet, so a link would lead nowhere. {helper} can turn it on." / `yours.cantPublish` "The next update can't publish this entry. Open it in the atlas to see why."); **Published datings** each **Put in “{date}” linked to the entry**; comparison: **Put in a link to this comparison**. Inline at the caret (`insertMarkdownInline`), `yours.linked` "Link put in." + Undo.
- **For readers** (`curate.*`, R12): heading `curate.title` "For readers of this post"; lede `curate.lede` "Choose research readers get beside this post. Choosing never makes anything public that isn't already."; list **Chosen for readers** (`curationSelectionName`, status `curate.shown` "Shown to readers" or the why words), each with **See what readers get** (rows), **Move up/down**, **Stop showing** (withdraw) / **Show it again** (stale), **Take it out**; per item in a detail: **Choose for readers** (`curate.choose*`: "Choose this source as a reference", "Add my comment on this source", "Choose this entry", "Add my explanation of this entry", "Choose the dating “{date}”", "Choose the link “{label}”", "Choose this comparison"), optional fields as checkboxes (`CURATION_FIELDS` → ids), comment/explanation text (+ **By**, **Where in the source**). Not choosable: `curate.notYet` "Not choosable yet: no published post, atlas or comparison shows it. Choosing never approves it." Each change + Undo (inverse call); 409 → reload + `curate.changed` "Your choices changed somewhere else. Here they are now."

### Other hooks (R12)
- R7 Before you publish › Research checks: research objects get **Open it** (as What readers see); the group gains **What readers will see from this post** (`POST research/boundary` with the unsaved fields; post scope of the same component).
- R10: "What they point to" › a claim opens `?sheet=claims&claim=<id>`; Record what you decided › "The evidence you recorded" links the same.
- Notebook concepts link to atlas entries (above).

## Errors by code

`researchProblem(error, place)` in `parts/research-rules.js` maps every answer to `{field, id, vars}`; the server's sentence and code go in details. Until G93, it reads today's shapes (409 `conflict: true`, 422 `diagnostics[].code`).

| Answer | Where | Her words (id) |
| --- | --- | --- |
| 401 | shell | "Sign in again"; forms stay filled |
| 0 | status | `research.noSignal` (+ `research.keptHere` for a form) |
| 5xx / `storage` | status | `research.serverDown` "{product} didn't save that, so nothing changed. Your changes are still here." **Try again** |
| 409 `changed` (`conflict`) | form banner | sources `sources.conflict`; notebook `notebook.conflict` "Your notebook changed somewhere else, so nothing was saved. Your changes are still here."; atlas/claims/alignments/curation the same sentence with `{what}` (`research.conflict`) + **Use the newer copy** / **Keep mine, on the newer one** |
| 413 `too-large` | field / sheet | `research.tooLarge` "That's too much for one save. Split it up." (imports: `sources.importTooBig`) |
| 400 / 415 `bad-request` | status | `research.failed` "That didn't work. " + `common.tell` |
| 422 `invalid-json`, `unsupported-version` on load | screen | `research.unreadable` + `common.tell`; details: file, code, message |
| 422 `missing-field` | that field | `research.fill` "Fill this in." (source title: `sources.needTitle` "Give the source a title.") |
| 422 `invalid-id` / `duplicate-id` | Key | `sources.badKey` "Use lowercase letters, numbers and dashes." / `sources.keyTaken` "Another source has that key. Choose another." (notebook ids are automatic: details only) |
| 422 `unknown-kind` / `kind-changed` | Type | `sources.badKind` "Choose one of these types." |
| 422 `unknown-source`, `unresolved-relationship`, `invalid-relationship` | It's a form of | `sources.badOf` "Choose a source it can belong to." |
| 422 `relationship-cycle` | It's a form of | `sources.cycle` "That would make the source a form of itself." |
| 422 `ambiguous-location` | Volume | `sources.needVolume` "Name the volume: pages restart in each one." |
| 422 `invalid-identifier` | that identifier row | `sources.badId` "That {kind} doesn't look right. Check it against the book or page." |
| 422 `conflicting-attribution` | People | `sources.anonymousAndNamed` "It's marked as anonymous but names a person. {helper} can fix that in the library." |
| 422 `contributor-credit` | People | `sources.notCredit` "People who made a source can't be people credited on your posts." |
| 422 `still-used` (archive or change) | form banner | `sources.stillUsed` "Your notebook or atlas still points at this source, so it can't change that way." |
| 422 `invalid-field` (other) | mapped field (`sourceDiagnosticControl`, `notebookDiagnosticControl`) | `research.checkField` "Check this against the help under it." |
| 422 notebook `unknown-source` / `unknown-passage` | From / About these passages | `notebook.badSource` "Choose a source in your library." / `notebook.badPassage` "One of those passages is gone. Take it off the list." |
| 422 `invalid-locator`, `ambiguous-locator`, `unknown-locator-kind` | that place row | `cite.badPlace` / `notebook.badPlace` "Place {n} needs a kind and a value, like page 514." / `notebook.ambiguousPlace` "Say which volume: that place is in more than one." |
| 422 `not-private`, `reader-feedback`, `source-changed` | form banner | `notebook.notPrivate` "This entry came from somewhere else and can't be changed here. " + `common.tell` |
| 422 `still-linked` | form banner | `notebook.stillLinked` |
| `citations/check` 422 `unknown-key` / `invalid-key` | Source | `cite.notInLibrary` |
| … `malformed-citation`, `too-many-locators`, `invalid-locator`, `ambiguous-locator`, `unknown-locator-kind` | Where in the source | `cite.malformedNow` "That citation can't be read. Choose the source again." / `cite.tooManyPlaces` / `cite.badPlace` |
| … `too-large`, `too-many-citations` | form banner | `cite.tooMany` "This post has too many citations for one check. " + `common.tell` |
| … 409 (library changed) | Source | `cite.libraryChanged` "Your library changed. The list is up to date now; choose again." (state refreshed from the reply) |
| `sources/import` 422 with `plan` | sheet | rows marked; `sources.importBlocked` |
| `research/import` 422 | sheet | `notebook.bringBlocked` |
| `research/draft` part `error` | that part | `yours.partFailed` |
| R12 atlas/claims (`knowledge_atlas` codes): `endpoint-kind`, `self-relationship`, `duplicate-relationship`, `cycle` | From / To | `atlas.badEnds` "That kind of link can't join these entries." / `atlas.self` "A link needs two different entries." / `atlas.duplicate` "These entries already have that link." / `atlas.cycle` "That would make a loop of links." |
| `missing-evidence`, `evidence-conflict` | Evidence | `atlas.needEvidence` "Add evidence, or mark it as a draft with no evidence yet." |
| `private-endpoint`, `private-reference`, `invalid-visibility`, `unpublished-datings` | Readers can see it | `atlas.cantShow` "Readers can't see this while {what} stays private." |
| `invalid-date`, `aspect-kind`, `duplicate-dating` | that date field | `atlas.badDate` "That date can't be right. Check the year and era." / `atlas.badAspect` "This entry can't be dated that way." / `atlas.sameDating` "That dating is already here." |
| `stale-anchor`, `ambiguous-anchor`, `anchor-mismatch`, `unknown-post` | claim card | `claims.lost` / `claims.ambiguous` / `claims.saveFirst` |
| `undisclosed-contradiction` | Readers can see it | `claims.showBoth` "Readers can't see this claim's support without its contradicting evidence. Let them see both, or neither." |
| curation `target-not-published`, `rights-restricted`, `private-identifier`, `stale-selection`, `text-*`, `attribution-required` | that choice | `curate.why*` (as What readers see) / `curate.needText` "Write your comment." / `curate.needBy` "Say who wrote it." |
| `build` failure on a save | status | `atlas.rebuildFailed` / `compare.rebuildFailed` / `sources.rebuildFailed` "Saved, but a published comparison didn't update. Tell {helper}." |
| any unknown code | mapped field, else banner | `research.checkField` / `research.failed`; server sentence in details |

## Undo

| Action | Undo |
| --- | --- |
| Cite / change / take out a citation; put in a quotation; turn a note into words; put in a link (R12) | toast **Undo**: the box's text and the caret exactly as before (R6); the first citation also takes `citations` back ⚑ 4 |
| How sources show, language of the notes | part of the post: saves with it; Update/Undo as R5 |
| Source saved (edit) / passage, note saved / entry, link, alignment, claim, evidence saved (R12) | toast **Undo** → `PUT` the record as it was on the new revision; 409 → `research.undoChanged` "It changed again since, so it wasn't undone." |
| Source added / passage or note kept / entry, link, alignment, claim added | none: take it out (or archive a source) instead; status says how |
| Archive / restore (source, passage, note) | toast **Undo** → the opposite call |
| Take it out (passage, note, entry, link, alignment, claim, evidence) ⚑ 8 | toast **Undo** → `POST` the removed record back; refused (key reused) → `research.undoTaken` "Something else uses that key now, so it wasn't put back." |
| Readers can see it (any approval) | toast **Undo** → the previous value |
| For readers: choose, stop showing, show again, move, take out | toast **Undo** → the inverse call (R12) |
| Import sources / bring in a notebook copy | none ⚑ 8: the check is the one question; nothing is removed |
| Export, save a copy, copy/download places, download what a post cites | none needed: nothing changes |

Toasts stay until the next action in that screen; Find lists "Undo: {last}".

## Safety

- **Imported files are untrusted text.** CSL JSON and notebook copies are read with `File.text()` and sent as a string; Studio never parses them for display: the preview shows only the server's plan (ids, field names, counts), each value `textContent` in `bdi`. File size checked before reading (3 MiB sources; the server's notebook limit); a file that isn't text says so. Nothing in an imported file is ever a link, an image or markup in Studio.
- **Every research value is text.** Titles, names, quotations, notes, interpretations, rights notes, labels, keys, identifiers: `textContent`, `dir="auto"`, `.studio-stranger` isolation (R10 rule; it is her own research but often pasted from elsewhere), `lang` from the record's language. Identifiers and DOIs show as text; a web address or DOI gets **Open** only when `http(s)` (`https://doi.org/` + DOI), `target=_blank`, `rel="noopener noreferrer nofollow"`, `referrerpolicy="no-referrer"`, and `research.notChecked` "Nothing checked this link." Never fetched, previewed or resolved ⚑ 10.
- **No remote fetches.** R11–R12 add none; no lookup of DOIs, ISBNs, Zotero or link details; CSP unchanged. Exports are `Blob` downloads made in the page.
- **Private research stays private.** Research text travels only in request bodies (search, backlinks), never in addresses; `?claim=`, `/research/notebook/<id>` carry ids only. Nothing is written to `localStorage`; `sessionStorage` only for a form that couldn't be sent (⚑ 7), removed on save. Notes reach a post only through the conversion dialog; a passage only as a quotation with its citation; interpretations never.
- **What goes in a post is checked by the server.** Citations come back from `citations/check`; quotations use `quotationMarkdown`/`literalMarkdownLine` (lifted, byte-for-byte) and end in a checked citation; links only to the `CONTEXT_URL` pattern (published pages).
- **R8:** the writing helper's disclosure keeps `research: off`: nothing from the library, notebook, atlas, claims or alignments is ever sent to a provider (R8 already shows this line; R11/R12 add no helper feature).
- **Rights are statements, not permission:** every quotation or copy of words with unknown or reserved rights asks once.

## Accessibility and keyboard

- **Names:** chips "Citation: {label}"; cards "Quotation from {source}"; result rows "{type}: {title}, {visibility}"; row controls full ("Take out place 2", "Role for person 1"); claim buttons name their claim ("Link evidence to: {statement}", cut at 80 letters); chronology lists "Datings of {aspect} of {name}".
- **Focus:** after save, the status; after add, the new row in the list; after take out, the next row (else the empty state); after Cite/quotation, the box at the caret after the insertion; sheets return focus to their opener; errors focus their field (first one) with `aria-describedby`.
- **Keys:** Ctrl/⌘ Enter saves the open research form or sheet; Escape closes sheets and menus (asking when filled in); `/` then "cite" or "quot" in a words box; Alt+↑/↓ moves a quotation card (R6); in lists ↑/↓ move between rows (roving tabindex), Enter opens. No one-letter shortcuts.
- **Live regions:** one polite region per screen (counts, statuses); `role="alert"` only for conflicts and unreadable stores.
- **320 px:** one column; area tabs become a `select-field`; source/notebook entries open full width with **‹ Your sources** / **‹ Your notebook** back links; row editors (people, identifiers, places, evidence, datings) stack each row's fields; Compare columns follow one another (side by side only ≥ 70rem, same order); chips wrap; Cite's source list scrolls inside its own labelled region (the one allowed inner scroll); no sideways scroll; controls ≥ 44 px.
- **Reduced motion:** no slide for docked/sheet research; no highlight fade on new cards.
- **Zubra:** `side-sheet`, `text-field`, `select-field`, `combo-box`, `choice-cards`, `radio-group`, `segmented-control`, `toggle-switch`, `tag-input`, `file-drop`, `content-card`, `status-badge`, `action-button`, `dropdown-menu`, `alert-banner`, `modal-dialog`, `toast-region`, `empty-state`, `skeleton-block`, `loading-spinner`, `data-table` (R12 What readers see rows), `command-palette`. Checkboxes use the native fallback (as R5–R10).

## Rules each part uses (static imports, DOM-free, tested)

| Part | File | Functions (lifted unless marked new) | Slice |
| --- | --- | --- | --- |
| Routes, home, kept | `parts/research-rules.js` | `RESEARCH_SCREENS` (from `RESEARCH_PANELS`), `researchRoute(name, rest, search)` (legacy map, from `canonicalAdminHash`), `researchHash(screen, id)`, `workflowSteps({library, notebook, atlas, alignments, post})` (new), `keptForms` helpers (new), `researchProblem(error, place)` (new), `RESEARCH_NOT_YET` | R11 |
| Sources | `parts/source-rules.js` | `SOURCE_KINDS` (→ ids), `SOURCE_LOCATION_SCHEMES`, `sourceFieldsForKind`, `sourceRelationOptions`, `sourceLabel`, `filterSources`, `sourceDependents`, `sourceDraft`, `mergeSourceCreators`, `mergeSourceLocation`, `sourceTargetVolumes`, `sourceDraftPayload`, `validateSourceDraft` (→ ids), `sourceDiagnosticControl`, `sourceImportSummary`, `sourceImportRows`, `sourceExportLossNotes`; new: `creatorRows`/`rowsToCreators`, `identifierRows`/`rowsToIdentifiers`, `suggestKey(title, taken)` | R11 |
| Notebook | `parts/notebook-rules.js` | `QUESTION_STATES`, `NOTE_KINDS`, `notebookSearchBody`, `searchIsActive`, `hitContext`, `notebookImportSummary`, `notebookImportRows`, `suggestEntryId`, `captureSources`, `parseLocatorLines`, `formatLocatorLines`, `parseConceptList`, `passageDraft`, `passageDraftPayload`, `validatePassageDraft`, `noteDraft`, `noteDraftPayload`, `validateNoteDraft`, `notebookDiagnosticControl`, `entryPreview`, `locatorText`; new: `placeRows`/`rowsToLocators` | R11 |
| Citations | `parts/cite-rules.js` | `citationSpans`, `citationAt`, `citationInsertionProblem` (+ `markdownLineKinds`, `codeSpanRanges`, `markdownLinkRanges`), `parseCitationText`, `formatCitationText`, `citationLocatorsFromPassage`, `citationDraftPayload`, `validateCitationDraft`, `insertCitationText`, `citationSourceChoices`, `citationProblem` (= `citationFailure`, → ids); new: `citationLabel(citation, sources)`, `citationsIn(text)` (chips per box), `removeCitation(text, span)`, `citationStyleField(fields, firstCitation)` | R11 |
| Your research | `parts/draft-research-rules.js` | `literalMarkdownLine`, `quotationMarkdown`, `convertedNoteMarkdown`, `insertMarkdownBlock`, `insertMarkdownInline`, `draftResearchItems`, `DRAFT_RESEARCH_FILTERS`, `rightsOf`, `rightsText`, `RIGHTS_NEEDING_CONFIRMATION`; R12: `contextLinkMarkdown`, `contextLinkWarning` (→ ids) | R11/R12 |
| Cards | `parts/word-blocks.js` | `blockKind` gains `quotation`; `parseQuotation(source)` (new) | R11 |
| Atlas | `parts/atlas-rules.js` | `ATLAS_ENTRY_KINDS`, `ATLAS_CONFIDENCE`, `ATLAS_ATTRIBUTIONS`, `ATLAS_PRECISIONS`, date forms, `atlasAspects`, `atlasYearText`, `atlasPointText`, `atlasEntryDraft`, `validateAtlasEntryDraft`, `atlasRelationshipDraft`, `atlasDissentDraft`, `validateAtlasRelationshipDraft`, `atlasPointDraft`, `atlasDatingDraft`, `atlasEvidenceText`, `rebaseAtlas*`, chronology model and filters, `atlasEndpointChoices`; new: `eraYear(year, era)` / `yearEra(year)` | R12 |
| Compare | `parts/compare-rules.js` | `alignableSources`, `alignmentMemberDraft`, `alignmentDraft`, `rebaseAlignmentDraft`, `validateAlignmentDraft`, comparison columns, `interpretersText`, `comparisonExportText`, rights confirmation | R12 |
| Claims | `parts/claims-rules.js` | `claimAnchorStatusText` (→ ids), `claimLinkColumns`, `claimFindings`, `claimFindingsSummary`, `claimCountsText`, `claimDraft`, `claimPayload`, `validateClaimDraft`, `evidenceLinkDraft`, `evidenceLinkPayload`, `validateEvidenceLinkDraft`, `claimDiagnosticControl`, `applyClaimsState`, `CLAIM_RELATIONS`, `CLAIM_REVIEW_STATES`; `claimSelectionAnchor` markdown half only; new: `boxSelectionToBody(box, start, end)` | R12 |
| For readers, boundary | `parts/curation-rules.js`, `parts/boundary-rules.js` | `CURATION_KINDS`, `CURATION_WHY`, `CURATION_FIELDS` (→ ids), `curationValueText`, `curationItemRows`, `curationSelectionName`, `curationStatusText`, `curationMove`, `curationPostSlug`; `BOUNDARY_STORES`, `boundaryCountsText`, boundary rows | R12 |
| Words | `parts/research-words.js` (`research.*`, `sources.*`, `notebook.*`, `place.*`), `parts/cite-words.js` (`cite.*`, `yours.*`, `quotation.*`, `add.citation*`, `add.quotation*`, `card.quotation*`); R12 `parts/atlas-words.js`, `parts/compare-words.js`, `parts/claims-words.js`, `parts/public-words.js` (`public.*`, `curate.*`) | all `layer: "her"` except `research.findStart`, `cite.writes`, `*.details*` (`layer: "details"`); every default passes `HER_BANNED` and the persona test; none uses `{owner}` | R11/R12 |
| Screens | `screens/research.js` (home), `screens/sources.js` + `parts/source-form.js`, `parts/source-import.js`; `screens/notebook.js` + `parts/notebook-form.js`, `parts/notebook-copy.js`; `parts/cite-form.js`, `parts/cite-chips.js`, `parts/your-research.js`, `parts/sources-in-post.js`; R12 `screens/atlas.js` + `parts/atlas-form.js`, `parts/atlas-dates.js`, `parts/chronology.js`; `screens/compare.js` + `parts/alignment-form.js`; `screens/research-public.js`; `parts/claims-sheet.js`, `parts/for-readers.js` (each < 400 lines) | | |

**Port (R11):** `admin-sources` (17) → `studio-source-rules`; `admin-research-notebook` (42) → `studio-notebook-rules`; `admin-citations` (31) → `studio-cite-rules`; `admin-draft-research` (19, minus the research-section cases R6 took) → `studio-draft-research-rules`; `admin-research-workspace` (30): route and workflow cases → `studio-research-rules`, kept-panel cases → `studio-research-rules` (kept forms), panel-chrome cases (landmarks of the old shell) deleted in R15. Browser: `research-workspace.spec` → `studio-research.spec.mjs`; `citations.spec` → `studio-cite.spec.mjs`; `draft-research.spec` (minus the Visual-mode case, dropped with Visual mode) → `studio-your-research.spec.mjs`.
**Port (R12):** `admin-research-atlas` (45) → `studio-atlas-rules`; `admin-research-compare` (34) → `studio-compare-rules`; `admin-research-claims` (22, minus Visual-mapping cases) → `studio-claims-rules`; `admin-curation` (28) → `studio-curation-rules`; `admin-boundary` (7) → `studio-boundary-rules`; site cases of `admin-readiness-report` and `admin-publication-review` → `studio-review-rules` (R7 deferral). Browser: `atlas.spec`, `chronology.spec` → `studio-atlas.spec.mjs`; `compare.spec` → `studio-compare.spec.mjs`; `claims.spec` → `studio-claims.spec.mjs`; `curation.spec` → `studio-for-readers.spec.mjs`; `research-readiness.spec` → `studio-research-public.spec.mjs`; by setup only (retirement plan §2): `public-boundary`, `curated-context` switch their Admin steps to API calls. `interpretation-comparisons.spec` is R13's. Public-site specs (`atlas-timeline`, `atlas-trail`, `citation-navigation`, `citation-previews`, `evidence-feedback`) are untouched.

**New tests:** `citationsIn` finds markers outside code and never inside links (fixtures from `admin-citations`); `removeCitation` + Undo restore bytes; every example post with citations round-trips `splitBlocks`/`joinBlocks` with `quotation` cards; first citation sets `citations: notes` once and Undo removes it; `creatorRows`/`rowsToCreators` and `identifierRows` round-trip every source in `examples/` and the test fixtures unchanged when untouched; `suggestKey` never collides; `workflowSteps` primary for each empty/partial state; `researchRoute` for every old address in §Navigation; `researchProblem` covers every code in §Errors (a fixture per enum value from the Rust enums, so a new code fails the test); no her-layer default in the research catalogs contains "capture", "Studio", "Admin" or a banned word; `eraYear`/`yearEra` (no year 0, 1 BCE ↔ −1); a non-research `meta` gives no research item in `addItems`, Find, About this post or nav (R11 gate test).
**New browser:** `studio-research.spec.mjs`: the gate (no research anywhere with `siteUses.research` false; Find's developer entry opens home); add a source with people and identifier rows; edit → Undo; archive → Undo; conflict keeps changes; import preview → import; export downloads; kept form across tabs; 320 px, axe, keyboard only. `studio-notebook.spec.mjs`: keep a passage with a note; partial failure; search filters (text not in the URL: request log check); take out → Undo; save a copy asks; bring in. `studio-cite.spec.mjs`: cite from the keyboard; chips Change/Show me/Take it out; refused inside a link; first citation turns notes on; quotation with rights dialog → card → Move → Undo; note conversion asks; offline Cite waits and survives a reload; docked panel at 1280 px, sheet at 400 px.

## Server gaps

- **G92. Research on this site:** `meta.siteUses.research` is true when any private research store exists (`sources.json`, `notebook.json`, atlas, alignments, claims, selections), any post has `profile: research`, `citations` or a `[@` marker outside code, or `knowledgeAtlas.publish`, `comparisons.publish`, `claimEvidence` or `curatedContext` is on. `meta.research` adds `{ atlasPublishes, comparisonsPublishes, claimEvidence, curatedContext, citationLocales: ["en","de","fr","es"] }` so her words never guess a switch. Until G92, Studio treats the site as a research site when `GET sources` answers with any source (one request, made only after the developer's Find entry or on a research post).
- **G93. Codes on research answers:** every `sources*`, `research/*` (incl. `atlas`, `claims`, `alignments`, `curation`, `boundary`, `readiness`) and `citations/*` refusal adds a top-level `code`: `changed` (409, today `conflict: true`), `too-large` (413), `bad-request` (400/415), `unreadable` (422 load failures, with `file` and the diagnostic codes), `storage` (500); saves that rebuild add `build: { ok, code }`. Diagnostics keep their kebab-case codes and `field`. Sentences stay one release.
- **G94. Where a source is used:** `GET sources` adds per source `citedBy: [{ path, title }]` (posts whose citations resolve to it or a version of it) and `usedBy: { passages, notes, atlasEvidence, claimEvidence, alignments }` counts, so the source page answers "Where did I cite this?" and archiving says what keeps working. Read-only; computed like the build.
- **G95. A citation as readers will see it:** `POST citations/check` accepts optional `post` (path, for the locale and style) and returns `label` (short, like "Republic, tr. Slings, p. 514") and `note` (the plain-text note in the post's language), so chips, cards and the Cite form show the published wording. Until then `citationLabel` builds the label from the library.
- **Not gaps:** `GET/POST/PUT sources`, `sources/archive`, `sources/import` (preview/apply), `sources/export?format=csl-json|bibtex`; `research/notebook`, `search`, `backlinks`, `archive`, `export`, `import`, `passages`, `notes` (POST/PUT/DELETE); `citations/library`, `citations/check`; `research/draft`; `research/atlas*`, `explore`; `research/claims*`, `anchor`; `research/alignments`; `research/curation*` (incl. `rebuild`); `research/boundary` GET/POST; `research/readiness`; `research/review*` (R7); `preview` `citations` (+ `exports`), `citationsOptedIn`, `research`; `document` (writes `citations`, `citationLocale`).

## Risks to test before release

- A non-research site (recipes, a roofer) on R11: no new nav, no new Add something items, no new About this post group, no new Find entries except the developer's, no new request at start (G92 absent: the fallback request is never made).
- A post written in the old Visual editor with citation chips and quotations: opens in Write, saves with no change, nothing rewritten; chips match the old chips' keys.
- A library from the old Admin with structured creator names (family/given/particles) and `x-` locator kinds: open, save untouched → byte-identical record; edit one row → only that creator changes.
- Two tabs: a source changed in one, saved in the other → conflict keeps her changes; Undo after a change elsewhere says so.
- A CSL JSON file from Zotero with 2,000 items (near 3 MiB) on a phone: preview stays responsive (rows render in pages of 50 with **Show more**), import completes, nothing removed.
- Right-to-left and polytonic Greek quotations: direction and language kept in cards, Compare columns and copies.
- iPhone at 320 px: Cite from `/`, chips wrap, a quotation card moves, the Cite source list scrolls only inside itself.
- No signal mid-Cite and mid-passage: kept, said, sent later by her press; nothing private left in `sessionStorage` after save.
- R12: a BCE dating with circa and decade precision saves at its stated precision and reads back the same; claims on a published post with unsaved changes ask for Update; a private passage on approved evidence is refused at its field; What readers see never lists a private note or unselected text (fixture with a planted secret string, as `curation.spec`).

## Docs and release note

- `docs/admin.md` (Studio manual, R15 rewrite): **Research** chapter — Research home, Sources (form, import from Zotero/CSL JSON, export), Notebook (keep a passage, notes, search, copies), citing in Write (Cite, Cited here, quotations, Your research, Sources in this post), R12 Atlas, Chronology, Compare, What readers see, Claims and evidence, For readers; old → new addresses.
- `docs/research-profile.md`: "Choose Research under Settings → Content profile" → "choose **Research** as what kind of post in Write"; "Open **Evidence** … `Alt+9`" → Before you publish › Research checks (R7) and, for claims, **Claims and evidence** (R12); "Admin Studio manages the library under Sources (`#/research/sources`)" → Studio › Research › Sources; Cite "in the Write view" → Add something › A citation; the opt-in paragraph gains "Studio turns on numbered notes with a post's first citation; change it in About this post › Sources in this post."
- `docs/studio-words.md`: R11/R12 ids (generated). `docs/configuration.md`: `knowledgeAtlas.publish`, `comparisons.publish`, `claimEvidence`, `curatedContext` entries say where Studio shows their effect. `CHANGELOG.md`.
- **Release note (R11):** Research is in Studio for sites that use it: keep sources (with people and identifiers as simple rows), import from Zotero or any reference manager as CSL JSON, export CSL JSON or BibTeX; keep passages and notes and search them; cite while you write — citations show under each part of your words with Change and Take it out, quotations from your notebook are cards you can move, and your research sits beside your words on a computer. A post's first citation turns on numbered notes; choose notes or a list of works, and the notes' language, in About this post. Editing or removing research can be undone. "Capture" is now "Keep a passage". Sites that don't use research see no change.
- **Release note (R12):** The atlas, chronology, Compare and What readers see are in Studio, with Claims and evidence and For readers beside your post. Old research addresses open the same places. Nothing private is ever shown, sent to a writing helper or looked up online.

## Changes to `studio-ux` (proposed)

- **A specialist's words are her words.** On a screen only a specialist owner reaches (research), the terms of her field (source, edition, citation, DOI, CSL JSON) belong on her layer; the system's words still never do. `HER_BANNED` applies unchanged.
- **Features appear only where they're used.** An area that most owners never need (research, trade) is invisible until the site uses it; the developer's door is one Find entry; the gate is tested.
- **Inline things live in her words; block things are cards.** Something that sits inside a sentence (a link, a citation) stays in the words and gets its buttons in a row directly under that box; something that stands alone (a quotation, a table) is a card in place.
- **Someone else's words go in exactly, and ask once.** Quoted or copied words are never retyped, trimmed or normalised, and words whose rights aren't cleared ask once before they go into a post or a copy; a rights statement is never presented as permission.
- **Private stays private by construction.** Private text travels only in request bodies, is stored on the phone only when it couldn't be sent (and says so), and reaches a post only through an explicit, named action.
- Review checklist: "A site that doesn't use this feature sees no trace of it." and "Every insertion of someone else's words keeps them exactly and is undoable."
