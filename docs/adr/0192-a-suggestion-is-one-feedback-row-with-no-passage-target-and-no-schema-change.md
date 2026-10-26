# ADR 0192: A suggestion is one feedback row with no passage target and no schema change

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#213](https://github.com/journey-to-code-org/open.blog/issues/213)
- Parent story: [#204](https://github.com/journey-to-code-org/open.blog/issues/204)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0080](0080-hosted-feedback-is-one-additive-private-table.md), [ADR 0113](0113-third-perspectives-are-one-feedback-row-submitted-through-the-one-route-with-a-receipt.md), [ADR 0101](0101-one-registry-of-participation-kinds-enabled-per-site-and-post.md)

## Context

The hosted feedback table already stores one row per participation item, with the text in `body`,
the reader's name in two columns, the page in `work`, the receiver's time and a `details` object.
Its `kind` check is a shape (`^[a-z][a-z0-9-]{0,39}$`) and its passage columns are "all three, or
none for a future kind that is about the whole work" ([ADR 0080](0080-hosted-feedback-is-one-additive-private-table.md)).
Release v0.38.1 learned that the inbox must not attach one kind's fields to other kinds, because
the Rust readers refuse unknown fields.

## Decision

- **A suggestion is one row of that table** with kind `future-suggestion`, no passage target,
  revision and anchor (it is not about a passage), `body` the reader's words, `item_revision` the
  text revision, and `details` `{type, url?, hints?, about?, contact?}`. The reader's name stays in
  its two columns, never in `details`. This needs **no migration**: the shape check already accepts
  the id and the passage columns already allow none.
- **`Suggestion::stored_details` and `Suggestion::from_stored` are the only readers and writers
  of that shape**, as strict as a submission. A row that does not read back is refused whole.
- **The inbox does not attach any suggestion field to any other kind**, and does not list this
  kind yet: `Source::holds` leaves `future-suggestion` out until RD13.2 wires the submission route,
  the quota and the inbox listing together, so a row of this kind cannot be stored or shown
  halfway. That change must add the kind's fields to its own projection only.
- **The receiver stamps the receipt**: the page (`work`, a published page path), the time and the
  channel; the reader's clock is not used.

## Consequences

Nothing on the hosted side changes in this task. If RD13.2 finds it needs a column (for example to
index duplicates), that is an additive migration to decide then, not a reason to store the record
elsewhere.
