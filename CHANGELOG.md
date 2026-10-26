# Changelog

All notable changes to open.blog are recorded here. Releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Reader participation now has one policy. Comments keep `engagement.comments` and `comments:`
  exactly as before; questions, suggested sources and corrections, other interpretations, Third
  Perspectives, author responses and abuse reports are each off until `participation.kinds` in
  `openblog.json` switches them on, and a post can choose its own mode with `participation:` front
  matter. Everything submitted starts pending; a request for clarification never publishes the
  text it asks about, removals and dismissed or upheld abuse reports always need a reason, and
  `participation.retention` sets how long unpublished text and the private moderation record are
  kept; comments stay out of retention unless you set it yourself. Nothing is e-mailed to readers.
  Sites that switch nothing on build exactly as before. Passage feedback's `engagement.feedback` is
  now the same as setting its four kinds to `follow-comments`, so each kind can also be set on its
  own: the "Questions and corrections" form offers only the kinds open on a post, and a locked
  kind keeps its published notes on show without taking new ones.
- Comments and reader feedback are now moderated in one place: Admin's **Moderation inbox**
  replaces the comment section of Analytics and the Reader feedback view. It lists every item by
  state (pending, waiting for clarification, approved, rejected, removed, withdrawn) and kind,
  oldest first, and pages through long lists. Each item shows only the decisions you can take on
  it, with their reasons and what each does: approve, ask the reader to clarify, reject, remove
  from the post, or reopen for a fresh decision. A removed or rejected comment can no longer be
  approved straight away, a moved passage must still be confirmed before approval, and a decision
  made on an out-of-date view is refused and the list reloaded. On a shared reflection a
  co-writer moderates as its coordinator, or only reads as a contributing author, and never sees
  a reader's private name. Everything works with the tables you have; to offer every decision,
  with a version and an audit trail for comments, run the new optional
  `supabase/moderation.sql` (and `feedback.sql` again if you use feedback) and set
  `OPENBLOG_MODERATION_ENABLED=true`; `supabase/moderation-rollback.sql` undoes it. Nothing is
  e-mailed to anyone.

## [0.33.0] - 2026-10-26

- Defined how reader questions, corrections and annotations will point at published text. A
  passage target names a section by its heading id and either the whole section or a short
  quotation with a little context on each side, and is checked against the post as it is now: it
  finds the same words again, even after they moved to another section, or it is reported stale
  with a reason (removed, reworded around it, ambiguous). It never silently points at different
  words, and accents, emoji and other combined characters are never split. A target can also
  point at a whole post, and sections that share a heading id are told apart. The same rules run in
  the build and in a small browser module for the reader features to come, checked against the
  same cases. Nothing uses targets yet, so no page changes.
- Defined what is kept about where each piece of reader feedback came from: the post and the
  revision of its text the reader saw, the passage, when they saw it (by their own clock, if
  given) and when the site received it. A reader's name is shown publicly only if they agree,
  nothing else about them is recorded, and a published note never re-quotes text the author has
  since removed. Research notebooks now refuse reader-feedback fields (`attribution`,
  `receivedAt`, `seenAt`) with a clear message, so feedback cannot be merged into private research
  by accident.
- Sites on Netlify and Supabase can opt in to typed passage feedback: a reader's question,
  suggested source, suggested correction or other interpretation of a passage, sent to the existing
  engagement function with the passage and the revision of the page they saw. It is off unless the
  site turns it on in `openblog.json`, sets `OPENBLOG_FEEDBACK_ENABLED=true` and runs the new
  `supabase/feedback.sql`, which only adds one private table (`supabase/feedback-rollback.sql`
  removes it). Every submission is checked with the same rules as the build, held pending for
  moderation with the time the site received it, and limited by the existing hourly quotas. A
  reader's name stays private unless they agree to show it, nothing else about them is kept and no
  e-mail is collected or sent. Sites that do not opt in are unchanged. Saving hosted engagement
  settings in Admin now keeps settings the form does not show. Reader forms and moderation screens
  come next.
- Readers can now send that feedback from the post itself. On sites that opt in, each open post ends
  with a "Questions and corrections" form: choose the whole post, a section, or words you selected
  in the post (a button appears next to the selection), say whether it is a question, a suggested
  source, a suggested correction or another interpretation, and write your note, with an optional
  name you choose whether to show. The form works with the keyboard and screen readers, announces
  problems and progress, fits narrow phones and changes nothing in the article. Without JavaScript
  the page explains how to send a note; when the service is offline, off or failing, the form
  gives you the note to copy and send to the author, at the address in the new optional
  `engagement.feedbackContact`. Locked and hidden posts, sites that do not opt in, feeds and
  portable copies are unchanged.
- Reader feedback can now be moderated and answered. Admin has a "Reader feedback" view that lists
  what readers sent, by state, through Admin's own server, so the hosted token never reaches the
  browser. Each note shows whether its passage is still where the reader saw it, has moved, or has
  changed or gone; a note about a passage that is not current can be approved only after you
  confirm you read it as it is now. Approve publishes a note, reject and remove need a reason, and
  two people can never act on the same note at once: every decision is checked against the
  version you saw and recorded in a private audit table. Approved notes are written to
  `content/reader-feedback.json`, versioned with your site, without the reader's name unless they
  agreed, their own clock or anything about moderation, and shown on the post's page only, under
  "Reader questions and responses", with the quotation only while the post still has those words.
  You can add a public response to each note and record what changed in the post as a revision
  note (`evidenceRevisions`), which a site that takes feedback now publishes; neither edits the
  post, and nothing is sent to readers. Feeds and portable copies carry a link to the page instead
  of the notes. A note that is approved but not on its post yet, or removed but still on it
  (because the file could not be written, or the decision was made outside Admin), says so and can
  be put on or taken off the post again. Run `supabase/feedback.sql` again to add moderation: it adds two columns, an audit
  table and one moderation function, and changes nothing else.

## [0.32.0] - 2026-10-26

- Defined the format for private claims in draft posts and evidence links that record whether a
  source supports, contradicts or contextualizes each claim, with rationale, uncertainty, review
  state and provenance. A citation alone never asserts support, contradicting evidence cannot be
  hidden while support is published, and nothing judges evidence or scores it. Nothing reads or
  writes these files yet, so no site output changes.
- Withdrawing consent on a claim or a contradicting evidence link is never refused: an approved
  link on a private claim, and approved support beside a private contradiction, stay private and
  are reported as notices instead of making the claims file invalid.
- Evidence Studio in the post editor can now record claims: select words in a saved draft to make
  a claim, then link supporting, contradicting or contextualizing evidence from your notebook
  passages or source library with a rationale, confidence and uncertainty. Supporting and
  contradicting evidence are listed side by side and never combined into one figure. Each claim
  shows whether its words are still where you selected them (verified, moved, stale or
  ambiguous) and can be re-anchored; a stale or ambiguous range is refused without changing the
  draft or the claims. Claims are stored privately in `.openblog/private/research/claims.json`,
  checked by `openblog check`, synced by the hosted workspace, and never reach your site, feeds,
  search, `llms.txt` or exports. A source or passage an evidence link uses cannot be removed
  until the link stops using it.
- Claims now come with evidence gaps and review prompts: a claim with no evidence, contradicting
  evidence without a note on how the post addresses it, only supporting evidence on a claim you
  marked uncertain, a link resting on an archived source or passage, a link with no location or
  no rationale, a location nobody has checked, a suggestion nobody has reviewed, and claim words
  that moved or are gone. Each names what was checked and what to do next, and none says whether
  a claim is true. `openblog check`, `openblog build` (as warnings, only when the private claims
  file is present, and never in the site) and Evidence Studio show the same findings in the same
  order. A claim's anchor that is still in place now reads "In place" rather than "Verified".
- Sites can now publish the claims and evidence you approved: turn on `claimEvidence.publish` and
  each post with approved claims gains a "Claims and evidence" section, readable without
  JavaScript, listing every claim's supporting and contradicting evidence side by side with the
  references, locations, your rationale, confidence and uncertainty, and marking a claim with
  published contradiction as contested. The same text reaches portable copies, feeds and
  `llms.txt`, and `/claim-evidence.json` holds the same data. Support is never published while a
  contradicting link stays private, private notes and passages never are, and withdrawing approval
  removes the item from the next build. Dated revision notes written in a post's front matter as
  `evidenceRevisions` are published in the same section and stay published even when the private
  claims file is gone. Sites that leave the setting off are unchanged.

## [0.31.0] - 2026-10-26

- Contributors to a shared reflection can pin moments to its sources in Admin: a time or range in
  a video or podcast, or a page, chapter or other location in text, with a short quotation (its
  speaker, rights and where the words came from) and their own observation. Moments are private
  unless proposed for the piece; a proposed moment is shared with the next draft revision its
  writer offers, every author must approve it, and editing it afterwards asks everyone to approve
  again. Times are read the same way every time, a malformed one is refused without losing what
  was typed, and every moment keeps a link to the original source, starting at the moment where
  the provider allows it.
- Quotations in moments are now credited the same precise way everywhere in Admin and the combined
  preview: who said the words, the source and the time or page. Choosing a rights status shows plain
  guidance on what that status states, always as your own statement: open.blog does not check
  rights or decide how words may be used. You can add a one-line rights note for your co-authors,
  such as who gave permission, which is never published. A quotation that names no speaker or runs
  past 300 characters gets a gentle warning as you type, and still saves.
- Approved moments are now published with the shared reflection, after everything else under
  "Moments in the sources": where each one is in its source (times read like 1:02), who noted it,
  the quotation in its own language credited to its speaker, source and time, the author's
  observation, and a link that opens a YouTube video at the moment or otherwise links to the original
  source. Nothing is embedded, so a removed or blocked video still leaves the title, the location
  and the link, and a source without a link keeps its location as text. Portable HTML, Markdown and
  text, RSS, JSON Feed and llms-full.txt carry the same moments in order, and an export that would
  drop one is refused. The preview shows each moment exactly as it will be published. Rights
  statements, rights notes and private moments are never published, and pieces without proposed
  moments publish exactly as before.
- Saving a moment in Admin now waits for the save to finish: its buttons are disabled while it is in
  flight, a quick second click no longer collides with the first save, and anything you type while
  it saves is kept instead of cleared.

## [0.30.0] - 2026-10-26

- Defined the reader-facing reference data behind citation previews: each cited reference has a
  stable id (its citation key, distinct per edition), each citation names its marker, note and
  locators, and only the public reference description is included. Posts without published
  citations are unchanged; the page and its notes read the same without JavaScript.
- Pages that publish citations now carry that reference data inline and are easier to navigate
  without JavaScript: the notes are one labelled region, following a citation moves keyboard and
  screen-reader focus to its note, each way back returns to the exact citation (repeated ones
  included), the place you arrive is highlighted, long addresses wrap at high zoom, and print keeps
  every note. If a page's citation links would not match its notes, for example because the post's
  own HTML reuses a generated id, the build stops and names the post. Other pages are unchanged.
- Citation markers now open a preview of the cited source right beside them: on keyboard focus,
  on hover, or on a first tap on touch screens. It shows the formatted reference, the cited
  location and its DOI or web link, closes with Escape (returning focus to the marker) or by
  moving elsewhere, stays on screen at any width, respects reduced motion and is not printed. The
  marker is still the link to its note, nothing is fetched or stored, and only pages with
  published citations load it; without JavaScript the page is unchanged.
- The citation documentation now lists what citation previews guarantee in every release (safe
  links, text-only metadata, the content security policy they need, no requests or storage,
  unchanged reading position, zoom, print and no-JavaScript behaviour, and which outputs never
  carry their data) and what they do not verify: that a source exists or is described correctly,
  that a DOI or address resolves, that a passage supports the claim, or that a source is
  authoritative or may be reused.

### Fixed

- A post that publishes citations and has no `description` no longer takes its description, JSON-LD
  `wordCount` and reading time from the generated notes. They now come from the post's own prose,
  and the space left before a removed citation marker is gone, so "stronger [@plato]." reads
  "stronger." (introduced in 0.27.0). Site search still includes the notes, as it does an author's
  footnotes; a written `description` and posts without citations are unchanged.
- Citation notes now link a DOI stored as `doi:10.x/y` or as a `doi.org` or `dx.doi.org` address
  to `https://doi.org/10.x/y` and show it as `doi:10.x/y`, instead of producing a broken
  `https://doi.org/https://doi.org/...` link (introduced in 0.27.0).
- In a post that publishes citations, a heading named like a generated note or citation id (such
  as `## Cite 1`), or a footnote such as `[^notes]` named like the notes heading, no longer shares
  an id with it, so every in-page link reaches the right place (introduced in 0.27.0). Only the
  generated heading moves aside: the post's own headings keep the ids they have without citations,
  so links to them still work. A post whose own HTML reuses a citation id is still refused, and the
  message now names the id to rename.
- On a site served under a base path (such as `https://example.org/blog/`), text that only reads
  like a redirect address, such as a title or note containing `; url=/x`, is no longer rewritten
  to `; url=/blog/x` on pages, in their structured data or in citation preview data.

## [0.29.0] - 2026-10-26

- Defined the format for a private Knowledge Atlas of people, works, concepts, movements and events,
  with relationships that always name who asserts them, the source evidence and the uncertainty,
  and that never present a contested relationship as consensus. Research-note concept links now
  have a defined home in concept entries; existing notebooks are unchanged. Nothing reads or writes
  an atlas yet, so no site output changes.
- The Knowledge Atlas is now stored privately in `.openblog/private/research/atlas.json` and
  checked by `openblog check`, which also notes approved relationships that stay private
  because an entry they join is private. Withdrawing an entry's approval is never refused,
  events can answer, influence and be influenced, and removing a concept your notes link to is
  allowed and lists those notes. A source or notebook passage the atlas uses cannot be removed
  until the atlas stops using it, and a copy of the atlas inside `content/`, `static/` or a
  theme stops the build and publishing. Nothing from the atlas reaches your site, feeds,
  search, `llms.txt` or exports.
- Admin Studio has a new **Atlas** view under Research tools. You can list, search and filter
  entries by kind, add and edit people, works, concepts, movements and events, and relate them
  with pickers that offer only the entries a relationship kind may join. Each relationship
  names who asserts it, rests on sources from your library (optionally a notebook passage) or
  is marked as an unsourced draft, and records confidence, what is uncertain and who disputes
  it. Each entry lists its incoming and outgoing relationships as text you can move through
  from the keyboard, and a disputed relationship is always shown as contested, never as
  agreed. A note's concepts in the notebook link to their atlas entries. Everything stays
  private.
- You can now publish the approved part of your Knowledge Atlas by setting
  `"knowledgeAtlas": {"publish": true}` in `openblog.json`. The build writes `/atlas/`, a page
  for each approved entry with its relationships from and to it, and the same data as
  `/atlas.json`, built from one projection with a fixed list of public fields. A relationship
  appears only when it and both its entries are approved, always in its stored direction with
  who asserts it, its sources, confidence and doubt, and a disputed one is shown as contested
  with everyone who disagrees. Private entries, notebook passages, unknown fields and anything
  unapproved never appear, clearing an approval removes the item from the next build, and
  sites that leave publication off build exactly as before without reading the atlas.
  Because the atlas is private and Git-ignored, only `openblog serve`, Admin or a local build
  you upload can publish it; `openblog build` and `openblog check` warn when publishing is on
  but no atlas is stored, as in a CI or static-host build.

## [0.28.0] - 2026-10-26

- Shared reflections now work for groups of any size up to the participant cap, through the same
  copy-link invitations. Site owners and coordinators see an audit trail of invitations, joins,
  role changes, and removals (participants and roles only, never links or prose), and role
  changes keep approvals and continuing-conversation attribution in step. Existing records need no
  migration.
- Site owners and coordinators can choose a shared reflection's approval rule in Admin: every
  author, everyone who wrote, the writers plus named people, or the writers plus everyone with a
  chosen role, and whether an approval covers one's own sections or the whole piece. Everyone who
  wrote always approves their own words. Changing the rule needs a confirmation, clears every
  approval, and is refused if someone else changed it first or if the authors could never meet
  it. A coordinator can keep or add people who must approve, but only a site owner can change the
  rule so that someone no longer has to. If a named person leaves, or nobody holds a listed role,
  publishing waits until the rule changes. The combined preview shows the rule. Changing the
  sharing rule now refuses to overwrite a change made elsewhere and, because it clears every
  standing offer, needs a confirmation too.
- A shared reflection with a large group, long names and a long membership history no longer
  risks being saved in a form that could not be opened again; a save that would be too large is
  refused and the reflection stays as it was.
- Accessibility Studio and `openblog check` no longer ask you to review the layout markup of an
  arranged shared reflection as custom raw HTML: it is written by open.blog, with every turn
  under a heading naming its author. Raw HTML anywhere else is still flagged for review.
- When an author removes a part of their draft after the piece was arranged, the combined
  preview says the arrangement no longer matches the drafts, and once every required approval is
  in, publishing asks a coordinator to arrange it again rather than failing with a generic error.
  A coordinator who cannot read the drafts is never told whether a part exists.

## [0.27.0] - 2026-10-25

- Defined how citations work, ahead of in-post citations: a citation is `[@key]` or
  `[@key, page 514; canonical 514a to 520a]`, where the key is a source library id and the
  locators are the notebook's. It is opt-in, so existing posts, links and footnotes render exactly
  as before. Only the key, the locators and the formatted reference can become public, never
  notebook text. CSL import and export now state what is stored, kept as-is, or reported as lost,
  including citation locators. Nothing on your site changes yet.
- You can now insert and edit citations from the Admin Write view. **Cite** searches your source
  library, takes optional locators or copies them from a notebook passage (never its quotation or
  notes), and inserts `[@key, page 514]` only after the server checks it the way a build will read
  it. In Visual mode every citation, including hand-written ones, is a chip that keeps its exact
  Markdown, and Ctrl+Z right after inserting restores the draft and caret exactly. If the library
  changed meanwhile, nothing is inserted and your choices are kept.
- Citations are now found with the same Markdown parser the renderer uses, so code, comments,
  defined `[@label]` links and list continuations are read the same way everywhere. Identifiers in
  private schemes (such as a local file path) and extra fields on notebook locators are never
  published with a citation, and CSL citation items keep custom labels and normalise ids the way
  reference import does.
- Citations typed or pasted in Visual mode now become chips, and a line whose citations the
  visual editor cannot read exactly as a build does (such as one inside link text) is kept
  verbatim instead of being rewritten. Cite refuses a caret inside code or a link in either mode
  and explains why in the still-open dialog. CSL export writes the current `sub-verbo` label.
- Posts can now publish their citations. Add `citations: notes` or `citations: bibliography` to a
  post's front matter and each `[@key, locator]` becomes a numbered note (or a reference list
  entry) built from the source library, in English, German, French or Spanish. The page, portable
  copies, feeds and `llms.txt` all show the same notes, and on the page each marker and note link
  to each other for keyboard and screen-reader users. Only the cited sources' public description
  is published. An unknown key or ambiguous page stops that post with its line and a fix. Posts
  without `citations` are unchanged.
- A draft (or a post waiting for its date) with an unresolved citation no longer stops the build
  or previews of other posts: it gets a warning and keeps the citation as text until it publishes.
  A source library edit that would break a published post's citations is refused and names the
  post and line. `citations: yes` and `on` now work like `true`. **Cite** also refuses a caret
  inside an autolink, indented code, HTML, a comment, or a code span or link that spans lines.
- `openblog check`, builds and Evidence Studio now review a post's citations offline in four
  separate kinds of finding: citations that cannot be read, keys or pages that do not resolve,
  cited sources missing a detail readers need (such as a title, date or journal), and the cited
  locations only you can check against the source. Nothing is looked up online, and no finding
  says whether a source is right or supports a claim. `openblog export <slug> --format
  csl-json` (or `bibtex`) and Evidence Studio's **Download cited references** save a post's
  cited references for reference managers, holding only what its notes show and listing
  anything the format cannot carry.

## [0.26.1] - 2026-10-25

- Two people saving to the same shared reflection at once (drafts, invitations, members, reveal
  and approval changes) are no longer refused now and then with "another content write is
  active": a finished request now releases the content lock before the next one starts.
- On Windows, saves no longer fail with "Access is denied" when another program, such as an
  antivirus or indexing scanner or a backup or sync client, briefly has the file open. Admin and
  CLI writes wait out the hold for up to five seconds, and a compare-and-swap save still refuses,
  rather than overwrites, a file someone changed in the meantime. Reading a shared reflection or
  the login list while it is being replaced waits the same way instead of failing, and a content
  lock file such a program holds is no longer left behind to block later writes.

## [0.26.0] - 2026-10-25

- Feeds and portable copies of a part of a collaborative series now say which series it belongs
  to, where it falls ("Part 2 in the series") and who wrote it, with a link to the series page: in
  the full RSS and JSON Feed content, in portable HTML, Markdown and text, in exports and
  syndicated copies, and in llms-full.txt. RSS items also name the series as a category in the
  site's series taxonomy, and JSON Feed items carry an `_openblog.series` object. Drafts and
  scheduled posts never count, no collaboration details appear, and every other post's feeds and
  copies are unchanged.
- A series that credits the site owner both as the site author and under their contributor entry
  (for example on a shared reflection) now names them once in its list of contributors.
- Portable Markdown now escapes `<` and `&` in titles, names and other facts, so a name such as
  `Kim <https://kim.example>` or `AT&amp;T` stays literal text instead of failing the build.
  Portable Markdown and text of a post with `<` or `&` in its title, credits or other facts change
  once as a result, and so does its portable source revision: renew any portability
  acknowledgements for such posts once in the Admin portable preview.
- A series that holds a collaborative work (a published post credited to two or more authors, such
  as a shared reflection) now says who wrote what. Its page lists the series' contributors, and
  every part, ordinary posts included, shows "By ..." on the series page, inside the previous and
  next links and in the list of all parts. Names come from each post's approved credits and are
  plain text, drafts and scheduled posts never appear, and order and links are unchanged. Every
  other series renders exactly as before.
- A shared publication can now carry a series placement: the same `series` and `seriesOrder` an
  ordinary post uses, so it joins the site's existing series, ordering and navigation. Any one-line
  title works, the placement is part of what every author approves (changing it makes approvals
  out of date), and records without one publish exactly as before. A series' contributors can be
  derived from its posts' work credits.
- The Shared reflections view has a Series panel. Every participant sees the reflection's series,
  position and the reading order it would join; site owners and coordinators choose an existing
  series or type a new title, set or clear the position, preview the order and save; site owners
  can add a new series with its recurring premise. The list and order come from published posts
  only, a change made against an older read is refused without losing what was typed, and the
  combined preview now shows the series and position authors are approving.

## [0.25.0] - 2026-10-25

- You can now archive passages and notes you want out of the way, without deleting them, and export
  and import your private research notebook. Archived entries stay in the file and in exports and
  come back with Show archived or Restore. Export saves one versioned file of all your private
  passages and notes, only when you ask and confirm; import previews first, only adds entries the
  notebook lacks, and refuses any conflict without changing anything. Building, checking and
  publishing now also refuse to continue when a research export or a copy of the notebook has been
  saved into content, static or themes, and automated tests check that private research never
  reaches pages, feeds, search, llms files, portable exports, CSL or BibTeX, logs, error messages or
  published history.
- You can now search the private research notebook and see how it connects. The Notebook view
  filters by source (including its editions and translations), locator kind, concept, and
  question state beside text search, shows each hit with its source, locators and linked notes,
  and lists backlinks for the selected passage, its source and a note's concepts. Questions can
  be marked open or resolved. Everything is computed from the stored files, so it stays correct
  after edits and archiving, and it is private: nothing reaches the public site, feeds or exports.
- Fixed capture edit conflicts: after a conflict you now choose between the stored copy and your
  draft before saving, so a concurrent change is never silently overwritten. Archived sources stay
  selectable on entries that already use them, and stale field errors clear on the next save.
- A source edit or import that would leave the research notebook invalid, such as re-pointing a
  reference so a page locator becomes ambiguous, is now refused with a message naming the affected source (for an import, each record it
  re-pointed or re-typed).
- Notebook search and backlinks now send their text in a request body instead of the URL, so a
  hosting proxy's access log cannot record private research text.

- Defined the private research notebook contract: quoted passages (verbatim excerpt, compound
  page, folio, line, canonical and custom locators, tied to a source-library record) and
  observation or question notes that link to passages, sources, and concepts. Every entry is
  always private with no publication path, quoted text stays apart from your own prose, and a
  failed change leaves the notebook untouched.
- You can now capture passages and notes from Admin. A new Notebook view under Research
  lists, edits and removes them, and a Capture research button in the post editor opens a
  dialog prefilled with your selected text where you pick a source, add locators and an
  optional note, then return to exactly where you were writing. Saving needs a real source and
  the current notebook revision; a stale save keeps your draft and writes nothing. Quoted text
  is stored as typed and shown only as text. The notebook lives in
  `.openblog/private/research/notebook.json`, is kept in the hosted workspace, is checked by
  `openblog check`, and never reaches the built site, feeds, search or exports. A source that
  a passage or note still uses can no longer be removed from the library.

## [0.24.0] - 2026-10-25

- A shared reflection that has both an arrangement and an approved continuing conversation
  publishes the arranged sections in reading order and then the conversation, and every portable
  form (Markdown, text, feeds, llms-full.txt) keeps that order. Approvals bind the arrangement and
  the conversation together.
- Fixed: a link with a username or password in shared prose is refused when publishing, with the
  other unsafe links, instead of failing the whole site build. Syndication plans no longer warn
  about literal raw HTML for a reflection's own layout markup.
- A published shared reflection now reads the same in portable HTML, Markdown, plain text, RSS, JSON
  Feed and llms-full.txt whichever layout it uses: each round prompt, then every turn under its
  author's name and label, in the published order, with no styles, scripts, placeholders or markers
  needed. Portable Markdown and text no longer show the page's layout tags as words, and
  llms-full.txt now keeps prompts, names and labels with their words. The portable HTML check
  reports that column and stagger placement is the one thing a portable copy does not carry.
- Fixed: Markdown typed into a turn label, round prompt or participant name (such as
  `[x](javascript:alert(1))`) could become a live link in the portable Markdown export and could
  break the build. These values now stay plain text everywhere.
- Fixed: in an alternating dialogue the side changes only when the speaker changes, so one author's
  consecutive turns stay on the same side. Point and counterpoint uses two columns only for exactly
  two people and one column for three or more.
- Fixed: a last turn that ends in an indented code block is no longer refused when publishing.
- Shared reflections can also be presented as point and counterpoint, an alternating dialogue or a
  roundtable. A coordinator picks the layout in Admin and can give any turn an optional short label
  (such as "Point"); no label is added for you, and no layout implies that anyone disagrees. The
  roundtable fits any number of participants. Every turn still has its author's name as a heading,
  the page reads in the same order without styles, and wide-screen placement falls back to one
  column on narrow screens, at high zoom and in print. If a contribution is missing or withdrawn,
  its turn and label disappear and the rest read as one honest column.
- Shared reflections can now be presented sequentially or side by side. A coordinator chooses the
  layout and the order of turns in Admin (Shared reflections, "Layout and arrangement"); writers can
  start a new part of their draft with "Start a new part". The published page keeps one reading
  order in the page itself, so a screen reader, print and a page without styles read it top to
  bottom, and side by side becomes one column on narrow screens and at high zoom. Changing the
  layout or the order makes earlier approvals stale, so every author approves what readers will
  see. The part marker line is never shown anywhere.
- Added the layout-independent structure of a shared reflection: rounds, round prompts and turns
  that point at parts of each participant's draft, one deterministic reading order that shows each
  reader only what they may read, and five layout modes over the same contributions without any
  gendered or positional field. Nothing is presented differently yet; invalid structures are
  refused without echoing anyone's text.

## [0.23.0] - 2026-10-25

- The continuing conversation travels with the piece. Full-content RSS, JSON Feed, portable
  HTML, Markdown and text, and llms files keep its categories, attribution, order, open questions
  and stable anchors with a canonical link, and carry no drafting or approval state. An automatic
  summary or excerpt now stops before the conversation, and summary-only feeds export none of it.
- Fixed: the continuing conversation's generated anchors can no longer be claimed by an author's
  own heading, and an item's headings must start at level five and not skip a level. Item saves
  now refuse these (and any heading above level five) up front, and a publish refusal caused by an
  item names the item and the rule instead of blaming a section.
- A published shared reflection now ends with a "Continuing the conversation" section holding its
  approved agreements, differences, questions, applications and uncertainties. Items are grouped by
  kind, each headed "Speaking for" the authors it names, with stable anchors and no consensus signal.
  Only items every named author approved at their current text publish; an empty synthesis adds
  nothing. The combined preview shows the same section, and item Markdown is held to the safety
  rules of sections (no raw HTML or unsafe links, and no headings above level five). It flows into
  RSS, JSON Feed and portable output as ordinary post content.
- Contributors can write, attribute, edit, reorder and approve a shared reflection's continuing
  conversation in Admin: optional agreements, differences, questions, applications and
  uncertainties, with dismissible, editable prompts and no minimum length. Each item shows who has
  approved it, in Admin and in the combined preview (editors and coordinators never see items). Publishing is blocked while a named author has
  not approved the piece or any item is awaiting approval, and any change to an item makes standing
  approvals of the piece out of date. Items stay private to the authors; nothing is published yet.
- Shared reflections have a core model for synthesis items: optional agreements, differences,
  questions, applications and uncertainties, each attributed to one, some or all authors. Disagreement
  is never an error, authors can withdraw their own name, and an approval binds to the exact items,
  order and attribution. Each item records which of its authors approved it, and any change to the
  item clears those approvals. No Admin screen or public output uses it yet.

## [0.22.0] - 2026-10-25

- Portable Markdown for a published shared reflection now escapes its title, so a participant-supplied
  title can no longer inject raw HTML into an export or syndicated copy.
- A published shared reflection now has checked output everywhere the site publishes: the page,
  portable HTML and Markdown, RSS and JSON Feed show every author's section in order, credit each
  author who wrote one in the same order, and link the shared source and guiding question. Replaced
  draft revisions, invitations, approvals and account names never appear in any of them.
- Shared reflections can now be approved, scheduled and published (routes only; the Admin screens
  come later). An author approves the exact piece they read, a coordinator or site owner publishes
  it only while every required author's approval still matches, and a missing or stale approval
  refuses the request with nothing written. Publishing writes the Post, its credits and the
  rebuilt site as one unit and is undone if any step fails; repeating it changes nothing. A
  scheduled reflection is held privately and checked again when its time comes, so an edit or a
  removal after scheduling holds it back. Sections with raw HTML or `javascript:` style links are
  refused, and refusals never repeat anyone's text. The check covers the combined page, so heading
  attributes, math-style `$...$` markup, and an unclosed code fence or link definition in one
  section that would change another author's section are refused too.
- Added the approval model for shared reflections: an approval is an author's own affirmative,
  timestamped consent bound to the exact content, author set, order, public metadata and policy,
  so editing or changing any of them withdraws the affected approvals and nobody can approve for
  another author. No screen or publishing step uses it yet.
- An approval from an author who has written no section now covers the whole piece, so any
  later edit to the prose withdraws it.
- Added a combined preview to Shared reflections in Admin ("Review the combined piece"). It shows
  every author's section together at its exact current revision with each author's approval (approved,
  awaiting, or out of date), and is clearly marked "Preview, not published". You see a section only
  when it is shared with you at its current revision; anything else is one placeholder. The preview
  runs no script, loads no images, and changes nothing. It renders prose with the site's own
  Markdown settings, and an author who has written nothing no longer stops the others from
  reviewing and approving the piece.

## [0.21.1] - 2026-10-25

- Fixed voluntary reveal so a publication keeps one author set: visibility is now derived from the
  active participants' standing ready offers, so late joiners see earlier offers and are seen in
  return, each person sees only the revision currently offered, and removed or withdrawn people are
  excluded both ways and rejoin when restored. Reveals made by the all-ready rule, explicit
  exchanges and data stored by v0.21.0 keep their meaning.

## [0.21.0] - 2026-10-25

- Fixed the shared draft sharing controls: the revision you confirm to share is now always the one
  sent, even if the draft changes in another tab, and keyboard focus stays in the Sharing section
  after you offer, take back or change the rule.
- Added a "Your draft" panel to Shared reflections in Admin. Writers get optional prompts they can
  add, edit, delete or hide, a clear saved or unsaved state, and sharing controls to offer a
  revision or take the offer back. If a draft changed in another tab, your text stays put beside the
  newer copy and you choose which to keep, with an undo. Offline and size errors keep your text.
  Other people's drafts appear only once the sharing rule has revealed them to you.
- Added optional mutual reveal for shared reflections. A coordinator chooses whether sharing is off
  (the default), voluntary, or requires everyone to be ready. Each contributor marks one exact
  revision ready and can take it back until the reveal happens; then everyone involved sees those
  revisions together. A comparison lists everyone in order by name and shows a placeholder for any
  section not revealed to you. Changing the policy never reveals anything, and removed members
  neither block nor receive a reveal.
- Added private draft saving for shared reflections: a Contributor or Editor can save and read only
  their own section through Admin. Each save appends a revision; a save made on an out-of-date
  copy is refused with the newer copy and overwrites nothing. Drafts stay under the project's
  private folder and never reach content, generated output, feeds, exports or Git.
- A shared draft that reaches its revision or storage limit is now refused with a clear message
  and nothing is lost, instead of making every participant's drafts unreadable.
- Defined private contribution drafts for shared reflections: append-only revisions with a
  prose-free identity, conflict checks on save, and a mutual reveal that shows nothing until every
  member has committed. Revealing is never approval, and no storage or route is added yet. Draft ids are compared ignoring case so a stored set always
  reloads, and saving over another participant's draft id no longer reveals more than that the id
  is taken.

## [0.20.0] - 2026-10-25

- Enforced collaboration roles through one server-side check on the shared reflection record.
  Readers, editors, and contributors cannot invite or manage invitations, accounts that were
  disabled or removed lose every grant at once, and operations without a route stay denied. Site
  ownership alone cannot publish a reflection until each contributor has approved the current
  revision.
- Added invitations to shared reflections in Admin Studio. A site owner or coordinator names an
  existing Admin account, the contributor profile it will appear as, and roles, and gets a private
  link to pass on; nothing is emailed. The link works once, only for that account, expires in 1 to
  30 days, and is stored only as a hash. The invitee accepts or declines after signing in; wrong
  accounts, spent, expired, revoked, and guessed links all fail the same way, and repeated guesses
  are rate limited. Owners and coordinators can revoke a link or issue a new one. The Admin API
  adds `/admin/api/collaboration/invitations` (list, create, revoke, reissue, accept, decline).

- Added member management to shared reflections in Admin Studio. Site owners and coordinators see
  who can sign in, their roles, pending and finished invitations, and warnings when an account or
  profile no longer exists. They can change roles, remove access, and revoke links, each after an
  explanation of what changes. Ending access never removes credit for what someone wrote. A change
  made on a stale view is refused and the list reloads, and the last site owner cannot be removed.
  The Admin API adds `GET /admin/api/collaboration/members` and `POST .../members/roles` and
  `.../members/remove`.

## [0.19.0] - 2026-10-25

- Added import and export to Sources in Admin Studio. Import CSL JSON (for example from
  Zotero) after a preview of what would be created, updated, kept, and not imported; conflicts
  such as duplicate ids or identifiers block the whole import and nothing is saved, and
  re-importing the same file changes nothing and never discards richer details you already
  recorded. Private notes and abstracts are never imported. Export CSL JSON (lossless for
  open.blog) or BibTeX (with a list of what it cannot carry). The Admin API adds
  `POST /admin/api/sources/import` and `GET /admin/api/sources/export`.
  Re-imported items may state only the fields they change, an import can no longer give two
  sources the same DOI, ISBN, ISSN, PMID, or PMCID (including through an update), hand-edited
  files cannot slip private notes through `custom`, and BibTeX export stays valid when a title
  holds a lone brace.
- Included the research source library in the durable hosted editorial workspace so source
  changes made in Admin survive a Render restart or redeploy.
- Defined the versioned research source library contract in core: distinct works, editions,
  translations, witnesses, and references with stable identifiers, source locations, lossless
  unknown fields, and source-scoped diagnostics that keep contributor credits out of
  bibliography.
- Stored the research source library privately at `.openblog/private/research/sources.json`
  with revision-checked, locked, atomic create, update, and remove. Stale revisions,
  duplicate or missing ids, symlinked paths, and malformed, oversized, or newer-version
  files are refused with source-scoped diagnostics and leave the stored file unchanged, and
  interrupted writes are cleaned up. `openblog check` validates a stored library.
- Added Sources to Admin Studio for managing the private research source library: create,
  edit, archive, restore, search, and filter works, editions, translations, witnesses, and
  references with type-aware fields. Stale edits report a conflict and keep your draft
  without overwriting newer data, failures name the source and field and leave the stored
  library unchanged, and archived sources stay in place so records that point at them still
  resolve. The Admin API is `/admin/api/sources`.
- Builds no longer copy anything inside `.openblog/` when a static or theme directory
  contains it or a static file links into it.

## [0.18.0] - 2026-10-25

- Fixed a guiding question or source title containing a tilde pair, such as `~this~`, stopping the site build and Admin preview; the text now exports literally.
- Posts can now publish the source of a shared reflection. `guidingQuestion`, `sharedSourceTitle`,
  `sharedSourceUrl`, and `sharedSourceType` in front matter show the guiding question and the
  original source's title, link, and type beside the work, in Admin preview, the built page, RSS,
  JSON Feed, `llms-full.txt`, and portable HTML, Markdown, and text. The source is always a plain
  link, so an unsupported provider degrades to the link. Only these four values are published;
  invitations, drafts, participants, and other collaboration state never reach output. An unsafe
  link, a bad type, or oversized text stops the build with a clear message instead of publishing.
- Added an optional **Suggest details from link** button to each source in a shared reflection.
  For YouTube and CodePen links, the same providers the embed renderer supports, Admin Studio asks
  the provider's oEmbed service for a title and creator and fills only fields you left empty,
  telling you what it filled. It never fetches transcripts or pages, refuses redirects and
  non-public addresses, and gives up after six seconds. A timeout, refusal, missing details, or an
  unsupported link changes nothing and never blocks saving. Nothing is stored until you create the
  reflection. Suggested fields carry a "Suggested by" note until you edit them, and an answer that
  arrives after you changed the link or removed the source is discarded.
- Added a versioned, group-safe collaboration contract in `openblog-core` with ordered
  participant, contribution, reveal, layout, and approval collections, explicit size limits, a
  derived two-person projection, revision-checked replacement, and one non-identifying error for
  unsafe identifiers, spoofed names, profile URLs, Markdown, or unknown fields.
- Defined shared-publication language for sources, participants, collaboration roles,
  contribution drafts, reveals, approvals, and published assemblies, kept apart from posts,
  contributors, work credits, and Admin users, with fixtures for legacy posts and groups of any size.
- Added a publication-scoped collaboration authorization policy that binds an Admin user and a
  contributor registry key to one participant. Site owner, coordinator, contributor, editor, and
  reader roles are explicit. Access is denied by default, checked against the draft's owner and
  reveal list from the contract, and creates no authorship, credit, or approval. Changing a
  binding or its roles is itself authorized: only a site owner can grant or revoke the site owner
  role, and the last site owner cannot be removed. Admin usernames and binding names now share
  one validation rule.
- Added **Content → Shared reflections** to Admin Studio: start a private shared reflection from
  a video, article, podcast, book, or other source, with or without a link, plus a working title
  or guiding question, using labelled fields and examples instead of Markdown. Each one is stored
  atomically as a versioned private record outside `content/` with ordered source references,
  normalized HTTP(S) links, and the creator bound as site owner. Unsafe links, unknown fields, and
  identity claims in the request are refused without echoing them, and no post, credit, build, or
  feed changes.
- Added a View publication collaboration action, listed shared reflections only to bound
  participants, and removed an account's bindings when `openblog user remove` or
  `openblog user add` reuses its name. Contributors bound to a shared reflection can no longer be
  removed from the registry.

## [0.17.2] - 2026-10-24

- Web sandbox HTML, CSS, and JavaScript editors and configured-runner lessons now use the same
  editable-code surface as Rust playgrounds: a labelled editor bar, syntax colouring and optional
  line numbers from the static code blocks, the same focus ring, and matching Run, Reset, and note
  styling. Existing `ob-rust-*`, `ob-code-runner-*`, and `ob-web-sandbox-*` classes remain on the
  elements for theme overrides; shared styles now live on `ob-code-editor-*` classes.
- Fixed sites built without a local `web/` folder missing the configured code-runner scripts;
  the absent module stopped every enhanced component on the page from loading. A test now
  checks that every relative script import is embedded.

## [0.17.1] - 2026-10-24

- Added modern Supabase secret API key support for Netlify comments and analytics via
  `SUPABASE_SECRET_KEY`, while preserving legacy service-role authentication and documenting
  the server-only setup without a database migration.

## [0.17.0] - 2026-10-24

- Added an optional post `subtitle` (also `subheading` or `dek`) shown under the title, edited directly
  beneath the title in Admin Studio, imported from and sent to Hashnode, and kept separate from the
  search `description`. JSON-LD carries it as `alternativeHeadline`, and subtitles over 160 characters are
  flagged in Admin readiness and as a build warning. Re-running the Hashnode import reports posts that have a
  Hashnode subtitle as changed; overwriting them adds `subtitle`, which marks them for re-syndication.

## [0.16.0] - 2026-10-24

- Portable HTML now renders static fallbacks for every current interactive capability:
  quizzes keep their prompt, lettered choices, and the author's answer and explanation behind a
  native `<details>` disclosure; runnable code and web sandboxes keep their labelled source with
  a link to run them on the canonical article; CodePen and YouTube embeds become titled provider
  links; video chapters become an ordered chapter list; recipe facts, callout titles, and
  video production notes stay visible; and comments become a link to the canonical discussion.
  The output needs no open.blog script, custom element, form, or iframe.
- Portable HTML now keeps research and attribution: ordered contributor credits with their roles
  and unauthenticated ORCID iDs (kept apart from the references), the DOI and license, the
  "Originally published at" source, and footnote citations that keep their numbers and ids and
  link to the note on the canonical article. Planned or unknown capabilities fail closed: their
  authored content stays visible with a labeled link to the canonical article and a
  canonical-only report, while private-only state adds nothing to the copy or its report.
- Portable HTML now rewrites authored raw HTML through a documented allowlist: scripts, styles,
  event handlers, forms, `<base>` and `<meta>` tags, comments, and custom elements are removed
  or unwrapped (Markdown inside a removed element goes with it); frames, media, SVG, and MathML
  become a link to the canonical article; heading `{key=value}` attributes are dropped; and each
  removal is reported as a `raw-html` capability. Raw HTML URLs resolve against the canonical
  article like Markdown links, ids stay unique across raw HTML, headings, and footnotes, every
  image gets `alt`, and the body stays well nested. Native pages are unchanged.
- The portable projection fails for that post with a source-scoped diagnostic, instead of
  publishing or truncating, when a raw HTML or `sourceUrl` address is unsafe (including `data:`
  and encoded `javascript:` URLs), a removed element or comment that is never closed would hide
  later content, or the body exceeds 2 MiB or 64 levels of nesting.
- Fixed quizzes and web sandboxes failing to build when nested in a callout, quote, or list item.

## [0.15.0] - 2026-10-24

- Added private per-admin workspace personalization to Admin Studio: Simple (the new default),
  Guided, Advanced, and Custom presets; showing, hiding, and reordering optional tools; comfortable
  or compact density; a default Visual or Markdown writing mode; and Restore defaults. A
  goal-grouped **Advanced tools** dialog, the **More tools** menu, and `Ctrl+K` keep every tool
  reachable in every preset, and Write, Site preview, Settings, save and publish state, conflicts,
  privacy notices, approvals, and blocking validation can never be hidden or reordered.
- Stored workspace preferences as a bounded, schema-versioned file per login under
  `.openblog/private/admin-preferences/`, behind login and CSRF checks, with atomic,
  revision-checked saves so a change from another tab is reloaded instead of overwritten. They never
  reach posts, `openblog.json`, the built site, feeds, or exports, and unavailable storage falls back
  to a usable Simple workspace with a notice.
- Admins whose browser remembered a writing mode from an earlier release move once into the
  Advanced layout with that mode; every other login, including others in the same browser, starts
  in Simple.

## [0.14.0] - 2026-10-24

- Defined the semantic portability invariant and domain language for derived output,
  destination policies, private/public boundaries, and canonical work identity.
- Added core descriptors for authored Markdown capabilities, including renderer,
  fallback, portability, and bounded diagnostics, without changing authoring syntax.
- Added a destination-neutral projection for canonical identity, existing HTML,
  Markdown, and text views, authorship, references, capabilities, and safe links;
  routed public feeds and syndication through it without changing authored content.
- Added a shared portability fixture corpus covering legacy articles, research and
  credits, recipes, callouts, media, quizzes, runnable code, unknown syntax, hostile
  code, Unicode, duplicate anchors, and draft exclusion.
- Published an implementation-status matrix separating shipped capabilities,
  partial support, and planned work without assigning unverified portability levels.
- Audited generated native HTML and optional custom elements, documenting no-JavaScript
  and no-CSS behavior, accessibility caveats, and the raw-HTML trust boundary.
- Audited semantic differences across Markdown, native pages, feeds, and syndication;
  extended shared fixtures across these output surfaces and documented known losses.
- Defined portability completion gates for planned research, reader, collaboration, and
  discovery capabilities, with unique story/task ownership and machine-checked fallbacks,
  privacy boundaries, and regression requirements.
- Added an opt-in portable HTML body projection that re-renders canonical Markdown, resolves
  authored link and image URLs against the post/site context, and leaves existing native HTML
  unchanged; raw-HTML sanitization and capability-specific fallbacks remain separately scoped.

## [0.13.0] - 2026-10-24

- Added `openblog syndicate <slug>` with dry-run planning, draft-first DEV, Hashnode,
  Ghost, and WordPress adapters, guided Medium import, private remote-ID state, and
  explicit two-step publication safety.
- Added optional provider-neutral code-runner configuration for credential-free, explicitly
  allowlisted executable lessons while preserving the official Rust Playground default and static
  fallback for unsupported languages.
- Expanded Assistant Interactions to propose strictly validated Rust, web, and configured-runner
  examples or coding challenges without executing code in the blog or Admin process.
- Added dependency-free `web runnable` HTML/CSS/JavaScript sandboxes with editable tabs and a
  CSP-restricted opaque-origin preview.
- Added structured video production stages, season/episode numbers, credits, an Admin workflow,
  and a complete fictional Zhalendor example production post.
- Added per-post open, locked, and hidden comment policies plus pending, approved, and rejected
  Admin moderation queues.
- Added optional Supabase-backed Netlify Functions for moderated comments and persistent,
  privacy-respecting view analytics, with a checked-in SQL schema and deployment guide.
- Added hosted engagement settings and pending-comment moderation to Admin Analytics. Public
  endpoints live in `openblog.json`; the matching Admin token is write-only, privately protected,
  bound to its endpoint origin, and can be overridden with `OPENBLOG_ENGAGEMENT_API_KEY` plus
  `OPENBLOG_ENGAGEMENT_API_ORIGIN`. Admin requests reject redirects and public writes use
  Supabase-backed per-client and per-site quotas.
- Expanded Assistant Interactions with editable runnable Rust examples and bounded coding challenges,
  including selected-section grounding, visible TODO and expected-result requirements, explicit
  insertion in Visual or Markdown mode, and a non-AI authoring path.
- Updated the Learning design review skill and versioned publishing-engine guide so recommendations
  distinguish recall checks, exploratory examples, and guided coding practice without inventing
  unsupported languages, multi-file projects, hidden tests, or automatic grading.

## [0.12.0] - 2026-10-24

- Added native Assistant integrations for OpenAI, Google Gemini, xAI Grok, DeepSeek, Mistral AI,
  and OpenRouter with fixed official destinations, provider-specific environment credentials,
  structured-output adapters, editable model choices, and strict local result validation.
- Added a versioned publishing-engine guide to Assistant requests so reviews, quiz proposals, and
  autocomplete understand native open.blog syntax, profiles, scheduling, and source boundaries.
- Added safe local application and one-step undo for exact AI review suggestions, with Unicode range
  handling and fail-closed stale, ambiguous, repeated, and overlapping edit detection.
- Added session-only opt-in AI autocomplete for Visual and Markdown writing, with explicit data
  disclosure, debouncing, selected context, stale-response suppression, abort-on-navigation, and
  author-controlled accept or dismiss actions.
- Completed Assistant Interactions by connecting it to the reviewed knowledge-check proposal flow.
- Added a CI-enforced documentation link and heading-anchor check, and expanded the documentation
  index and project overview to cover the completed author-time Assistant workflows.

## [0.11.2] - 2026-10-23

- Grounded Assistant reviews in trusted open.blog renderer capabilities so native quiz and
  runnable Rust fences are reviewed for authoring quality without being misreported as unsupported.

## [0.11.1] - 2026-10-23

- Made review verification labels context-aware and conservatively downgraded unsupported
  `supplied-context` claims to unverified advice instead of discarding an otherwise valid review.
- Extended native Anthropic Assistant requests to four minutes while preserving the existing
  30-second custom-provider deadline, allowing first-use structured-output grammar compilation.
- Constrained native Anthropic Assistant replies with task-specific JSON schemas so every review
  finding includes its required source range, and safely re-anchors incorrect provider offsets
  when their exact evidence occurs only once in the reviewed Markdown.
- Fixed Anthropic reviews that could spend the entire output budget on adaptive thinking before
  returning JSON, and now report safe, actionable stop-reason errors for empty responses.
- Added native Anthropic Claude support with the correct Messages API authentication and response
  adapter, plus an author-friendly provider choice that keeps custom HTTPS integrations compatible.
- Added an Assistant provider settings panel for endpoint and model configuration plus write-only
  private credential replacement and clearing, with environment credentials taking precedence.
- Refined Assistant provider setup into a compact connection card with clear status, progressive
  disclosure, author-friendly guidance, and confirmed credential removal.

## [0.11.0] - 2026-10-23

### Added

- Added a post Assistant workspace with keyboard and command-palette navigation, labelled
  Review, Interactions, and Context areas, and an authenticated credential-safe provider
  capability summary that leaves non-AI authoring available when configuration is missing.
- Added portable and private author/site Assistant context management with bounded UTF-8 files,
  atomic conflict-safe saves, Git safety warnings, publish exclusions, and a selected-context
  disclosure preview.
- Added portable and private post briefs, bounded Markdown/text references, and immutable existing-
  post snapshots to Assistant context, including transactional post rename and deletion handling.
- Added explicit URL-context snapshots with inspect-before-save metadata, selectable portable or
  private storage, SSRF-safe DNS and redirect validation, and bounded textual extraction without
  implicit refetching.
- Added seven inspectable, non-executable Markdown review skills plus validated project skills,
  explicit built-in overrides, repair guidance, and conflict-safe editing.
- Added document review over the current unsaved draft with selected skills and context, strict
  all-or-nothing structured findings, source anchoring, provider disclosure, and clearly labelled
  AI advice that never edits or saves the draft automatically.
- Added Visual and Markdown writing modes in Admin, with a remembered author preference,
  Heading 2–6 selection, familiar rich-text controls, and protected advanced blocks that
  retain source the visual editor cannot safely represent.

- Added a Field journal content profile for hikes and other place-based notes, with field
  facts, route and elevation drawings, structured place metadata, and hidden-by-default
  location handling.
- Added an Admin Field Review workflow that analyzes GPX locally, derives deterministic
  measurements, trims endpoints, and uploads source tracks only when Exact mode is chosen.

- Added a Video production content profile with privacy-enhanced YouTube embeds, duration
  and thumbnail metadata, creator-authored AI-assistance disclosure, and `VideoObject`
  structured data.
- Added an Admin release kit that extracts timestamp lines from Markdown, validates YouTube
  chapter rules, and composes a copy-ready description from the current draft.

## [0.10.1] - 2026-10-23

### Added

- Added a runnable research and contributor-credit demonstration to the repository example
  site, with synthetic registry identities, ordered Crossref/CRediT roles, an adjacent credit
  sidecar, visible references, a reusable license, feeds, and scholarly structured data.

### Changed

- Linked the README and authoring documentation directly to the example's configuration,
  Markdown, and sidecar files, with commands for inspecting them in Admin Studio or a build.

## [0.10.0] - 2026-10-23

### Added

- Added a stable contributor registry with public profile links, normalized manually entered
  ORCID identifiers, `sameAs` identities, and explicit provenance boundaries that avoid
  presenting editable identity data as authenticated.
- Added versioned per-post credit sidecars with ordered contributors and controlled
  Crossref/CRediT roles, including explicit-empty credits and legacy site-author inheritance.
- Added Admin Studio tools for managing contributor identities and per-post credits with
  conflict detection, reference-aware deletion, repair states, and source-preserving saves.
- Added `openblog contributors migrate --id <stable-id>` with a dry-run default and explicit
  `--write` mode for safely converting inherited authorship to reusable contributor credits.

### Changed

- Published bylines, article JSON-LD (including recipe posts), RSS, JSON Feed, and research
  metadata now use the resolved ordered contributor credits while preserving legacy author
  behavior for existing sites.
- Admin and CLI content writes, imports, migrations, and publishing now share a filesystem
  transaction lock so configuration and credit sidecars cannot be published half-written.
- Document listing, preview, save, delete, and validation now understand adjacent
  credit sidecars and surface malformed, orphaned, or ambiguous ownership errors.

## [0.9.0] - 2026-10-23

### Added

- Added the opt-in `research` content profile with DOI and license authoring fields, visible
  work metadata, ordinary-Markdown Abstract and References/Bibliography sections, and
  bounded reference extraction.
- Added deterministic evidence findings shared by `openblog check`, builds, and admin
  previews for research structure, DOI and license syntax, footnotes, reference links, and
  preferred DOI resolver links.
- Added `ScholarlyArticle` JSON-LD and conservative Highwire title, author, and publication
  date metadata, while omitting unsupported venue, publisher, review, and indexing claims.
- Added Evidence Studio with current-document findings, normalized work-metadata inspection,
  engine-backed Abstract/References insertion actions, dynamic profile fields, and `Alt+7`.

### Changed

- Build reports and `openblog check` now print evidence findings with stable codes, outcomes,
  source locations, and repair guidance separately from accessibility and SEO guidance.
- Profile-specific editor drafts now survive profile switches and save losslessly, including
  explicit field clears.

## [0.8.0] - 2026-10-23

### Added

- Added one structured accessibility audit shared by the core engine, `openblog check`,
  builds, and the admin preview. Findings use stable codes, canonical source locations,
  outcome labels, repair guidance, and informative standards references where applicable.
- Added bounded source checks for empty link names, missing site language, image
  alternatives, heading jumps, generic link text, tables, media, production embeds, and
  raw HTML without presenting context-dependent concerns as certain failures.
- Added a dedicated Accessibility Studio editor view with outcome counts, grouped findings,
  exact source context, next actions, and rendered-site manual-review guidance. It is
  available from normal editor navigation and `Alt+6`.

### Changed

- Build and check output now reports accessibility findings separately from publishing and
  SEO warnings. The accessibility reporter adds no pass or WCAG-conformance statement when
  its finding list is empty.
- Admin previews return only site-wide findings and findings for the document being edited,
  so another post's guidance cannot leak into the current workflow.

## [0.7.0] - 2026-10-23

### Added

- Added a content-profile catalog shared by the publishing engine and admin, beginning
  with the general-purpose `article` profile and the structured `recipe` profile.
- Added a Content profile selector to post settings, including visible fallback guidance
  for unknown profile ids and structured authoring-field metadata for future profiles.

### Changed

- Made `profile: recipe` the canonical way to select recipe behavior while retaining
  byte-for-byte generated-output compatibility with `recipe: true` and the existing
  `type`, `layout`, and `kind` recipe aliases.
- Unknown profile ids now round-trip without data loss, render safely as articles, and
  produce source-scoped build and preview warnings. A canonical `profile` takes precedence
  over contradictory legacy recipe markers and reports the conflict.

## [0.6.2] - 2026-10-23

### Changed

- Updated the project overview and documentation index to describe the focused writing
  workspace, publishing-faithful theme preview, social cards, readiness guidance, and
  source-preserving editing added in 0.6.0.
- Documented post, series, and site theme precedence with a practical pre-publish testing
  workflow, plus troubleshooting for base-path stylesheet MIME errors and the expected
  signed-out session probe.

## [0.6.1] - 2026-10-23

### Fixed

- Served the admin shell's root-relative theme and base styles from the built site when a
  configured deployment base path is active, preventing HTML fallback responses and strict
  MIME-type stylesheet failures during local administration.

## [0.6.0] - 2026-10-23

### Added

- Production-faithful draft previews that use the same site model, theme inheritance,
  renderer, metadata, and components as a published build while keeping front matter hidden.
- A dedicated social-card view backed by the exact resolved OpenGraph and X metadata emitted
  by the renderer, including canonical and site-image fallbacks.
- A transparent SEO and answer-readiness workspace with grouped search, answer-structure,
  trust, accessibility, and source-link guidance.
- Source-preserving Markdown controls for headings, emphasis, links, quotes, lists, and code,
  including keyboard shortcuts and undo-aware editing.

### Changed

- Replaced the permanent side-by-side editor with focused full-width Write, Site preview,
  Social, Optimize, and Settings views.
- Deferred expensive publishing-engine previews until Site preview or Social is visible and
  prevented stale asynchronous responses from replacing newer drafts.
- Hardened unpublished previews with authenticated random URLs, a bounded in-memory cache,
  opaque-origin sandboxing, restricted script origins, and disabled snippets and analytics.

## [0.5.0] - 2026-10-23

### Changed

- Reworked the admin into a publishing workspace with grouped tools, a persistent
  publish-status bar, labeled settings/Markdown/preview panes, and an explicit
  mobile pane switcher inspired by the README Studio workspace pattern.
- Added a `Ctrl/Cmd+K` workspace search for navigation, creation, account actions,
  and contextual editor commands, with keyboard result navigation and unsaved-change
  protection when moving between admin views.
- Added editor save-state feedback, live line/word/character counts, `Alt+1/2/3`
  pane focus shortcuts, and persistent wide/tablet/mobile preview widths.
- Added an admin overview with publishing-pipeline totals, quick-create actions,
  content inventory, recent posts, scheduled-post context, and build health.

## [0.4.1] - 2026-10-23

### Added

- A reader-facing guide to safely syndicating open.blog articles to Hashnode, DEV,
  Medium, Ghost, WordPress.com, and self-hosted WordPress.
- A deploy-gated GitHub Actions template and dependency-free DEV adapter that create
  drafts, verify canonical URLs, and update existing articles without duplicating them.

### Changed

- Expanded the starter Getting Started series with a cross-posting walkthrough and
  documented feed, credential, canonical URL, and platform-specific safety requirements.

## [0.4.0] - 2026-10-22

### Added

- Opt-in editor-style Rust examples with syntax colouring, line decorations, inline
  compiler/program output through the official Rust Playground, reset, copy, an optional
  external fallback, a privacy notice, and a no-JavaScript code-block fallback.

## [0.3.0] - 2026-10-22

### Added

- Live search and answer-readiness guidance in the author editor, with the
  same checks available during site builds.
- `llms.txt` and `llms-full.txt` discovery files for AI assistants and answer
  engines.
- Structured author identity, author profile links, richer Open Graph data,
  and Twitter card metadata.
- Privacy-preserving analytics for AI crawler and agent traffic, including
  aggregate provider totals and requested-page breakdowns.
- Independent controls for AI search discovery and AI model-training crawlers.
- An SEO and answer-engine optimization guide for blog authors and operators.

### Changed

- Expanded generated metadata and feeds so posts are easier for search
  engines, answer engines, and social platforms to understand and attribute.
- Updated the starter configuration and documentation for the new SEO,
  author-identity, crawler-policy, and analytics capabilities.

## [0.2.0] - 2026-10-22

### Added

- Interactive Markdown knowledge checks with immediate accessible feedback,
  retry support, and attempts stored only in the reader's browser.
- An admin knowledge-check builder for one to three questions, with editable
  manual entry and optional author-time generation through an owner-configured
  API endpoint and key.
- A sample knowledge check in the starter “Writing a post” article.
- Persistent light and dark modes for the redesigned admin interface.
- Domain documentation, an architectural decision record, and automated
  coverage for quiz rendering, interaction, validation, and provider failures.

### Changed

- Refined the admin navigation, editor, content tables, analytics, dialogs,
  responsive layout, keyboard focus, and visual hierarchy.
- CI now discovers every JavaScript test in `tests/web/`.

[Unreleased]: https://github.com/journey-to-code-org/open.blog/compare/v0.17.0...HEAD
[0.17.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.11.2...v0.12.0
[0.11.2]: https://github.com/journey-to-code-org/open.blog/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/journey-to-code-org/open.blog/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/journey-to-code-org/open.blog/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/journey-to-code-org/open.blog/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/journey-to-code-org/open.blog/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/journey-to-code-org/open.blog/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/journey-to-code-org/open.blog/releases/tag/v0.2.0
