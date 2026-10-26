# ADR 0100: One closed registry of participation kinds, each off until the site and the post turn it on

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#211](https://github.com/journey-to-code-org/open.blog/issues/211)
- Parent story: [#203](https://github.com/journey-to-code-org/open.blog/issues/203)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [Hosted engagement](../specs/hosted-engagement.md)
- Coordinates with: B5 passage feedback (ADRs 0087 to 0089 on `story/b5-passage-feedback`, #81),
  [#210](https://github.com/journey-to-code-org/open.blog/issues/210) and
  [#221](https://github.com/journey-to-code-org/open.blog/issues/221) (RD10 Third Perspectives),
  [#83](https://github.com/journey-to-code-org/open.blog/issues/83) (author responses),
  [#213](https://github.com/journey-to-code-org/open.blog/issues/213) (RD13 suggestions),
  [#225](https://github.com/journey-to-code-org/open.blog/issues/225) (moderation inbox),
  [#226](https://github.com/journey-to-code-org/open.blog/issues/226) (abuse and retention)

## Context

The site already has one kind of reader participation: hosted comments, switched on by
`engagement.enabled`, `engagement.comments` and an endpoint, with each post's `comments:` front
matter choosing `open`, `locked` or `hidden`. B5 adds four typed feedback kinds and, until this
decision, lets them follow each post's `comments:` setting behind one more switch
(`engagement.feedback`, ADR 0089). RD10 adds Third Perspectives, #83 author responses and #226
abuse reports. The roadmap (#92) says all of them go through one policy seam with no second
comment system, and the backlog asks that everything new start switched off. Existing sites must
build exactly as before.

## Decision

- **One closed registry.** `openblog_core::participation::ParticipationKind` lists every kind, with
  a stored id (lowercase letters, digits and hyphens, at most 40 characters, the shape ADR 0088's
  `kind` column accepts) and fixed rules:

  | Id | From | Target | Public when approved | May ask to clarify | Per post |
  | --- | --- | --- | --- | --- | --- |
  | `comment` | reader | the work | yes | no | `comments:` |
  | `question` | reader | a passage | yes | yes | yes |
  | `source-suggestion` | reader | a passage | yes | yes | yes |
  | `correction-suggestion` | reader | a passage | yes | yes | yes |
  | `alternative-interpretation` | reader | a passage | yes | yes | yes |
  | `third-perspective` | reader | the work or a section | yes | yes | yes |
  | `author-response` | an author of the work | an approved item | yes | no | yes |
  | `abuse-report` | reader | an approved item | never | no | no (site-wide) |

  An id this version does not know is refused, never guessed. A new kind (RD11 section responses,
  RD13 future questions and sources) is a new variant with its own row and starts `off`, so no
  existing site changes and, because storage checks only the id's shape, no migration is needed.
- **Modes are the comment modes, for every kind.** `ParticipationMode` is `hidden` (nothing shown
  or accepted), `locked` (approved items shown, nothing accepted) or `open` (approved items shown,
  new items accepted pending moderation).
- **Site settings** live in `openblog.json` under `participation.kinds`, keyed by kind id:
  `off` (the default for every kind: the kind does not exist on the site and no front matter can
  enable it), `hidden`, `locked` or `open` (enabled, and the mode of posts that do not name the
  kind), or `follow-comments` (each post's mode is its `comments:` setting). `abuse-report`
  accepts only `off` or `open`. `comment` is refused here. Unknown kinds, values and fields are
  refused at load. The whole `participation` object is omitted when written while it has its
  defaults, so existing configuration files are unchanged.
- **Post settings** live in front matter as `kind: mode` entries:

  ```yaml
  participation:
    - question: open
    - third-perspective: locked
  ```

  or `participation: [question: open, third-perspective: locked]`. A post may name any kind whose
  rules allow it; `comment` (use `comments:`), `abuse-report`, unknown kinds or modes and a kind
  named twice are build errors. A kind the site has switched `off` may be named and has no effect,
  so turning a kind off site-wide never breaks a build.
- **One resolver.** `participation::effective_mode(config, post, kind)` is the only answer pages,
  manifests and portable output use:
  1. Without a hosted transport (engagement disabled or no endpoint) every kind is `hidden`.
  2. `comment` is `hidden` when `engagement.comments` is off and otherwise the post's `comments:`
     setting: exactly the rule pages used before, now one row of the policy. Comment pages, the
     `openblog-comments.json` manifest and portable output call the resolver.
  3. Any other kind is `hidden` when its site setting is `off`; otherwise the post's own mode if it
     names the kind, else the site default (`follow-comments` reading the post's `comments:`).
- **A published manifest, only once something new is on.** When the site has a transport and at
  least one kind beyond comments is not `off`, the build writes `openblog-participation.json`,
  mapping each post path to the kinds that are not hidden and their modes; a missing kind or post
  means hidden. It holds only public post paths and modes. Otherwise the build output is byte for
  byte what it was.

### How B5's interim rule maps onto the registry

B5's four kinds use the same ids here. Its interim rule, "feedback follows each post's `comments:`
setting, whatever `engagement.comments` says, when `engagement.feedback` is on", is the
`follow-comments` site setting. When B5 merges with this policy:

- `engagement.feedback: true` is read as `follow-comments` for each of the four kinds that
  `participation.kinds` does not name, and `false` (its default) as `off`, so a site that opted in
  to B5 sees no change; naming a kind in `participation.kinds` takes precedence.
- B5's `openblog-feedback.json` (path to mode) is the per-kind column of this manifest; the hosted
  function reads the kind's mode from `openblog-participation.json` instead, with a missing entry
  meaning hidden, as B5 already treats a missing manifest.
- B5's `FeedbackKind` stays the registry of its submission format (ADR 0087); every `FeedbackKind`
  id must be a `ParticipationKind` id, and the merge adds a test that asserts it.

## Considered options

- **Per-kind boolean switches beside `engagement.comments`.** Rejected: a second shape for every
  kind, and no way to say "enabled, but only on the posts that ask".
- **Let a post enable a kind the site has off.** Rejected: a single front-matter line would open
  hosted submissions the owner never chose, which is not a conservative default.
- **Move comments into `participation.kinds`.** Rejected: two settings for one thing, and existing
  `engagement.comments` and `comments:` must keep their meaning.

## Consequences

- Owners turn on one kind at a time, site-wide by default or post by post, and nothing new is
  accepted anywhere until they do.
- Third Perspectives (#221), author responses (#83), passage feedback (B5) and abuse reports (#226)
  plug into the same resolver and manifest; the hosted function adopting the manifest is part of
  those tasks.
- Moderation of what each kind receives is one state machine (ADR 0101), with one role model
  (ADR 0102) and one retention and audit policy (ADR 0103).
