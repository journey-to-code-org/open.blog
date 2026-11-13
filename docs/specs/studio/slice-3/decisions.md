# Studio slice 3: decisions

Made by the stakeholder delegate on 2026-11-13.

| Question | Decision |
| --- | --- |
| A1: put it up now | A dated, one-off `seasons.upNow: { theme, until: "YYYY-MM-DD" }` in core. It wins over the calendar through `until` (inclusive, UTC day like the calendar), then expires by itself. It never moves the yearly windows. Studio sets `until` to the last day of that look's coming window (Christmas: January 6), or 14 days out when the look has no window. The confirmation says what comes down and the day the calendar takes over. Undo restores the previous `upNow` (usually none), so a put-up-then-undo save is byte-identical. |
| A2: preview in a look | Add `POST seasons/preview { theme, seasons, day }` per the architecture. Studio shows it in slice 2's sandboxed sheet. |
| A3: layout | Skip writing unchanged members, and render a changed `seasons` in documented key order (`to_text`). A save that changes nothing writes nothing. |
| A4: UTC switch | The engine stays on UTC in this slice. Studio says the time in her own words: "It goes up on your site the evening before, around 7 pm your time," computed from her time zone and the build schedule. A site time zone setting is a follow-up for "Look and site". |
| Writing reminders (`seasonal`) | Out of this slice (brief). Kept for the parity audit. |
| Turning one decoration off | Out of this slice, first follow-up. *(Mikey to confirm.)* |
| `write.js` split | The body host landed in 65b7f46. The post session (`parts/post-session.js`, DOM-free) lands before the Decorations screen. |

## Review round (QA, Grammi, Mikey using the running slice)

Grammi finished task 1 without help. QA passed checks 3 and 5. Mikey's config round trips were byte-identical.

**Fixed:**
- **Unsaved edits kept.** Putting a look up keeps her unsaved calendar edits (QA B1, Mikey P1).
- **Conflicts.** Put up, Undo and Take down change only `upNow`. On a conflict they apply it on top of the other device's calendar instead of resending the old one, so someone else's edit is never undone. "Your decorations were changed…".
- **Honest words.**
  - "Christmas is up here", plus "Your public site catches up when the person who set it up sends it out", when the public site lives elsewhere and nothing sends it out. The same words are used for posts.
  - Switch time: "by about 8 pm your time" (build minute plus half an hour, rounded up). The old "around 7 pm" was before it can ever show.
  - "The change reaches your site …" instead of an ambiguous "It goes up …".
- **Files and errors.**
  - Configs keep their own indent (2 spaces, 4 spaces or tabs) when a member is rewritten.
  - Details no longer claims "kept as written: yes". It says how members are written, and gives the last build result.
  - Server errors are shown in her words. A 422 for a missing look says "The look x isn't on your site anymore. Choose another."
- **Accessibility and layout.**
  - One landmark per name.
  - At 320 px each season row stacks.
  - Focus returns to the top sentence after a save, a put-up or a take-down.
  - "Put a look up now" is in Find from any screen.
- **Grammi's words.**
  - **Take Christmas down early**.
  - **Use these dates** (with "Changes are saved when you press Save.").
  - The put-up date is also said in words ("That's Wednesday, January 6, 2027"), and it can't be before today.
  - The switch says what saving it off will do.
  - Overlaps read "Shares days", in calm colours, with a one-tap **Start January on January 11 instead**.
  - The preview says that only the decorations change.
  - The Undo banner sits above the sentence.
  - New seasons start with the between-seasons look.
- **Tests.**
  - Preview: the route test checks the page wears the look asked for.
  - Four-space configs stay four-space.
  - Eastern-evening cases (Nov 30 6:30 pm, 11:30 pm, Dec 1 12:30 am).
  - A browser test that putting a look up keeps unsaved edits.

**Mikey's decisions (2026-11-13):**
- Auto-publish comes later.
- The Rudolph and Island of Misfit Toys look is theme work in `grammis-house`.
- He wants decorations she can turn off one by one, a choice of decorations, a tree she decorates, and family gifts under it that she opens on Christmas. That is slice 3b.

**Deferred:**
- Hide series and utility looks from her pickers (`"season": false` in `theme.json`).
- Swatches.
- A read-only "what's up early" history.
- `decorations.js` is 416 lines; move put-up and Details into parts.
- `write.js` is 543 lines.
