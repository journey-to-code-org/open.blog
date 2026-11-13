# Studio design, slice 3: Decorations

By `studio-senior-ux`, 2026-11-13. This is a condensed record of the design that was built; the full version is in the slice 3 PR. The nav item is **Decorations**.

## Answers to U1 to U4

- **U1. One primary action at a time.**
  - With nothing unsaved, the primary is **Put [next look] up now**, in the top card.
  - Once she changes the calendar, a bar appears with **Save** as the primary.
  - Calendar edits don't save by themselves, because every save rebuilds and sends the site out.
- **U2. One short line per season**, for example "Christmas", then "December 1 to January 6". Tapping a line opens that one season in a sheet, full screen at 400 px. There is no wall of dropdowns.
- **U3. Looks are listed alphabetically by label**, so variants sit together ("Christmas", "Christmas: Grammi's toy shelf"). **See how it looks** sits next to every look picker, so she compares by seeing.
- **U4. Undo for "Put it up now"** is a banner, "Christmas is up. Thanksgiving came down.", with **Undo**. It stays until she closes it. After that, the top card offers **Go back to the calendar** while the early look is up. Undo restores the previous `upNow`, so the file is byte-identical.

## The top card

| State | Words |
| --- | --- |
| A season is up | "Your house is decorated for Thanksgiving." / "On Tuesday, December 1 it changes to Christmas." / "The change reaches your site the evening before, by about 8 pm your time." |
| Put up early | "Your house is decorated for Christmas, put up early. It stays up through Wednesday, January 6, 2027." |
| Everyday look | "Your house is wearing its everyday look: No decorations (just the house)." |
| Calendar off | "Your house wears No decorations (just the house) every day. The calendar is off." |

## The calendar

- **Switch:** "Change by itself with the calendar".
- **List help:** "If two seasons share a day, the one higher up wins."
- **Each row:** a button named "Season 1 of 12: Christmas, December 1 to January 6", with words-only badges (**Up now**, **Next**, **Check this**).
- **Row menu:** **Move or remove**, containing Change it, See how it looks, Move up, Move down and Remove this season. Alt+Shift+↑/↓ moves the focused row, and each move is announced.
- **Add a season:** starts the day after the last season ends and opens its sheet.
- **Between seasons:** a select. With the calendar off it reads **Every day**. Its help says when the look shows.
- **The sheet:** Look; **See how it looks**; First day and Last day, each a Month select and a Day select (days clamp to the month); "It comes down after this day."; "This season runs past New Year."; the February 29 notes; **Done** and **Never mind**. Ctrl/Cmd+Enter is Done and Save.

## Put it up now (dialog)

- **Heading:** "Put Christmas up now?"
- **Text:** "Thanksgiving comes down today, and Christmas goes up." / "It stays up through Wednesday, January 6, 2027. Then your calendar takes over again, starting with January: snowy morning on Thursday, January 7, 2027." / "Next year's dates don't change."
- **Fields:** **Which look**, and **Keep it up through** (a date). It defaults to the end of the look's coming season, or 14 days out for a look with no season. Help: "After this day, your calendar takes over."
- **Buttons:** **Put it up now** and **Not yet**.

## See how it looks

Slice 2's preview sheet, fed by `POST seasons/preview { look }`. Heading "How Christmas looks"; line "Only you can see this. Nothing is saved or put up."; back button **Back to decorations**; iframe titled "Your front page decorated for Christmas".

## Saving

- **Bar:** "Not saved yet." and **Save** (Ctrl/Cmd+S or Ctrl/Cmd+Enter).
- **Result:** the toast comes from `wentOutWords(action: "saved")`, in the same words as posts. A `buildError` says the site couldn't be put together yet.
- **Overlaps** are warnings that name the winner. Other problems block the save, listed in a banner.
- **Conflict:** `askWhichToKeep` with "changes", then **Use my changes**, or **Show the other version** followed by **Put my changes back**.
- **Leaving with changes:** "Save your decorations?" with **Save** or **Leave without saving**.

## Mikey's layer

- **Details** ("For the person who set up your site") lists:
  - the file and members;
  - the look between seasons;
  - Up early (stored JSON);
  - Today (UTC) and what's worn;
  - Next change, with its UTC build time;
  - File kept as written;
  - the last send-out;
  - a table of every season (#, look, theme name, start, end as stored);
  - **Copy the stored seasons**.
- **Find (the palette):** Decorations, Save decorations, Add a season, Show decorations details, "Put up …" for each look, "See how it looks in …" for each look.

## Deferred from this design

- Colour swatches for each look (needs the theme's accent in `GET seasons`).
- Keeping unsaved calendar changes on the device.
- An optional `"season": false` in `theme.json` to hide series looks from her pickers.
- `toggle-switch` help slot and `select-field` id pass-through in Zubra UI.
