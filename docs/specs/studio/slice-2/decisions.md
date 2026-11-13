# Studio slice 2: decisions

Made by the stakeholder delegate on 2026-11-12, from the brief, the architecture and the design.

| Question | Decision |
| --- | --- |
| Request key for keeping files as written | `"frontMatter": "keep"` on PUT document. The reply's `layout` says `kept` or `rewritten`. It is opt-in for slice 2 and becomes the default once the whole suite passes with it on. |
| Do delete and restore send the site out? | Yes, the same as a save (`auto_publish`). A deleted post leaves readers' site, and Undo brings it back. |
| Restoring a field journal whose map track was trashed | Not offered in slice 2. The restore route refuses with a plain sentence, and Studio shows no Undo for those posts. |
| Phone action bar (design §1) | Accepted: **See how it looks** and the primary button. On the phone, Save draft and Make it a draft again move into More. |
| Row menu label (design §1, §8) | **Move or remove**, so Remove is not hidden under "Move". |
| Posts row menu trigger (design §7) | The word **More**, named "More for <title>". There is no icon-only trigger. |
| Renaming a post or changing its web address | Out of slice 2 (brief). Mikey can ask for it back. |

## From the user walk-throughs of the design (before building)

**Mikey**
- **A file that can't be kept is never rewritten silently.**
  - `splice_explained` gives the reason in one sentence. The save reply carries `layout: "rewritten"` and `layoutReason`.
  - Studio shows "File kept as written: yes / no, because …" in Details. The palette's "Show what Studio last did" shows the same.
- **Leaving a key out is not deleting it.** In keep mode, a key the request leaves out entirely stays as it is. Only `null` or an empty value removes a key.
- **New keys go beside their `KEY_ORDER` neighbour**, as the architecture says. The brief's "at the end" is superseded.
- **Comments.** A comment after a quoted value or inline list is not supported by the parser, so such a value already reads with the comment inside it. Comments on bare values are kept.
- **Changed bodies.** When the body changes, trailing blank lines collapse to one. That only happens if the body changed.
- **Delete takes `?etag=`** and refuses with 409 when the post changed since Studio showed it. A pending save that fails means no delete.
- **Delete and restore send the site out** (`auto_publish`). The Undo toast says when readers see it again. A scheduled post whose time passed while it sat in the trash goes up at once, and the banner says so.
- **Field journals.** A field journal's confirmation says Undo isn't available. Restoring one is refused with a plain sentence.
- **Previews opened directly.** They now carry `sandbox allow-scripts` in their CSP, so they never run with Studio's origin.
- **Recipe boxes.**
  - They are used only when the body maps and round-trips byte-exact.
  - `*`/`+` bullets, loose lists, multi-paragraph steps, `1)`, Steps before Ingredients and a `###` heading in the story all fall back to plain words, each with its line number.
  - Legacy `layout: recipe` posts count as recipes.
  - Pasting lines into rows strips `- `, and strips `1. ` only when a space follows. "1.5 cups" stays.
- **Keys.**
  - Alt+Shift+↑/↓ moves a row. Plain Alt+↑/↓ is left to macOS.
  - Enter in an ingredient row adds a row. A step is a multi-line box, so Enter is a new line there, and "Add a step" adds a step.
  - Ctrl/Cmd+Enter publishes. It never adds a row. Recipe problems never block publishing; See how it looks names them.
- **Recipe field aliases.** `servings`, `prepTime`, `cookTime`, `totalTime`, `yield` and `adaptedFrom` now have `profile::field_aliases`. Studio edits whichever name the post already uses (Grammi's `prep:` stays `prep:`).
- **Deferred:**
  - a read-only trash list;
  - previews per user (the 16-preview cache is shared);
  - a See how it looks shortcut beyond the palette.

**Grammi**
- **Labels and menus**
  - The row menu reads **Move or remove**. The Posts row menu reads **More**.
  - More lists her items first: Take it off my site, Delete this post, Save draft (phone), More about this recipe. The setup-person items come last: Write it all in one box, Show details, Open in the old Admin.
  - "Write it as plain words" becomes **Write it all in one box**. Its opposite stays **Use the recipe boxes**.
  - Series reads **Part of a set** (`series`).
  - "Photos" everywhere she acts ("Add photos", "Put a photo in"). The screen is still called Pictures.
- **Help and warnings**
  - Picture help: "Tap a photo to find it in your story." There is no "![" help.
  - A failed photo says "This photo didn't go in", with a thumbnail when the browser can show one, then the server's sentence.
  - Amount warning: "If you can, start with a number, like 2 or 1/2, so readers can make more. "A pinch" is fine too."
  - Ingredients help: "Start with the amount: 2 cups flour. Press Return for the next one."
- **Delete and Undo**
  - The Undo banner says "You can bring it back." next to Undo.
  - The name-taken case says "There's a new post with that name now. Ask the person who set up your site to help bring this one back."
- **The status line always shows the save state on the phone**, now that Save draft lives in More.

## Review round (QA, Grammi and Mikey using the running slice)

All three found no data loss. QA passed finish-line checks 3–6. Grammi finished task 1 without help, and Mikey finished task 2 keyboard-only. Every save kept the file as written.

Fixed:
- **Saving and keys**
  - Ctrl/⌘ S on a published post keeps the changes on the device, and Update puts them on the site. It never publishes half-typed words.
  - Studio sends only the fields that changed (`onlyChanges`); keep mode leaves the rest alone.
  - New posts are written with a bare `draft: true` (`compose` too, so the old Admin benefits).
- **Focus**
  - See how it looks focuses **Back to writing**, not the frame, so Escape and Tab work. It passes axe.
  - The dialog and side-sheet headers no longer count as a second banner (a Studio workaround until Zubra UI changes).
  - Undo keeps focus after a delete from Write. "Undo the delete" is in Find, and focus goes to the screen's heading after Undo.
  - Opening a post scrolls only Studio's own scroller, to the top.
- **Find, and More from the same list:** one command table feeds both. Find adds "Write a new recipe", "Write a new story" and the setup-person items.
- **What she's told about where a post went**
  - When this server is the public site: "Published. It's on your site."
  - When the public site is elsewhere and nothing sends it out: "Published here. Your public site doesn't update from Studio yet, so ask the person who set it up."
  - The word "server" is gone.
  - The delete banner says when readers stop seeing a post only when a send-out is set up.
- **Photos.** They show under the story, the notes and the Words box, each with **Take it out**, so the `![…]` line doesn't look broken.
- **Recipe rows**
  - Rows are full width, with Move or remove on the label line.
  - Steps grow with their text.
  - Moves are shown in words as well as read aloud, with no flash under reduced motion.
  - Row boxes are tied to their list's help.
- **Posts and Home**
  - Posts: posts with no date say "No date yet", not 1970. Two posts with the same title show their file names. On a phone the title takes the whole line.
  - Home: "Draft, goes up Friday, November 20".
- **Smaller fixes**
  - Toasts sit at the top on a phone, so they never cover the bar.
  - The Undo details read "For the person who set up your site".
  - A post that won't open hides the form and offers **Back to your posts**.
  - The details sheet no longer shows the word "null".
  - The publish setting is asked at most once a minute.
- **Code**
  - The conflict words moved to `parts/conflict.js`.
  - The take-off copies became one.
  - `write.js` is still about 590 lines.

Deferred:
- **`write.js` split** [senior dev, before slice 3]: a DOM-free post session (save, announce, problems), and the body host (one box or the boxes).
- **Zubra UI upstream** [Zubra UI]:
  - a `modal-dialog`/`side-sheet` header that isn't a banner;
  - a `file-drop` prompt;
  - destructive menu items.
- **"What was written"** [senior UX]: the details say whether the file was kept, but not which keys changed.
- **A conflict view that shows what differs** [senior UX], instead of the raw Markdown aside.
- **Restoring the original position of `draft`** [architect]: taking a post off adds `draft` by key order, so publish-then-take-off isn't byte-identical to the original.
