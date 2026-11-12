# ADR 0329: An approval binds one previewed plan, and a write that requires one sends only what it covers

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#381](https://github.com/journey-to-code-org/open.blog/issues/381)
- Story: #390 (task DIST1.2.2)

## Context

`openblog syndicate --write` is already an explicit act, but it sends whatever the post is at that moment, which may
differ from what the author reviewed. The epic asks for dry-run artifacts and explicit consent to what was previewed,
and ADR 0327 left "pin each approval to a provider and policy version" to this story. Existing runs must not change
for anyone who does not opt in.

## Decision

- **Dry-run artifacts.** `openblog syndicate <slug> --preview <new folder>` writes, and sends nothing, reads no
  credential and creates no private state:
  - `plan.json`: the `DistributionPlan` (version 1) with each destination's status, reasons, manifest, digest,
    content and the file holding it, and `remoteRequestSent: false`;
  - one file per destination, named `NN-<provider>.<md|html>` (never from the author's target names), holding
    exactly what that destination would receive;
  - `index.html`, the accessible preview (ADR 0330).
  The folder must not exist (a preview never replaces one), must not contain `..` or a symlink, and the run refuses
  `--write` or `--json` with it.
- **Explicit approval of a digest.** `--approve <digest>` rebuilds the plan with the same targets and draft or
  publish choice and records an approval only when the digest is the plan's own (`plan-changed` otherwise), the plan
  has a destination (`nothing-to-approve`) and none is blocked (`destination-blocked`). It records the source id,
  revision, canonical address, publish choice, plan digest, time, and per destination its preview digest and the
  whole manifest it was previewed under, in a private file (`syndication.approvalFile`, default
  `.openblog/distribution-approvals.json`; one approval per source, the latest). It sends nothing.
- **Opt-in enforcement.** With `syndication.requireApproval: true`, `--write` checks every remote target before
  credentials, the canonical preflight or any request, and refuses the run with the target, the reason and "No
  request was sent." unless the approval covers it: the same source, revision and canonical address
  (`source-changed`), the same publish choice (`intent-changed`), the target approved (`destination-not-approved`)
  with the same preview digest (`preview-changed`), and `approval_stands` for its approved and current manifests
  (`policy-changed`). A run limited with `--target` may send a subset of an approval. The dry run then prints each
  target's approval state. The manual Medium workflow sends nothing and is not gated.
- **Off by default, unchanged when off.** `requireApproval` defaults to `false`. Without it, and without `--preview`
  or `--approve`, the text dry run, `--json` and `--write` behave and print exactly as before; an approval recorded
  anyway is not consulted.
- **The approvals file fails closed.** An unknown version, field, provider or manifest refuses the whole file
  (`invalid-approvals`), and a run that requires approval then sends nothing. Messages are fixed text and never
  repeat content.

## Considered options

- **Always require an approval.** Rejected: it would change every existing `--write` and every CI job using it.
- **Approve inside `--write` with a prompt.** Rejected: the CLI is used non-interactively, and consent should be to
  something already reviewed, not to a prompt.
- **Store approvals beside the post.** Rejected: approvals are private workflow state, like the syndication state
  file, and never part of content or a build.

## Consequences

- An author who opts in knows that what reaches a destination is byte for byte what they previewed and approved.
- An edit, a different draft or publish choice, or a breaking provider change asks for a new preview and approval.
