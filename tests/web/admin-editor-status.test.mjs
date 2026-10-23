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
  assert.match(admin, /this\.app\.editVersion === saveVersion/);
  assert.match(admin, /this\.app\.dirty = true;\s+ui\.saveState\.textContent = "Unsaved changes"/);
  assert.match(admin, /if \(this\.saving\) return/);
  assert.match(admin, /Saved the earlier version\. Your newer edits are still unsaved\./);
  assert.match(admin, /if \(this\.ui\.saveState\.textContent === "Unsaved changes"\) return/);
  assert.match(styles, /\.oba-editor-status/);
  assert.match(styles, /\.oba-save-state\.is-dirty/);
});

test("editor panes can be focused from Alt number shortcuts", () => {
  assert.match(admin, /e\.altKey && \["1", "2", "3"\]\.includes\(e\.key\)/);
  assert.match(admin, /this\.editor\.activatePane\(pane, true\)/);
  assert.match(admin, /target\?\.focus\(\)/);
});

test("preview width controls expose wide, tablet, and mobile canvases", () => {
  assert.match(admin, /"aria-label": "Preview width"/);
  assert.match(admin, /\["wide", "tablet", "mobile"\]/);
  assert.match(admin, /this\.root\.dataset\.previewWidth = ui\.previewWidth\.value/);
  assert.match(styles, /data-preview-width="tablet"/);
  assert.match(styles, /data-preview-width="mobile"/);
});
