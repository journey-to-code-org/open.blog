# ADR 0328: A destination preview is the run's own portable projection, checked against its manifest

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#381](https://github.com/journey-to-code-org/open.blog/issues/381)
- Story: #390 (task DIST1.2.1)

## Context

Epic #381 asks for a deterministic portable projection per destination, with the exact canonical address and
destination-specific errors, before anything is sent. The pieces already exist but are scattered:
`PortableProjection` (ADR 0004) produces the portable Markdown and HTML; the destination policies, content, tag and
payload plans say how a cross-posting target converts it; the provider manifests (ADRs 0325 to 0327) say what each
destination's adapter can do. `openblog syndicate` prints parts of this, and `--json` prints the before and after,
but neither says, per destination, "this is exactly what goes there, and this is why it can or cannot".

## Decision

- **One core model, no second projection.** `openblog_core::distribution` holds a `DestinationPreview` per chosen
  destination and a `DistributionPlan` over them. The CLI fills a preview with exactly the string the adapter would
  send (the same `SyndicationPost` Markdown or HTML that `--json` and `--write` use, chosen by the destination
  policy's representation), so a preview cannot drift from the request. Nothing re-renders or re-parses output.
- **What a destination is asked comes from the run.** The intent is `draft`, `published` (both `--publish` and the
  target's `allowPublish`) or `manual` (Medium). It asks for `article`, plus `draft` for a draft and `image` when the
  content plan keeps images, and carries the selected tag count, the longest tag and, for Hashnode, the request size.
  `ProviderManifest::check` turns that into the destination's ineligibilities (ADR 0326).
- **Destination-specific reasons, all at once.** Besides the manifest's codes, a preview lists the reasons a run
  would already refuse before any request: `target-not-ready` (the same sentence `validate_plan` uses: a missing
  endpoint, publishing not allowed, a draft-only destination) and `conversion-blocked` (a blocking content, tag or
  payload finding). Its status is `ready` (no reason), `manual` (only manual capabilities: the guided workflow, with
  the step to take) or `blocked`.
- **Digests bind what the author sees.** A destination digest (BLAKE2b, 128 bits, length-prefixed fields) covers the
  target name, provider, format, intent, canonical address, capabilities, content and every other field the
  request carries (title, description or excerpt, subtitle, slug, tags, each list item by item, under the request's
  own field names), so an approval covers everything a write sends. The preview shows those fields beside the
  content, and a test holds each provider's previewed fields to its request builder. It leaves out the policy
  version on purpose: whether a newer manifest keeps an approval is the compatibility policy's question (ADR 0327).
  The plan digest covers the source id, revision, canonical address, draft or publish, and each destination's name,
  digest and status.
- **The social composer keeps its own preview.** An announcement's preview (`POST /admin/api/social/preview`, ADR
  0309) already shows its exact caption, link and time, and creating it is the author's explicit act; its adapter
  is admitted under its manifest (ADR 0326). It is not folded into this plan in this story.

## Considered options

- **Render previews in Admin from the editor preview.** Rejected for this story: the editor preview is of unsaved
  text and has no target configuration, so it cannot say what a configured run would send. It keeps its
  per-destination mode and acknowledgements.
- **Include the policy version in the destination digest.** Rejected: every compatible provider upgrade would then
  void approvals that ADR 0327 says stand.

## Consequences

- One plan answers "what goes where, and can it" for every cross-posting destination, from the same code that sends.
- Nothing in a build, feed or export reads the plan.
