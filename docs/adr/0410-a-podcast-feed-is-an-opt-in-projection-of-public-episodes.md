# ADR 0410: A podcast feed is an opt-in projection of public episodes

- Status: Accepted
- Date: 2026-11-12
- Builds on: [ADR 0408](0408-audio-episodes-use-verified-author-owned-sources.md),
  [ADR 0409](0409-a-transcript-is-required-to-publish-an-audio-episode.md)

## Context

Listeners should be able to subscribe without surrendering the author's audio
or changing the output of sites that do not use podcasts.

## Decision

An optional versioned configuration generates RSS 2.0 with Apple and
Podcasting 2.0 metadata. Only public episodes enter the feed; the first audio
source is its enclosure and the episode page URL is its GUID. The author
submits the public feed to directories by hand.

## Consequences

Changing the episode URL changes its GUID. The first source must meet each
directory's format and hosting rules. A successful build does not certify
artwork, decode the file, validate directory policy or guarantee approval.
