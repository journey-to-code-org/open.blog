# ADR 0409: A transcript is required to publish an audio episode

- Status: Accepted
- Date: 2026-11-12
- Builds on: [ADR 0408](0408-audio-episodes-use-verified-author-owned-sources.md)

## Context

Readers need access to the words even when they cannot listen; checking only
the player leaves publication surfaces able to bypass that requirement.

## Decision

The shared publication check requires a nonempty Transcript section or a
readable bounded plain-text or WebVTT file. Builds, check, Admin saves and
Git Publish use the check. Drafts may be incomplete with warnings. AI
transcription remains optional and explicitly consented.

## Consequences

The check establishes presence and basic readability, not fidelity. Authors
must review transcripts and hosting; unavailable evidence blocks publication.
