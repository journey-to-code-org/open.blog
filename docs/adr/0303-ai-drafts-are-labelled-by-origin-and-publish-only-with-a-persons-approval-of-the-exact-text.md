# ADR 0303: AI drafts are labelled by origin and publish only with a person's approval of the exact text

- Status: Accepted
- Date: 2026-10-27
- Decision issue: [#88](https://github.com/journey-to-code-org/open.blog/issues/88)
- Parent story: [#31](https://github.com/journey-to-code-org/open.blog/issues/31)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0301](0301-interpretations-disagree-without-a-ruling-and-attribution-is-required.md), [ADR 0302](0302-an-audience-explanation-is-a-supplement-for-one-level-and-never-replaces-canonical-prose.md)

## Decision

- **Origin is stated, never inferred.** An interpretation or explanation has `origin`: `author` (the
  default, which a file may omit) or `ai-draft` with the author's label for the `tool` and an optional
  `draftedAt`. Nothing in this repository calls a model; the field records what the author says.
- **Approval is explicit and bound to the text.** `approval` holds `by` (the person), `at` and
  `digest`, a Blake2s digest over the item's kind, id and the text approved (the statement or the
  explanation text). Editing the text changes the digest, so the approval is *stale* and the item is
  withheld until a person approves again. The digest covers the text only: origin, tool and time are
  the label, not the thing approved.
- **Standing.** `Authored` (the author's own words; publishing the comparison is their approval),
  `Approved`, `AwaitingApproval`, `Stale`. In a published file an AI draft with no approval, or with a
  stale one, is refused. In a draft file both are allowed as work in progress.
- **Withheld, not shown, not named.** The public projection (ADR 0304) omits an unapproved or stale
  item and everything depending on it. The author-facing `Withheld` list says which and why. The
  public value never says that something was omitted.
- **The label travels.** An approved AI draft projects as `origin: ai-draft` with the tool and the
  approver, so a renderer cannot present it as the author's own prose, and an AI explanation is never
  presented as evidence.

## Consequences

- A person's approval is auditable in the file and in review.
- Nothing is published on a model's output alone, so no one-way door is opened.

## Domain language

**AI draft** and **Approval** are defined in [`CONTEXT.md`](../../CONTEXT.md).
