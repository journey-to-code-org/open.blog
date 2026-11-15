// What readers will see of a comparison of readings, as text: each reading's holder, certainty, words,
// uncertainty, who drafted it and its evidence count; the relations; the explanations by audience; the
// evidence to check; and, for the author only, what was left out and why. Everything from the file is
// placed as text. Studio R13; docs/specs/studio/r13/ux.md.
import { h } from "./dom.js";
import { say } from "./words.js";
import { certaintyWords, levelWords, relationKindWords, leftOutLine } from "./readings-rules.js";

const holder = (attribution, titleOfSource) => {
  if (!attribution) return say("readings.someone");
  if (attribution.kind === "source") return titleOfSource(attribution.source);
  return (attribution.kind === "anonymous" ? attribution.description : attribution.name) || say("readings.someone");
};

const provenance = (p) => (p?.origin === "ai-draft" ? say("readings.provenanceAi", { tool: p.tool || "" }) : say("readings.provenanceOwn"));

/** `reply` is the preview answer; `titleOfSource(id)` and `nameOf(id)` give words for ids. Returns nodes. */
export function readingPreview(reply, { titleOfSource, nameOf }) {
  const out = [];
  const view = reply?.projection;
  if (!view) {
    const found = (reply?.problems || []).map((p) => h("li", { text: p.message || p.text || "" }));
    return [h("p", { class: "studio-help", text: say("readings.previewEmpty") }), found.length ? h("ul", {}, found) : null];
  }
  if (view.asPublished) out.push(h("p", { class: "studio-help", text: say("readings.previewDraft") }));
  const pub = view.public;
  if (view.withheld || !pub) out.push(h("p", { class: "studio-help", role: "status", text: say("readings.previewWithheld") }));
  if (pub) {
    out.push(h("h3", { text: pub.title }), h("p", { text: pub.subject }));
    const names = new Map();
    for (const item of pub.interpretations || []) names.set(item.id, holder(item.attribution, titleOfSource));
    for (const item of pub.interpretations || []) {
      out.push(h("section", { class: "studio-reading-preview" },
        h("h4", { text: names.get(item.id) }),
        item.attribution?.certainty ? h("p", { class: "studio-help", text: certaintyWords(item.attribution.certainty) }) : null,
        h("p", { lang: item.language || undefined, text: item.statement }),
        item.uncertainty ? h("p", { class: "studio-help", text: say("readings.previewUncertain", { text: item.uncertainty }) }) : null,
        h("p", { class: "studio-help", text: provenance(item.provenance) }),
        h("p", { class: "studio-help", text: (item.evidence || []).length ? say("readings.evidenceCount", { count: String(item.evidence.length) }) : say("readings.evidenceNone") })));
    }
    for (const r of pub.relations || []) {
      out.push(h("p", { text: say("readings.relationLine", { from: names.get(r.from) || r.from, kind: relationKindWords(r.kind), to: names.get(r.to) || r.to }) + (r.note ? ` — ${r.note}` : "") }));
    }
    for (const x of pub.explanations || []) {
      out.push(h("section", { class: "studio-reading-preview" },
        h("h4", { text: say("readings.explanationLine", { level: levelWords(x.level), about: x.about ? names.get(x.about) || x.about : say("readings.aboutWhole") }) }),
        h("p", { lang: x.language || undefined, text: x.text }),
        h("p", { class: "studio-help", text: provenance(x.provenance) })));
    }
  }
  const notes = reply.notes || [];
  if (notes.length) {
    out.push(h("p", { class: "studio-help", text: say("readings.checkEvidence") }),
      h("ul", {}, notes.map((n) => h("li", { text: n.message || n.text || "" }))));
  }
  const left = view.leftOut || [];
  if (left.length) {
    out.push(h("section", { class: "studio-only-you" },
      h("h4", { text: say("readings.leftOutHeading") }),
      h("ul", {}, left.map((entry) => h("li", {}, leftOutLine(entry, nameOf),
        h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: say("readings.leftDetails", { reason: entry.reason }) })))))));
  }
  return out;
}
