# ADR 0331: Social publishing is an opt-in outward announcement beside canonical Markdown, with a server-only threat model

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#353](https://github.com/journey-to-code-org/open.blog/issues/353)
- Story: #360 (task #379)

## Context

Scheduled social publishing was built in five stories, each with its own decision records: identity and scope
(ADR 0293), the schema (0294), token encryption (0295), the OAuth handshake (0299), destinations (0300), the Admin
pages (0301, 0308 to 0310), the queue and worker (0316 to 0318), the adapters (0319 to 0321), and status and
operations (0323, 0324). Each one is narrow. None of them says in one place how the feature sits beside the rest of
open.blog, what it must never change, and what an attacker could reach with each secret. A self-hosting owner who
wants to turn it on needs that picture, and a later story (Instagram, X, a Supabase Edge port) needs the rules it
must keep. The epic asks for exactly this: canonical Markdown, the existing syndication, an optional feature, a
Rust-native UI and the Supabase identity and secret threat model.

## Decision

### What the feature is, and what it never is

- **Canonical Markdown stays the only source of a post.** Social publishing reads a post only to find whether it is
  public and to build its canonical link from `url` in `openblog.json` (ADR 0308). It never writes to `content/`,
  `openblog.json`, a build, a feed, an export or the repository. The hosted code cannot: no `netlify/lib/social-*`
  or `netlify/functions/social*` module imports a file system API, and a test keeps it that way.
- **An announcement is a link, not a copy.** Cross-posting (syndication, `docs/cross-posting.md`) publishes the whole
  article elsewhere with a canonical link back. An announcement is a short caption plus the canonical link, sent to
  a LinkedIn identity or Facebook Page. The two never share state, settings or code paths: `openblog syndicate`
  plans are byte for byte the same with and without every social setting, and a post whose `canonical` points to
  another site is not announced (ADR 0308).
- **Off unless switched on at three independent places.** Each switch is separate and each is reversible:

  | Switch | Where | Off means |
  | --- | --- | --- |
  | `OPENBLOG_SOCIAL_ENABLED=true` plus valid settings | the hosted functions | every hosted social route and the worker answer 404 and touch nothing |
  | `OPENBLOG_SOCIAL_ENDPOINT` and `OPENBLOG_SOCIAL_ADMIN_KEY` | the machine running `openblog serve --admin` | Admin has no Social entries and its routes say how to turn the feature on, without a network call |
  | `supabase/social-cron.sql` and the Vault secrets | the Supabase project | nothing wakes the worker; announcements wait |

  There is no fourth flag in `openblog.json`, on purpose: a setting in the site file would be committed, built and
  exported, and the feature has nothing to say to a static build.
- **The UI is the Rust Admin and native Web Components.** The Social accounts page and the Announcements tab are
  served by the Rust Admin and call only `/admin/api/social/*` (session, CSRF, deny by default). No Next.js client,
  no Supabase client library and no Supabase address are in any browser bundle; a test scans `web/` for them.

### Threat model

The assets are: provider access and refresh tokens; the token encryption keys; the Supabase secret key; the admin
and worker keys; the provider client secrets; the queue and its history; and the author's own unpublished content.

| Who or what | What they hold | What they can do | What stops more |
| --- | --- | --- | --- |
| A reader or crawler | the public site | nothing social: no page, feed or bundle carries a social setting or address | builds are identical with and without the settings (test); `web/` has no Supabase client (test) |
| A browser with an Admin session | an Admin cookie | what the Admin routes allow, as that user | Admin session, CSRF and per-route authorization run first; replies are rebuilt from known fields, never a token (ADR 0301) |
| Someone with the database dump or `service_role` | rows | read captions, schedules and history; tokens stay sealed | tokens are envelope-encrypted with keys only in the function environment (ADR 0295) |
| Someone with the worker key | the worker URL | run a batch of due work early; nothing else | the key is accepted only on `/api/social-worker`, may name no site or actor, and is refused on author routes (ADR 0293, 0317) |
| Someone with the admin key | the social function | act as an author for this one site, attributed to whoever they name | the key is compared by digest, never equals a public key, and every query is bound to the server's site scope (ADR 0293) |
| Someone with a token encryption key alone | nothing | nothing without the database rows | both halves are needed |
| A compromised provider reply | the HTTP answer | influence one announcement's status | provider text is never stored, logged or rendered; only fixed codes and the post id are kept (ADR 0319) |
| `pg_cron` / `pg_net` | the Vault secrets | call the worker with its key | the ping function is owner-only, https-only and needs a key of 32 or more characters (ADR 0317) |
| Logs and error reports | log lines | read counts and short codes | log lines are built from numbers, booleans and fixed codes only (ADR 0324) |

Accepted residual risks, stated so nobody mistakes them for guarantees:

- Every Admin user may manage the site's social accounts (single-site, trusted-Admin model, ADR 0293).
- A person holding both the `service_role` key and the token keys can read every token. Keep the token keys in a
  different secret store from the database credentials, and rotate them as the guide describes.
- Tokens erased by a disconnect or a rollback stay valid at the provider until revoked there.
- The Facebook unknown-outcome lookup and LinkedIn's lack of one mean some outcomes need a person (ADR 0318).

### Release gates

Before a release that touches social publishing, these automated checks must pass; CI runs all of them:

1. Builds, feeds, portable exports, cross-posting plans and offline authoring (`openblog new`, `openblog check`) are
   byte for byte identical with and without every social setting, and none of the secret values appears in them
   (`crates/openblog-cli/tests/social_opt_in.rs`).
2. With no settings, every hosted social route and the worker answer 404 without a single outgoing call; a half
   enabled value (`TRUE`, `1`, `yes`) is off (`tests/web/social-architecture.test.mjs`).
3. No browser file carries a Supabase client, a Supabase address or a hosted social route, and no social hosted
   module imports a file system API (the same test).
4. The documentation, settings, SQL and provider versions agree (ADR 0332, `tests/web/social-release-gates.test.mjs`).

## Considered options

- **A feature flag in `openblog.json`.** Rejected: it would be committed and built, could be turned on without the
  hosted settings it depends on, and would make a static build depend on a hosted feature.
- **Treat announcements as a new syndication provider.** Rejected: syndication copies the article and has its own
  plan, ids and canonical rules; an announcement is a scheduled link with delivery uncertainty, leases and
  provider tokens. Sharing the path would put tokens next to the publishing pipeline.
- **Supabase Auth and RLS for the author.** Rejected in ADR 0293 and not reopened here.

## Consequences

- A new provider, or moving the hosted code to a Supabase Edge Function, must keep all three switches, keep the
  release gates green and add its own row to the threat model.
- The release gates are tests, so a regression fails CI instead of relying on a reviewer's memory.
