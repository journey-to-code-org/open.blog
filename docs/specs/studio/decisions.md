# Studio, slice 1: decisions after the user walk-throughs

Settled for the stakeholder from `review-grammi.md` and `review-mikey.md`, before building.

| Finding | Decision |
| --- | --- |
| Front matter is rewritten on save (architect's blocker) | Not a blocker: values are kept, the old Admin already does the same. Check 3 runs on a file in the server's own layout. `"layout": "keep"` is the first item of slice 2, sooner if a post carries `#` comments. |
| Conflict message doesn't say who or what (Grammi: stuck) | Say it plainly: "Pumpkin bread was changed on another device or by someone else while you had it open. Your words are still here." Choices: **Use my words** (asks once, naming what it replaces) and **Show the other version** (her words stay in a panel she can copy from, with a Copy button). |
| Cover photo buttons read wrong on a phone (Grammi: stuck) | "Add a photo" (from the phone or computer: the file picker) and "Use a picture already on my site". No "drop". |
| Save draft beside Update on a published post (Grammi: unsure) | A published post shows only **Update**. Save draft appears only for drafts and new posts. |
| Paragraphs | Help under Words: "Leave an empty line between paragraphs." |
| Finding the post after publishing | The status line links "See it on your site" once published. |
| Tags on a phone | Help: "Type a tag and press Enter." |
| Old Admin one tap from Grammi (Mikey: Grammi-safe) | "Open the old Admin" lives in the command palette and Write's More only, not the account menu. |
| Title becomes the file name for good (Mikey: hidden) | The first save waits until the title is left (3+ characters) or she starts on the words, never mid-title. Details shows the file name. Renaming stays in slice 2. |
| Schedule truth and time zone (Mikey: trust) | Times say "your time". Details explains that a scheduled post goes up when the site next builds after that time. |
| Palette after a new post | The palette's posts reload whenever it opens. |
| Forgotten password | Sign in says "Forgot it? Ask the person who set up your site." (no reset exists). |
| Undo publish | Out of this slice; slice 2 adds "Take it off my site" (back to draft). |
