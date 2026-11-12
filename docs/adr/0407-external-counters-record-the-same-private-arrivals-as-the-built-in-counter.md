# ADR 0407: External counters record the same private arrivals as the built-in counter

- Status: Accepted
- Date: 2026-11-11
- Parent epic: [#615](https://github.com/journey-to-code-org/open.blog/issues/615)
- Stories: [#616](https://github.com/journey-to-code-org/open.blog/issues/616), [#620](https://github.com/journey-to-code-org/open.blog/issues/620)
- Builds on: [ADR 0404](0404-visits-are-attributed-only-to-a-fixed-list-of-destinations-and-campaign-tags-are-opt-in.md)

## Context

The built-in counter attributes a counted view to a fixed destination when its campaign tag or referring host
names one. The Cloudflare Worker and the hosted engagement function also count views, but their exports omit
arrivals, so **Where it went** cannot show the same estimate for those sites. Mastodon visits are not recognized
by their referrer because every instance has its own hostname.

## Decision

- One source of truth: `openblog_core::outcome` owns the fixed destination vocabulary, fixed referring-host table,
  host matching rules and campaign-source rules. The Cloudflare Worker and the hosted function carry a generated
  JavaScript block from that source. Shared fixture tests run the same cases through Rust and both JavaScript copies;
  a parity test fails if either generated block drifts.
- A counted view is attributed to the known `utm_source` only when campaigns are on; otherwise, or when the value
  is unknown, the referring host is checked. Only a fixed destination id can become a stored key. A view not
  counted because of DNT, GPC or rate limiting is not attributed.
- A generated counter stores aggregate arrivals per day, destination and page. A day without any arrival keeps its
  prior shape. The export adds those maps only where present and stays version 1. Import replaces a named source's
  snapshot, drops unknown destination keys and merges counts without double-counting repeated pulls.
- The hosted engagement function adds nothing until the deployer runs the additive `supabase/arrivals.sql` schema
  and sets `OPENBLOG_ARRIVALS_ENABLED=true`. Its export is private behind `OPENBLOG_ADMIN_API_KEY`. If arrival
  storage fails after the view was recorded, the view still succeeds and the function logs the failure.
- `analytics.fediverseHosts` is an optional list of at most 20 normalized bare host names. These and the configured
  `OPENBLOG_SOCIAL_MASTODON_INSTANCE` map to `mastodon`; external counters read them through the bounded
  `OPENBLOG_ANALYTICS_OWN_HOSTS` setting. The built-in counter reads the same hosts directly from configuration.
- **Where it went** uses arrivals from the built-in counter and every pulled source, even if the built-in counter
  is off. Visits remain estimates; open.blog does not ask a destination for its own statistics.

## Consequences

- Authors can compare where readers arrived from regardless of whether the built-in counter or a supported hosted
  counter recorded the view.
- The Worker and hosted function need their attribution settings refreshed when the site's campaigns, target
  endpoints, fediverse hosts or social Mastodon instance change. `openblog analytics attribution` prints them.
- A hosted function deployment without the opt-in migration keeps its existing behavior and data shape.
- `supabase/arrivals-rollback.sql` removes only the arrivals table and functions; existing view data is untouched.
