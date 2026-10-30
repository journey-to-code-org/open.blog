# ADR 0865: Approved mentions are published in a content file and listed as plain links on the canonical page only

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#387](https://github.com/journey-to-code-org/open.blog/issues/387)
- Story: #402 (task DIST7.2.3)

## Context

Story #402 asks for safe mentions and an optional no-JavaScript view. Published reader feedback (ADR 0083), Third
Perspectives (ADR 0115) and continuation links (ADR 0219) already set the pattern: an approved projection is a
versioned file in the content folder, read strictly by the build, shown on the canonical page only, with every value
escaped, and a file that cannot be read refuses the build instead of dropping what was approved. Section 4.1 of the
Recommendation requires what is shown to be encoded or filtered.

## Decision

- **`content/webmentions.json`.** Written only by `openblog mentions` from the private inbox, whenever an approval,
  removal, block, pull or prune changes what is public: `version` 1 and, per mention approved at its current
  revision, the id, the post's source path, the source address, the claimed title, author and day, and the day it was
  approved. Nothing else: no state, reason, revision, block list or time of day. It is not created while nothing is
  approved, so a site that never approves one builds exactly as before. The build reads it like
  `reader-feedback.json`: unknown fields, another version, a non-web or credentialed source, text that is not plain or
  too long, a bad day, a repeated id or more than 5000 mentions refuse the build with the item's number; a mention of
  a missing post is a warning, and one of a draft waits for it.
- **The section.** A post that has approved mentions and has not opted out with `webmentions: false` lists them after
  its continuation links and before the participation forms: `<section id="ob-mentions"
  aria-labelledby="ob-mentions-heading">` with an `h2` "Mentions", a note that titles and names are as each site gives
  them and that only the address was checked, and an ordered list. Each item is a link to the source, labelled by its
  claimed title or else its host, then "on" the host, the claimed author ("as the page says") and a `<time>`. Every
  value is HTML-escaped; links are `rel="nofollow ugc noopener noreferrer"`. There is no script, image, avatar, embed
  or excerpt, so the page loads nothing from another site and reads the same without JavaScript: the static list is
  the no-JavaScript view, and no enhancement is needed.
- **Canonical page only.** Feeds, portable exports, cross-posting copies and search data never carry mentions, and
  the post records no portability capability for them, so every derived output is unchanged.

## Consequences

- Approving or removing a mention changes the site at its next build and deploy, like reader feedback.
- Mentions stay listed while receiving is switched off: turning receiving off stops the endpoint and new mentions,
  not what was approved. Removing or blocking is how one comes off the page.
