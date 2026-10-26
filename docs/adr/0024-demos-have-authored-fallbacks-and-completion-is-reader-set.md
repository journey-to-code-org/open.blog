# ADR 0024: Interactive demos have authored fallbacks, and completion is only what the reader marks

- Status: Accepted
- Date: 2026-10-25

## Context

The Journey to Code series needed hands-on teaching tools (a Git sandbox, a fetch and storage inspector,
a Shadow DOM explorer) and a sense of progress through a series. Two constraints from earlier decisions
apply. Portable projections are derived from the canonical Markdown and must not depend on JavaScript or
invent meaning ([ADR 0004](0004-portable-projections-from-canonical-work.md)). And the opt-in reading
history promised readers no account, no analytics and no guessing about what they had finished.

Series landing pages are not exported, so demos placed only there were never syndicated. A demo placed in
a post would reach feeds and syndication destinations that cannot run it.

## Decision

An interactive demo is a publishing capability (`interactive-demo`) embedded with a `demo <kind>` fence.
The fence body is an **authored fallback**, plain Markdown, and it is the portable representation: native
pages wrap it in the demo element (which hides it once running), and feeds, portable HTML and portable
Markdown carry the caption, the fallback and a link to the live version. The fallback is validated rather
than sanitized (no raw HTML, no images, absolute https links only), so one text is safe in every output.
The portable semantic-fact check fails an export that loses the fallback's text, the kind's label, the
title or the canonical link. Kinds are a closed registry in the engine, so an unknown kind fails the build.

Completion is a **reader-set** mark stored as an optional `completed` field of the existing opt-in
`mnix.reading.v1` value. A visit never sets it. Themes respond through a published contract
(`window.mnixProgress` and the `mnix:progress` event) and show nothing earned unless the reader enabled
history. Series navigation is one engine-rendered structure that themes restyle, with completion labels
added by the reader tools layer.

## Consequences

- A demo is only as portable as its fallback is good; the fence therefore asks the author to write the
  moment the demo teaches, and personas review the fallback, not the widget.
- The fallback cannot be generated from the demo's model. That keeps Rust and JavaScript from each
  re-implementing the model, at the cost of the author keeping prose and demo consistent.
- Because the reading data is additive and optional, older saved data stays valid and nothing is written
  until a reader presses the button. Another tab or an older script can drop the new field when it saves.
- Adding a demo kind touches the engine registry, both asset lists, and the docs. The three labs that
  began as series-landing scripts (JavaScript evolution, Web Audio, native APIs) are now kinds too. The
  first two keep their themed landing markup and import the same shared module the element uses, so
  there is one implementation; the native lab's landing page still has its own DOM glue.
