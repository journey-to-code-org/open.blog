// "What readers will see" for a reading path, drawn from the server's projection: the title, the line
// about it, the steps with why each follows, then what only she sees (why readers don't see some steps).
// Everything from the server is placed as text, never markup. Studio R13.
import { h } from "./dom.js";
import { say } from "./words.js";
import { relationshipWords, difficultyWords, diagnosticWords } from "./path-rules.js";

/** The preview body for `reply` (the preview or view answer). `titleOf(stepId)` names a step for the author-only list. */
export function pathPreview(reply, { titleOf = (id) => id } = {}) {
  const projection = reply?.projection;
  const out = [];
  if (!projection) return [h("p", { class: "studio-help", text: say("paths.previewEmpty") })];
  if (projection.asPublished) out.push(h("p", { class: "studio-help", text: say("paths.previewDraft") }));
  if (projection.withheld || !projection.public) {
    out.push(h("p", { class: "studio-help", role: "status", text: say("paths.previewWithheld") }));
  } else {
    const path = projection.public;
    out.push(h("h3", { text: path.title }));
    if (path.summary) out.push(h("p", { text: path.summary }));
    out.push(h("ol", { class: "studio-preview-steps" }, path.steps.map((step) => h("li", { class: "studio-preview-step" },
      step.transition ? h("p", { class: "studio-help", text: `${relationshipWords(step.transition.relationship)}. ${step.transition.why}` }) : null,
      h("strong", { text: step.title }),
      h("span", { class: "studio-help", text: ` · ${step.kindLabel}` }),
      step.optional ? h("span", { class: "studio-help", text: ` · ${say("paths.previewSide")}` }) : null,
      step.difficulty ? h("p", { class: "studio-help", text: say("paths.previewHard", { level: difficultyWords(step.difficulty) }) }) : null,
      step.rationale ? h("p", { text: step.rationale }) : null,
      step.prerequisites ? h("p", { class: "studio-help", text: say("paths.previewNeed", { text: step.prerequisites }) }) : null))));
  }
  const diagnostics = projection.diagnostics || [];
  if (diagnostics.length) {
    out.push(h("section", { class: "studio-only-you" },
      h("h3", { text: say("paths.previewReasons") }),
      h("ul", {}, diagnostics.map((d) => h("li", {},
        d.step ? say("paths.diagStep", { title: titleOf(d.step), why: diagnosticWords(d.kind) }) : diagnosticWords(d.kind),
        h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: say("paths.diagDetails", { kind: String(d.kind) }) })))))));
  }
  return out;
}
