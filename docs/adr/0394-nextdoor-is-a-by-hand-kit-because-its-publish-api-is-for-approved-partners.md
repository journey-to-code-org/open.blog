# ADR 0394: Nextdoor is a by-hand kit, because its Publish API is for approved partners

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Story: #488 (task #523, TRADE5.1.2)

## Context

Task #523 asks whether Nextdoor offers a business posting API that this kind of app can use. It asks for an
adapter if so and a guided kit if not, with the decision recorded with its date and source.

## What was checked (2026-11-08)

- [Sharing overview](https://developer.nextdoor.com/docs/sharing-overview): Nextdoor offers two ways to share. The
  **Publish API** needs an application: "you will be required to request access for Publish API". The **Share
  Plugin** "is an open offering" and needs no application.
- [Share using a Business Account](https://developer.nextdoor.com/docs/business-share): posting as a business
  profile through the Publish API needs a developer token, applied for under "Publish API" with a company logo and
  a redirect address, and then the owner's sign-in with the `profile` scope. The page names no approval time.
  Nextdoor's announced Publish API partners are agencies and social media tools, not a single business's own site.
- [Share Plugin](https://developer.nextdoor.com/reference/share-plugin): `https://nextdoor.com/sharekit/?source=...&body=...`
  opens Nextdoor's own post box with `body` filled in. `body` holds at most 3,500 characters including its URL
  encoding, and the last link in it becomes the link preview. It cannot attach a photo.

## Decision

- No Nextdoor adapter. `nextdoor` is a community-family provider (ADR 0337): link, text and image by hand, the rest
  unsupported, login none, publishing manual, policy version `2026-11-08`. open.blog never posts to Nextdoor.
- The job kit (`openblog job-share <slug> --kit <new folder>`) gives Nextdoor the words with the job's link last,
  held to 3,500 encoded characters, the first after-photo to save, and an **Open Nextdoor** link to the Share Plugin
  with the words filled in. The owner adds the photo and posts it there, or not at all.

## Consequences

- Neighbours see the job only when the owner posts it. That works today with any Nextdoor account and no approval.
- If Nextdoor opens its Publish API to businesses' own sites, an adapter can replace the kit. Its manifest change
  must raise the policy version (ADR 0327).
