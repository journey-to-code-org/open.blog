# ADR 0345: A photo is reduced on the server as it is uploaded, and the original is not kept

- Status: Accepted
- Date: 2026-11-06
- Parent epic: [#554](https://github.com/journey-to-code-org/open.blog/issues/554)
- Story: #558

## Context

An owner adding photos from a phone was refused over the 10 MB default, and a photo under it was published at full
size with whatever metadata the camera wrote, which can include where it was taken. The project had no image
library. Each blog runs as its own instance, on a host that can be as small as 512 MB of memory and a fraction of a
CPU.

## Decision

- **The reduction happens on the server, in `photo.rs`, using the `image` crate** with only the JPEG, PNG and WebP
  features compiled. Every upload through Admin is covered, whichever browser or path sent it.
- **What is replaced:** a picture over 2000 pixels on its longest side, over 1 MB, or carrying camera metadata. The
  copy is a JPEG at quality 82, or a PNG if it has transparent pixels. It is turned the right way up and keeps its
  colour profile, because the metadata that asked for the turn is dropped and a phone's wide colour looks washed out
  without its profile.
- **The original is not kept.** The site's files are published and kept in git, so a second copy would be a second
  place for the location to leak, and would grow the repository by the size it set out to save.
- **What is kept as sent:** anything that cannot be decoded here (GIF, AVIF, damaged files), animations, and light
  pictures without metadata. `admin.maxUploadMb` still caps these. Reading is capped separately at 40 MB.
- **A small host is protected in three ways.** A picture whose decoded size is over 256 MB (about 64 megapixels with
  transparency) is not decoded, one photo is decoded at a time, and the reduction runs before the site's locks are
  taken, so a large photo never holds up a save.
- **`thumbnail`, not `resize`.** Its box averaging is fast and needs no intermediate buffer, where `resize` would
  allocate one of 16 bytes for each pixel across.

## Considered options

- **Reducing in the browser before upload.** It adds no dependency and saves mobile data, but does not cover other
  clients, and every browser would need to handle orientation and metadata itself. Rejected by the owner's choice,
  since each blog has its own instance.
- **Reducing at build time.** It would leave full-size originals, with their metadata, in the repository.
- **Decoding HEIC.** The available decoders are C libraries that complicate the build. Naming the accepted types on
  the file input asks an iPhone for a JPEG instead, and a HEIC file that still arrives gets a message saying what to do.

## Consequences

- Files added outside Admin, such as a commit to `static/`, are not reduced.
- A photo reduced at upload cannot be restored to full size from the site. The owner's phone keeps the original.
- The release binary grows by the size of the image codecs.
