---
name: studio-ux
description: open.blog Studio's UI/UX standard (the new Admin built on Zubra UI). Use when designing, building, writing copy for, or reviewing any Studio screen.
---

# Studio UX standard

Studio is where an owner runs an open.blog site. It serves two people at once, and every screen is judged by both:

- **Grammi** (the owner who writes): not technical, writes recipes and family stories, wants to put words up and get back to the kitchen. She must never meet a file path, a setting name, JSON, Git, a status code or a word like "deploy", "upload", "sync", "offline", "queue", "storage", "capture", "push", "subscription", "PWA", "service worker", "permission", "endpoint", "device" or "browser" (except to name the app she is in: "Safari", "Chrome"), nor "slug", "front matter", "metadata", "canonical", "noindex", "profile", "credits", "contributor", "SEO", "markdown", "shortcode", "syntax", "fence", "block", "piece", "snippet", "embed", "iframe", "HTML", "callout", "alt text", "caption", "OpenGraph", "score", "readiness", "audit", "finding", "WCAG", "track", "GPX", "coordinates", "acknowledge" or "validator" (a file format may be named once, in help, only where another app shows her that name). She says "phone", "iPad" or "computer", and hears "saved on this phone", "waiting for a signal", "sent", "address", "summary", "what kind of post", "who wrote it", "add", "put in", "take out", "describe the photo", "words under it", "suggestion", "needs fixing", "when it's shared", "route", "mark as checked". Nor the helper's machinery: "provider", "AI provider", "model", "API key", "key" (except in Getting started's one key step, explained in a sentence), "credential", "prompt" (except a writing prompt on Your writing voice), "token", "completion", "autocomplete", "skill", "context", "snapshot", "severity", "scope"; nor voice's and a look's: "sample", "portable", "pack", "session", "catalog", "provenance", "diff", "revision", "hex", "contrast ratio", "theme" (say "look"). She hears "your writing helper", "read it over", "use this", "what goes to <company>", "word for word", "it can be wrong", "a piece", "rough draft", "polished copy", "easy to read", "put it up". "AI" may appear once, in a screen's opening sentence, never as a label.
- **Mikey** (the owner who builds): a developer who set the site up. Wants speed, the keyboard, everything reachable, and the truth about what the system did.

The answer is _layers_: the first layer of every screen is Grammi's; Mikey's power sits one deliberate step deeper (a **More** menu, a details panel, the command palette), never in her way and never missing.

## Principles

1. **One job per screen.** Each screen answers one question ("What do I want to write?", "When does the house change?"). Its title says the job in her words. Anything that serves a different job moves to its own screen.
2. **The next step is obvious.** One primary action per screen, visible without scrolling at 400 px. Secondary actions are quieter buttons; rare or risky ones live in **More**.
3. **Her words, not the system's.** Name things by what she does: _Write_, _Publish_, _Recipes_, _Decorations_, _Cards_. Same action, same word, in the button, the toast and the help: a button that says **Publish** produces "Published". In her own words the product is _your blog_: "Studio" and "Admin" never appear in her sentences ("Your blog can post for you", not "Studio can post for you"); they may appear in details for Mikey.
4. **Nothing is lost.** Every edit autosaves as a draft; leaving with unsaved work asks first; every destructive action can be undone, or shows exactly what goes and asks once in plain words. Anything kept only on this phone says so where she sees it (Home), is never thrown away without asking, and offers a way to save its photos out first.
5. **Say what happened.** After every action, a short status in words ("Saved. Your readers will see it in about a minute."). Errors say what went wrong and how to fix it, never apologise and never show a code. Empty screens invite the first action. "Waiting for a signal" is a state with words and a badge, never an error: errors are for things she can change.
6. **Calm, warm, large.** Base text 18 px, controls at least 44 px tall, generous spacing, one accent colour. Motion only to show what changed, and none under reduced motion.
7. **One place per fact.** A field shows in one spot on her layer; a kind of post shows only its own fields, never twice.
8. **No syntax on her layer.** Anything in her words that isn't plain words shows as a card in place with Change, Move and Take it out; raw text is Mikey's, behind **Show the words as written**. Anything she adds goes where she was, and the screen says where first. A form that writes into the file writes it the way it was: unchanged writes nothing, and a form is offered only when it can write the block back exactly.
9. **Checks suggest; only the build blocks.** A check that only advises never disables Publish; a blocker names the fix and Publish says why it waits. No scores or totals: counts by kind. A checklist opens by itself only on the first Publish and only with something to show.
10. **Where someone was stays private by default.** Anything that could show where she lives or was starts hidden, shows what readers will see before it is saved, keeps the source on her phone, and leaves it only by her explicit, confirmed choice, cleaned first.
11. **Settings are part of the thing they describe.** A sheet of a post's settings has no Save of its own; it saves with the post and says how ("Saves by itself.", "Press Update to put these on your site.").
12. **Times she picks are complete.** A future day with no time gets a visible default time. A promise about when something happens is made only when the system keeps it.
13. **Works on her phone.** One column at 400 px with nothing scrolling sideways; the same screen widens into columns on a desktop. Every screen works in the installed app, which has no Back button or address bar: every screen has its own way home.
14. **Say what leaves, before it leaves.** Anything sent to another company is preceded, on the same screen and above the button that sends it, by a list of what goes, named by company, with a **Word for word** view. Nothing is queued to send later. Anything that keeps sending (suggestions as you type) is switched on by her, for one thing, and shows a line while it's on.
15. **A helper suggests; she decides.** Nothing a helper returns changes her work without her press; every press undoes; what it returns is text, never a link, a picture or an action.
16. **Secrets are write-only.** A secret field is empty on load and after every answer, shows only "set", "not set" or "set by the server", is emptied before anything is sent, is never kept on the phone, and is refused over plain http.
17. **Her raw words are sacred.** A screen that collects writing "as she really writes" turns off every correction it can, never lets a helper change it, and says why in one sentence.
18. **A clock the server owns.** Timed tasks show time as digits, a word and a shape; announce only marks; never give time back; ask before leaving while it runs.
19. **Colours she picks are made readable, and said.** Any colour an owner chooses is checked on the server against both schemes (writing 7:1 target, 4.5:1 floor; controls 3:1); a colour moved or replaced is shown as it will be, with a sentence saying what changed. The client may warn early but never decides.
20. **New things are undoable briefly.** Creating a file she can see in a list (a look, a post from a piece) offers Undo until the thing is in use.
21. **First use is a path, not a tour.** Getting started asks only what can't be known already, one step per screen, each skippable, each resumable after a reload, with its own way home.
22. **Ask again once, gently, and stop.** A reminder appears only where it helps, never while she types, at a fixed restrained rate, and always offers "Don't ask again".

## Accessibility (the floor, not a goal)

- WCAG 2.2 AA: text contrast 4.5:1 (7:1 for body text is the target), focus always visible, every control named, targets 44 px.
- Keyboard only: every action reachable, logical order, no traps; Escape closes what opened.
- Status messages in a live region; errors linked to their field and focus moves to the first one.
- Works at 400% zoom (320 CSS px) and with reduced motion.

## Zubra UI

Studio is built from Zubra UI components, themed through Studio's tokens. Reach for the component before writing markup:

| Need | Component |
| --- | --- |
| Page frame, navigation | `sidebar-layout` (desktop), `nav-bar`, `breadcrumb-trail` |
| Buttons | `action-button` |
| Text, numbers, dates | `text-field`, `money-input`, `date-field`, `date-range` |
| On/off, one of a few, one of many | `toggle-switch`, `segmented-control` / `choice-cards` / `radio-group`, `select-field` / `combo-box` |
| Tags | `tag-input` |
| Confirm, edit in place | `modal-dialog`, `side-sheet` |
| Status | `toast-region`, `alert-banner`, `status-badge` |
| Lists of things | `data-table`, `content-card`, `empty-state` |
| Uploads | `file-drop` |
| Find anything | `command-palette` |
| Progress | `step-indicator`, `progress-bar`, `loading-spinner`, `skeleton-block` |

When a component falls short, fix or extend it in zubra-ui and re-vendor it (see `studio-architecture`); a Studio-only fork is the last resort and is written down in the screen's notes.

## Words

- Sentence case everywhere. Buttons are verbs ("Publish", "Add a recipe"). Labels are nouns.
- One short sentence of help under a field, only when the label can't carry it.
- Dates and times as people say them: "Friday, November 27 at 8 AM".
- Numbers she cares about, never internals: "3 recipes waiting", not "3 drafts (status=draft)".
- Grammi is a persona for judging screens, never a default. No shipped string names her, her
  family, her site or her food; recipe examples appear only on recipe screens.
- Who helps her is `{helper}`, the product is `{product}`, her name is `{owner}`. Never write
  "the person who set up your site", "your blog" or a name as a literal.
- Every her-layer sentence is a word id with its default in the area's `parts/*-words.js`;
  a site may change it, so it must read right on its own and with any `{helper}` (no pronouns
  for the helper: "Tell {helper}.", not "Tell him").

## Review checklist

A screen passes when every line holds:

- [ ] Its job and its one primary action are clear at 400 px without scrolling.
- [ ] Grammi can finish its main task without reading help; nothing on the first layer is technical.
- [ ] Mikey can reach every advanced option in one step (More, details or the command palette).
- [ ] Every action ends in a status in words; every error names its field and the fix.
- [ ] Unsaved work is never lost; destructive actions undo or ask once.
- [ ] Works with no signal: what she made is kept, and the screen says when it will go.
- [ ] A suggestion never stops Publish; nothing she types or chooses reveals a location without a confirm.
- [ ] Keyboard only, screen reader names, 320 px reflow, reduced motion, contrast: all pass.
- [ ] Built from Zubra UI components themed by Studio tokens, with no one-off styles.
- [ ] Her layer says "your blog", never "Studio" or "Admin"; platform steps show only the ones for the device in her hand.
- [ ] Every field the old screen edited is on her layer, in details, or dropped with a written reason.
- [ ] Every call to another company names what goes before it is sent; every helper result is undoable and shown as text; no secret can be read back from the page.
- [ ] Anything kept on this phone is named on Home and asked about before sign-out.
- [ ] A first-use step hides itself when the answer is already known, and leaving it midway loses nothing.
