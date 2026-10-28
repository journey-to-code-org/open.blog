# ADR 0372: A timed draft is kept on the server and on the device and reconciled on load, and the polished editor guards its own unsaved work

- Status: Accepted
- Date: 2026-10-28
- Decision issue: [#446](https://github.com/journey-to-code-org/open.blog/issues/446)
- Parent story: [#418](https://github.com/journey-to-code-org/open.blog/issues/418)
- Parent epic: [#408](https://github.com/journey-to-code-org/open.blog/issues/408)
- Builds on: ADR 0267, ADR 0370, ADR 0371, ADR 0249 and ADR 0264 (the landing builder's drafts)

## Context

A reload, a closed tab or a network drop in the middle of three minutes must lose nothing, and it must also never
turn into extra time. Two copies of the draft exist: the session record on the server (written by autosave) and
whatever this browser kept.

## Decision

- **The server's autosave is the protection that always works.** The rough draft goes to `PUT session/draft`
  1.5 seconds after typing stops, one request at a time, and a failed save is retried after the next pause.
- **A bounded copy on the device is the second protection.** One record per site and sign-in, `ob-voice-draft:<user>`
  in `localStorage`: `{ v: 1, sessionId, deadline, text, savedAt }`, written 300 ms after typing stops and when the
  page is hidden, at most 60 KiB (more is not kept, the server would refuse it too). Every access is in a
  `try`/`catch`; a browser that throws keeps the copy in memory for the life of the page and the page says so. The
  page then relies on the server's autosave alone, which the tests exercise.
- **Reconciling on load.** The server's session wins for the deadline: the page only ever takes the time left
  from the server and a countdown never moves its end later. For the text, the longer of the device's copy and
  the server's draft wins if both belong to the same session id (the one that was cut short missed typing), and
  when the device wins it is sent to the server at once. A copy of a different session is dropped.
- **An expired session never grants time.** If the time ran out while the page was away, the page reads the
  session's status first. A copy that was kept before the deadline plus the server's 10 second grace, and is
  longer than what the server saved, is handed to the lock; the server accepts it only inside its own grace and
  otherwise locks the draft it saved. A copy kept later than that is ignored. An expired session with nothing
  written is discarded. No draft is sent after the deadline.
- **The copy is cleared when the rough draft is locked** (it is on the server for good), when the session is
  scrapped, and whenever the session turns out to be over.
- **The announcement and reconciliation rules are plain functions** (`reconcileDraft`, `expiredPlan`,
  `createVoiceDraftStore`) tested at exact seconds, besides the harness tests that reload the page.

## Considered options

- **Trust the device's copy over the server.** Rejected: the server holds the deadline, and a copy with a stale
  deadline could be used to keep writing.
- **IndexedDB.** Rejected: one small string; `localStorage` with a memory fallback is enough, and matches the
  landing builder.
- **Lock from the device's text whatever the time.** Rejected: ADR 0267 limits a late hand-over to 10 seconds.
  The cost is that typing done offline in the last seconds before a long outage can be lost; the autosave is short
  so that is a small window, and the alternative would let a client choose its own deadline.

## What would trigger revisiting this

- Authors losing words to long outages at the deadline: the grace is the server's (ADR 0267) and would change there.

## Consequences

- Reloading is always safe; the clock continues from the server's deadline.
- Nothing about the device's copy is ever sent anywhere except to the session's own draft route.
