# Reading modes and supplements

The contract for author-approved supplements and the reading modes that reveal them. Decisions:
[ADR 0170](../adr/0170-a-supplement-is-a-marked-block-quote-the-author-wrote-into-the-post.md) and
[ADR 0171](../adr/0171-a-reading-mode-only-shows-or-hides-supplements-and-every-representation-stays-complete.md).
Code: `openblog_core::reading_depth`.

## Writing a supplement

Opt in per post with `readingModes: true` in the front matter, or with `readingModes: {default:
guided}` to also choose the mode the post opens in (`standard`, `guided` or `deep-dive`; standard
if absent). `true`, `yes` and `on` and any map opt in, `false`, `no` and `off` opt out, and
anything else is off with a warning. A map opts in unless it says `enabled: false`; a key other
than `default` and `enabled` is reported and ignored. Then write a block quote whose first
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
| title | optional plain text, at most 120 characters, no formatting; a longer one leaves the marker a quote |

Known kinds and their default level: `definition` and `context` are `guided`; `evidence`,
`relationship`, `comparison` and `further-reading` are `deep-dive`. Any other kind is shown, labelled
with its own words, at `deep-dive`.

Supplements nest up to three deep, and a supplement is never shown without the one it is written
in. A marker that cannot be read stays an ordinary block quote and is reported; so do markers past
three levels or 200 supplements. A marker whose bracket is escaped (`\[!supplement`) is ordinary
text. Every report is a warning in the build, `check` and Admin, beginning with the post's path.

A supplement that holds a `[!WARNING]` or `[!CAUTION]` callout at any depth is shown in every mode
(`data-ob-always`) and reported, so safety text is never hidden.

## Modes

| Mode | Shows |
| --- | --- |
| `standard` | no supplement |
| `guided` | `guided` supplements |
| `deep-dive` | `guided` and `deep-dive` supplements |

A mode changes visibility only. The article words, citations, footnotes, headings and their order
are identical in every mode. A supplement's own words are not counted in the post's description, word
count or reading time. A heading inside a supplement is a real heading with its own id
(`ob-supplement-N-hK`, or the author's `{#id}`), is not in the outline and does not renumber the
post's headings. The reader's saved choice opens first, then the author's default, then standard.

## Static markup (no JavaScript)

```html
<div class="ob-supplement" id="ob-supplement-1" role="group" aria-labelledby="ob-supplement-1-label" data-ob-supplement data-ob-kind="definition" data-ob-level="guided">
<p class="ob-supplement-label" id="ob-supplement-1-label"><strong class="ob-supplement-kind">Definition</strong> <span class="ob-supplement-level">guided supplement</span> <span class="ob-supplement-title">Aporia</span></p>
<blockquote>
<p>A state of puzzlement in which a question has no ready answer.</p>
</blockquote>
<p class="ob-supplement-end"><strong>End of definition supplement.</strong></p>
</div>
```

The build writes every supplement visible; it never writes `hidden`. `data-ob-level` is the
effective level. Controls hide a supplement whose `data-ob-level` the chosen mode does not show and
restore all of them without script. Ids are positional for one revision of the post and are not
stored; `ob-supplement-` is reserved: a heading `{#id}`, footnote label or raw HTML `id` an opted-in post
writes with that prefix is renamed with `section-` and reported (a post that has not opted in is
never touched), and a U+0000 in such a post is read as U+FFFD. A generated note cited only inside supplements has
`data-ob-supplement="ob-supplement-1 ob-supplement-3"` naming them.

## The control (no JavaScript needed to read; script adds it)

`<ob-reading-modes default="guided" data-ob-base="/blog">` (the base path only for a site under a
folder) wraps the article prose of a post that has supplements. It adds
a `fieldset` "Reading mode" with three native radio buttons (Standard, Guided, Deep dive), each with a
description linked by `aria-describedby`, and a "Use the author's default" button. It sets `hidden`
on the supplements the chosen mode does not show and never on one with `data-ob-always`; announces
each change in a polite status region; keeps the choice in `localStorage` key `ob-reading-mode`, or
`ob-reading-mode:/blog` for a site under a folder, so project sites that share an origin do not
share it (a mode name, on this device only, never sent anywhere; blocked storage is tolerated and said);
and, when the address names something inside a hidden supplement (or a note that names one), shows
that supplement, moves focus to the target and says so. The fade-in runs only when motion is not
reduced. The shared rules are in `web/components/reading-modes.js`, checked against
`tests/fixtures/reading-modes.json` by both the Rust and Node tests. Decisions: ADR 0172, ADR 0173, ADR 0174.

## Progressive rendering (ADR 0174)

- The static page is the whole content. Without script nothing is hidden, and portable copies keep
  every supplement.
- With script on, the stylesheet hides, until the element is defined, the layers the author's
  `default` hides, so the page does not paint every layer and then jump. If the script never
  arrives they return after six seconds. Warnings are never hidden. Reduced motion skips this and
  shows the full page first.
- A hidden supplement is `hidden="until-found"` where supported (find in page and links reach it,
  `beforematch` marks it revealed), else `hidden`.
- A mode change keeps the first article block in view where it is. Open `<details>` and the
  checked radio are untouched.
- A hash change, a click on an in-page link (even to the address already shown), a citation
  back-link and a find-in-page match show the holding supplement. Another tab's change applies only
  when it changes the mode, and never hides the supplement that holds focus.
- A supplement with a missing or unknown level is always shown. Only a layer the reader just
  chose fades in, and not under reduced motion. The reset button is `aria-disabled`, so it keeps
  focus.

## Portable copies

Portable HTML and feeds carry the same groups. Portable Markdown keeps the quote with its marker
line as written. Plain text and JSON Feed `content_text` carry the words between a line naming the
supplement and an `End of ... supplement.` line. The capability `guided-reading-supplements` is
reported for a post with supplements, `fully-portable`.

## Private material

Supplements come only from the published post. Drafts, private research notes, atlas entries that are
not published, unapproved reader suggestions and AI output cannot become one unless the author
writes the words into the post.
