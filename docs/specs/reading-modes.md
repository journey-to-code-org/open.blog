# Reading modes and supplements

The contract for author-approved supplements and the reading modes that reveal them. Decisions:
[ADR 0170](../adr/0170-a-supplement-is-a-marked-block-quote-the-author-wrote-into-the-post.md) and
[ADR 0171](../adr/0171-a-reading-mode-only-shows-or-hides-supplements-and-every-representation-stays-complete.md).
Code: `openblog_core::reading_depth`.

## Writing a supplement

Opt in per post with `readingModes: true` in the front matter. Then write a block quote whose first
line is a marker:

```markdown
> [!supplement kind=definition level=guided] Aporia
> A state of puzzlement in which a question has no ready answer.

> [!supplement kind=evidence level=deep-dive] The manuscripts
> Three witnesses agree on this reading.
>
> > [!supplement kind=further-reading]
> > The critical edition discusses the variants.
```

| Part | Rule |
| --- | --- |
| `[!supplement` ... `]` | case-insensitive; on the quote's first line, alone or followed by a plain-text title |
| `kind=` | one lowercase word (`a-z`, `0-9`, `-`, at most 32); default `supplement` |
| `level=` | `guided` or `deep-dive`; default by kind |
| other `key=value` | ignored, so later releases can add attributes |
| title | optional plain text, at most 120 characters, no formatting |

Known kinds and their default level: `definition` and `context` are `guided`; `evidence`,
`relationship`, `comparison` and `further-reading` are `deep-dive`. Any other kind is shown, labelled
with its own words, at `deep-dive`.

Supplements nest up to three deep, and a supplement is never shown without the one it is written
in. A marker that cannot be read stays an ordinary block quote and is reported; so do markers past
three levels or 200 supplements.

## Modes

| Mode | Shows |
| --- | --- |
| `standard` | no supplement |
| `guided` | `guided` supplements |
| `deep-dive` | `guided` and `deep-dive` supplements |

A mode changes visibility only. The article words, citations, footnotes, headings and their order
are identical in every mode. A supplement's own words are not counted in the post's description, word
count or reading time.

## Static markup (no JavaScript)

```html
<div class="ob-supplement" id="ob-supplement-1" role="group" aria-labelledby="ob-supplement-1-label" data-ob-supplement data-ob-kind="definition" data-ob-level="guided">
<p class="ob-supplement-label" id="ob-supplement-1-label"><strong class="ob-supplement-kind">Definition</strong> <span class="ob-supplement-level">guided supplement</span> <span class="ob-supplement-title">Aporia</span></p>
<p>A state of puzzlement in which a question has no ready answer.</p>
</div>
```

The build writes every supplement visible; it never writes `hidden`. `data-ob-level` is the
effective level. Controls hide a supplement whose `data-ob-level` the chosen mode does not show and
restore all of them without script. Ids are positional for one revision of the post and are not
stored.

## Portable copies

Portable HTML and feeds carry the same groups. Portable Markdown keeps the quote with its marker
line as written. Plain text carries the words. The capability `guided-reading-supplements` is
reported for a post with supplements, `fully-portable`.

## Private material

Supplements come only from the published post. Drafts, private research notes, atlas entries that are
not published, unapproved reader suggestions and AI output cannot become one unless the author
writes the words into the post.
