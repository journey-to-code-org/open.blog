import assert from "node:assert/strict";
import test from "node:test";

import {
  ObAdmin,
  applyPaneSelection,
  normalizeStatusFilter,
  parseAdminHash,
  saveStateForVersions,
} from "../../web/admin/admin.js";

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
  const buttons = ["write", "preview", "settings"].map((paneTarget) => ({
    dataset: { paneTarget },
    setAttribute: (name, value) => pressed.set(paneTarget, [name, value]),
  }));
  applyPaneSelection(root, buttons, "preview");
  assert.equal(root.dataset.editorView, "preview");
  assert.deepEqual(Object.fromEntries(pressed), {
    write: ["aria-pressed", "false"],
    preview: ["aria-pressed", "true"],
    settings: ["aria-pressed", "false"],
  });
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
