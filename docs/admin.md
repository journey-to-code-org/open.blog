# The admin editor: log in, edit, create, schedule

`openblog serve --admin` adds a login-protected editor at `/admin` to the same server that
serves your blog. The editor reads and writes the same Markdown files you would edit by
hand, so your content stays plain files you own. No database is required by default.
Ephemeral hosts can opt into [durable Supabase workspace storage](deploy.md#durable-editorial-workspace-on-ephemeral-hosts).

```sh
openblog user add you              # create a login (prompts for a password)
openblog serve --admin             # http://localhost:8080/admin
```

Passwords need at least 12 characters. To avoid typing one where it is echoed, use
`echo "your passphrase" | openblog user add you --password-stdin` or set
`OPENBLOG_PASSWORD`. Other commands: `user passwd <name>`, `user remove <name>`,
`user list`. Changing a password or removing a user ends that person's open sessions
immediately.

## What you can do

| | |
| --- | --- |
| **Edit** | Every post, page, and series. Front matter fields become a form; unknown fields you added by hand are kept. |
| **Create** | New posts, pages, and series. The file is named from the date and slug. |
| **Preview** | A full-page site preview plus portable HTML and Markdown projections for posts, all generated from the current unsaved source. Portable warnings identify transformed or canonical-only behavior; front matter stays in Settings and is never printed into a preview. |
| **Social preview** | A card built from the generated OpenGraph title, description, canonical URL, type, image, and X card mode—not a separate browser-side approximation. |
| **SEO & answer readiness** | A transparent, local checklist for search metadata, direct-answer structure, supporting sources, authorship, links, and image accessibility. Its readiness score is guidance, not a ranking guarantee. |
| **Accessibility Studio** | Production-backed source findings grouped as detected, potential, or needs review, with exact locations and repair guidance. It also keeps rendered-site checks visible without claiming WCAG conformance. |
| **Evidence Studio** | Research-profile structure and metadata findings from the publishing engine, plus authored DOI (normalized to a resolver URL when valid), valid absolute license URL, and linked-reference inspection without truth or authority scoring. |
| **Images** | Insert by button, drag and drop, or paste. Saved under `static/images/uploads/<year>/`. |
| **Formatting** | Write in a word-processor-style Visual mode or switch to Markdown. Choose Paragraph or Heading 2–6, then apply bold, italic, links, quotes, numbered or bulleted lists, images, and code. `Ctrl+B`/`Command+B` and `Ctrl+I`/`Command+I` work in either mode. |
| **Personal workspace** | Start with a calm writing-focused workspace, choose Guided or Advanced, or customize optional tools, their order, spacing, and default writing mode. |
| **Content profiles** | Choose field-specific authoring and rendering behavior for a post. Legacy recipes are recognized without silently rewriting their front matter, and unknown profile ids remain intact with visible fallback guidance. |
| **Video release kit** | Validate authored YouTube chapters and copy a description assembled from the current summary, chapters, and AI-assistance disclosure. |
| **Field Review** | Analyze GPX locally, derive route facts, and choose hidden, trimmed, approximate, or exact location publication. |
| **Assistant** | Inspect the configured author-time provider, manage portable or private author/site context, and preview exactly which context is selected. Provider credentials remain on the server. |
| **Knowledge checks** | Insert one to three multiple-choice questions through a form, with optional author-time generation. Reader attempts stay in the reader's browser. |
| **Shared reflections** | Start a private shared reflection from a video, article, podcast, book, or other source, with a working title or guiding question. Nothing is published and no post is created. |
| **Delete** | Moves the file to `.openblog/trash/`; nothing is destroyed. |
| **Schedule** | See below. |
| **Analytics** | Views, unique visitors, a per-day chart, top pages and referrers from the built-in counter. See [features.md](features.md). |
| **Publish** | A button in the header commits changed content with git and pushes it, so a Pages workflow deploys. Drafts stay local. See [publishing.md](publishing.md). |

## Workspace layout

The admin is organized like a writing studio. New accounts start in **Simple**, which keeps
the main navigation focused on content and the essential **Write**, **Site preview**, and
**Settings** views. Every other document view sits under **More tools** in the editor bar,
and the header's **Advanced tools** dialog groups every optional tool by goal: getting
writing help (the optional AI Assistant, including knowledge checks and runnable-code
proposals), checking quality and research, sharing and distribution, and collaboration and
readership. **Guided** adds Accessibility, Evidence Studio, and Assistant to the editor bar,
**Advanced** shows everything, and **Custom** lets you show or hide each optional tool. In
every preset you can reorder optional tools with the up and down buttons, choose comfortable
or compact spacing, pick a default Visual or Markdown writing mode, and **Restore defaults**.
Open **Personalize** from the header, from Advanced tools, or by searching for
"Personalize workspace" with `Ctrl+K`.

Workspace preferences are private presentation choices for one admin login, not site
configuration: they never change a post, `openblog.json`, the generated site, feeds, or
exports. They are stored under `.openblog/private/admin-preferences/` (ignored by Git in new
projects), limited to a small schema-versioned file per login, and protected by the same
login and CSRF checks as content editing. Each save names the revision it replaces, so a
change made in another tab or session is reloaded instead of silently overwritten. Write,
preview, settings, save state, publish status, conflicts, privacy notices, approvals, and
blockers cannot be hidden or reordered. If private preference storage is unavailable,
authoring falls back to the Simple workspace with a notice and remains usable. Only saving
from **Personalize** replaces stored preferences that can no longer be read; switching
between Visual and Markdown then lasts for the session without touching the stored file.
The server allows that replacement only when the stored file is malformed or too large,
never when it could not be read at all.

Admins who used the workspace before personalization existed keep the full layout: on their
first sign-in after upgrading, a browser that remembered a writing mode from an earlier
release starts in **Advanced** with that writing mode, and the choice is then stored privately
for the login. The browser then forgets the old writing mode, so the migration happens once
and another login in the same browser starts in **Simple**. A remembered preview width does
not count, because this release still remembers it.

Inside the editor, Social, Release kit, Field Review, Optimize, Accessibility, Evidence, and
Assistant are separate full-width views, so writing is not squeezed beside a permanent preview.
Switching views never loses edits, and opening Site preview refreshes it from the current draft.

Portable preview findings are grouped by capability, representation, and destination, with
**Fully portable**, **Gracefully transformed**, or **Canonical-only interaction** labels
rather than a score. Findings explain what the copy preserves and which interactions stay
on the canonical article. **Edit source at line …** opens Markdown, focuses and selects the
relevant source, and announces the navigation without saving or changing unsaved content.
Findings without an exact source location remain visible without a navigation button.
Warning acknowledgements remain revision- and destination-scoped. A failed preview shows
the validation error and disables copy/download until a current preview succeeds.

Destination views also show shared content-policy findings: retained image references
have not been inspected or uploaded, Ghost's HTML-to-Lexical conversion is lossy, and
WordPress's external canonical needs separate configuration. Unmapped destination tags
are disclosed, not silently discarded. These are draft-review requirements, not claims
that a browser preview certifies provider rendering or media type/size acceptance.

Press `Ctrl+K` on Windows or Linux, or `Command+K` on macOS, to search workspace
commands. The palette opens content lists, creates documents, switches editor panes,
saves the current document, changes the color scheme, and reaches account actions. Use
the arrow keys and Enter to choose a result, or Escape to close it.

The editor footer shows whether the document is saved plus its line, word, and character
counts. Press `Alt+1` through `Alt+9` to focus Write, Site preview, Social, Release kit,
Field Review, Optimize, Settings, Accessibility, or Evidence, whether or not that view is
shown in the editor bar. The preview
toolbar can constrain the canvas to wide, tablet, or mobile width; this preference is stored
in the browser and does not change the published theme.

For posts, press `Alt+0` to open **Assistant**. Its provider card reports the provider type,
model, configured state, and supported capabilities without returning the credential or
configured endpoint path, query, or user information to the browser. The provider card and Review
disclosure show only the safe destination origin so authors know which service receives selected
material. Review, Interactions, and Context are labelled work areas. Interactions creates editable
knowledge-check, runnable-example, and coding-challenge proposals, while Context manages author,
site, and post notes plus selected sources. Provider failures do not disable ordinary non-AI
authoring.

### Review an unsaved document

Open **Assistant → Review** to review the current unsaved title, metadata, and Markdown without
saving first. Select one or more review skills and any context the provider should receive, then
inspect the disclosure: it lists the complete-document scope, approximate source size, every skill
and context item, provider model and safe destination origin, and confirms external research is off.
Nothing is sent until **Run document review** is pressed.

Validated findings are grouped under their originating skill and visibly labelled **AI-generated
advice**. Each finding shows its severity, category, exact source evidence, explanation, optional
suggested replacement, and whether it is unverified advice or based on supplied context. Choose
**Apply suggestion** to replace its exact reviewed passage in the unsaved draft. The editor refuses
ambiguous, stale, repeated, or overlapping replacements and offers one-step undo. Applying or undoing
never saves or publishes. Provider errors, invalid results, and edits made while a review is running
leave the draft unchanged.

### Use AI autocomplete while writing

In **Write**, turn on **AI autocomplete** for the current editor session. It is off by default and is
not remembered. The disclosure explains that after an 850 ms typing pause the current unsaved title,
metadata, Markdown, nearby caret text, and explicitly selected Assistant context are sent to the
configured provider. Only one request runs at a time. Navigating away aborts pending work.

A returned continuation remains a visible proposal. Press `Tab` or choose **Accept** to insert it,
or press `Escape` or choose **Dismiss**. Moving the caret or changing the title, metadata, context,
writing mode, or draft makes the proposal stale and prevents insertion. Accepted text follows the
normal unsaved-change path in Visual and Markdown modes; it is never saved or published automatically.

### Draft a knowledge check

Open **Assistant → Interactions** and choose **Create knowledge-check proposal**. The same proposal
dialog available from the Write toolbar uses selected text when present, otherwise the current post.
Generated questions are reviewed in the dialog and enter the unsaved Markdown only after explicit
insertion. Non-AI quiz authoring remains available.

### Draft a runnable example or coding challenge

Open **Assistant → Interactions** and choose **Create runnable-code proposal**. Choose a complete
example when readers should run, change, and observe working code, or a coding challenge when they
should complete a small bounded task. With a provider configured, **Generate draft** uses selected
text, then the current section, then the post as context. Without a provider, fill in the same form
manually.

Choose Rust, Web (HTML/CSS/JavaScript), or a language explicitly enabled by the site's external
runner. The title, instructions, source, expected result, hint, and explanation remain editable in
the dialog. A challenge must include a visible TODO comment and expected result. Nothing enters the
unsaved post until **Insert into draft** is chosen. The inserted content uses portable Markdown prose
and one native runnable fence, so it works in both Visual and Markdown authoring modes. Web results
must preserve `---html`, `---css`, and `---js` markers. The provider must return the requested
language; multi-file projects, hidden tests, automatic grading, and shell commands are not offered.

### What the Assistant knows about open.blog

Every review, interaction-generation, and autocomplete request includes a versioned engine guide generated
from open.blog's deterministic core. It describes native quiz and Rust/web runnable fences, configured
runner allowlists, code options,
supported embeds, content-profile IDs, scheduling, source ownership, and the limits of evidence checks.
These are renderer facts, not instructions found in the draft. Draft and context text remain untrusted
data. The guide prevents an AI from treating supported engine syntax as an error, but it does not let
the provider save, publish, certify claims, perform external research, or add unsupported syntax.

### Manage Assistant context

Open **Assistant → Context** to create or edit Markdown notes about the author or the site's
audience and goals. **Portable** notes live at `assistant/context/author.md` and
`assistant/context/site.md`; they can be reviewed and deliberately included in normal Git
publishing paths. **Private** mirrors live below `.openblog/private/context/`, are visually
distinguished, and are always excluded from open.blog publish staging.

Each file is limited to 64 KiB of UTF-8 text. Invalid or oversized files remain visible with
repair guidance instead of being silently selected. Saves and removals use revision checks, so
an edit made elsewhere is not overwritten. The Context view warns if Git does not ignore the
private directory or if a private file is already tracked. `openblog init` adds
`/.openblog/private/` to `.gitignore` for Git projects while preserving existing rules.

Select context explicitly with the checkbox on each valid file. The **Context disclosure**
preview lists every selected filename, whether it is Portable or Private, its character count,
and the total size. Selection alone does not contact a provider; a later explicit Assistant
request will use this disclosure before anything is sent.

Saved posts also offer **Post brief** context in portable and private forms. The brief has separate
fields for the post's goal, audience, learning outcomes, sources, and free-form constraints; it is
stored at `assistant/context/posts/<post-filename>.md` or the matching private path. Renaming or
moving a post to trash moves its brief in the same filesystem transaction, and restores the whole
bundle if any move fails.

The **Text references** area accepts only `.md` and `.txt` UTF-8 sources up to 64 KiB. It shows the
stored text before selection and rejects unsupported filenames, binary text, duplicates, and
oversized input without a partial file. **Existing post snapshots** shows only Markdown posts from
the configured content directory. Selecting one uses the exact bounded source currently on disk;
it does not copy images, sidecars, or other repository files. Invalid or oversized snapshots remain
unselectable with guidance.

The disclosure preview includes every selected post brief, reference, and existing-post snapshot,
with its visibility and character count. These selections remain local until a later explicit
Assistant request.
To capture a web reference, use **Add URL snapshot** and confirm the retrieval. Admin accepts
only public HTTP(S) destinations, rechecks every bounded redirect, rejects credentials and
local or private network addresses, and applies one total deadline plus strict response and
extracted-text limits. Supported responses are UTF-8 HTML, Markdown, and plain text. Compressed
responses are rejected, so an encoded body cannot expand past the extraction limit.

Retrieval does not save anything. Inspect the source and final canonical URLs, retrieval time,
content type, and extracted text, then choose portable or private storage and explicitly save.
Saved references live under `assistant/context/references/` or the matching
`.openblog/private/context/references/` directory. They are labelled untrusted reference data;
selecting one uses the saved Markdown snapshot and never silently contacts the URL again.

### Write visually or in Markdown

The Write view defaults to **Visual**, which behaves like a word processor while keeping
Markdown as the saved file format. Switch to **Markdown** whenever you want to inspect or
edit the underlying text. The browser remembers the last mode selected on that device.

Visual mode directly edits paragraphs, Heading 2–6, emphasis, links, quotes, simple lists,
images, and code. Advanced constructs such as callouts, knowledge checks, embeds, task or
nested lists, tables, footnotes, and raw HTML appear as protected blocks. Move or remove a
protected block visually, or choose **Edit in Markdown** to change its exact source. This
boundary prevents an ordinary visual edit from flattening syntax the visual editor cannot
represent safely.

### Test a theme before publishing

The Site preview reports the theme it resolved and renders through the same site model,
theme compiler, document renderer, and components as a public build. Theme precedence is
the same in both places:

1. A post or page theme selected in **Settings** is an explicit override.
2. A post without an override inherits the theme selected by its series.
3. Content without either override uses the site theme from `openblog.json`.

To test a series design, set the theme on the series document, leave the post's theme
unset, and open **Site preview** on a post in that series. To compare a one-off design,
select a theme on the post instead. The preview includes unsaved changes to the document
you are editing but does not expose unrelated drafts or scheduled posts. Front matter
remains in **Settings** and is never printed into the preview.

For posts, use the **Preview representation or destination** selector to compare the themed site
output, portable HTML, Markdown, and plain text, or a DEV, Hashnode, Ghost, WordPress, or Medium policy view.
These projections run through the same conversion used by feeds, export, and syndication;
warnings include the source, transformation, and recommended action.
**Copy portable output** and **Download portable output** use the exact selected artifact
without saving or changing the post. Downloaded previews may contain unsaved draft content;
review them before sharing. Actions are disabled for the native site view, unavailable policies,
failed previews, and while edits await a fresh preview. Text and Markdown are displayed as literal
source, never executed in the Admin shell. The authenticated API also returns capability
portability levels alongside all three representations.
DEV and Hashnode views also show the selected and omitted tags, slug transformations,
and blocking tag errors from the same core plan used by the CLI. These are payload metadata
checks; copying a portable body does not validate or include its destination tags.

Warnings can be acknowledged for a specific source revision, capability, representation, and
destination. Acknowledgements are stored in a tracked sibling `*.portability.json` sidecar and
remain visible beside the warning; they never bypass unsafe-markup errors, private-state rules, or
canonical-identity requirements. Editing the post makes older acknowledgements visibly stale.
The portable views are computed from the authenticated, unsaved preview request and are not saved
to the document or exposed at a public URL. Acknowledging is allowed only when the preview matches
the saved source revision.

### Review accessibility while writing

Open **Accessibility** to run the publishing engine's source audit against the current
unsaved document. The view includes site-wide configuration findings, such as a missing
default language, but excludes findings that belong only to other documents. It reports
what was located, the canonical file/line or field, and what to do next.

The outcome labels have deliberately different meanings: **Detected** is a source condition
the engine can establish, **Potential** is a useful heuristic that still needs context, and
**Needs review** is a decision only an author can make. The pane never turns an empty result
into a score or conformance claim. See [Accessibility checks and manual review](accessibility.md)
for every check, the CLI workflow, and the rendered-page checklist.

### Review research evidence while writing

Choose the Research content profile, then open **Evidence**. The preview API runs the same
core audit used by `openblog check` and builds, scoped to the current unsaved document. It
shows the authored DOI (normalized to a resolver URL when valid), valid absolute license
URL, number of linked references, and findings for missing
visible Abstract or References/Bibliography sections, malformed work metadata, unresolved
footnotes, references without resolvable links, and non-preferred DOI links.

The **Abstract** and **References** toolbar actions ask the publishing engine whether the
section already exists before changing Markdown. This keeps formatted headings, code
examples, containers, and HTML blocks consistent with the actual build parser. Profile
metadata drafts survive profile switches and are included when the document is saved.

Evidence Studio does not score truth, source authority, peer review, methodology, or
whether a citation supports a claim. Outside the Research profile it explicitly reports
that the checks are inactive. See [Research posts and Evidence Studio](research-profile.md).

The **Overview** is the admin home. It summarizes the publishing pipeline, links to quick
creation flows, shows the size of the content library and recent posts, and surfaces the
next scheduled post or last build error without requiring a trip through each content list.

Markdown remains the source of truth. Visual mode converts only the ordinary blocks it can
represent and carries advanced blocks through unchanged. Front matter remains in Settings,
outside both body editors. Saving, conflict detection, preview sandboxing, and publishing
use the same file-based workflow and security checks.

In a post's **Settings** view, **Content profile** defaults to Article. Recipe posts select
Recipe and continue through the existing recipe renderer and structured-data path. Files
using `recipe: true` or another legacy recipe alias appear as Recipe but keep that original
field unless you explicitly change the selector. An unknown `profile` value appears as its
own option with a warning; saving without changing it preserves the value.
Research posts select Research and expose DOI and license fields. Values entered there are
preserved when switching profiles and saved without discarding explicit clears.
Video posts select Video production and expose YouTube URL, duration, thumbnail, and
AI-assistance disclosure fields. The Release kit view remains inactive for other profiles.
Field-journal posts expose activity, area, privacy, distance, elevation, duration, and
conditions. Field Review analyzes GPX in the browser and privately stages the source track
only in Exact mode; it becomes public as part of a successful post save. Other modes save
privacy-filtered derived data. Downgrading a saved Exact route moves its managed GPX to
`.openblog/trash/tracks/` so the next build retracts it without destroying the source.

Every save is checked against the whole site before anything is written (duplicate slugs,
unknown themes, bad dates), then the site is rebuilt. A save that would break the build is
refused with the reason. If the file changed on disk since you opened it (for example you
edited it in your text editor), the save is refused instead of overwriting your changes.

Posts with an adjacent `<stem>.credits.json` file keep that contributor data throughout the
Admin lifecycle. The server validates the Markdown and credits together, preserves the
sidecar when an older editor does not send credit fields, checks it independently for
concurrent edits, and moves it to `.openblog/trash/` with the post. Preview requests can
include unsaved credits and are rendered through the same contributor rules as a build.
An explicit empty credits list remains distinct from having no sidecar and inheriting the
site author. A malformed sidecar does not hide the Markdown document: Admin reports the
credit error and keeps a separate revision token so a credits-aware client can safely repair
or remove it. Editing the JSON files by hand remains supported.

### Credit contributors and roles

For posts, open **Settings → Contributors** to choose between inheriting the site author
and an explicit ordered credit list. Add people from the contributor registry, arrange the
public byline order with the arrow buttons, and choose publishing roles or CRediT taxonomy
roles for each person. Every selected person needs at least one role. An explicit list with
no people intentionally suppresses inherited authorship; the editor labels this state so it
cannot be confused with inheritance.

The people available in the picker come from the site contributor registry. Open
**Site → Contributors** to add or update a public name, stable ID, profile URL, same-as
profiles, and optional ORCID iD. Existing IDs cannot be renamed in Admin because post
sidecars refer to them; a contributor cannot be removed while any sidecar still uses that
ID. If the registry is empty, **Prefill legacy author** copies the existing site author into
an unsaved draft for review—it does not change configuration or post credits until you save.

Registry saves use their own `openblog.json` revision token. If configuration changed on
disk after the workspace opened, Admin refuses the stale save and asks you to reload. It
updates only the `contributors` member of the parsed JSON object, preserving unrelated and
future configuration members, validates the complete candidate with the publishing engine,
then rebuilds the preview. ORCID iDs entered here are manual and unauthenticated: format and
checksum validation does not verify the person or ownership of the record.

If a sidecar is malformed, Settings shows the error without hiding
the Markdown and requires an explicit repair choice: inherit to remove the broken sidecar,
or set new explicit credits to replace it. Credit-only changes participate in unsaved-change
warnings, production preview, conflict detection, and the normal save validation.

### Start a shared reflection

A shared reflection is a private draft that several writers answer from the same source. Open
**Content → Shared reflections** and choose **Start a shared reflection** (or search the
workspace for it). The form asks, in plain words:

1. **What prompted it.** Choose the type of source, then enter its title. Paste the original
   link if there is one; a book, a talk you attended, or a conversation can be left without a
   link. You can add who made it, the publisher, a year or date, and an ISBN for a book. Use
   **Add another source** to list up to 20 sources in the order you want; at 20 the button is
   turned off and the form says why. With a YouTube or CodePen link, **Suggest details from
   link** can fill in a title, who made it, and the publisher. It only fills fields you left
   empty, says what it filled so you can check it, and never asks for a transcript. If the
   provider is slow, refuses, or has nothing, or the link is from another site, the form tells
   you and nothing changes; type the details yourself.
2. **Your reflection.** Give a working title, a guiding question that each writer answers in
   their own words, or both.
3. **You will appear as.** Choose your entry from the contributor registry. If you are not in
   it yet, add yourself under **Site → Contributors** first. Admin Studio does not yet check that
   the entry you pick is yours, so choose your own.

You don’t need Markdown anywhere in this form. Links must be complete web addresses starting with
`https://` or `http://` and cannot contain a username or password; a pasted link with non-English
characters is stored in its standard encoded form. If something needs fixing, the message names
the field and moves focus to it; a problem that is not about one field, such as a save that
fails on the server, moves focus to the message itself. What you entered is kept so you can try
again.

Creating a shared reflection publishes nothing and changes no post, credit, or setting. It is
saved as a private file under `.openblog/private/collaboration/publications/`, which Git
ignores, so back up that folder with your other private files. Only the people taking part see
it under **Shared reflections**; signing in to Admin Studio or being in the contributor registry
is not enough. You are its site owner. Removing your account with `openblog user remove` removes
you from every shared reflection, and so does adding a new account under a name that was used
before. A contributor who takes part in one cannot be removed from the registry; the Contributors
message names each entry that is in use. Writing contributions and publishing the result arrive in later releases. The design is recorded in
[ADR 0007](adr/0007-private-shared-publication-records.md) and the
[collaboration contract](specs/shared-perspectives-collaboration.md#shared-publication-record).

### Inviting other writers

Site owners and coordinators see an **Invitations** section on each shared reflection. Enter the
sign-in name of an existing Admin account, choose the contributor profile they will appear as, pick
their roles, and choose how long the link lasts (1 to 30 days, 7 by default). Admin Studio shows a
private link once. Copy it and pass it on yourself: open.blog never sends email or contacts
anyone. The link works once, only for the account you named, and only after that person signs in
and chooses **Accept and join** or **Decline**. A lost link cannot be shown again; use **Issue a
new link**, which also stops the old one working. **Revoke** withdraws a link at once.
Invitations are kept inside the shared reflection's private file as hashes, never the link
itself, and only a site owner can invite another site owner. Add the person's Admin account first
with `openblog user add`. The design is recorded in
[ADR 0013](adr/0013-publication-scoped-invitations.md).

### Managing members

The same **Members and invitations** section lists everyone who can sign in to the reflection,
with their sign-in account, the contributor profile they are credited as, and their roles written
out. These are separate: *sign-in access* decides who can open the reflection and what they can
do, while *credit* names who is shown for what they wrote. **Change roles** previews what is added
and removed before it applies. **Remove access** asks first, and ends only sign-in access: the
person's name stays credited for what they wrote and approved, and you can invite them again
later. The last site owner cannot be removed or demoted, and a coordinator cannot change a site
owner. If someone else changed the members while you were looking, the change is refused, the list
reloads, and you can try again. A member whose account or profile has been deleted is flagged with
a warning. If your browser cannot copy to the clipboard, select the link and copy it yourself.
Everything is reachable by keyboard: **Escape** cancels a confirmation, and results are announced
to screen readers. The design is recorded in
[ADR 0015](adr/0015-member-management-separates-access-from-credit.md).

### Putting a shared reflection in a series

Each shared reflection has a **Series** section. Everyone taking part sees which series it will
join, its position, and the reading order it would have among the parts already published.
Site owners and coordinators choose an existing series or type a new title, set a position (or
leave it empty to follow the numbered parts, by date), use **Preview order**, and **Save
placement**. Choose **Not in a series** and save to remove it. The series and position are shown in
the combined preview and are part of what every author approves, so saving a change means each
author approves again. If someone else changed the placement first, your choice stays in the form
next to the current one and you can save again. Site owners can also **Add a new series** with a
name and a one-line recurring premise; it is an ordinary series file, not shown to readers until a
part is published, and other details stay in the Series editor. Once the reflection is published,
its series is changed in the post like any other. The design is recorded in
[ADR 0037](adr/0037-arranging-a-shared-reflections-series-in-admin.md).

## Scheduling

A post's status is one of:

- **Draft**: never public (`draft: true`).
- **Published**: the date is now or in the past.
- **Scheduled**: the date is in the future.

Pick *Scheduled* and a date and time (your local time; it is stored as UTC) and save. The
post is held back from the pages, feeds, sitemap, search index, tags, series, and the
latest-posts JSON. The server checks every few seconds and rebuilds at the moment the post
comes due, so it appears by itself.

This works in plain files too: any post with a future `date:` stays hidden until a build
runs after that time. So a scheduled post also goes live on a static host if something runs
`openblog build` periodically, such as a cron job or a scheduled GitHub Action.

```yaml
date: 2026-12-25T09:00:00Z      # offsets work too: 2026-12-25T09:00:00-05:00
```

`openblog build --drafts` and `serve --drafts` include drafts and scheduled posts, for
previewing.

## Running it for real

By default the server listens on `127.0.0.1` only. To use the admin from anywhere, run it on
a machine you control and put it behind HTTPS (a reverse proxy such as Caddy or nginx), then:

```jsonc
// openblog.json
"admin": {
  "secureCookies": true,      // mark the session cookie Secure (required over HTTPS)
  "sessionHours": 12,
  "maxUploadMb": 10,
  "usersFile": ".openblog/users.json",
  "trustedProxies": ["127.0.0.1"]   // the proxy's address, so login limits see real clients
}
```

Entries in `trustedProxies` are exact IP addresses, not ranges, or the single entry `"*"`
to trust every connection's `X-Forwarded-For` (only right when nothing can reach the
server except through the proxy, as in a container on a PaaS; the
`OPENBLOG_BEHIND_PROXY=1` environment variable sets this and `secureCookies` together). A connection from one of
them takes the client address from the last `X-Forwarded-For` entry, the one that proxy
appended; if the header is missing, the proxy's own address is used and every visitor
shares one login limit. Connections from a trusted proxy are also exempt from the
per-address connection cap, so the whole readership is not squeezed through one slot.

```sh
openblog serve --admin --port 8080
```

Keep the default `--host 127.0.0.1` when the proxy runs on the same machine, so only the
proxy can reach the plain-HTTP port; use `--host 0.0.0.0` only when the proxy is elsewhere,
and firewall the port. The proxy must pass the original `Host` header through and add
`X-Forwarded-For` (Caddy does both by default; nginx needs `proxy_set_header Host $host;`
and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Without the `Host`
header every login and save is refused as cross-origin; without `X-Forwarded-For` all
visitors share one login limit. [Deploying](deploy.md) has a complete nginx example.

Without HTTPS, passwords and sessions cross the network in clear text; the server prints a
warning if you expose it that way with `secureCookies` off. Keep `.openblog/` (users file and
trash) out of version control; `openblog init` adds it to `.gitignore`.

The public site and the admin share one process, so the blog is served by this server too.
If you would rather host the static output elsewhere, run the admin where the content lives
and publish `dist/` onward (for example with a git push or rsync after each build).

### Troubleshooting local styles and sessions

If the browser refuses `/assets/base.css` or `/themes/.../tokens.css` because the response
has the `text/html` MIME type, first restart `openblog serve --admin` after upgrading. Sites
whose configured URL includes a base path, such as `https://example.github.io/project/`,
still open the private editor at `/admin`; in admin mode the server maps its root-relative
asset requests to the same built styles used by the public site. A stale pre-0.6.1 server
does not provide that mapping. If restarting does not help, run `openblog build` and confirm
the corresponding files exist under `dist/assets/` and `dist/themes/`.

An initial `GET /admin/api/session` response of `401 Unauthorized` is expected when no valid
admin cookie exists: it is how the editor decides to show the sign-in form. A `401` after
you have signed in means the session expired, the user was removed, or the password changed;
sign in again. It is unrelated to stylesheet MIME errors.

## Optional question generation

Knowledge checks work without an AI service. To add **Generate draft** and document review,
site owners can configure the provider from the Assistant panel. The endpoint and model are saved
in `openblog.json`:

```jsonc
// openblog.json
"knowledgeChecks": {
  "provider": "anthropic",
  "generationEndpoint": "",
  "model": "claude-sonnet-5-5"
}
```

Choose a native provider to use its official API directly. open.blog fixes the destination for
native providers; only **Custom HTTPS** accepts an endpoint entered by the author.

| Provider | Suggested model | Environment credential |
|---|---|---|
| Anthropic Claude | `claude-sonnet-5-5` | `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-6-luna` | `OPENAI_API_KEY` |
| Google Gemini | `gemini-3.8-flash` | `GEMINI_API_KEY` |
| xAI Grok | `grok-4.7` | `XAI_API_KEY` |
| DeepSeek | `deepseek-flash` | `DEEPSEEK_API_KEY` |
| Mistral AI | `mistral-small-latest` | `MISTRAL_API_KEY` |
| OpenRouter | enter a supported routed model ID | `OPENROUTER_API_KEY` |

The model field remains editable because provider model catalogs change. OpenRouter restricts
routing to upstream endpoints that accept the requested structured-output parameters, but the
upstream service still determines exact schema support.

```sh
export ANTHROPIC_API_KEY="your Anthropic key"
openblog serve --admin
```

An OpenAI integration uses an OpenAI API key and API billing; a ChatGPT or Codex product
subscription is not itself an API credential. GitHub Copilot is not listed because its supported
programmatic integration is an authenticated agent/CLI SDK rather than this API-key provider
contract, and the separate GitHub Models inference API has been retired.

For an existing compatible service, choose **Custom HTTPS** instead:

```jsonc
"knowledgeChecks": {
  "provider": "custom-https",
  "generationEndpoint": "https://lessons.example.com/generate",
  "model": "your-model-name"
}
```

```sh
export OPENBLOG_LESSONS_API_KEY="your secret"
openblog serve --admin
```

The credential can instead be added, replaced, or cleared in the Assistant provider panel. It is
write-only and stored under `.openblog/private/assistant/`, never in `openblog.json`. An environment
credential takes precedence when present. Admin reports only whether a credential exists and where
it comes from; it never returns the saved value. Saved private credentials are bound to the provider
and destination active when they are entered. If you switch providers or change a Custom HTTPS
endpoint, enter the appropriate key for the new destination rather than reusing the hidden value.
Credentials saved by an older open.blog version have no destination binding and are not reused;
enter them once in the current panel to bind them safely.

Custom HTTPS endpoints receive JSON with `context`, `count`, `model`, task instructions, and the
expected response shape. They return one to three questions:

```json
{
  "questions": [{
    "prompt": "What stays in the reader's browser?",
    "choices": ["Quiz attempts", "Published posts"],
    "correctIndex": 0,
    "explanation": "Attempts are private local progress."
  }]
}
```

The key and endpoint are used only by the admin server. The browser calls the authenticated
same-origin admin API, public builds contain only the reviewed Markdown, and readers never
contact the generation service.

Open a post's **Assistant** view to confirm whether this provider is ready. If configuration
is incomplete, the status message identifies the server-side setting or environment variable
to add. It never displays the endpoint or credential value.

## Security design

- Passwords are hashed with Argon2id. Session and CSRF tokens are 256 random bits from the
  operating system.
- The session cookie is `HttpOnly` and `SameSite=Strict`, scoped to `/admin`. Every API route
  except login checks it **before any request body is read**, so anonymous clients cannot make
  the server buffer uploads.
- Every state-changing request needs the CSRF token header and, when the browser sends one, a
  same-origin `Origin`. JSON endpoints require `Content-Type: application/json`.
- Failed logins are limited two ways. A client address is locked for five minutes after five
  failures (the attempt is counted before the password is checked, so parallel guesses do not
  slip past). A username is never locked, only slowed down with a growing delay, so someone who
  knows your username cannot shut you out. Unknown usernames take as long as wrong passwords.
- File paths from the browser are matched against a strict allow-list (`posts/`, `series/`,
  `pages/`, `.md` only) and resolved inside the content directory, including through symlinks.
- Uploads are accepted by their bytes, not their names: PNG, JPEG, GIF, WebP, and AVIF only.
  SVG is refused because it can carry scripts.
- The admin page is served with a strict Content-Security-Policy (no inline scripts). Full-page
  previews are kept in a small in-memory cache behind an authenticated random URL and rendered in
  an opaque-origin sandbox. Built-in components and the selected theme's local or configured-CDN
  assets can run, while owner-supplied analytics, comments, and other raw HTML snippets are removed
  from unpublished previews. The preview cannot submit forms or access the admin document.
- Front matter values are always quoted so a value containing a newline cannot add fields.
- Limits: 64 concurrent connections (16 per address, not applied to trusted proxies),
  header and body size caps, deadlines for slow senders and slow readers, and no chunked
  bodies.

What it does not do: multi-factor login or per-user roles (every user can edit everything).
