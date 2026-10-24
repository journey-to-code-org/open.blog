import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { assistantReviewGroups, assistantReviewSourceChanged, assistantReviewSummary } from "../../web/admin/admin.js";

const admin = fs.readFileSync(new URL("../../web/admin/admin.js", import.meta.url), "utf8");

test("document review disclosure names every selected input before sending", () => {
  assert.deepEqual(
    assistantReviewSummary({
      title: "Unsaved title",
      markdown: "Draft body",
      skills: [{ id: "copy-review", name: "Copy review", version: "1.0.0" }],
      selectedSkillIds: new Set(["copy-review"]),
      context: [{ id: "private:author", name: "author.md", visibility: "private", characters: 42 }],
      selectedContextIds: new Set(["private:author"]),
      provider: { providerType: "generic-https", model: "writer-v1" },
    }),
    {
      scope: "Complete document",
      sourceCharacters: 24,
      skills: ["Copy review · 1.0.0"],
      context: ["author.md · Private · 42 characters"],
      provider: "Generic HTTPS · writer-v1",
      research: "Off",
    },
  );
});

test("review disclosure distinguishes references and existing-post snapshots", () => {
  assert.deepEqual(
    assistantReviewSummary({
      context: [
        { id: "portable:reference:style.txt", name: "style.txt", visibility: "portable", kind: "reference", characters: 12 },
        { id: "post:posts/guide.md", name: "guide.md", path: "posts/guide.md", visibility: "source", kind: "postSnapshot", characters: 50 },
      ],
      selectedContextIds: new Set(["portable:reference:style.txt", "post:posts/guide.md"]),
    }).context,
    ["style.txt · Portable · 12 characters", "posts/guide.md · Post snapshot · 50 characters"],
  );
});

test("validated findings are grouped by skill and labelled as AI-generated advice", () => {
  const groups = assistantReviewGroups(
    {
      findings: [
        { id: "f1", skillId: "copy-review", severity: "medium", title: "Clarify this", evidence: "Draft", explanation: "Vague opening." },
        { id: "f2", skillId: "technical-review", severity: "note", title: "Verify claim", evidence: "always", explanation: "Needs support." },
      ],
    },
    [
      { id: "copy-review", name: "Copy review", version: "1.0.0" },
      { id: "technical-review", name: "Technical review", version: "1.0.0" },
    ],
  );
  assert.deepEqual(groups.map(({ id, name, label, findings }) => ({ id, name, label, ids: findings.map((finding) => finding.id) })), [
    { id: "copy-review", name: "Copy review", label: "AI-generated advice", ids: ["f1"] },
    { id: "technical-review", name: "Technical review", label: "AI-generated advice", ids: ["f2"] },
  ]);
});

test("review completion detects when the editor moved beyond the submitted snapshot", () => {
  const submitted = { title: "Draft", metadata: { draft: "true" }, markdown: "Original" };
  assert.equal(assistantReviewSourceChanged(submitted, { ...submitted }), false);
  assert.equal(assistantReviewSourceChanged(submitted, { ...submitted, markdown: "New edit" }), true);
});

test("Review view submits unsaved editor state and exposes accessible result states without mutation controls", () => {
  assert.match(admin, /api\.call\("POST", "assistant\/review"/);
  assert.match(admin, /title: this\.ui\.title\.value/);
  assert.match(admin, /metadata: this\.collect\(\)/);
  assert.match(admin, /markdown: this\.ui\.body\.value/);
  assert.match(admin, /aria-live": "polite"/);
  assert.match(admin, /Running document review/);
  assert.match(admin, /No findings returned/);
  assert.match(admin, /Review finished for an older draft/);
  assert.match(admin, /aria-label": "Review results"/);
  assert.match(admin, /AI-generated advice/);
  assert.doesNotMatch(admin, /applyAssistantReviewFinding/);
});
