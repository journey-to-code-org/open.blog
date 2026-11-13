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

## Review round 1 (QA, Grammi, Mikey on the running slice)

Fixed in this round:

- **Saving**
  - Dirty means "different from what was last saved", not "a field was touched". Tabbing past Title no longer marks a post as changed.
  - Ctrl/⌘ S on an unchanged post sends nothing.
  - While an autosave is waiting, the status says "saving in a moment…".
- **Conflicts**
  - An autosave that hits a conflict shows a banner. The question only opens when she asks for it.
  - The question says when the other version is published or scheduled, and "Use my words" keeps that state.
  - Pressing Escape leaves a "Not saved yet" banner.
- **Address and screens**
  - A new post's first save moves the address through the router, so "Write something new" opens a blank post again (QA B1).
  - A screen that has been left is never asked to leave twice.
  - A quick second address change isn't lost.
- **Publishing**
  - Each toast says where the post really went (`parts/publish.js`).
  - "See it on your site" uses the site's base path, and this server when the site is only kept here.
  - The details sheet links the web address and says how this site goes out.
- **Keeping her words**
  - A new post's words are kept on the device even without a title.
  - "Leave for now" keeps them, "Throw it away" drops them, and the next new post offers "Put them back".
- **Grammi's screens**
  - Home has "Coming up" for scheduled posts.
  - A date-only post shows its own day in lists, not the evening before.
  - Write's breadcrumb starts at Home.
  - A visible "Tags" label.
  - Phone dialogs wrap their buttons.
  - The sign-in page names the site.
  - A scheduled post's second button is "Make it a draft again".
  - Updating a published post says "Updated".
- **Accessibility**
  - A `main` landmark.
  - Focus goes to Title on a new post, to the first answer in a dialog, and back to where it was after signing in again or picking a picture.
  - Tap targets are 44 px.
- **Search** covers tags and ignores apostrophes.

Deferred (owner in brackets):

- **Front matter written in the server's normal form** [architect, slice 2 `"layout": "keep"`]. Key order, `draft: "true"` quoted, block lists, and leading blank lines trimmed. This is the existing writer (`openblog-core/src/frontmatter.rs` `compose`), and the old Admin writes the same way. Studio now saves only real changes, so an untouched post is never rewritten.
- **The file name uses the server's UTC date** (a post written at 10 PM Eastern on the 12th is named for the 13th) [architect, server].
- **Single lines join into one paragraph on the site** (Markdown) [senior UX, slice 2 recipes]. The Words help now says how to make a list. Recipes get real ingredient and step fields.
- **The file-drop box says "Drop a file here, or choose"** [Zubra UI upstream: a `prompt` prop].
- **A time with no date is ignored, and a date with no time uses the current clock time** [senior UX: say so beside the fields].
- **Mikey's structure notes, before slice 2 adds screens** [senior dev]:
  - one posts store shared by Home, Posts and the palette;
  - a screen registry instead of NAV, AREA and screens in `shell.js`;
  - a keymap with checked command ids;
  - route query state, so Posts filters survive Back.
- **Arrow keys in the Posts filter** [Zubra UI `segmented-control`].
