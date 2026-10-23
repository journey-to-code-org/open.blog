import assert from "node:assert/strict";
import test from "node:test";

import {
  ObAdmin,
  accessibilityReview,
  evidenceReview,
  evidenceStudioState,
  applyPaneSelection,
  applyProfileFieldDrafts,
  creditHasAuthor,
  creditPayload,
  focusCreditControl,
  moveCredit,
  normalizeStatusFilter,
  normalizeCreditDraft,
  parseAdminHash,
  preserveProfileFieldDrafts,
  previewWarningsForDisplay,
  resolveProfileSelection,
  researchSectionIsPresent,
  researchActionIsCurrent,
  saveStateForVersions,
  toggleCreditRole,
  validateCreditDraft,
} from "../../web/admin/admin.js";

test("credit drafts preserve inherited, explicit empty, and ordered contributor semantics", () => {
  const credits = normalizeCreditDraft([
    { contributor: "ada", roles: [{ vocabulary: "crossref", role: "author" }] },
    { contributor: "grace", roles: [{ vocabulary: "credit", role: "software" }] },
    null,
  ]);
  assert.equal(creditPayload("unresolved", credits), undefined);
  assert.equal(creditPayload("inherited", credits), null);
  assert.deepEqual(creditPayload("explicit", []), []);
  assert.deepEqual(moveCredit(credits, 1, 0).map((credit) => credit.contributor), ["grace", "ada"]);
  assert.deepEqual(credits.map((credit) => credit.contributor), ["ada", "grace"], "moving does not mutate the saved draft");
});

test("controlled credit roles toggle without duplicates and validate author intent", () => {
  const author = { vocabulary: "crossref", role: "author" };
  const software = { vocabulary: "credit", role: "software" };
  let credit = { contributor: "ada", roles: [author] };
  credit = toggleCreditRole(credit, software, true);
  credit = toggleCreditRole(credit, software, true);
  assert.deepEqual(credit.roles, [author, software]);
  credit = toggleCreditRole(credit, author, false);
  assert.deepEqual(credit.roles, [software]);
  assert.equal(validateCreditDraft("unresolved", []), "Choose how to repair the malformed contributor credits.");
  assert.equal(validateCreditDraft("inherited", []), "");
  assert.equal(validateCreditDraft("explicit", []), "");
  assert.match(validateCreditDraft("explicit", [{ contributor: "ada", roles: [] }]), /at least one role/);
  assert.match(
    validateCreditDraft("explicit", [
      { contributor: "ada", roles: [author] },
      { contributor: "ada", roles: [software] },
    ]),
    /only once/,
  );
  assert.equal(creditHasAuthor([{ contributor: "ada", roles: [author] }], { ada: { name: "Ada" } }), true);
  assert.equal(creditHasAuthor([{ contributor: "ada", roles: [software] }], { ada: { name: "Ada" } }), false);
  assert.equal(creditHasAuthor([{ contributor: "missing", roles: [author] }], {}), false);
  assert.deepEqual(normalizeCreditDraft([{ contributor: "ada", roles: [author, author] }])[0].roles, [author]);
});

test("credit list rerenders restore keyboard focus to a row or the add control", () => {
  let selector = "";
  let rowFocused = false;
  let addFocused = false;
  const ui = {
    creditList: {
      querySelector: (value) => {
        selector = value;
        return { focus: () => (rowFocused = true) };
      },
    },
    addCredit: { focus: () => (addFocused = true) },
  };
  const immediately = (callback) => callback();
  focusCreditControl(ui, 2, immediately);
  assert.equal(selector, "#oba-credit-2-contributor");
  assert.equal(rowFocused, true);
  focusCreditControl(ui, -1, immediately);
  assert.equal(addFocused, true);
});

test("profile metadata drafts survive profile switches including explicit clears", () => {
  const saved = new Map([
    ["doi", "10.1000/original"],
    ["license", "https://creativecommons.org/licenses/by/4.0/"],
  ]);
  const switched = preserveProfileFieldDrafts(
    saved,
    new Map([
      ["doi", { value: "10.1000/revised" }],
      ["license", { value: "" }],
    ]),
  );

  assert.equal(switched.get("doi"), "10.1000/revised");
  assert.equal(switched.get("license"), "");
  assert.equal(saved.get("doi"), "10.1000/original");
  assert.deepEqual(
    applyProfileFieldDrafts(
      { title: "Study", doi: "10.1000/original", license: "https://example.test/old" },
      switched,
    ),
    { title: "Study", doi: "10.1000/revised" },
  );
});

test("toggling an open command palette closes it and restores its opener", () => {
  let closed = false;
  let removed = false;
  let focused = false;
  const activeDialog = {
    classList: { contains: (name) => name === "oba-command-dialog" },
    returnFocus: { focus: () => (focused = true) },
    close: () => (closed = true),
    remove: () => (removed = true),
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    activeElement: {},
    querySelector: () => activeDialog,
  };
  try {
    new ObAdmin().openCommandPalette();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert.deepEqual({ closed, removed, focused }, { closed: true, removed: true, focused: true });
});

test("rejecting dirty navigation preserves the editor route and state", async () => {
  const previousLocation = globalThis.location;
  const previousHistory = globalThis.history;
  let restoredHash = "";
  globalThis.location = { hash: "#/posts" };
  globalThis.history = { replaceState: (_state, _title, hash) => (restoredHash = hash) };
  try {
    const app = new ObAdmin();
    app.dirty = true;
    app.currentHash = "#/edit/posts%2Fdraft.md";
    app.confirmLeave = async () => false;
    await app.onHash();
    assert.equal(restoredHash, "#/edit/posts%2Fdraft.md");
    assert.equal(app.dirty, true);
    assert.equal(app.currentHash, "#/edit/posts%2Fdraft.md");
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousHistory === undefined) delete globalThis.history;
    else globalThis.history = previousHistory;
  }
});

test("an edit made during save remains dirty after the earlier response", () => {
  assert.deepEqual(saveStateForVersions(7, 7), { dirty: false, label: "Saved", messageIsCurrent: true });
  assert.deepEqual(saveStateForVersions(7, 8), { dirty: true, label: "Unsaved changes", messageIsCurrent: false });
});

test("editor view selection updates the container and every toggle", () => {
  const root = { dataset: { editorView: "write" } };
  const pressed = new Map();
  const buttons = ["write", "preview", "social", "optimize", "settings", "accessibility"].map((paneTarget) => ({
    dataset: { paneTarget },
    setAttribute: (name, value) => pressed.set(paneTarget, [name, value]),
  }));
  applyPaneSelection(root, buttons, "preview");
  assert.equal(root.dataset.editorView, "preview");
  assert.deepEqual(Object.fromEntries(pressed), {
    write: ["aria-pressed", "false"],
    preview: ["aria-pressed", "true"],
    social: ["aria-pressed", "false"],
    optimize: ["aria-pressed", "false"],
    settings: ["aria-pressed", "false"],
    accessibility: ["aria-pressed", "false"],
  });
});

test("accessibility findings are grouped by outcome with precise source labels", () => {
  assert.deepEqual(
    accessibilityReview([
      {
        code: "link-name-empty",
        outcome: "detected",
        scope: "content",
        source: { path: "posts/example.md", line: 7, column: 1, field: null },
        message: "This link has no accessible name.",
        repair: "Add descriptive link text.",
        references: ["WCAG-2.2-2.4.4"],
      },
      {
        code: "document-language-missing",
        outcome: "detected",
        scope: "site",
        source: { path: "openblog.json", line: null, column: null, field: "language" },
        message: "Generated pages have no configured default language.",
        repair: "Set the site language.",
        references: ["WCAG-2.2-3.1.1"],
      },
      {
        code: "image-alt-review",
        outcome: "needs-review",
        scope: "content",
        source: { path: "posts/example.md", line: 10, column: 1, field: null },
        message: "Review this image.",
        repair: "Decide whether it needs alternative text.",
        references: [],
      },
      { outcome: "unknown", message: "Ignore unsupported payloads" },
    ]),
    {
      total: 3,
      counts: { detected: 2, potential: 0, "needs-review": 1 },
      groups: [
        {
          outcome: "detected",
          label: "Detected",
          findings: [
            {
              code: "link-name-empty",
              outcome: "detected",
              scope: "content",
              sourceLabel: "posts/example.md:7:1",
              message: "This link has no accessible name.",
              repair: "Add descriptive link text.",
              references: ["WCAG-2.2-2.4.4"],
            },
            {
              code: "document-language-missing",
              outcome: "detected",
              scope: "site",
              sourceLabel: "openblog.json · language",
              message: "Generated pages have no configured default language.",
              repair: "Set the site language.",
              references: ["WCAG-2.2-3.1.1"],
            },
          ],
        },
        {
          outcome: "needs-review",
          label: "Needs review",
          findings: [
            {
              code: "image-alt-review",
              outcome: "needs-review",
              scope: "content",
              sourceLabel: "posts/example.md:10:1",
              message: "Review this image.",
              repair: "Decide whether it needs alternative text.",
              references: [],
            },
          ],
        },
      ],
    },
  );
});

test("evidence findings are grouped without inventing quality scores", () => {
  const review = evidenceReview([
    {
      code: "doi-invalid",
      outcome: "detected",
      source: { path: "posts/study.md", line: null, column: null, field: "doi" },
      message: "The DOI is malformed.",
      repair: "Use a DOI name or resolver URL.",
    },
    {
      code: "reference-link-review",
      outcome: "needs-review",
      source: { path: "posts/study.md", line: 14, column: 1, field: null },
      message: "This reference has no resolvable link.",
      repair: "Add a stable URL when one exists.",
    },
  ]);

  assert.equal(review.total, 2);
  assert.deepEqual(review.counts, { detected: 1, potential: 0, "needs-review": 1 });
  assert.equal(review.groups[0].findings[0].sourceLabel, "posts/study.md · doi");
  assert.equal(review.groups[1].findings[0].sourceLabel, "posts/study.md:14:1");
});

test("evidence studio distinguishes an inactive profile from a clean research audit", () => {
  assert.deepEqual(evidenceStudioState([], null), {
    active: false,
    status: "Evidence checks are not active for this content profile.",
    review: null,
  });
  assert.deepEqual(evidenceStudioState([], { referenceCount: 0 }), {
    active: true,
    status: "0 evidence findings",
    review: { total: 0, counts: { detected: 0, potential: 0, "needs-review": 0 }, groups: [] },
  });
});

test("research section presence comes from the publishing-engine evidence result", () => {
  const research = { referenceCount: 0 };
  assert.equal(researchSectionIsPresent([], research, "abstract"), true);
  assert.equal(researchSectionIsPresent([{ code: "abstract-missing" }], research, "abstract"), false);
  assert.equal(researchSectionIsPresent([{ code: "references-missing" }], research, "references"), false);
  assert.equal(researchSectionIsPresent([], null, "abstract"), null);
});

test("a delayed research action rejects a profile switch before its response", () => {
  const request = { version: 7, path: "posts/study.md", profile: "research", body: "Draft" };
  assert.equal(researchActionIsCurrent(request, { ...request }), true);
  assert.equal(researchActionIsCurrent(request, { ...request, version: 8, profile: "article" }), false);
  assert.equal(researchActionIsCurrent(request, { ...request, path: "posts/renamed.md" }), false);
});

test("overview drill-down routes retain validated status filters and issue focus", () => {
  const drafts = parseAdminHash("#/posts?status=draft");
  assert.equal(drafts.head, "posts");
  assert.equal(normalizeStatusFilter(drafts.params.get("status")), "draft");
  assert.equal(normalizeStatusFilter("unknown"), "all");
  const issues = parseAdminHash("#/overview?focus=issues");
  assert.equal(issues.head, "overview");
  assert.equal(issues.params.get("focus"), "issues");
});

test("profile selection honors canonical values and legacy recipes without losing unknown ids", () => {
  const profiles = [{ id: "article" }, { id: "recipe" }];
  assert.deepEqual(resolveProfileSelection({}, profiles), {
    value: "article",
    unknown: false,
  });
  assert.deepEqual(resolveProfileSelection({ recipe: "true" }, profiles, "recipe"), {
    value: "recipe",
    unknown: false,
  });
  assert.deepEqual(resolveProfileSelection({ profile: "Recipe" }, profiles), {
    value: "recipe",
    unknown: false,
  });
  assert.deepEqual(resolveProfileSelection({ profile: "field-notes", recipe: "true" }, profiles), {
    value: "field-notes",
    unknown: true,
  });
});

test("preview warnings preserve profile fallback and contradiction messages for display", () => {
  assert.deepEqual(
    previewWarningsForDisplay([
      "posts/log.md: unknown content profile `field-notes`; rendering as an article",
      "posts/log.md: profile `article` overrides the legacy recipe marker",
      42,
    ]),
    [
      "posts/log.md: unknown content profile `field-notes`; rendering as an article",
      "posts/log.md: profile `article` overrides the legacy recipe marker",
    ],
  );
});
