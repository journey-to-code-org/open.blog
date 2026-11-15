# ADR 0413: Co-writer accounts reach only the collaboration routes

- Status: Accepted
- Date: 2026-11-14
- Changes: [ADR 0007](0007-private-shared-publication-records.md) (for co-writers: "any signed-in Admin user may pick any key")
- Spec: [Studio R14, G110 and G111](../specs/studio/r14/ux.md#server-gaps)

## Context

Every Admin account was a full Admin: `users.json` held `{ name, hash }` and roles existed only per
shared reflection. Inviting a sister to write together meant giving her the whole Admin: settings,
social accounts, the writing helper's key, every post. Hiding buttons in Studio would not change that:
the routes would still answer.

## Decision

- An account may carry `kind: "co-writer"`. Absent is an owner account, so every account made before
  is unchanged. `openblog user add --co-writer <name>` makes one; `openblog user list` says which.
- The server reads the kind from the users file on every request. A co-writer session may call only
  the routes in `CO_WRITER_ROUTES` (`crates/openblog-cli/src/admin/together.rs`): its session and sign-out,
  a reduced `meta`, and the collaboration routes, each of which still authorizes by the reflection's
  own record. Every other Admin API route answers **403** `owner-only`, checked in `preflight` (so no
  body is read) and again before the CSRF check and before any handler.
- The list is an allowlist. A route-table test reads the router itself and fails when a route is in
  neither `CO_WRITER_ROUTES` nor the owner list (`together_owner_routes.in`), so a new route is never
  reachable by a co-writer by accident.
- Starting a reflection, publishing, scheduling, making a collection, putting one away, looking up a
  link on another site, and inviting someone new are owner accounts' only; the scheduler checks again
  that the account that scheduled a reflection is still an owner's.
- A co-writer's `meta` holds only `account`, `siteTitle`, `siteUrl`, `studioWords`, `now` and `together`.
  A combined preview's document opens only for the sign-in it was made for.

## Consequences

- Co-writers see Writing together and nothing else; their Home is it. Studio hides the rest too, but the
  safety is the server's.
- The answer is 403, not the 404 an unrouted path gets: the owner of the blog decided it (2026-11-14), so a
  refused route says so plainly in Mikey's details.
- The R10 author-response routes stay owner-only until a co-writer screen needs them.
