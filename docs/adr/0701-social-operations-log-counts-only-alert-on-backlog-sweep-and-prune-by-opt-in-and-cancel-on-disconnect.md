# ADR 0701: Social operations log counts only, alert on backlog, sweep and prune by opt-in, and cancel on disconnect

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#353](https://github.com/journey-to-code-org/open.blog/issues/353)
- Story: #359 (task #377)

## Context

Delivery runs unattended every minute (ADR 0317). An operator needs to know when it stops (the queue grows late), when
work is stuck (expired leases, outcomes waiting for a person, accounts that need reconnecting), and needs history to
end eventually. Until now nothing was logged at all, because an error could carry a request and a request carries
credentials; nothing was ever deleted; and disconnecting an account left its scheduled announcements to fail one by
one at delivery time, although a disconnected account can never post again (it is connected as a new account,
ADR 0300).

Provider terms bear on retention. Meta's Platform Terms (section 3.d.i) require deleting Platform Data when keeping
it is no longer necessary for a legitimate business purpose, when the user asks, or when the user no longer has an
account with you (https://developers.facebook.com/terms/, read 2026-10-29). LinkedIn's API Terms of Use (sections 4.1
and 4.4) allow storing content only for as long as the application needs it and require deleting it, tokens included,
when a member asks or closes their account (https://www.linkedin.com/legal/l/api-terms-of-use, read 2026-10-29).
Neither sets a fixed period, so the period is the deployer's decision.

## Decision

- **Log lines are built from an allow-list of shapes.** `netlify/lib/social-ops.mjs` `logEvent` writes one JSON line
  whose fields can only be whole numbers, booleans, short codes (`^[a-z][a-z0-9-]{0,39}$`), lists of codes, or objects
  of those two levels deep; anything else is dropped, whatever the caller passed. The worker logs one
  `openblog-social-worker` line of counts per run. A token, a caption, a name, an address or provider text cannot
  reach a log because no such value has an allowed shape.
- **Operations are an opt-in SQL file plus a switch.** `supabase/social-ops.sql` adds three functions, nothing else:
  `openblog_social_health` (counts: due, overdue past the alert threshold, in flight, expired leases, retrying,
  unknown waiting for a lookup or for a person, failed in the last day, accounts needing reconnect or paused, abandoned
  handshakes), `openblog_social_sweep` (reaps expired leases with the claim's rule, ADR 0316, and expires handshakes
  left open past their time, erasing any sealed tokens) and `openblog_social_prune`. With `OPENBLOG_SOCIAL_OPS=true`
  each worker run sweeps, reads health and logs an `openblog-social-ops` line, at `warn` level when there is an alert
  (`backlog-overdue`, `expired-leases`, `provider-not-configured`, `accounts-need-reconnect`, `needs-review`,
  `failed-recently`, `stale-connections`), so a log drain or alert rule can page on it. A missing install or a storage failure is
  reported as a code and never fails delivery. Off by default: the worker's reply and behaviour are unchanged.
- **Late means late for the claim.** `due`, `overdue` and the oldest due time use the claim's own rule (ADR 0316):
  an announcement whose account is paused after a rate limit, or whose provider has no adapter (the same
  `p_skip_providers` the claim takes, computed from the deployment's provider settings by both the worker and Admin),
  is held back on purpose and is counted apart as `waiting_on_pause` or `waiting_on_provider`. A pause raises no
  alert, since it ends by itself; a provider without an adapter raises `provider-not-configured`, because it never
  does. So `backlog-overdue` means only that the worker is not taking work it could take.
- **Admin shows the same health.** `GET announcements/health` (admin key only, this site only) returns counts and alert
  codes, or `installed: false`; Admin rebuilds it from known fields and the Social screen shows it as sentences, or a
  hint to run the file. Reading it changes nothing.
- **Retention is opt-in and narrow.** Only with `OPENBLOG_SOCIAL_RETENTION_DAYS` (30 to 3650) as well, each run calls
  `openblog_social_prune`, which deletes at most 200 announcements per call that ended (published, failed or canceled)
  before the period, with their attempts and recorded history; finished handshakes; and disconnected accounts that
  nothing refers to any more, with their revoked credential row. It never touches anything scheduled, in flight or
  unknown. The service role has no delete grant (social.sql), so this one function is `security definer` with a fixed
  search path, checks the site and the period itself, and only `service_role` may execute it. This is a one-way door,
  so it is off unless asked for and refuses less than 30 days.
- **Disconnect cancels the account's scheduled announcements.** After the tokens are erased, each `scheduled`
  announcement of the account is set to `canceled` with the code `account-disconnected`, fenced by its version and
  status like an author's cancel. A claimed one is left to the worker, which fails it without sending because the
  tokens are gone; an `unknown` one stays for the author to check. It is best effort: a storage failure leaves the
  disconnect done and the count unreported, and a second disconnect retries. Admin says how many were canceled.

## Consequences

- Rollback: `supabase/social-ops-rollback.sql` drops the three functions and touches no row; what retention already
  deleted stays deleted. `social-rollback.sql` drops them too.
- A deletion request from a person is still a manual step; the operations runbook in `docs/social-publishing.md` gives
  the SQL.
- The health route reads several counts per call; it is only called when an author opens the Social screen.
