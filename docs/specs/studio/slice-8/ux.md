# Studio UX, slice 8: Comments

By `studio-ux`, 2026-11-13, from `studio-ux` and the moderation and engagement-settings routes as they exist. The nav item is **Comments**. It shows only when comments are set up (`meta.engagement` true). The old Admin keeps setup and every scholarly note.

## The screen

- **Job (her words):** "Did anyone leave me a comment, and do I want it on my site?"
- **Primary action:** **Show it** on the first waiting comment, visible at 400 px without scrolling.
- **Title:** "Comments". **Question (h2, Literata):** "What have people said?"
- **Routes:** `#/comments` (Waiting), `#/comments/shown`, `#/comments/not-shown`, `#/comments/taken-down`. Mikey's `?kind=comment|report` rides along. Back: the nav, or Home's waiting line.

| View | Server state | Line under the question |
| --- | --- | --- |
| **Waiting** | `pending` | "New comments wait here until you choose. Nobody else sees them yet." |
| **Shown** | `approved` | "These are on your posts for everyone to read." |
| **Not shown** | `rejected` | "You chose not to show these. Only you can see them." |
| **Taken down** | `removed` | "These were shown, then you took them down. Only you can see them." |

`clarification` never appears. The view picker is a `segmented-control` (label "Which comments") above 30rem, and a `select-field` with the same label and options below that (gap S1). Changing it changes the hash, so Back works.

### 400 px

```
+--------------------------------------+
| [Menu] Comments     [Find] [Grammi v]|  dashboard-shell
+--------------------------------------+
| What have people said?               |  h2
| New comments wait here until you     |  p (ink-soft)
| choose. Nobody else sees them yet.   |
| Which comments [Waiting          v]  |  select-field
| +----------------------------------+ |
| | Aunt Sue                         | |  content-card, heading = name
| | on “Pecan pie” . Today at 7:42 PM| |  meta; post title is a link
| | This is just how Mama made it,   | |  body (Literata)
| | right down to the burnt edge!    | |
| | [  Show it  ] [Don't show v] [..]| |  action-button primary,
| +----------------------------------+ |  dropdown-menu x2
| +----------------------------------+ |
| | [Reported]                       | |  status-badge
| | Ricky reported a comment         | |
| | Why: It's rude                   | |
| | | Jimmy wrote on “Stuffing”:     | |  blockquote, sage edge
| | | You call that stuffing?        | |
| | [Take the comment down v]        | |
| | [Keep the comment]          [..] | |
| +----------------------------------+ |
|            [ Show more ]             |  action-button secondary
|                                      |
| Taking comments                      |  h3
| (o) Let people leave comments        |  toggle-switch
| > For the person who set up your site|  details
+--------------------------------------+
```

At 320 px the card's buttons stack full width (`cluster-layout`, wrap); the More button stays on the first row with the name.

### Desktop (1280 px)

```
+-------------+-----------------------------------------------------------------------------+
| Grammi's    | Comments                                        [Find  Ctrl K] [Grammi v]   |
| House       +-----------------------------------------------------------------------------+
| Studio      | What have people said?                                                      |
|  Home       | [ Waiting | Shown | Not shown | Taken down ]          segmented-control      |
|  Posts      |                                                                             |
| > Comments  | +--------------------------------------------+   Taking comments            |
|  ...        | | Aunt Sue            on “Pecan pie”     [..]|   (o) Let people leave       |
|             | | Today at 7:42 PM                           |       comments               |
|             | | This is just how Mama made it ...          |   When it's off, the         |
|             | | [ Show it ]  [ Don't show v ]              |   comments section leaves    |
|             | +--------------------------------------------+   your posts.                |
|             | +--------------------------------------------+                              |
|             | | ...                                        |   > For the person who set   |
|             | +--------------------------------------------+     up your site             |
|             |               [ Show more ]                                                 |
+-------------+-----------------------------------------------------------------------------+
```

List column max 46rem; the switch section moves to a right column at 70rem and up, otherwise it sits under the list.

## The card

One `content-card` per item, in a list (`role="list"`, each card a `listitem` labelled "Aunt Sue's comment on Pecan pie").

- **Who:** `reader.name`, or "Someone" when empty. When `reader.publishName` is false: a small line "Only you see this name."
- **Where:** "on “Pecan pie”", linked to the post on her site in a new tab (named "Pecan pie on your site, opens in a new tab"). `post` null: "on your site".
- **When:** `receivedAt` as people say it: "Today at 7:42 PM", "Yesterday at 9 AM", "Tuesday, November 10 at 7:42 PM"; the year only when not this year.
- **The words:** `body`, line breaks kept, Literata at base size. Over about 600 characters: clamped to 8 lines with **Read all** (a disclosure, not a link).
- **Erased** (`purged` or `body` null): "Its words were erased." in ink-soft; no buttons but More.
- **Decided views** add one line: `status-badge` plus "Not shown: it's spam. You decided Tuesday, November 10." (the reason in Studio's words below; `moderatedAt` as a day).

**Reported variant** (`source` "report"):

- `status-badge` **Reported** (words, not colour alone).
- Heading: "Ricky reported a comment" (`reader.name`, or "Someone reported a comment").
- "Why: " + `report.groundLabel`.
- The reported comment in a `blockquote`: "Jimmy wrote on “Stuffing”:" (`target.authorName`) then `target.body`. If `target.body` is null: "Its words were erased." Under it, "Right now it's " + `target.statusLabel` lower-cased, only when it isn't shown (for example already taken down).
- Decided views: approved reports read "You took the comment down." Rejected ones read "You kept the comment."

**Other kinds** (anything not `comment` or `report`): a short card, no body, no buttons.

> **A different kind of note**, on “Pecan pie” . Today at 7:42 PM
> Studio doesn't handle this kind of note yet.
> [Open in the full inbox](/admin/#/moderation/pending)

The link goes to `/admin/#/moderation/<state>` for the current view. `kindLabel` is in its details only.

## Buttons and words

Studio's words are chosen by action id and source. Any other action id (including `request-clarification`, which Studio never shows) appears only in the card's More menu under its server `label`; if it needs a reason, it opens the same Why menu with server reason labels.

### Comments

| View | Action id | Button | Kind | Asks why? | Status after (live region + toast) | Undo |
| --- | --- | --- | --- | --- | --- | --- |
| Waiting | `approve` | **Show it** | primary | no | "Shown under “Pecan pie”. Visitors can see it now." | none (see below) |
| Waiting | `reject` | **Don't show** | secondary, opens Why | yes | "Not shown. Nobody else sees it." | yes: `reopen` |
| Shown | `remove` | **Take it down** | secondary, opens Why | yes | "Taken down from “Pecan pie”. Visitors don't see it any more." | yes: `reopen` |
| Not shown, Taken down | `reopen` | **Put it back in Waiting** | secondary | no | "Back in Waiting. Choose Show it when you're ready." | none needed |
| Not shown, Taken down | `erase` | More: **Erase it for good** | destructive, in More | dialog | "Erased. Its words and the name are gone for good." | none; asks once |

**Show it has no Undo.** Undoing a showing would mean a recorded take-down. Instead the status adds: "Changed your mind? It's under Shown, with Take it down."

### Reports

| View | Action id | Button | Asks why? | Status after | Undo |
| --- | --- | --- | --- | --- | --- |
| Waiting | `uphold-report` | **Take the comment down** (primary) | yes | "Taken down from “Stuffing”. Visitors don't see it any more." | none; status adds "To bring it back, find it under Taken down." |
| Waiting | `reject` | **Keep the comment** | no: sends `no-action` quietly when the server lists it, otherwise opens Why | "Kept. The comment stays where it is." | yes: `reopen` |
| Decided | `reopen` | **Decide again** | no | "Back in Waiting." | none needed |

### The Why menu

A `dropdown-menu` from the button, heading "Why?". One tap decides. Escape closes it and nothing is sent. Items keep the server's order and come from `reasons[]` only; Studio's words by reason id, server `label` otherwise:

| Reason id | Studio's words |
| --- | --- |
| `spam` | It's spam |
| `abusive` | It's unkind |
| `personal-data` | It shares something private |
| `off-topic` | It's not about this post |
| `duplicate` | They said it twice |
| `rights` | It copies someone else's work |
| `no-action` | The comment is fine |
| `other` | Another reason |

A report's Why on **Keep the comment** uses "It was already reported" for `duplicate` and "The report is spam" for `spam`. If `guidance` is present, it shows as one ink-soft line at the top of the menu only when it's under 120 characters; otherwise it moves to details.

### Card More menu

`dropdown-menu`, labelled "More for Aunt Sue's comment": **See it on your site** (when `post.url`), **Erase it for good** (when `erase` is offered), any other server action, **Open in the full inbox**.

### Erase dialog

`modal-dialog`:

- **Heading:** "Erase Aunt Sue's comment for good?"
- **Text:** "Its words and the name on it are deleted. Only a private note that you decided stays. This can't be undone."
- **Buttons:** **Erase it** (destructive) and **Keep it** (focused first). Escape is Keep it.
- When the action carries `confirm`, the dialog stands for it; Studio never asks her to type a word.

### While a decision is sending

The card's buttons go busy (`action-button loading`); other cards stay usable. On success the card leaves the list (a 160 ms fade; none under reduced motion) and focus moves to the next card's heading, else the previous one's, else the empty state's heading.

### Undo

Through `context.undo`, extended to moderation (gap S2): the shell banner "Not shown: Aunt Sue's comment on “Pecan pie”." with **Undo**. It holds the last decision only, and stays until she closes it or decides another. Undo sends `reopen` with the version the decision returned, then says "Back in Waiting." If that fails with 409: "It changed again since, so it wasn't undone. It's under Not shown." Palette: "Undo the last decision".

## Paging, loading, empty

- **Loading:** three `skeleton-block shape="card"`, `aria-busy` on the list.
- **Show more:** shown while `next` is set; fetches `after=next` and appends. The button goes busy; focus moves to the first new card. Status: "Showing 40 comments."
- **Server-unreadable items** (`invalid` > 0): one quiet line at the end, "Some notes couldn't be shown here.", with **Open in the full inbox**.

| View | Empty heading | Text | Action |
| --- | --- | --- | --- |
| Waiting | "Nothing waiting" | "When someone leaves a comment, it waits here for you to say yes." | **See what's shown** |
| Shown | "No comments up yet" | "Comments you show appear under your posts, and here." | **See what's waiting** |
| Not shown | "Nothing here" | "Comments you choose not to show stay here, out of sight, in case you change your mind." | **See what's waiting** |
| Taken down | "Nothing taken down" | "If you take a comment down, it waits here in case you want it back." | **See what's shown** |

When the switch is off, Waiting's empty text is "Comments are switched off, so nobody can leave a new one." with **Turn comments on** (focuses the switch).

## Errors

All failures say what happened and what to do, with no codes. The list's errors use an `alert-banner` at the top with **Try again**; a decision's errors go in a line on that card, the buttons stay, and focus goes to the line.

| What | List | Card |
| --- | --- | --- |
| Service unreachable (502, 503) | "Your comments service isn't answering right now, so Studio can't show your comments. Try again in a few minutes." | "That didn't go through: your comments service isn't answering. Nothing changed. Try again in a few minutes." |
| Changed meanwhile (409) | n/a | Studio reloads the current view up to the same count, keeps her place, and focuses the card again: "This comment changed somewhere else just now. Here it is as it is now. Choose again." If it left this view: "This comment was already decided somewhere else." in the status. |
| Bad or missing reason (422) | n/a | Reopens the Why menu with the line "Choose why first." |
| No connection | "Studio couldn't reach your site's server. Check your connection, then try again." | same words |
| Signed out (401) | the shell's sign-in, back to this view | same |
| Anything else | "Your comments didn't load. Try again, and if it keeps happening, tell the person who set up your site." | "That didn't go through. Nothing changed. Try again." |

## Taking comments (the switch)

- **Heading:** "Taking comments". **`toggle-switch`:** "Let people leave comments".
- **Help:** "When it's off, the comments section leaves your posts and nobody can leave a new one."
- It loads with `GET engagement/settings`. Each flip saves at once: `PUT` with the whole loaded settings echoed back, `comments` changed, `credentialAction: "keep"`, and the `etag`. Then it sends out as the other saves do.
- The switch is busy while saving. Afterwards the status comes from `wentOutWords(action: "saved")`, starting "Comments are on." or "Comments are off." For example: "Comments are off. Your readers will see the change in about a minute."
- **On failure** the switch flips back with "Your comment setting wasn't saved. Try again."
- **409:** reload the settings, then "Your comment settings changed somewhere else. Here they are now; switch again if you still want to."
- **Off banner:** while off, an `alert-banner variant="info"` above the list reads "Comments are switched off. Your posts don't show any, and nobody can leave new ones." with **Turn comments on**.
- There's no confirm, because it can be switched back.
- If settings fail to load, the section shows "Studio couldn't check whether comments are on." with **Try again**, and the list still works.

## Home

Home calls `moderation?state=pending` once on load, only when `meta.engagement` is true. It counts `comment` and `report` items. Above "Keep going" goes one link row (`content-card` with `href="#/comments"`):

- "1 comment is waiting for you" / "3 comments are waiting for you" / "More than 20 comments are waiting for you" (when `next` is set; the number is the page length).
- With 0 comments, or on any error, Home shows nothing. It never nags or shows a failure here.

## First layer and deeper

**First layer (Grammi):** the view picker, the cards, **Show it**, **Don't show**, **Take it down**, **Put it back in Waiting**, the reported comment and why, **Show more**, and the one switch.

**More (per card):** Erase it for good, See it on your site, server actions Studio doesn't name, and Open in the full inbox. Rare or permanent, so one step down.

**Details** (`details`, "For the person who set up your site", per card and per screen; `studio-mono`):

- **Per card:** `id`, `source`, `kind` / `kindLabel`, `status`, `version`, `reason` and `reasonLabel`, `receivedAt` and `moderatedAt` in UTC ISO, `post.source`, `work`, `public`, `purged`, `reader.private`, the offered actions as `id: label` with their `guidance`, and the action's `confirm` text when present.
- **Per screen:** `state`, `kind` filter, `protocol`, `invalid`, `next` cursor, the service endpoint and `comments` value from settings, and the link "Comments setup in the old Admin" (More tools, Comments setup).
- Show it's missing Undo and the quiet `no-action` on Keep the comment are written here, so the record never surprises him.

**Command palette:**

- **Go to:** Comments, Waiting comments, Shown comments, Not shown comments, Taken-down comments.
- **Do:** Show only comments, Show only reports, Show every kind (each sets `?kind=`), Turn comments off or on, Undo the last decision, Open the full inbox, and Comments setup in the old Admin.

**Why:** Grammi's whole task is "yes or no to each comment", so only those verbs and their reverse sit on top. Reasons are asked only when saying no, so the record stays useful without slowing a yes. Permanent erasure and scholarly kinds are rare and are Mikey's. Setup is already in the old Admin.

## Accessibility notes

- Buttons keep their visible names ("Show it") and point `aria-describedby` at the card's heading, so a screen reader hears "Show it, Aunt Sue's comment on Pecan pie".
- The Why menu and More menu are keyboard menus (arrows, Enter, Escape returns focus).
- Statuses go to the live region; the toast repeats them visually.
- 44 px targets. Text never sits on a colour alone (badges carry words).
- 320 px stacks everything with no sideways scroll; long words and links in comments wrap (`overflow-wrap: anywhere`).

## Gaps

- **S1.** `segmented-control` can't wrap to two rows. Until Zubra UI can, Studio switches to `select-field` under 30rem; fix it upstream.
- **S2.** `context.undo` holds post deletes only. Give it a generic entry (`heading`, `run`, `details`) so moderation, and later screens, share one Undo banner.

## As built

- **S1:** the view picker is a `select-field` at every width for now; `segmented-control` comes back when it can wrap.
- **S2:** Undo is the Comments screen's own banner (the last no, sent back with `reopen`), not the shell's. Moving it into a general `context.undo` is still open.
- A reason asked from the More menu opens a dialog rather than a menu.
- Saving engagement settings now rewrites only `engagement` in `openblog.json` (`config_text::set_member`), the same as Look.
