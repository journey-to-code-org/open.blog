import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_OPTIONAL_MODULES,
  DEFAULT_ADMIN_PREFERENCES,
  normalizeAdminPreferences,
  visibleAdminModules,
} from "../../web/admin/admin.js";

const admin = readFileSync(new URL("../../web/admin/admin.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../web/admin/admin.css", import.meta.url), "utf8");

test("the default workspace is calm while every optional module remains known", () => {
  assert.equal(DEFAULT_ADMIN_PREFERENCES.preset, "simple");
  assert.equal(DEFAULT_ADMIN_PREFERENCES.editorMode, "visual");
  assert.deepEqual(visibleAdminModules(DEFAULT_ADMIN_PREFERENCES), []);
  assert.deepEqual(DEFAULT_ADMIN_PREFERENCES.moduleOrder, ADMIN_OPTIONAL_MODULES);
  assert.match(admin, /Everything remains reachable even when your everyday workspace is simple/);
  assert.match(admin, /Write, preview, settings, save, publish status/);
});

test("guided, advanced, and custom presets disclose the intended modules", () => {
  assert.deepEqual(visibleAdminModules({ preset: "guided" }), ["accessibility", "evidence", "assistant"]);
  assert.deepEqual(visibleAdminModules({ preset: "advanced" }), ADMIN_OPTIONAL_MODULES);
  const custom = normalizeAdminPreferences({
    preset: "custom",
    moduleOrder: ["assistant", "social"],
    hiddenModules: ["social"],
  });
  assert.equal(custom.moduleOrder[0], "assistant");
  assert.equal(custom.moduleOrder[1], "social");
  assert.deepEqual(visibleAdminModules(custom).filter((module) => ["assistant", "social"].includes(module)), ["assistant"]);
});

test("untrusted preference values normalize to safe, complete settings", () => {
  const normalized = normalizeAdminPreferences({
    schemaVersion: 99,
    preset: "root",
    density: "invisible",
    editorMode: "html",
    moduleOrder: ["secrets", "assistant", "assistant"],
    hiddenModules: ["publish", "assistant", "assistant"],
  });
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.preset, "simple");
  assert.equal(normalized.density, "comfortable");
  assert.equal(normalized.editorMode, "visual");
  assert.deepEqual(normalized.moduleOrder, ["assistant", ...ADMIN_OPTIONAL_MODULES.filter((module) => module !== "assistant")]);
  assert.deepEqual(normalized.hiddenModules, ["assistant"]);
});

test("personalization uses the private authenticated API and accessible responsive controls", () => {
  assert.match(admin, /api\.call\("GET", "preferences"\)/);
  assert.match(admin, /api\.call\("PUT", "preferences"/);
  assert.match(admin, /Your private view/);
  assert.match(admin, /Restore defaults/);
  assert.match(admin, /aria-labelledby": "oba-preferences-title"/);
  assert.match(admin, /role: "status", "aria-live": "polite"/);
  assert.match(styles, /html\[data-admin-preset="simple"\] \.oba-progressive-tools/);
  assert.match(styles, /@media \(max-width: 44rem\)/);
  assert.match(styles, /min-height: 44px/);
});

