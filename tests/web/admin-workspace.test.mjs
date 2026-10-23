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

test("editor has named settings, markdown, and preview panes", () => {
  assert.match(admin, /"data-pane": "settings"/);
  assert.match(admin, /"data-pane": "markdown"/);
  assert.match(admin, /"data-pane": "preview"/);
  assert.match(admin, /"aria-label": "Editor panes"/);
});

test("mobile editors expose one explicitly selected pane", () => {
  assert.match(admin, /root\.dataset\.mobilePane = pane/);
  assert.match(admin, /aria-pressed/);
  assert.match(styles, /\.oba-mobile-nav/);
  assert.match(styles, /\.oba-editor\[data-mobile-pane="settings"\]/);
  assert.match(styles, /\.oba-editor\[data-mobile-pane="markdown"\]/);
  assert.match(styles, /\.oba-editor\[data-mobile-pane="preview"\]/);
});

test("workspace layout keeps wide-screen panes and narrow-screen controls explicit", () => {
  assert.match(styles, /grid-template-columns:\s*minmax\(16rem,\s*22rem\)\s+minmax\(0,\s*1fr\)/);
  assert.match(styles, /@media \(max-width: 64rem\)/);
  assert.match(styles, /@media \(max-width: 44rem\)/);
});
