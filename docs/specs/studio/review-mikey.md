# Studio slice 1: review as Mikey

By `user-mikey`, 2026-11-12, walking `brief.md`, `design.md` and `architecture.md` on paper (no
running Studio yet). Task: Ctrl/Cmd+K → Write a new post → write → schedule next Friday 8 AM →
reopen from the palette by title → More/details shows file path and publish result; set Grammi up.

## Slow

- **No key for Publish/Schedule/Update.** Ctrl/Cmd+S saves a draft or Updates; scheduling means
  Ctrl+K → "This post" → Schedule. Give it a direct key (Ctrl/Cmd+Enter) shown as a palette hint.
- **"Next Friday 8 AM" is a date picker plus a `type=time` field.** Keyboard entry in segmented
  time inputs (hh / mm / AM-PM) is fiddly. Fine for this slice; later, let me type "fri 8am".
- **Show details only exists inside Write.** From Posts or the palette I can't jump to "details of
  Pumpkin bread"; I have to open the post, then More, then Show details (three steps for one path).
- **Copy path/commit** are buttons in the sheet; add "Copy file path" to the palette's This post group.

## Hidden

- **The file name is fixed by whatever the title is on first blur.** Architecture: the first
  `POST` fires when Title is left with ≥ 3 characters, and the file is never renamed in this slice.
  Tab out of "Pumkin bre" and `posts/2026-11-12-pumkin-bre.md` is forever (until the old Admin).
  Show the file name the post *will* get in the status line or details before it is created, or
  wait for the first save of words too. (Design says "3 s after typing stops"; architecture says
  "on leaving Title": pick one and write it down.)
- **No way to un-publish or un-schedule is described.** Does Save draft on a published or
  scheduled post put `draft: "true"` back? The brief doesn't say. I need it; she needs it more.
- **Does the palette learn about the post I just made?** Items are built from `GET documents`;
  nothing says the list refreshes after a create. My step 4 (reopen by title) fails if it doesn't.
- **Last publish result after a reload.** Details shows "the last publish as the server said it",
  but that only comes from the `POST publish` reply. Reopen in a new tab and it's gone. Fall back
  to `GET publish` (`lastCommit`, `ahead`, remote) and say which one I'm looking at.
- **Spec drift on the account menu:** design has View my site, old Admin, Sign out; `shell.js` in
  the architecture lists who, Sign out, old Admin. Make them match.
- **Old Admin had, and Studio leaves out:** slug, subtitle, description, series/order, theme,
  canonical, cover credit, card title/description, comments, profile, credits, preview, visual
  editor. Out of scope and preserved, so "Open in the old Admin" from More is enough for now.

## Trust

- **"Scheduled for Friday at 8 AM" may not be true for readers.** The local server rebuilds when
  `nextDue` passes, but the live site only shows it if something builds at 8 AM (cron or a
  scheduled workflow, per the publishing-and-scheduling post). Details must say what makes it go
  live and in which time zone 8 AM is (browser vs server `now`).
- **Auto-publish is claimed, not checked.** With `auto: true`, Studio says "readers will see it in
  about a minute" while the push runs in a background thread nobody reports on. Say "sent
  automatically; result not known yet" in details, or read `GET publish` after a few seconds.
- **`POST publish` ships every pending change on the site,** not just this post. Listing
  `committed` in More is right; the toast should say "and 2 other changes" when there are others.
- **Error copy covers 409/401 but not 422 `problems`, 413, 415, 503 "Workspace save NOT
  acknowledged".** Each needs a sentence that says what wasn't saved and that her words are kept.
- Good: `pushed:false` gets a sticky warning plus **Send it out again**; conflict keeps her text
  and details shows both save times; nothing is autosaved onto a published post.

## Grammi-safe

- **Open the old Admin is in her account menu.** That's delete, rename, settings, users, every
  power I'm keeping her away from, one tap from her name. Palette only (or hidden per user later).
- **Publish sits under her thumb next to Save draft, with no undo and (per above) no un-publish.**
  Autosave already keeps drafts, so a stray tap on the bigger button puts a half-recipe online.
  Either a short undo toast or an un-publish path before she gets this.
- **Keep mine instead** on a conflict will overwrite a fix I made in the old Admin. It asks once,
  which is fine; make sure the confirm names what is lost, as designed.
- **Setting her up** is `openblog user add` on the CLI plus a bookmark; every user is a full
  user, no roles. Fine for one trusted mom, but say it in the setup notes.
- Tag suggestions will still let her make "thanksgiving" next to "Thanksgiving"; match case-blind.

## Front-matter blocker (owner's opinion)

I care a little, and it is **not a blocker for this slice**. Values survive, and the old Admin
already rewrites front matter through the same `compose`, so Studio makes nothing worse. The cost
is noisy git diffs on Grammi's typo fixes, which I can fix once: commit a one-time "canonicalize
all posts" pass so every later save diffs only what changed. Run check 3 on canonical files as the
architect proposes and log the gap. One caveat to verify first: the parser skips `#` comment
lines (`frontmatter.rs:115`), so `compose` drops YAML comments; that's real (if small) content
loss. If any of my posts carry front-matter comments, either move them into the body or do
`"layout": "keep"` (`frontmatter::splice`) in the next slice, not this one.
