# ADR 0191: A suggestion is untrusted reader text with a safe public link and bibliographic hints that are never fetched or verified

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#213](https://github.com/journey-to-code-org/open.blog/issues/213)
- Parent story: [#204](https://github.com/journey-to-code-org/open.blog/issues/204)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0079](0079-typed-scholarly-feedback-kinds-and-one-submission-format.md), [ADR 0116](0116-evidence-submissions-are-suggested-sources-and-corrections-with-unverified-reader-evidence.md), [ADR 0009](0009-research-source-library-identity.md)

## Context

Editors need actionable ideas, but a suggestion's link, title, creators and identifiers are things
a stranger typed. The Source Library has strict, author-owned records with stable identities
([ADR 0009](0009-research-source-library-identity.md)); a suggestion must never be mistaken for one.

## Decision

- **Five types, a closed set**: `question` (words only), `text`, `video`, `audio` and `source`
  (an archive, dataset, object or account). An unknown type is refused, not guessed. A question
  carries no link or hints (a source is its own suggestion), and every type needs the reader's own
  words (`text`, 1 to 2,000 characters, no control or text-direction characters).
- **The link is optional and public-web only.** It must pass B5's source-link rule (absolute
  `http` or `https`, no credentials, no whitespace or control characters, normalized, at most
  2,048 ASCII bytes) and also must not name this machine or a private network: `localhost`,
  single-label and `.local`, `.internal`, `.lan` hosts, and loopback, private, link-local,
  carrier-grade, multicast and documentation addresses in both IP versions. An editor who opens it
  reaches the public web. Nothing in open.blog fetches it.
- **Hints are the reader's statement.** Title, up to 8 creators, a free-text year, publisher and up
  to 4 scheme-qualified identifiers, each bounded and plain text; identifiers are checked for
  shape by the Source Library's own offline `check_identifier` and never against a registry or a
  remote service. None of them is a stable source identifier, a citation or a rights statement.
- **Missing metadata is allowed.** A suggestion needs only its words; `missing_metadata` lists
  what an editor still has to find (a link or identifier, a title, a creator) and never blocks one.
- **It may name a series or an article** (`about`: exactly one of `series` slug or `article` page
  path). It is a hint for the editors, not a target the policy resolves; the policy's work is the
  page the form was on.
- **Strict, versioned, deterministic.** Format version 1; unknown fields, a newer version, a wrong
  kind, oversize input (16 KiB) and any broken rule are refused with a code and a message that
  never repeats what the reader wrote. Output is canonical JSON in a fixed field order.
- **No remote scraping and no automatic episode creation**, as the issue says. Nothing here
  reads the network or the filesystem.
