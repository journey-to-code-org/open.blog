# ADR 0414: Invite a new person by link, and they choose their own password

- Status: Accepted
- Date: 2026-11-14
- Builds on: [ADR 0013](0013-publication-scoped-invitations.md), [ADR 0413](0413-co-writer-accounts-reach-only-the-collaboration-routes.md)
- Spec: [Studio R14, G112 and G119](../specs/studio/r14/ux.md#join-togetherjoin)

## Context

Inviting someone needed an existing sign-in name, which only the developer could make, on the command
line. The owner wants to invite a sister by name and send her a link herself.

## Decision

- `POST collaboration/invitations` takes `newAccount: { signInName }` (owner accounts only). The server
  reserves a co-writer account under that name with no password, which cannot sign in, and invites it
  in the same transaction; if the invitation is refused, the reservation goes with it. A reserved
  account whose invitation is withdrawn, declined or expired, and that no reflection binds, is
  released.
- The link opens Studio's join page, `/admin/studio/#/together/join/<token>`. The token is in the
  fragment, so it never reaches the server's log, and Studio takes it out of the address and history
  before its first request and keeps it only in memory. The old `/admin/#/shared/accept/<token>` form
  opens the same page.
- `GET collaboration/invitations/join` (token in the `X-Openblog-Invitation` header, never a query; no
  session) says whose invitation it is, for which reflection, under which name, and whether a password
  is to be chosen. `POST collaboration/invitations/join { token, password }` sets the password, accepts
  the invitation and starts a session in one step; if the reflection can't be stored, the password is
  taken back. `{ token, decline: true }` says no thanks. Only a reserved account joins this way, so a
  link can never set an existing account's password. Every refusal is the same `404`
  `invalid-invitation`; five tries per address and per reflection in a window, refunded on success.
- Links are single-use (the hash is cleared on accept, decline or withdraw) and expire (7 days unless
  chosen, 1 to 30). Nothing is emailed.

## Consequences

- An owner can invite anyone from Studio; a co-writer who helps run a reflection can invite only other
  co-writer accounts.
- `users.json` may hold an account with an empty hash while an invitation waits. It can never sign in.
