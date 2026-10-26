# Hosted comments and analytics

## Problem

Static Netlify deployments cannot use the local `openblog serve` comment or analytics state. Site
owners need a deployable persistence path without exposing database credentials in generated pages,
and they need one Admin surface for the public endpoint and the private moderation credential.

## Solution

Add a first-party Netlify Function backed by Supabase. The function owns the database seam and reads
all database credentials from the Netlify environment. Public pages talk only to the function. New
comments are moderated by default; the existing privacy-respecting view element uses the same
function. Admin stores the public endpoint in `openblog.json` and a write-only moderation token in
`.openblog/private`, with a server environment variable taking precedence.

## User stories

1. As a reader, I want to read approved comments on a post, so that I can follow its discussion.
2. As a reader, I want to submit a name and comment, so that I can participate without creating an account.
3. As a reader, I want clear pending and failure states, so that moderation is not mistaken for data loss.
4. As a site owner, I want comments pending by default, so that untrusted text is never published automatically.
5. As a site owner, I want token-authenticated moderation endpoints, so that only someone holding my server secret can approve or reject comments.
6. As a site owner, I want view analytics persisted in Supabase, so that Netlify deploys do not lose counts.
7. As a privacy-conscious reader, I want DNT and GPC honored, so that opting out prevents a view event.
8. As a site owner, I want Supabase credentials to remain server-only environment values, so that static assets cannot disclose them.
9. As an Admin user, I want to configure the public function endpoint and a write-only moderation token, so that hosted engagement can be managed without editing JSON or private files.
10. As an Admin user, I want the existing Analytics screen to use hosted data when configured, so that local and Netlify deployments retain one dashboard.
11. As a deployer, I want a checked-in SQL migration and environment-variable guide, so that setup is repeatable.

## Implementation decisions

- Add `engagement` configuration with `enabled`, `comments`, and `endpoint`. The endpoint is public
  and contains no credentials. When enabled, rendering adds one `<ob-comments>` element per post and
  points both comments and view counts at the same endpoint.
- Add a dependency-free progressive-enhancement comments component. It renders returned text only
  through DOM text nodes, bounds input client-side, and works without cookies or local identifiers.
- Add a dependency-free Netlify Function with `/comments`, `/hit`, `/views`, `/admin/comments`, and
  `/admin/analytics` operations. It validates origin, site id, paths, sizes, status values, and JSON.
- Supabase access uses REST/RPC calls authenticated with `SUPABASE_SECRET_KEY` in the `apikey`
  header, without treating the secret key as a bearer JWT. `SUPABASE_SERVICE_ROLE_KEY` remains a
  legacy fallback with JWT bearer authentication; the new variable takes precedence.
  Required environment values are `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or the legacy fallback), `OPENBLOG_SITE_ID`,
  `OPENBLOG_SITE_ORIGIN`, `OPENBLOG_ADMIN_API_KEY`, and `OPENBLOG_ANALYTICS_SALT`.
  `OPENBLOG_SITE_BASE_PATH` is optional for sites published below the origin root.
- Comment moderation and hosted Admin analytics require `Authorization: Bearer <token>` and compare
  against `OPENBLOG_ADMIN_API_KEY` without returning either token or database credentials.
- New comments have `pending` status. Public reads return only `approved` rows.
- Analytics persists daily aggregates and date-scoped visitor hashes. It never stores raw addresses,
  raw user-agent strings, cookies, or cross-day identifiers.
- Admin stores its matching hosted API token using the existing private-credential protection model
  and binds that credential to the endpoint origin. Endpoint changes fail closed until the token is
  explicitly replaced. An `OPENBLOG_ENGAGEMENT_API_KEY` server environment value overrides the
  private copy when `OPENBLOG_ENGAGEMENT_API_ORIGIN` matches the configured origin. Admin proxy
  requests do not follow redirects.
- Supabase-backed per-client and per-site hourly quotas reject excessive public comment and
  analytics writes before storing content or view events.
- The local built-in analytics store remains the default and remains available when hosted
  engagement is disabled.

## Testing decisions

- Exercise the Netlify handler through HTTP-shaped events with a fake Supabase fetch seam.
- Verify public versus authenticated routes, origin checks, bounds, rate limiting, pending
  moderation, secret non-disclosure, and analytics privacy fields.
- Verify rendering and configuration defaults in core tests.
- Exercise comment submission and text-only rendering through the mounted web component.
- Exercise Admin settings through authenticated/CSRF-protected routes and browser settings controls.
- Run the full Rust, browser, documentation-link, formatting, lint, and locked release-build gates.

## Typed passage feedback

The same function carries typed scholarly feedback (questions, suggested sources, suggested
corrections and other interpretations of a passage) as an opt-in extension of this seam, not a
second comment system. The submission format and kinds are [ADR 0079](../adr/0079-typed-scholarly-feedback-kinds-and-one-submission-format.md),
the additive `openblog_feedback` table and its rollback are [ADR 0080](../adr/0080-hosted-feedback-is-one-additive-private-table.md),
and the transport, its double opt-in, quotas and fallback are [ADR 0081](../adr/0081-hosted-feedback-transport-is-opt-in-and-reuses-the-engagement-seam.md).
The reader form on each open post, its passage data and its copy-and-send fallback are
[ADR 0082](../adr/0082-passage-feedback-forms-are-one-progressive-region-over-the-build-passage-text.md).
Moderation, author responses, revision notes and the published notes are
[ADR 0083](../adr/0083-feedback-moderation-is-version-checked-and-approved-notes-publish-from-a-versioned-file.md):
`PATCH /admin/feedback` takes `{id, action, from, expectedVersion, reason?, actor?}` and applies
the change with its audit event only while the item still has that state and version (`409`
otherwise), and approved notes are published from `content/reader-feedback.json`, never read back
from the hosted service by a build. Comments, their table and their routes are unchanged.

Evidence submissions and correction decisions (RD6) extend the same two kinds rather than adding a
third: a suggested source or correction may carry a version 2 evidence block naming the published
claim, evidence link, citation or source it concerns
([ADR 0138](../adr/0138-evidence-submissions-are-suggested-sources-and-corrections-with-unverified-reader-evidence.md)),
and only the author's correction decision, separate from moderation and kept in an append-only
log per item, can label one a correction
([ADR 0139](../adr/0139-only-the-authors-correction-decision-labels-a-correction.md)). The hosted
function refuses version 2 until #217 adopts it.

## Out of scope

- Reader accounts, email collection, avatars, reactions, notifications, nested replies, rich-text
  comments, automatic spam scoring, CAPTCHA, real-time subscriptions, and multi-tenant management UI.
- Storing Supabase service-role credentials in `openblog.json`, Admin browser storage, generated HTML,
  or the repository.
- Automatic Netlify environment mutation; Admin explains the required server values but does not
  call Netlify's management API.
