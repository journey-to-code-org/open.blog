# ADR 0408: Audio episodes use verified author-owned sources

- Status: Accepted
- Date: 2026-11-12

## Context

An audio post needs media that remains under its author's control without
trusting authored sizes or accepting an inaccessible resource.

## Decision

Use a versioned audio mapping with declared duration, sources and chapters.
The host checks local static files or fetches a bounded HTTPS range through the
public-only network resolver. It validates size and signature before publishing.
Admin copies an upload or voice note to public static files only on explicit
action. The native player does not autoplay.

## Consequences

Builds with remote audio require a reachable public storage host that supports
range requests. Header checks are not a decoder and a file can change after
checking. Copied audio is public independently of the post's draft status.
