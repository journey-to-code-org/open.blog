# ADR 0314: Hosted comment captcha uses Turnstile and a signed tab-session pass

- Status: Accepted
- Date: 2026-10-29
- Parent epic: #296

## Context

Moderation and comment quotas bound spam but cannot distinguish a script from a reader.
Readers should verify once while visiting, with no account and no challenge on page view.

## Decision

Use Cloudflare Turnstile behind a provider-shaped server verifier. Verify success, the site's
hostname and the `comment` action. Bound verification to eight seconds, return a generic failure,
and never log tokens or provider responses. Load the explicit widget only on form interaction.

Exchange a valid challenge for an HMAC-SHA256 pass carrying site ID, random ID and expiry.
The pass expires after 30 minutes and lives in sessionStorage, scoped by endpoint and public key.
Storage denial falls back to page memory. A pass is a bearer credential, never a reader identity;
do not bind it to an IP address. Every comment still consumes the existing quota. Attempts without
a valid pass consume a separate existing SQL quota bucket (20 per client, 2,000 per site per hour).
No SQL migration is needed. Passes cannot be individually revoked; rotating the signing secret
invalidates them all. A newly opened tab with an opener may inherit a browser sessionStorage copy.

Keep the public opt-in and site key in `engagement.captcha`. Independently enforce the opt-in
with `OPENBLOG_CAPTCHA_ENABLED=true` on Netlify: an untrusted browser cannot switch protection off.
Missing provider or signing secrets fail closed. Admin accepts only public captcha fields.
Deploy both settings together; rebuild after changing public configuration.

Keep the existing no-JavaScript fallback, announce states politely, and offer a keyboard-operable
retry. Never reset the form on a failed submission. Local comments and other participation kinds
remain outside this feature.

## Consequences

Turnstile introduces a disclosed third party only when commenting. Blocking it prevents protected
submissions; readers can retain/copy their words and retry. Strict CSP deployments must allow
only `https://challenges.cloudflare.com` for the challenge script and frame. The provider seam can
support alternatives later, while the configuration currently permits only Turnstile.
