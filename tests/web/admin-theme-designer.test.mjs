// The Design a theme screen (ADR 0410): the pure contract. The server checks every proposal and makes
// it readable; these functions only show what it sends and keep the owner from sending what it refuses.
import assert from "node:assert/strict";
import test from "node:test";

import { IDEAS, MAX_DESCRIPTION, descriptionProblem, designerErrorText, labelProblem, renamed, startFrom, swatches } from "../../web/admin/theme-designer.js";

const theme = {
  colors: {
    light: { page: "#fbf8f2", surface: "#ffffff", text: "#1d2a22", muted: "#5b6a60", border: "#dfe5dc", accent: "#b02236", glow: "#f5e6b8" },
    dark: { page: "#0e1c19", text: "#f4efe4" },
  },
};

test("swatches show the six colours an owner recognizes, in a fixed order", () => {
  assert.deepEqual(swatches(theme, "light").map((s) => s.label), ["Page", "Boxes", "Writing", "Quiet writing", "Edges", "Links and buttons"]);
  assert.equal(swatches(theme, "light")[5].color, "#b02236");
  assert.deepEqual(swatches(theme, "dark").map((s) => s.key), ["page", "text"]);
  assert.deepEqual(swatches(null, "light"), []);
});

test("a description and a name are checked in plain words", () => {
  assert.match(descriptionProblem("   "), /few words/);
  assert.match(descriptionProblem("x".repeat(MAX_DESCRIPTION + 1)), /a little shorter/);
  assert.equal(descriptionProblem(IDEAS[0]), "");
  assert.match(labelProblem(""), /name/);
  assert.match(labelProblem("x".repeat(41)), /40 characters/);
  assert.match(labelProblem("two\nlines"), /one line/);
  assert.equal(labelProblem("Christmas Kitchen"), "");
});

test("renaming keeps the rest of the draft", () => {
  const draft = { label: "Old", summary: "s", font: "theme" };
  assert.deepEqual(renamed(draft, "  New name "), { label: "New name", summary: "s", font: "theme" });
});

test("failures say what to do", () => {
  assert.match(designerErrorText({ status: 404, data: { code: "not-configured" } }), /not set up/);
  assert.match(designerErrorText({ status: 429 }), /busy/);
  assert.match(designerErrorText({ status: 502, data: { code: "invalid-result" } }), /nothing changed/);
  assert.match(designerErrorText({ status: 401 }), /Sign in/);
});

test("Start from lists the site's themes, leaving out the engine's plain default unless it is worn", () => {
  const options = { current: "grammis", themes: [{ name: "base", label: "Base" }, { name: "christmas", label: "Christmas" }, { name: "grammis", label: "No decorations" }] };
  assert.deepEqual(startFrom(options), [{ value: "christmas", label: "Christmas" }, { value: "grammis", label: "No decorations" }]);
  assert.equal(startFrom({ current: "base", themes: [{ name: "base", label: "Base" }] }).length, 1);
  assert.deepEqual(startFrom(null), []);
});
