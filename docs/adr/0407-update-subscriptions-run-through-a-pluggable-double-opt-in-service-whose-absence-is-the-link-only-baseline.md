# ADR 0407: Update subscriptions run through a pluggable double opt-in service whose absence is the link-only baseline

- Status: Accepted
- Date: 2026-10-27
- Decision issue: [#232](https://github.com/journey-to-code-org/open.blog/issues/232)
- Parent story: [#206](https://github.com/journey-to-code-org/open.blog/issues/206)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: ADR 0404

## Context

ADR 0404 fixed what a subscription request and a stored record are, and left transport and the hosted schema to this task. The risks are an address leaking into output or analytics, a form that can tell a stranger who is subscribed, a link that outlives consent, and any dependence on a mail vendor.

## Decision

- **A boundary, not a vendor.** `subscription::SubscriptionService` takes a `Mailer` (send one plain-text message to one address; `None` is a site with no provider) and `Tokens` (ids and tokens from a secure random source). Nothing in the crates knows a provider, reads a secret or opens a connection. With no mailer a valid request gets `Unavailable`, nothing is stored, and the page offers links only (`continuation::offer`). Bundled email, newsletters and tracking stay out of scope.
- **Double opt-in.** A request stores a pending record only after the confirmation message was sent, and a single-use link makes it active within 48 hours. A late or used link, and a pending record past its window (`sweep`), end in erasure of the address. Consent expiry is therefore a deletion, not a flag.
- **No enumeration.** Every valid request is answered `Accepted`, whether the address is new, pending or active; a repeat inside an hour, or for an active subscription, sends nothing. A wrong, used, late or malformed link of any kind gets the same `false`.
- **Minimal event.** An update is the title and canonical link of a later work, in plain text, with the reader's own unsubscribe link: no address, reader text, count, pixel or tracked link, and no claim that anything caused the work. A subscription gets at most one message a day, however many updates wait (10 at most); a failed send keeps them for the next run.
- **Unsubscribe and deletion** erase the whole record, address included, with no account. Each update message carries a fresh unsubscribe token and the last eight stay valid, so an old email still works. Digests only are stored, never tokens. `Debug` of the service and of a message shows no address or token, and a failed send carries no text.
- **Hosted store: additive, behind a flag, reversible.** `supabase/subscriptions.sql` creates one private table (row level security on, no policies, public roles revoked) and six `security definer` functions callable by `service_role` only; it never touches `openblog_feedback`, so no address reaches a moderation export. Tokens come from pgcrypto's `gen_random_bytes` and are stored as SHA-256 digests (the reference service in Rust uses its own digest; the contract is "a one-way digest", not a shared algorithm). `supabase/subscriptions-rollback.sql` drops them all. Nothing is used until `OPENBLOG_SUBSCRIPTIONS_ENABLED` is `true` and a provider is configured.
- **Not in this task:** the Netlify function that calls the SQL and a real `Mailer`, and a rendered subscription form. The static page still has no form, address or count.
- **Scheduling.** `sweep` (expire pending) and delivery run from a scheduled job; the SQL equivalents are `openblog_purge_subscriptions` and `openblog_subscription_recipients`.

## Consequences

A site needs a provider, the flag and the SQL to offer updates, and loses none of its navigation without them. The decision is reversible: removing the flag returns every page to links only, and the rollback file deletes every address.
