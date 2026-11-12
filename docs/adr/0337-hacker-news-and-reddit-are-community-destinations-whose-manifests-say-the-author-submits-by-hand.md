# ADR 0337: Hacker News and Reddit are community destinations whose manifests say the author submits by hand

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#384](https://github.com/journey-to-code-org/open.blog/issues/384)
- Story: #395 (task DIST4.1.1)

## Context

Epic #384 asks for community-first guided submissions: never auto-submit to Hacker News, prepare Reddit submissions
with a per-community checklist and "no API assumption", and keep the author in control. The provider capability
contract (ADRs 0325 to 0327) already says "manual" for anything only the author can do, and it is closed: a provider
that is not in its list is refused everywhere. So the two communities either join the contract or live outside it,
with their own idea of what open.blog may do there.

What the providers say, checked on 2026-10-29:

- Hacker News: the [official API](https://github.com/HackerNews/API) only publishes data; it has no way to submit.
  The [guidelines](https://news.ycombinator.com/newsguidelines.html) ask for the original title, no editorialising,
  no soliciting of votes, comments or submissions, no delete-and-repost, and "It's ok to post your own stuff part of
  the time". The [FAQ](https://news.ycombinator.com/newsfaq.html) allows "a small number of reposts" only when a
  story "has not had significant attention in the last year or so", and penalises accounts and sites that ask for
  votes. HN's own [bookmarklet](https://news.ycombinator.com/bookmarklet.html) opens
  `https://news.ycombinator.com/submitlink?u=<address>&t=<title>`, the submit form filled in.
- Reddit: [Reddit's rules](https://redditinc.com/policies/reddit-rules) (rule 2) ask people to abide by each
  community's rules, post authentic content where they have a personal interest, and not spam or manipulate votes;
  moderators set stricter rules per community. Data API access now needs Reddit's approval under its
  [Data API terms](https://redditinc.com/policies/data-api-terms) and Responsible Builder Policy, and commercial use
  needs a separate agreement. These Reddit pages refused automated fetching from the environment this was written
  in; their content was confirmed through quotations of them, and the sources are listed so a maintainer can
  re-read them.

## Decision

- **A third family, `community`.** `ProviderId` gains `hacker-news` and `reddit`, both in `Family::Community`. A
  community destination is reached by `openblog submit` (ADRs 0338 to 0340), never by `openblog syndicate` or the
  social delivery worker.
- **The manifest says "by hand" and the contract enforces it.** Both manifests declare `link: manual` and every other
  capability `unsupported`, login `none`, publishing `manual`, canonical `linked`, and no constraints. A community
  manifest that claims any adapter capability, a login, a publishing rule other than `manual`, a canonical rule other
  than `linked`, or a link that is not `manual` is `manifest-inconsistent`, in Rust and in the hosted function alike
  (`tests/fixtures/provider-manifests.json` holds the cases). A future release cannot quietly start submitting:
  that would be a breaking manifest change *and* a contradiction the reader refuses.
- **The hosted function knows the names and nothing more.** `social-capabilities.mjs` reads the two manifests so the
  shared fixture stays one list, but `admittedManifest` admits only the social family, so the delivery worker never
  registers an adapter for a community.
- **Title limits are not capabilities.** HN and Reddit titles are held to limits by the submission kit (ADR 0338),
  not by `maxTextChars`, which is the limit of the `text` capability these destinations do not have.

## Considered options

- **Keep the communities outside the contract.** Rejected: the epic builds on the DIST1 contract, and a second,
  unchecked list of destinations would let "what open.blog does there" drift from the one place that says it.
- **Reddit as an adapter through its API.** Rejected: the epic asks for no API assumption, access needs Reddit's
  approval and terms open.blog cannot accept for its users, and a tool posting to communities is what Reddit's spam
  rules are about.
- **Model each subreddit as a provider.** Rejected: the provider is Reddit; a community is the author's choice of
  where, with its own checklist (ADR 0339).

## Consequences

- The provider list grows to nine; the policy version of every existing manifest is unchanged because no existing
  manifest changed.
- Every later distribution epic sees the communities in the same contract, with the guarantee that open.blog only
  prepares and the author submits.
