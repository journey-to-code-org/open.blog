# ADR 0721: An adapter is used only under a manifest that reads and does the request, and anything unknown fails closed

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#381](https://github.com/journey-to-code-org/open.blog/issues/381)
- Story: #389 (task DIST1.1.2)

## Context

A manifest (ADR 0720) is only useful if the code that sends something consults it, and only safe if an unknown or
unsupported capability can never be guessed at. Two adapter seams exist already and must not gain a parallel one: the
hosted delivery worker's adapter interface (`netlify/lib/social-delivery.mjs`, ADRs 0317 and 0319), and the
cross-posting adapters behind `openblog syndicate` (`crates/openblog-cli/src/syndication.rs`).

## Decision

- **A request is checked against its destination.** `DistributionRequest` names the capabilities a distribution asks
  for (parsed from a closed list; one unknown name refuses the whole list with `unknown-capability`), and optionally
  its text length, tags, request size and schedule lead time. `ProviderManifest::check` returns every
  destination-specific `Ineligibility`, in a fixed order: `capability-manual`, `capability-unsupported`,
  `text-too-long`, `too-many-tags`, `tag-too-long`, `body-too-large`, `schedule-not-requested`, `schedule-too-soon`,
  `schedule-too-far`. Empty means eligible. Only `adapter` support passes: a manual capability is reported so the
  author can be guided, never performed or skipped silently. Messages name the provider's label, the capability and
  the declared limit, never the author's content.
- **The social adapter interface gains `manifest`, and registration is gated by it.** `socialAdapters` registers a
  provider's adapter only when the provider is configured (unchanged, ADR 0319) *and* `admittedManifest` reads its
  manifest, finds it is the social manifest of that very provider, and finds that the adapter does every
  announcement need (`link`, `text`, `schedule`). The adapter is then registered as `{ provider, manifest, publish,
  reconcile? }`. A manifest that is missing, malformed, of a later format, of another provider, or narrowed below an
  announcement's needs leaves the provider with no adapter, so its announcements wait in the queue (ADR 0317) instead
  of being sent on a guess. Manifests are injectable for tests; the default is the shipped ones.
- **The cross-posting plan is checked before any request.** `validate_plan` checks each remote target's built-in
  manifest for `article`, plus `draft` unless the run publishes, after the existing opt-in and draft-only checks, and
  refuses the run with the destination's sentence and "No request was sent." The manual Medium workflow sends
  nothing and is not checked. Every shipped adapter passes, so no existing run, dry-run output or JSON plan changes.
- **Two halves, one contract.** `netlify/lib/social-capabilities.mjs` reads, refuses and checks exactly as
  `openblog_core::provider_manifest` does, so the hosted function never depends on the Rust side having checked first.

## Considered options

- **Warn and continue on an unknown capability.** Rejected: the epic requires default-deny, and a warning in a
  worker's log is not something an author sees.
- **Let the worker check each announcement against the manifest.** Not needed today: every announcement asks for the
  same three capabilities, so checking once at registration is equivalent and keeps the worker unchanged. A later
  story that sends images will check per post.

## Consequences

- A wrong manifest turns a provider off; it cannot widen what an adapter does.
- No credential, environment value or provider text is read or produced by the check.
