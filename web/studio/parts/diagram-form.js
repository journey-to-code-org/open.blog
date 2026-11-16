// The diagram form (Add something › A diagram, #646): start from an example, write the diagram's
// lines, give it a title and a description for people who can't see it, optionally words under
// it, and Draw it to see it exactly as the post will show it. The server draws it with the build's
// renderer (POST diagram/preview); the drawing comes back as text and is shown only as a picture
// the page made itself (a blob: image), never placed as markup. Adding it checks it the same way,
// so a diagram the build would refuse is never put in her words.
import { h } from "./dom.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { cardSummary } from "./piece-words.js";
import { diagramInfo, diagramMarkdown, diagramProblems, parseDiagramFence } from "./diagram-rules.js";

const text = (control) => String(control?.value ?? "");

/** The form for `ctx` (see piece-forms.js `buildForm`). */
export function diagramForm(ctx) {
  const parsed = ctx.block ? parseDiagramFence(ctx.block.source) : null;
  const field = (label, { help = "", value = "", rows = 0, mono = false, name = "" } = {}) => h("text-field", {
    label, description: help, value, rows: rows || undefined, class: mono ? "studio-mono-field" : "", "data-field": name,
    onValuechange: () => ctx.onChange?.(),
  });
  const example = h("select-field", { label: say("diagram.example"), description: say("diagram.exampleHelp"), value: "",
    options: [{ value: "", label: say("diagram.exampleNone") }], onValuechange: () => useExample() });
  const source = field(say("diagram.source"), { help: say("diagram.sourceHelp"), rows: 10, mono: true, value: parsed?.source || "", name: "source" });
  const title = field(say("diagram.title"), { help: say("diagram.titleHelp"), value: parsed?.title || "", name: "title" });
  const description = field(say("diagram.describe"), { help: say("diagram.describeHelp"), rows: 3, value: parsed?.description || "", name: "description" });
  const caption = field(say("form.wordsUnder"), { help: say("diagram.captionHelp"), value: parsed?.caption || "", name: "caption" });
  const drawn = h("div", { class: "studio-diagram-drawn", "aria-live": "polite" });
  const draw = h("action-button", { variant: "secondary", onClick: () => drawIt() }, say("diagram.draw"));
  let templates = [];
  let picture = "";

  ctx.api.get("diagram/templates").then((reply) => {
    templates = Array.isArray(reply?.templates) ? reply.templates : [];
    example.options = [{ value: "", label: say("diagram.exampleNone") }, ...templates.map((t) => ({ value: t.id, label: t.label }))];
  }).catch(() => { example.hidden = true; });

  async function useExample() {
    const chosen = templates.find((t) => t.id === example.value);
    if (!chosen) return;
    if (text(source).trim() && text(source) !== chosen.source) {
      const go = await ask({ heading: say("diagram.replaceAsk"), text: say("diagram.replaceText"),
        choices: [{ label: say("diagram.replaceGo"), value: "go" }, { label: say("diagram.replaceKeep"), value: "keep", variant: "secondary" }] });
      if (go !== "go") { example.value = ""; return; }
    }
    source.value = chosen.source;
    ctx.onChange?.();
  }

  const values = () => ({ source: text(source), title: text(title).trim(), description: text(description).trim(), caption: text(caption).trim() });
  const start = JSON.stringify(values());

  /** Ask the server to draw it: `{ svg, alt }`, `{ problems }`, or `{ waiting }` / `{ failed }`. */
  async function check(v) {
    try {
      const reply = await ctx.api.post("diagram/preview", { info: diagramInfo(v), source: v.source.replace(/\r\n?/g, "\n").replace(/\n*$/, "") });
      return { svg: String(reply?.svg || ""), alt: String(reply?.alt || "") };
    } catch (error) {
      if (error.status === 422) return { problems: [{ field: String(error.data?.field || "source"), code: "diagram", message: String(error.data?.error || ""), line: error.data?.line }] };
      if (error.status === 413) return { problems: [{ field: "source", code: "too-long", max: 16384 }] };
      if (error.status === 401) return { signedOut: true };
      if (!error.status || error.offline) return { waiting: true };
      return { failed: true };
    }
  }

  function show(svg, alt) {
    if (picture) URL.revokeObjectURL(picture);
    picture = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    drawn.replaceChildren(h("img", { class: "studio-diagram-picture", src: picture, alt }));
  }

  async function drawIt() {
    const v = values();
    const problems = diagramProblems(v);
    if (problems.length) { drawn.replaceChildren(h("p", { class: "studio-help", text: say("diagram.fixFirst") })); return; }
    draw.loading = true;
    try {
      const got = await check(v);
      if (got.svg) show(got.svg, got.alt);
      else drawn.replaceChildren(h("p", { class: "studio-help", text: got.problems ? say("diagram.cantDraw", { why: got.problems[0].message }) : got.waiting ? say("diagram.needsSignal") : say("form.noAnswer") }));
    } finally {
      draw.loading = false;
    }
  }

  return {
    element: h("div", { class: "studio-form-fields" }, example, source, title, description, caption, h("div", {}, draw), drawn),
    focus: () => (source.querySelector("textarea, input") || source).focus?.(),
    values,
    restore(v) { source.value = v.source || ""; title.value = v.title || ""; description.value = v.description || ""; caption.value = v.caption || ""; },
    async read() {
      const v = values();
      if (ctx.block && JSON.stringify(v) === start) return { markdown: ctx.block.source.replace(/\n+$/, "") };
      const problems = diagramProblems(v);
      if (problems.length) return { problems };
      // The build's own check: a diagram it would refuse is never put in.
      const got = await check(v);
      if (!got.svg) return got;
      show(got.svg, got.alt);
      return { markdown: diagramMarkdown(v) };
    },
    controls: { source, title, description, caption },
    sketch: () => cardSummary({ kind: "diagram", source: diagramMarkdown({ ...values(), source: text(source) || " " }) }),
  };
}
