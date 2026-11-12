# ADR 0414: A Bluesky thumbnail is approved after resizing

- Status: Accepted
- Parent epic: #623
- Amends: [ADR 0358](0358-a-bluesky-announcement-is-one-post-record-with-facets-and-a-link-card-under-a-record-key-derived-from-the-announcement.md)

## Context

Bluesky's external-card thumbnail is limited to 1,000,000 bytes. Approving a source image before resizing it does not
show the author what will be uploaded. The announcement queue stores a small snapshot, not an image file.

## Decision

When a same-origin cover is larger than 1,000,000 bytes but no larger than 8 MiB, the hosted preview converts it to a
bounded JPEG, displays those exact bytes and binds their hash, the source hash and the transform version into the
approval. Transparency is flattened onto white. The worker fetches and checks the source, recreates the thumbnail,
and verifies the output hash before uploading it. If the source, output or upload cannot be verified, the card is
posted without a picture, as the author approved.

The pinned image library limits decoded pixels and is installed for the target function runtime. A library or runtime
change that produces different bytes fails closed rather than replacing an approved thumbnail. Smaller images keep
the existing byte-for-byte path.

## Consequences

Large images can be used without storing their bytes in the queue, while the approval covers what Bluesky receives.
The deployment must bundle the native image dependency for its runtime. Bluesky's external-card schema does not
provide a separate image-alt field; Admin shows the description but cannot transmit it with the thumbnail.
