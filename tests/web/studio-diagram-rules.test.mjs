// A diagram in Studio (#646): the fence the form writes, what it reads back from a card, and what
// it says is wrong. The drawing itself is the server's (crates/openblog-cli/src/admin/diagrams.rs).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DIAGRAM_MAX_OPTION_BYTES, DIAGRAM_MAX_SOURCE_BYTES, diagramInfo, diagramMarkdown, diagramProblems, diagramTitle, parseDiagramFence,
} from "../../web/studio/parts/diagram-rules.js";
import { blockKind } from "../../web/studio/parts/word-blocks.js";
import { blockThing, cardForm, cardSummary } from "../../web/studio/parts/piece-words.js";
import { addItems } from "../../web/studio/parts/add-words.js";

const FLOW = "flowchart LR\n  A --> B";

test("the fence keeps the diagram as written and quotes each option so Markdown never breaks", () => {
  const values = { source: "flowchart LR\nA[`one ``` two`] --> B", title: 'The "request"', description: "A request goes to B", caption: "" };
  assert.equal(diagramInfo(values), `mermaid title='The "request"' description="A request goes to B"`);
  const markdown = diagramMarkdown(values);
  assert.ok(markdown.startsWith("````mermaid "), markdown);
  assert.ok(markdown.endsWith("\n````"));
  assert.ok(markdown.includes("A[`one ``` two`] --> B"));
  assert.deepEqual(parseDiagramFence(markdown), values);
});

test("a card is changed by the form only when the form can write it back exactly", () => {
  const written = diagramMarkdown({ source: FLOW, title: "Two steps", description: "A leads to B.", caption: "How it starts" });
  assert.equal(written, '```mermaid title="Two steps" description="A leads to B." caption="How it starts"\nflowchart LR\n  A --> B\n```');
  assert.equal(cardForm({ kind: "diagram", source: written }), "diagram");
  // Written by hand another way: kept as written.
  for (const other of ["```mermaid title=Two\nflowchart LR\n```", "~~~mermaid\nA\n~~~", "```mermaid theme=\"dark\"\nA\n```", "```mermaid title=\"a\" title=\"b\"\nA\n```"]) {
    assert.equal(parseDiagramFence(other), null, other);
    assert.equal(cardForm({ kind: "diagram", source: other }), "", other);
  }
});

test("a mermaid fence is a diagram card, named by its title", () => {
  const written = diagramMarkdown({ source: FLOW, title: "Two steps", description: "A leads to B." });
  assert.equal(blockKind(written), "diagram");
  assert.equal(blockThing({ kind: "diagram", source: written }), "A diagram");
  const card = cardSummary({ kind: "diagram", source: written });
  assert.equal(card.name, "Diagram: Two steps");
  assert.deepEqual(card.lines, ["flowchart LR", "  A --> B"]);
  assert.equal(diagramTitle("```mermaid\nflowchart LR\n  accTitle: From the diagram\n```"), "From the diagram");
});

test("what is wrong is said by field, and a title or description in the diagram itself counts", () => {
  assert.deepEqual(diagramProblems({ source: "  " }), [
    { field: "source", code: "required" }, { field: "title", code: "diagram-title" }, { field: "description", code: "diagram-describe" },
  ]);
  assert.deepEqual(diagramProblems({ source: "flowchart LR\n  accTitle: T\n  accDescr: D\n  A --> B" }), []);
  assert.deepEqual(diagramProblems({ source: "x".repeat(DIAGRAM_MAX_SOURCE_BYTES + 1), title: "t", description: "d" }), [{ field: "source", code: "too-long", max: DIAGRAM_MAX_SOURCE_BYTES }]);
  assert.deepEqual(diagramProblems({ source: FLOW, title: "two\nlines", description: "d" }), [{ field: "title", code: "one-line" }]);
  assert.deepEqual(diagramProblems({ source: FLOW, title: "t", description: "é".repeat(DIAGRAM_MAX_OPTION_BYTES) }), [{ field: "description", code: "too-long", max: DIAGRAM_MAX_OPTION_BYTES }]);
  assert.deepEqual(diagramProblems({ source: FLOW, title: "t", description: "d", caption: `it's "both"` }), [{ field: "caption", code: "diagram-quotes" }]);
});

test("A diagram is offered on the details layer only where the server draws diagrams", () => {
  const ids = (meta) => Object.values(addItems(meta)).flat().map((item) => item.id);
  assert.ok(ids({ diagramRendering: true, pieces: [] }).includes("diagram"));
  assert.ok(!ids({ diagramRendering: false, pieces: [] }).includes("diagram"));
  assert.ok(addItems({ diagramRendering: true, pieces: [] }).details.some((item) => item.id === "diagram"));
});

test("the form never places the drawing as markup: it is a picture the page made", () => {
  const form = readFileSync(new URL("../../web/studio/parts/diagram-form.js", import.meta.url), "utf8");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|DOMParser/.test(form));
  assert.match(form, /new Blob\(\[svg\], \{ type: "image\/svg\+xml" \}\)/);
  assert.match(form, /h\("img", \{ class: "studio-diagram-picture", src: picture, alt \}\)/);
});
