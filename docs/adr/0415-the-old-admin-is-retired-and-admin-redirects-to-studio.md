# ADR 0415: The old Admin is retired, and `/admin/` redirects to Studio

- Status: Accepted
- Date: 2026-11-15
- Builds on: [ADR 0297](0297-a-capture-waits-in-a-bounded-versioned-queue-on-the-phone-and-is-sent-with-its-id-as-an-idempotency-key.md), [ADR 0412](0412-admin-installs-as-an-app-and-the-owner-is-told-on-her-own-devices-by-web-push-sent-from-where-the-news-arrives.md)
- Spec: [Studio R15](../specs/studio/r15/spec.md), [retiring the old Admin](../specs/studio/retirement-plan.md)

(The R15 spec names this record ADR 0413; that number went to co-writer accounts in R14, so the
retirement is 0415.)

## Context

Studio (`web/studio/`, at `/admin/studio/`) was built beside the old Admin (`web/admin/`) slice by
slice, R0 to R14, until it did every job the old Admin did. Two editors meant two copies of every rule,
two sets of tests, an override folder that could replace the editor's own files, and owners who could
land on either. The owner decided to retire the old Admin; nothing about the server, its sessions or
its API was to change for Studio.

## Decision

- **The address opens Studio.** `GET`/`HEAD /admin` and `/admin/`, with any query, answer `302
  Location: /admin/studio/` with an empty body, through the same `secured()` headers as every Admin
  answer (the policy, `X-Frame-Options`, `Referrer-Policy`, `no-store`). Any other `/admin/<x>` that is
  not Studio (`/admin/studio/*`), the worker (`/admin/sw.js`), the manifest, the icons or the API
  answers the same: every one of them was an old Admin page or file. A 302, never 301 or 308, and
  never cached, so a rollback works at once. The query is dropped because Studio's kept copy opens
  only a query-less address; the `#…` never reaches the server, and browsers keep it across a
  redirect whose `Location` has none.
- **`legacyRoute` is permanent.** Studio maps every old Admin address (`#/edit/<path>`,
  `#/moderation/<state>`, `#/shared/accept/<token>`, `#/tools`, `#/not-yet/<name>`, …) to its own
  screen and fixes the address bar. Bookmarks, notices queued on other phones and old invitation
  links carry these forever; a test checks every address the old Admin answered, frozen from its
  dispatch before it was deleted.
- **The worker gives the same answer with no signal.** A page load of exactly `/admin` or `/admin/`
  is answered by the one worker (`/admin/sw.js`, scope `/admin/`) with a redirect to `/admin/studio/`,
  which opens from the kept copy; where Chrome's static routes exist, those two navigations are routed
  to the worker before "everything but Studio goes to the network". An iPhone app installed before R3
  starts at `/admin/` because iOS never reads the manifest again; it now opens with no signal.
- **Deleted:** `web/admin/` (33 files), its embedded copy (`EMBEDDED_ADMIN`, `site::admin_file`) and
  the `<paths.web>/admin/` override (only `admin/icons/` is still read; build still skips `admin/`, so a
  stale folder is never published); Personalize (`GET`/`PUT preferences`); Studio's More tools and
  not-yet screens; the old Admin's own tests. Earlier slices had already removed `document/rename`,
  `reading-paths/reorder`, `decorations/preview` and `voice/catalog`; all answer the same 404 as an
  unknown route.
- **Kept on purpose:** `engagement/feedback/publish-decision` and the collaboration `approve`,
  `approve/withdraw`, `schedule` and `publish` routes, which Studio uses; sign-in, sessions, CSRF and
  the cookie (`Path=/admin`).
- **Nothing of the owner's is migrated or removed.** The IndexedDB `openblog-capture` v1 store is
  Studio's forever (ADR 0297). The old preference files stay under
  `.openblog/private/admin-preferences/`, read only for the voice invitation's earlier "No thanks".
  Front page and Look offer back, once, the unsaved copies the old Admin kept in `localStorage`
  (`ob-landing-draft:<user>`, `ob-look-draft:<user>`), and remove only that key after she chooses.
  Every other old key is left alone and no longer read.

## Consequences

- One editor, one set of rules and tests; the binary is smaller by the old Admin's size.
- A tab of the old Admin left open across the deploy keeps saving through the API; its next lazy
  module load gets the redirect instead of a script and fails, and a reload opens Studio.
- Rolling back is reverting the switch and redeploying: nothing on disk, in IndexedDB, in
  `localStorage` or in push sign-ups was changed, and the 302 was never cached.
