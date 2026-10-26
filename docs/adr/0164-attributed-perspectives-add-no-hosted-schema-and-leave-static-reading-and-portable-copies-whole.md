# ADR 0164: Attributed perspectives add no hosted schema, publish nothing by themselves, and leave static reading and portable copies whole

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#212](https://github.com/journey-to-code-org/open.blog/issues/212)
- Parent story: [#202](https://github.com/journey-to-code-org/open.blog/issues/202)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0081](0081-hosted-feedback-transport-is-opt-in-and-reuses-the-engagement-seam.md),
  [ADR 0115](0115-approved-third-perspectives-publish-from-a-versioned-public-file-and-portable-copies-link-to-them.md),
  [ADR 0160](0160-an-attributed-section-is-an-ordinary-section-target-with-a-reserved-anchor-and-a-digest.md),
  [ADR 0162](0162-only-the-bound-contributor-who-wrote-a-section-may-answer-as-its-author.md)

## Context

Hosted storage, and anything that makes reader or author words public, are hard to take back. This
task defines the targets and permissions so that #223 and #224 can build on them.

## Decision

- **No new storage.** The target is stored as the existing RD10 section target inside the existing
  hosted rows and the existing `third-perspectives.json`; the answer will be an existing
  `author-response` item. Nothing here adds a table, a column, a file or a versioned format, so
  older sites read newer data tolerantly because it is the data they already read, and nothing
  needs a migration or a rollback.
- **Nothing is published or sent.** The module is pure: it decides, and callers write. It does no
  e-mailing, notification or publication, and an answer is pending until a moderator approves it.
- **Static and portable stay whole.** A post's canonical page, static builds, portable HTML and
  Markdown, feeds and `llms` files are produced as before; this change alters no output. Ordinary
  reading never needs the response service, JavaScript or an account. Where the hosted service is
  absent the contract still resolves targets from the published body alone, and answers simply
  cannot be written, with the canonical page and the offer-by-text fallback of ADR 0114 unchanged.
- **Untrusted input.** The anchor and digest are checked strictly and by exact form, a target names
  no value in its errors, names in headings are matched exactly and fail closed when duplicated,
  and a forged look-alike arrangement is not an arrangement. Reader text is untouched here.
- **Out of scope.** Nested discussion trees, answers to conversation items, per-author opt-outs,
  rate limits and the submission route (#223), and rendering (#224).
