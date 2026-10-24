import test from "node:test";
import assert from "node:assert/strict";

import { Editor, assistantReviewGroups, assistantReviewSourceChanged, assistantReviewSummary } from "../../web/admin/admin.js";

test("document review disclosure names every selected input before sending", () => {
  assert.deepEqual(
    assistantReviewSummary({
      title: "Unsaved title",
      markdown: "Draft body",
      skills: [{ id: "copy-review", name: "Copy review", version: "1.0.0" }],
      selectedSkillIds: new Set(["copy-review"]),
      context: [{ id: "private:author", name: "author.md", visibility: "private", characters: 42 }],
      selectedContextIds: new Set(["private:author"]),
      provider: { providerType: "generic-https", model: "writer-v1", destination: "https://assistant.example" },
    }),
    {
      scope: "Complete document",
      sourceCharacters: 24,
      skills: ["Copy review · 1.0.0"],
      context: ["author.md · Private · 42 characters"],
    provider: "Custom HTTPS · writer-v1 · https://assistant.example",
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

test("controlled provider response renders through the mounted Review UI without changing the draft", async () => {
  class DomNode {
    constructor(tag = "") {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attributes = {};
      this._text = "";
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
      this._text = "";
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    addEventListener() {}
    focus() {
      this.focused = true;
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join("");
    }
  }

  const previousNode = globalThis.Node;
  const previousDocument = globalThis.document;
  globalThis.Node = DomNode;
  globalThis.document = {
    createElement: (tag) => new DomNode(tag),
    createTextNode: (text) => {
      const node = new DomNode("#text");
      node.textContent = text;
      return node;
    },
  };
  try {
    let submitted;
    const calls = [];
    const app = {
      meta: {},
      api: {
        call: async (method, path, request) => {
          calls.push(path);
          if (path === "assistant/status") {
            return {
              providerType: "generic-https",
              model: "writer-v1",
              destination: "https://assistant.example",
              configured: true,
              capabilities: { review: true },
              message: "Assistant provider is ready.",
            };
          }
          submitted = { method, path, request };
          return {
            findings: [
              {
                id: "finding-1",
                skillId: "copy-review",
                severity: "medium",
                category: "clarity",
                title: "Clarify the opening",
                evidence: "Draft body",
                explanation: "Name the specific audience.",
                suggestion: "Draft body for new readers",
                verification: "unverified-advice",
              },
            ],
          };
        },
      },
    };
    const editor = new Editor(app, { kind: "posts", path: "posts/draft.md", fields: {}, credits: null });
    editor.ui = {
      title: { value: "Unsaved title" },
      body: { value: "Draft body" },
      assistantReviewRun: { disabled: false },
      assistantReviewStatus: new DomNode("p"),
      assistantReviewResults: Object.assign(new DomNode("section"), { attributes: { role: "region", "aria-label": "Review results" } }),
      assistantStatus: new DomNode("p"),
      assistantStatusBadge: Object.assign(new DomNode("span"), { dataset: {} }),
      assistantProviderType: new DomNode("dd"),
      assistantModel: new DomNode("dd"),
      assistantDestination: new DomNode("dd"),
      assistantConfigured: new DomNode("dd"),
      assistantCapabilities: new DomNode("dd"),
    };
    editor.collect = () => ({ draft: "true" });
    let disclosedDestination = "";
    editor.renderAssistantReviewSummary = () => {
      disclosedDestination = editor.assistantProviderStatus?.destination || "";
    };
    editor.selectedAssistantSkills = new Set(["copy-review"]);
    editor.assistantContextSelected = new Set(["private:author"]);
    editor.assistantSkills = [{ id: "copy-review", name: "Copy review" }];

    await editor.runAssistantReview();

    assert.deepEqual(calls, ["assistant/status", "assistant/review"]);
    assert.equal(disclosedDestination, "https://assistant.example");
    assert.deepEqual(submitted, {
      method: "POST",
      path: "assistant/review",
      request: {
        json: {
          source: { title: "Unsaved title", metadata: { draft: "true" }, markdown: "Draft body" },
          skillIds: ["copy-review"],
          contextIds: ["private:author"],
        },
      },
    });
    assert.equal(editor.ui.body.value, "Draft body");
    assert.equal(editor.ui.assistantReviewResults.textContent.includes("AI-generated advice"), true);
    assert.equal(editor.ui.assistantReviewResults.textContent.includes("Clarify the opening"), true);
    assert.equal(editor.ui.assistantReviewResults.attributes["aria-label"], "Review results");
    assert.equal(editor.ui.assistantReviewResults.focused, true);
    assert.equal(editor.ui.assistantReviewStatus.textContent, "1 AI-generated finding. Your draft is unchanged.");
  } finally {
    if (previousNode === undefined) delete globalThis.Node;
    else globalThis.Node = previousNode;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
