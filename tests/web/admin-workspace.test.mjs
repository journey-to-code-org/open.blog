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

test("editor has named writing, preview, optimization, accessibility, and evidence views", () => {
  assert.match(admin, /"data-pane": "settings"/);
  assert.match(admin, /"data-pane": "write"/);
  assert.match(admin, /"data-pane": "preview"/);
  assert.match(admin, /"data-pane": "social"/);
  assert.match(admin, /"data-pane": "optimize"/);
  assert.match(admin, /"data-pane": "accessibility"/);
  assert.match(admin, /"data-pane": "evidence"/);
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
  assert.match(styles, /\.oba-editor\[data-editor-view="optimize"\]/);
  assert.match(styles, /\.oba-editor\[data-editor-view="accessibility"\]/);
  assert.match(styles, /\.oba-editor\[data-editor-view="evidence"\]/);
});

test("workspace layout keeps one focused editor view and responsive controls", () => {
  assert.match(styles, /\.oba-panes > \.oba-pane/);
  assert.match(styles, /display:\s*none/);
  assert.match(styles, /@media \(max-width: 64rem\)/);
  assert.match(styles, /@media \(max-width: 44rem\)/);
});

test("post settings expose content profiles without silently migrating legacy fields", () => {
  assert.match(admin, /id: "oba-profile"/);
  assert.match(admin, /resolveProfileSelection\(f, profiles, this\.doc\.resolvedProfile\)/);
  assert.match(admin, /if \(this\.profileTouched\) set\("profile", ui\.profile\.value\)/);
  assert.match(admin, /Unknown profile:/);
  assert.match(admin, /ui\.previewWarnings\.replaceChildren/);
  assert.match(admin, /previewWarningsForDisplay\(preview\.warnings\)/);
});

test("post settings expose ordered contributor credits and repair states", () => {
  assert.match(admin, /class: "oba-credit-editor"/);
  assert.match(admin, /Inherit site author/);
  assert.match(admin, /Set credits for this post/);
  assert.match(admin, /Add contributor/);
  assert.match(admin, /Publishing roles/);
  assert.match(admin, /CRediT taxonomy/);
  assert.match(admin, /creditRequestFields\(true\)/);
  assert.match(admin, /creditEtag/);
  assert.match(admin, /Explicit credits/);
  assert.match(admin, /Choose contributor/);
  assert.match(admin, /focusCreditControl/);
  assert.match(styles, /\.oba-credit-card/);
  assert.match(styles, /\.oba-credit-roles/);
});

test("site tools expose a contributor registry workspace with manual identity provenance", () => {
  assert.match(admin, /href: "#\/contributors"/);
  assert.match(admin, /async showContributors\(\)/);
  assert.match(admin, /Manually entered ORCID iD/);
  assert.match(admin, /Prefill legacy author/);
  assert.match(admin, /api\.call\("PUT", "contributors"/);
  assert.match(admin, /contributorSaveState\(saveVersion, editVersion/);
  assert.match(admin, /this\.viewVersion !== mountedView/);
  assert.match(admin, /this\.mount\(this\.shell\(doc\.kind, editor\.render\(\)\)\)/);
  assert.match(styles, /\.oba-contributor-grid/);
  assert.match(styles, /\.oba-contributor-card/);
});
