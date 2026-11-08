# ADR 0386: A Bluesky card shows the post's own title, and a link already in a caption is read as a reader sees it

- Status: Accepted
- Date: 2026-11-08
- Parent epics: [#382](https://github.com/journey-to-code-org/open.blog/issues/382), [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Stories and tasks: #391, #392, #489, #526, #514, #515, #516, #517, #518
- Amends: [ADR 0358](0358-a-bluesky-announcement-is-one-post-record-with-facets-and-a-link-card-under-a-record-key-derived-from-the-announcement.md),
  [ADR 0360](0360-a-mastodon-announcement-is-one-status-with-the-link-written-into-it-at-the-deployers-visibility-checked-against-the-instances-own-limits.md),
  [ADR 0354](0354-seasonal-topics-are-bundled-per-trade-the-site-stores-only-its-changes-and-absent-means-off.md),
  [ADR 0383](0383-the-owner-is-told-by-one-opt-in-email-to-their-own-address-that-carries-no-contact-details-and-can-never-lose-a-request.md),
  [ADR 0384](0384-the-owner-manages-quote-requests-in-admin-with-no-crm-and-erases-them-only-after-a-preview-with-a-verified-result.md)

## Context

A read-only check of work merged to develop found defects that need no person or outside account to fix:

- **Bluesky card (#391).** ADR 0358 titled the link card with the caption's first line and left the description
  empty. A one-line announcement such as "Soup is up, see https://... #recipes" showed its text twice and never the
  post's title. A retry of an attempt that did land is refused for its taken record key, and that refusal was filed
  as failed.
- **Mastodon link (#392).** The link was left off the status only when a whitespace-separated word equalled it.
  "Soup (https://.../soup/)" and "New soup: https://.../soup/." got it a second time. Admin's preview used the same
  rule, and the docs said "that exact link".
- **Reminders (#489, #526).** After **Start a draft** the card was not redrawn and still offered **Snooze a week**;
  the server's 409 ("A draft was already opened") was shown as "These settings changed in another window". ADR 0354
  and the docs said an `enabled: false` member is not written back, which is false when it holds topic changes.
- **Quote intake (#514, #517).** The intake kept C1 control characters (U+0080 to U+009F). Admin refuses any
  control but a line break or tab, so such a request was silently left out of the list: it could not be read,
  marked, archived or erased.
- **No JavaScript (#515).** A refused field came back as a page saying "correct the highlighted fields" with
  nothing highlighted. The phone box had no `pattern`, so the browser let "call me" through. A `quote` fence with
  no `service:` lines showed a text box even when the site publishes services.
- **Email timing (#516).** The owner's email was sent while the visitor waited, two tries of up to 8 seconds each;
  a hung provider held the visitor for over 16 seconds, past the 10 seconds a synchronous hosted function may get,
  so a saved request could be reported as not saved.
- **Erase (#518).** Photos were removed before the records, so a failure part way left the requests but lost some
  photos. ADR 0384 accepted that; the task's criterion is that a partial failure leaves everything in place.

## Decision

1. **The Bluesky card is the post's.** Just before writing the record, the adapter reads the post's canonical page
   (a public GET, no token, no redirect followed, at most 3 seconds and 1 MB) and uses its `og:title` and
   `og:description`, plain and at most 300 characters each. A page that cannot be had, is not HTML or has no title
   leaves the card as before, titled with the caption's first line. There is still no picture. Admin's preview
   carries the same title and description from the site's own social metadata and says so. When `createRecord`
   refuses with a 400 that is not about the session, the adapter reads that one record; if it is exactly this
   announcement, the attempt counts as posted.
2. **A link in a caption is read as Mastodon reads it.** Each `http(s)` link in the caption is taken without the
   punctuation after it (`. , ; : ! ?` and a closing bracket the link did not open). If one equals the post link,
   the link is not added. The length count uses the same reading. Admin's `captionHoldsLink` repeats the rule and is
   tested against the server's `holdsLink`.
3. **A started draft is redrawn at once.** The Reminders card is drawn again after **Start a draft**, keeping the
   link to the draft, so it no longer offers Start or Snooze. A 409 is "changed in another window" only when the
   server sent the settings back with it (a stale save); any other 409 is said in the server's own words.
   `enabled: false` is written back whenever the member holds topic changes; it is removed only when it holds none.
4. **What is stored can always be shown.** The intake removes C0 and C1 controls (keeping line breaks and tabs)
   and invisible format marks from every field. Admin shows any control character it still meets as a space instead
   of leaving the request out, and the list reply counts any stored request it cannot show (`unreadable`), which
   Admin states in words.
5. **Without JavaScript the visitor is told which field is wrong.** The phone box carries the function's own rule as
   a `pattern` (written for the `v` flag browsers use) and a `minlength`. A request the function refuses for its
   fields comes back, for a form post, as the form with the typing kept, a list at the top naming each wrong field
   with what to do, each wrong box marked `aria-invalid` with its message, and a fresh token. JSON answers are
   unchanged. A `quote` fence with no `service:` lines lists the site's published services by name, as the landing
   section does; drafts are not listed.
6. **The email never holds the visitor long.** All inline tries together get at most 4 seconds; a try still running
   at the deadline is given up and recorded as `timeout`, and a second try is made only with at least a second left.
   The Resend call itself is aborted after 3.5 seconds. The request is stored before the email starts, so the
   visitor's answer is the truth, and the owner's retry in Admin sends a failed email later under the same
   Idempotency-Key.
7. **An erase is all or nothing for the owner.** Photos are first moved (which can be undone) into one private hold
   folder per site, `<site>/erasing/<request id>-<file>`. A failed move puts back every photo already moved; a
   failure removing the records does too. Only after the records are verified gone are the held photos removed.
   If that last removal fails after a second try, the reply says how many photos are left (`photosPending`); no
   request points to them, and the next erase or retention run removes held photos whose request no longer exists.
   A photo that cannot even be moved back stays in the hold folder and its request is pointed there, so nothing a
   request shows is lost.

## Consequences

- A Bluesky announcement costs one more request, to the blog's own public page, bounded so the record always has
  time. The card text is what the page said at posting time.
- A link written as `https://.../soup/x` or a shorter address is still not the post link, and the link is added.
- No stored format changes: the quote table, the bucket, the seasonal member and the social rows are as they were.
  The hold folder is inside the existing private bucket.
- Still open, and recorded on the issues: the quote function runs only on Netlify, so the site's Render host has no
  `/api/quote` route (#485, #486); the retention period is set only where the function runs, not in Admin (#518);
  no live Bluesky, Mastodon, Supabase or Resend account was tried.
