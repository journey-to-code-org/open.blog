# Claims and evidence links format

Private claims in draft posts and the author's evidence links, owned by
`openblog_core::claims`. Decisions:
[ADR 0078](../adr/0078-claims-and-evidence-links-record-the-authors-reading.md),
[ADR 0079](../adr/0079-contradicting-evidence-is-never-hidden-or-published-alone.md) and
[ADR 0080](../adr/0080-claim-anchors-are-verified-utf8-byte-spans.md). Nothing here reaches a
public page, feed, export or search index; a later projection copies approved items only.

```json
{
  "version": 1,
  "claims": [
    { "id": "c1", "post": "on-caves", "statement": "The cave is an allegory of education.",
      "anchor": { "start": 120, "end": 158, "text": "the cave is an allegory of education." },
      "uncertainty": "Readers disagree about scope.", "visibility": "private" }
  ],
  "links": [
    { "id": "l1", "claim": "c1", "relation": "supports",
      "evidence": { "source": "republic-slings", "passage": "p-cave",
                    "locators": [{ "kind": "page", "value": "514" }] },
      "rationale": "Socrates says so directly.", "confidence": "plausible",
      "reviewState": "location-checked", "recordedBy": { "kind": "author" },
      "origin": "authored", "visibility": "private" }
  ]
}
```

- **Relations:** `supports`, `contradicts`, `contextualizes`; required, never defaulted.
- **Defaults written:** `visibility` private, `confidence` tentative, `reviewState` unreviewed,
  `origin` authored, `recordedBy` author.
- **Evidence** is the [Knowledge Atlas](knowledge-atlas.md) evidence object.
- **Anchors** are UTF-8 byte offsets into the post's anchor text: the body after a leading
  byte-order mark and the front matter are removed, with CRLF folded to LF
  (`claims::anchor_text`). `text` is the exact span and keeps `\n` only. A check reports
  `verified`, `moved` (exactly one occurrence elsewhere, overlapping occurrences counted),
  `stale` or `ambiguous`, and never rewrites the anchor.
- **Refused:** unknown source, passage from another source, ambiguous locator, unknown claim,
  duplicate link, duplicate id, contributor credits, an approved link with a private passage,
  approving an unreviewed suggestion, oversized or hostile text (control or bidi characters),
  unsupported version.
- **Projected, not refused:** a link reaches public output only when it and its claim are
  approved, it has no passage, and, for `supports`, every contradicting link on the claim is
  approved. An approved link on a private claim (`private-endpoint`) and approved support beside a
  private contradiction (`undisclosed-contradiction`) are valid, stay private, and are reported as
  non-blocking notices, so withdrawing consent is never refused.
- **Never present:** truth value, score, net result, verified state.
- **Limits:** 4 MiB file, 20,000 claims, 100,000 links, statements 2,000 characters, rationale
  4,000.
