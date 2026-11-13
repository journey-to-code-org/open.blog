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
