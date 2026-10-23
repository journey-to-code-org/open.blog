import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const admin = readFileSync(new URL("../../web/admin/admin.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../web/admin/admin.css", import.meta.url), "utf8");

test("editor reports document size and save state", () => {
  assert.match(admin, /ui\.documentStats/);
  assert.match(admin, /updateDocumentStats\(\)/);
  assert.match(admin, /\$\{lines\} line\$\{lines === 1/);
  assert.match(admin, /Unsaved changes/);
  assert.match(admin, /Saving…/);
  assert.match(admin, /Saved/);
  assert.match(admin, /const saveVersion = this\.app\.editVersion/);
  assert.match(admin, /saveStateForVersions\(saveVersion, this\.app\.editVersion\)/);
  assert.match(admin, /this\.app\.dirty = savedState\.dirty/);
  assert.match(admin, /if \(this\.saving\) return/);
  assert.match(admin, /Saved the earlier version\. Your newer edits are still unsaved\./);
  assert.match(admin, /if \(this\.ui\.saveState\.textContent === "Unsaved changes"\) return/);
  assert.match(styles, /\.oba-editor-status/);
  assert.match(styles, /\.oba-save-state\.is-dirty/);
});

test("editor panes can be focused from Alt number shortcuts", () => {
  assert.match(admin, /e\.altKey && \["1", "2", "3", "4", "5"\]\.includes\(e\.key\)/);
  assert.match(admin, /\["write", "preview", "social", "optimize", "settings"\]/);
  assert.match(admin, /this\.editor\.activatePane\(pane, true\)/);
  assert.match(admin, /target\?\.focus\(\)/);
});

test("optimizer separates search, answer, and trust guidance", () => {
  assert.match(admin, /"data-pane": "optimize"/);
  assert.match(admin, /SEO & answer readiness/);
  assert.match(admin, /Heuristic guidance, not a ranking guarantee/);
  assert.match(admin, /analyzeReadiness/);
  assert.match(styles, /\.oba-optimize-workspace/);
});

test("social preview displays publishing-engine OpenGraph metadata", () => {
  assert.match(admin, /"data-pane": "social"/);
  assert.match(admin, /preview\.social/);
  assert.match(admin, /Matches generated OpenGraph metadata/);
  assert.match(admin, /ui\.socialCardPreview = h\(/);
  assert.match(admin, /ui\.socialCardType = h\("dd"/);
  assert.match(admin, /ui\.socialCardType\.textContent = social\.card/);
  assert.match(admin, /ui\.socialCardPreview\.setAttribute\("aria-busy"/);
  assert.match(styles, /\.oba-social-card/);
  assert.match(styles, /aspect-ratio:\s*1\.91 \/ 1/);
});

test("preview width controls expose wide, tablet, and mobile canvases", () => {
  assert.match(admin, /"aria-label": "Preview width"/);
  assert.match(admin, /\["wide", "tablet", "mobile"\]/);
  assert.match(admin, /this\.root\.dataset\.previewWidth = ui\.previewWidth\.value/);
  assert.match(styles, /data-preview-width="tablet"/);
  assert.match(styles, /data-preview-width="mobile"/);
});
