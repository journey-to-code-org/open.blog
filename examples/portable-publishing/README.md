# One lesson, multiple destinations

The [canonical lesson](./content/posts/portable-lesson.md) combines research metadata,
[contributor credits](./content/posts/portable-lesson.credits.json), a callout, knowledge check,
Rust and configured Python runners, a web sandbox, media, timestamps, and discussion links.
The [configuration](./openblog.json) enables all five destination policies for offline dry runs.
Its example endpoints are placeholders, not usable hosted services.

From the repository root:

```sh
cargo run -p openblog-cli -- export portable-lesson --root examples/portable-publishing
cargo run -p openblog-cli -- syndicate portable-lesson --json --root examples/portable-publishing
```

Neither command contacts a provider or writes content. To create a Markdown file, add
`--out portable-lesson.md --write` to the export command; an existing file is not overwritten.
Do not use syndication `--write` with these placeholder endpoints.

## What readers receive

- Portable HTML and Markdown preserve the question, choices, visible answer, explanation,
  source, expected output, evidence, public credits, and canonical identity.
- Rust gets a prefilled external Playground link as well as the canonical run/edit link.
  Python retains its source and canonical execution link without exposing the runner endpoint.
- The web sandbox becomes labeled HTML/CSS/JavaScript blocks plus a canonical live-preview link.
  No CodePen copy is created.
- Video becomes a provider link. Timestamps remain readable prose because this example uses the
  research profile; automatic linked chapter lists belong to the video profile.
- RSS and JSON Feed use the same portable HTML; JSON Feed adds a portable text companion.
- DEV/Hashnode plans select Markdown, Ghost/WordPress plans select HTML, and Medium remains
  manual import. Destination policies explain canonical limitations.
- Private front matter, HTML comments, and configured service endpoints never enter the public
  representations. Native quizzes and sandboxes remain interactive on the canonical site.

The shared example is exercised by core/feed, Admin preview, export, and adapter regression
tests. These verify local artifacts and safety gates, not third-party rendering parity.
