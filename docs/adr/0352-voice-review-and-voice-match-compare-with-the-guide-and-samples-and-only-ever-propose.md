# ADR 0352: Voice review and voice match compare with the guide and samples and only ever propose

- Status: Accepted
- Date: 2026-10-28
- Parent epic: [#409](https://github.com/journey-to-code-org/open.blog/issues/409)
- Tasks: #458, #459, #460
- Builds on: ADR 0266 (AI proposes, never applies), ADR 0350 (samples as context), ADR 0351 (the guide)

## Context

The `voice-review` skill told the model to compare with "explicitly supplied voice context", and nothing
supplied any. Now the guide and samples are context (ADR 0350). The review must use them, say what each
finding rests on, and leave the author's deliberate choices alone. A second skill should help the author make a
passage sound more like themselves, through the apply and undo path reviews already have.

## Decision

### Voice review (#458)

- **`voice-review` 1.1.0** prefers the voice guide (`kind: voice-guide`) and the voice samples
  (`kind: voice-sample`) over any general idea of style, requires every finding to name its evidence in the
  explanation (a sample file name, or a guide section heading), and says deliberate stylistic choices are not
  defects.
- **A finding is `supplied-context` only if it names its evidence.** The instructions ask for that, and the
  validator enforces it for `voice-review` findings when the request carries a voice sample or the guide: if
  the explanation contains neither the file name of a selected sample nor a `##` heading of the selected
  guide, the finding is kept but its verification becomes `unverified-advice`, the label every finding without
  evidence already gets. The check is exact and case sensitive; "this doesn't sound like you" is not
  evidence. Without voice context, and for every other skill, findings are validated exactly as before.

### Voice match (#459)

- **A new built-in review skill, `voice-match`**, returns findings with a `suggestion` anchored to the exact
  source passage in `evidence`, so the browser's existing Apply suggestion and Undo path (which re-finds the
  evidence, applies only when it is found exactly once, and undoes from the same finding) handles it. It
  declares `scopes: [selection, section, document]`: the only review entry today sends the whole document, and
  the validator refuses a skill without the `document` scope there. The skill's rules and the check below keep
  it to passages, not rewrites.
- **A suggestion that does not anchor is advice, never applied.** For `voice-match` findings only: if the
  evidence does not identify exactly one place in the draft, or the passage is longer than 2,000 characters, or
  it is the whole document, the finding is kept, its `suggestion` becomes null and the suggested wording is
  appended to the explanation as advice. (Every other skill is unchanged: evidence that does not anchor
  rejects the whole review.) So there is no full-document rewrite and nothing unanchored is offered with an
  Apply button.
- `voice-match` findings follow the same evidence rule as `voice-review`: `supplied-context` only when the
  explanation names a selected sample or a section of the selected guide.
