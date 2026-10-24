# Portable projection contract

open.blog derives destination-neutral HTML, Markdown, and plain-text representations from the
same parsed `Post` used by native page generation. The contract lives in
`openblog_core::projection`; feed and syndication consumers request a `ProjectionFormat` instead
of reparsing a source file or inspecting custom-element markup.

`project_post(post, config)` owns the shared publishing identity:

- `publication_url` identifies this open.blog copy;
- `canonical_url` applies the same preferred DOI or authored canonical identity used by the
  publishing model, with the publication URL as its safe fallback;
- `base_url` resolves site-root links consistently, including sites hosted below a path;
- ordered work credits retain contributor ids, names, safe profile links, and controlled roles;
- research references retain their labels, safe URLs, and canonical source lines; and
- provenance retains the canonical source path and a safe original-source URL when one exists.

The projection retains the authored Markdown body during the original post parse. Markdown
projection therefore does not parse front matter a second time. Root-relative links, images,
reference definitions, and raw HTML attributes become absolute, while inline code, fenced code,
scripts, comments, protocol-relative links, footnote text, and indented code remain unchanged.
HTML projection normalizes link and image attributes through an HTML parser rather than string
replacement. Text projection reports its intentional loss of formatting, media, links, and
interactive behavior.

Projection has no filesystem, network, clock, credential, or remote-state access. Invalid site
identity fails with the canonical source path and leaves the post unchanged. Capability-specific
fallback negotiation builds on the separate [capability registry](content-portability.md); the
projection contract does not sanitize authored HTML or invent destination support.

Compatibility tests prove that requesting a projection does not change native generated files.
Feed and syndication tests cover attribution, canonical identity, Unicode, anchors, relative URLs,
protected code/script content, deterministic repeats, and dry-run behavior.

