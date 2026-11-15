// Copy it for another blog (Studio R5). The pure parts of the old Admin's portable output tests
// (admin-behavior.test.mjs) are ported with the rules they test; the rest are Studio's own.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DESTINATIONS, checkedState, differenceHeading, differenceWords, differences, downloadName, htmlFrame,
  portabilityAcknowledgementScope, portabilityGroups, portabilitySourceSelection, portableDiagnosticsForDisplay, portablePreviewArtifact,
} from "../../web/studio/parts/portable-rules.js";

test("portable preview diagnostics retain source scope and severity in readable warnings", () => {
  assert.deepEqual(
    portableDiagnosticsForDisplay([
      { code: "canonical-only-interaction", severity: "warning", sourcePath: "posts/lesson.md", message: "Timeline remains on the canonical article.", recommendedAction: "Keep the canonical link." },
      { code: "invalid", message: "" },
      null,
    ]),
    ["posts/lesson.md: warning: Timeline remains on the canonical article. Action: Keep the canonical link."],
  );
});

test("portable export actions use exact preview bytes and fail closed for unavailable policies", () => {
  const preview = { portablePreview: {
    html: "<p>&lt;script&gt;</p>",
    markdown: "```html\n<script>\n```",
    text: "Literal <script>",
    destinations: [
      { version: 1, provider: "ghost", representation: "portable-html" },
      { version: 1, provider: "medium", representation: "manual-markdown" },
      { version: 2, provider: "dev", representation: "portable-markdown" },
    ],
  } };
  assert.deepEqual(portablePreviewArtifact(preview, "portable-text"), { content: "Literal <script>", extension: "txt", mime: "text/plain;charset=utf-8" });
  assert.equal(portablePreviewArtifact(preview, "destination:ghost").content, preview.portablePreview.html);
  assert.equal(portablePreviewArtifact(preview, "destination:medium").content, preview.portablePreview.markdown);
  assert.equal(portablePreviewArtifact(preview, "destination:unknown"), null);
  assert.equal(portablePreviewArtifact(preview, "destination:dev"), null);
  assert.equal(portablePreviewArtifact(preview, "site"), null);
  assert.equal(portablePreviewArtifact(null, "portable-text"), null);
});

test("acknowledgement scope follows the destination's policy, and only a current one", () => {
  const policies = [
    { version: 1, provider: "wordpress", representation: "portable-html" },
    { version: 1, provider: "medium", representation: "manual-markdown" },
  ];
  assert.equal(portabilityAcknowledgementScope([{ version: 2, provider: "medium", representation: "manual-markdown" }], "destination:medium"), null);
  assert.deepEqual(portabilityAcknowledgementScope(policies, "destination:medium"), { destination: "medium", representation: "manual-markdown" });
  assert.deepEqual(portabilityAcknowledgementScope(policies, "portable-html"), { destination: "portable-export", representation: "portable-html" });
  assert.deepEqual(portabilityAcknowledgementScope(policies, "portable-text"), { destination: "portable-export", representation: "portable-text" });
  assert.equal(portabilityAcknowledgementScope(policies, "site"), null);
});

test("portable findings group deterministic capability levels without scores and navigate Unicode source without edits", () => {
  const diagnostic = { capabilityId: "knowledge-check", portabilityLevel: "gracefully-transformed", message: "Static answer." };
  const preview = { portablePreview: {
    destinations: [{ version: 1, provider: "dev", representation: "portable-markdown" }],
    diagnosticsByRepresentation: { "portable-markdown": [diagnostic, diagnostic] },
  } };
  const groups = portabilityGroups(preview, "destination:dev");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].diagnostics.length, 2);
  assert.equal(groups[0].level, "gracefully-transformed");
  assert.equal(groups[0].destination, "dev");
  assert.equal(groups[0].representation, "portable-markdown");
  assert.deepEqual(portabilityGroups(preview, "site"), []);
  assert.equal(portabilityGroups({ portablePreview: { diagnostics: [diagnostic] } }, "site")[0].level, "gracefully-transformed");
  const body = "😀 heading\n> ```quiz\n> Question?\n> ```\n";
  const range = { startLine: 2, startColumn: 3, endLine: 4, endColumn: 6 };
  const selection = portabilitySourceSelection(body, range);
  assert.equal(body.slice(selection.start, selection.end), "```quiz\n> Question?\n> ```");
  assert.equal(portabilitySourceSelection(body, { ...range, startLine: 99 }), null);
});

test("every destination she can pick is one the preview knows", () => {
  assert.deepEqual(DESTINATIONS.map((d) => d.value), [
    "destination:medium", "destination:ghost", "destination:hashnode", "destination:dev", "destination:wordpress", "portable-html", "portable-text",
  ]);
});

test("differences are said in her words, once each, with where they are", () => {
  assert.equal(differenceWords({ capabilityId: "knowledge-check", code: "graceful-transformation" }), "The quiz becomes a plain question with its answer.");
  assert.equal(differenceWords({ capabilityId: "something-new", code: "canonical-only-interaction" }), "Something readers can use on your blog only works there. The copy links back to it.");
  assert.equal(differenceWords({ code: "destination-tag-whatever" }), "Some of your tags can't go across.");
  assert.equal(differenceWords({ code: "?" }), "One thing looks different there.");
  const range = { startLine: 3, startColumn: 1, endLine: 5, endColumn: 4 };
  const preview = { portablePreview: {
    destinations: [{ version: 1, provider: "ghost", representation: "portable-html" }],
    diagnosticsByRepresentation: { "portable-html": [
      { capabilityId: "knowledge-check", code: "graceful-transformation", context: { sourceRange: range } },
      { capabilityId: "knowledge-check", code: "canonical-only-interaction" },
    ] },
    destinationContentPlans: [{ policy: { version: 1, provider: "ghost" }, diagnostics: [{ code: "destination-hosted-media", message: "Ghost receives hosted image references only." }] }],
    destinationTagPlans: [{ policy: { version: 1, provider: "dev" }, diagnostics: [{ code: "destination-tag-invalid" }] }],
  } };
  const lines = differences(preview, "destination:ghost");
  assert.deepEqual(lines.map((l) => l.words), ["The quiz becomes a plain question with its answer.", "That site handles part of it differently."]);
  assert.deepEqual(lines[0].range, range);
  assert.equal(lines[0].diagnostics.length, 2);
  assert.equal(differenceHeading(0), "It goes across as it is.");
  assert.equal(differenceHeading(1), "1 thing looks different there");
  assert.equal(differenceHeading(2), "2 things look different there");
});

test("downloads are named for the post, and the web-page frame keeps the title as text", () => {
  assert.equal(downloadName("pumpkin-bread", "md"), "pumpkin-bread.md");
  assert.equal(downloadName("", "txt"), "post.txt");
  assert.match(htmlFrame("A <lesson>", "<p>Hi</p>"), /<h1>A &lt;lesson&gt;<\/h1><p>Hi<\/p>/);
});

test("a warning is checked for this version, an earlier one, or not at all", () => {
  const scope = { destination: "ghost", representation: "portable-html" };
  const diagnostic = { capabilityId: "knowledge-check" };
  const portable = { sourceRevision: "r2", acknowledgements: [{ capabilityId: "knowledge-check", representation: "portable-html", destination: "ghost", sourceRevision: "r1" }] };
  assert.equal(checkedState(portable, scope, diagnostic), "stale");
  assert.equal(checkedState({ ...portable, sourceRevision: "r1" }, scope, diagnostic), "checked");
  assert.equal(checkedState({ sourceRevision: "r1", acknowledgements: [] }, scope, diagnostic), "unchecked");
});
