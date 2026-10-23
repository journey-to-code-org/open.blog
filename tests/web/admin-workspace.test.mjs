import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const admin = readFileSync(new URL("../../web/admin/admin.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../web/admin/admin.css", import.meta.url), "utf8");

test("admin shell exposes a grouped publishing workspace", () => {
  assert.match(admin, /oba-brand-mark/);
  assert.match(admin, /oba-tool-group/);
  assert.match(admin, /"aria-label": "Admin tools"/);
  assert.match(admin, /oba-context-bar/);
  assert.match(admin, /h\("h1", \{\}, activeInfo\.title\)/);
});

test("editor has named writing, site preview, social, and settings views", () => {
  assert.match(admin, /"data-pane": "settings"/);
  assert.match(admin, /"data-pane": "write"/);
  assert.match(admin, /"data-pane": "preview"/);
  assert.match(admin, /"data-pane": "social"/);
  assert.match(admin, /"aria-label": "Editor views"/);
});

test("editors expose one explicitly selected view at every width", () => {
  assert.match(admin, /applyPaneSelection\(this\.root, paneButtons, pane\)/);
  assert.match(admin, /aria-pressed/);
  assert.match(styles, /\.oba-editor-nav/);
  assert.match(styles, /\.oba-editor\[data-editor-view="settings"\]/);
  assert.match(styles, /\.oba-editor\[data-editor-view="write"\]/);
  assert.match(styles, /\.oba-editor\[data-editor-view="preview"\]/);
  assert.match(styles, /\.oba-editor\[data-editor-view="social"\]/);
});

test("workspace layout keeps one focused editor view and responsive controls", () => {
  assert.match(styles, /\.oba-panes > \.oba-pane/);
  assert.match(styles, /display:\s*none/);
  assert.match(styles, /@media \(max-width: 64rem\)/);
  assert.match(styles, /@media \(max-width: 44rem\)/);
});
