# Studio, slice 3: decorations and seasons

Brief by `studio-stakeholder`, 2026-11-13. Builds on slices 1 and 2 (`../brief.md`, `../slice-2/brief.md`, `../decisions.md`, `../slice-2/decisions.md`). The old Admin at `/admin` keeps running untouched.

## Outcome

Grammi can open **Decorations** on her phone and read one sentence in her own words: "Your house is decorated for Thanksgiving. On Tuesday, December 1 it changes to Christmas." She can put Christmas up today if she can't wait. She can change the day it goes up, or the day it comes down, for every year. She can choose the look for each part of the year, and she can see her front page in a look before anyone else does. When she saves, she is told in plain words when readers will see the change. She never meets a theme name, a month-day code or `openblog.json`. Mikey gets the real theme names, the calendar as stored and the publish result one step deeper, all reachable from the keyboard. Every save leaves `openblog.json` as he wrote it, except for the values that changed.

### What it takes (in this order; the shape step refines it, it does not grow it)

1. **Split `write.js` first** (slice 2, deferred). Make a DOM-free post session (save, announce, problems) and a body host (one box or the recipe boxes). There is no behaviour change, and slice 2's tests pass unchanged. Nothing below starts until this lands.
2. **Decorations screen** (`GET`/`PUT seasons`). It shows:
   - the sentence for today and the next change, from `wearing` and `next`;
   - the calendar as a list ("Christmas, December 1 to January 6"), with each look shown by its label and a small swatch;
   - an editor for each season's look, first day and last day (months by name, days from a list);
   - **Add a season**, and **Move or remove** as in slice 2;
   - one switch: "Change by itself with the calendar";
   - "Between seasons" (`theme`).

   A conflict (409) reuses `parts/conflict.js` wording.
3. **Put it up now.** One action puts a chosen look up from today. It says plainly what it takes down and when the calendar takes over again. It must not move next year's dates without telling her (A1).
4. **See how it looks.** This previews her front page in any look, at phone width on a phone. It saves nothing and publishes nothing (A2).
5. **Readers see it.** Save goes through `parts/publish.js`, as posts do. The status says whether readers see the change now, within the hour, or only after the person who set up the site sends it out. A scheduled change says when it will show for readers (A4).
6. **Mikey's layer.** Details shows theme names, the stored windows, "File kept as written: yes / no, because …" and the publish result. The palette gets "Decorations", "Put up …" for each look, and "See how it looks in …".

## For

**Grammi first.** Christmas is twelve days out on the calendar and sooner in her head. She judges every first-layer word.

**Mikey must not lose:**
- **His config as written.** Only the changed values' bytes differ. Every other member keeps its order, spacing and spelling (A3).
- **His themes.** Studio lists whatever themes the site has. It never creates, edits or deletes one.
- **The truth** about what was written, rebuilt and sent out.
- **The old Admin**, unchanged.

## Out of scope

- **Writing reminders (`seasonal`, snooze, open).** These are prompts that start drafts for trade sites, not decorations, and Grammi's House has none. The parent brief paired them with seasons by mistake. They move to the parity audit.
- **Turning one decoration off** (garland, wreath, mantel, pattern). These are tokens inside a theme. No route or config member exists for them, so adding one is a core change that would put Christmas at risk. It is the first follow-up. *(Mikey to confirm.)*
- **Making a theme**, including the Rudolph and Island of Misfit Toys look Grammi loves. That is theme work in `grammis-house`, done by Mikey alongside this slice. Once it exists, Studio offers it like any other look.
- Designing a theme from words, colours, fonts and site look (slice "Look and site").
- The landing page and countdown sign (next slice).
- Changes to the hourly build schedule.

## Finish line

All checks run against `openblog serve --admin` on a copy of Grammi's House, with the clock set to November 13 unless stated.

1. **Grammi's task** (`user-grammi`, 400 px, a screenshot of each step):
   - Open Decorations and read today's sentence aloud correctly.
   - Use See how it looks for Christmas, then go back.
   - Put Christmas up now. Read what came down and when the calendar takes over.
   - Move the Christmas last day from January 6 to January 10.
   - Turn off "Change by itself", then turn it back on.

   Passes with no help read and no blocker reported.
2. **Mikey's task** (`user-mikey`, desktop, keyboard only):
   - Ctrl/Cmd+K, "Put up Christmas", confirm.
   - Ctrl/Cmd+K, "Decorations". Add a season, reorder it and remove it without a mouse. Save with Ctrl/Cmd+Enter.
   - Details shows the theme names, the stored windows, the kept-as-written answer and the publish result.
3. **Config round trip:**
   - (a) Changing one window's end date changes exactly that value's bytes in `openblog.json`.
   - (b) Turning the switch off and on again, then saving, gives a byte-identical file.
   - (c) Putting a look up now, then undoing it, gives a byte-identical file.
   - (d) No other member moves, re-indents or re-escapes (for example, the `©` in `footer` stays as it is).
4. **Dates:**
   - With the clock at November 30 23:30 and at December 1 00:30 Eastern, the sentence and the built site agree on which look is up.
   - A season that crosses New Year works.
   - February 29 works in a year that has none.
   - Overlapping seasons say which one wins.
5. **Conflict and session:**
   - `openblog.json` changed on disk while the screen is open gives a plain-words message and a reload, and nothing she chose is lost.
   - An expired session keeps her changes and completes the save after she signs in.
6. **Preview:** a test checks that the preview's stylesheet is the chosen theme's, and that nothing is written, built or published.
7. **Accessibility:**
   - axe-core reports no violations on Decorations, the put-up-now dialog and the preview.
   - Every season row is named ("Season 2 of 12: Christmas"), and moves are announced.
   - Swatches never carry meaning alone.
   - 320 px reflow and reduced motion pass.
8. **Housekeeping:**
   - These all pass: `node --test tests/web/studio-*.test.mjs`, `tests/browser/studio-*.spec.mjs`, `cargo test -p openblog-cli` (with route tests for keep-as-written and put-up-now), and the old Admin's seasons tests.
   - `scripts/studio-files.mjs` is clean.
   - No Studio screen module is over about 400 lines.
9. **No regressions:** slice 1 checks 1–6 and slice 2 checks 1–9 still pass.
10. **UX checklist:** every new or changed screen passes `studio-ux`, signed by `studio-qa`.

## Open questions

**Architect**
- **A1.** The Thanksgiving window covers today, so setting `theme` alone changes nothing readers see. Should "put up now" be a dated, one-off override in `seasons` (core schema, validated, expires on its own), or an edit to the windows? An edit would also move next year's dates, and she would have to be told. A new member or route comes back here before building.
- **A2.** Can slice 2's preview render the front page with a theme passed in, under Studio's CSP, without a rebuild?
- **A3.** `set_member` replaces the whole `seasons` value with `to_value()`. Does that keep the existing indentation and key order, or does seasons need slice 2's keep mode?
- **A4.** Builds pick a season by the UTC day, so Christmas reaches readers at about 7 PM Eastern on November 30. Should Studio say "your time" and correct for it, or should the engine take a site time zone?

**Designers**
- **U1.** What is the one primary action at 400 px: **Save**, or **Put it up now**?
- **U2.** How should twelve monthly seasons read on a phone without a wall of dropdowns?
- **U3.** How should she pick between several Christmas looks once Rudolph's arrives?
- **U4.** What should Undo for put-up-now say, and how long should it last?
