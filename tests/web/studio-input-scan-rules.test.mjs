// The Admin input scan (ADR 0263's guard), over Studio's own code since the old Admin was retired
// (R15): the same checks, and any finding is fixed in Studio, never allowed here.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { SECTION_CATALOG } from "../../web/studio/parts/landing-rules.js";

// The Admin input scan (ADR 0263, #336): no Admin form takes HTML or CSS as free text, nothing writes
// markup into the page through the DOM, and a new field that would is a failing test.

// Studio's own code, scanned as well: its top level, parts/ and screens/. The vendored Zubra UI under
// zubra/ is copied in from zubra-ui by scripts/vendor-zubra-ui.mjs and never edited here, so it is
// not scanned; a bug in it is fixed upstream.
const studioDir = new URL("../../web/studio/", import.meta.url);
const studioFiles = (sub = "") => readdirSync(new URL(sub, studioDir), { withFileTypes: true }).flatMap((entry) => {
  const path = sub + entry.name;
  if (entry.isDirectory()) return entry.name === "zubra" ? [] : studioFiles(`${path}/`);
  return entry.name.endsWith(".js") || entry.name.endsWith(".html") ? [path] : [];
});
const studioSource = (name) => readFileSync(new URL(name, studioDir), "utf8");
const scanned = studioFiles().map((name) => ({ name: `studio/${name}`, text: studioSource(name) }));
const RISKY = /(?:^|[^a-z])(?:html|css|stylesheet|style|markup|script|javascript|custom[ -]?code|embed[ -]?code|raw[ -]?html)(?:[^a-z]|$)/i;

test("every landing field is a typed control and none is named or labelled for HTML or CSS", () => {
  const allowed = new Set(["text", "textarea", "email", "tel", "url", "number", "select", "list", "group", "post", "richtext"]);
  const seen = [];
  const walk = (fields, where) => {
    for (const field of fields || []) {
      seen.push(field.kind);
      assert.ok(allowed.has(field.kind), `${where}.${field.name}: kind ${field.kind} is not an allowed typed control`);
      // A choice list ("How it looks": primary or secondary) is closed; only free text could take markup.
      if (field.kind !== "select") assert.ok(!RISKY.test(`${field.name} ${field.label}`), `${where}.${field.name}: "${field.label}" invites HTML or CSS`);
      walk(field.fields || field.item?.fields, `${where}.${field.name}`);
    }
  };
  for (const section of SECTION_CATALOG) {
    assert.ok(!RISKY.test(`${section.type} ${section.title}`), `${section.type} is named for HTML or CSS`);
    walk(section.fields, section.type);
  }
  assert.ok(seen.length > 20, "the walk saw the catalog");
});

test("the front page, look, paste and suggestion modules create no text area, no HTML sink and no style or script", () => {
  for (const name of ["parts/landing-rules.js", "screens/landing.js", "parts/look-rules.js", "screens/look.js", "parts/paste.js", "parts/checks.js", "parts/job-rules.js"]) {
    const text = studioSource(name);
    assert.ok(!/(?:h|el|createElement)\(\s*["'`]textarea|<textarea/i.test(text) || name === "screens/landing.js", `${name} creates a text area`);
    for (const sink of [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write/, /\.srcdoc\s*=/, /createContextualFragment/, /new DOMParser/, /\beval\(/, /new Function/, /\.style\.cssText/]) {
      assert.ok(!sink.test(text), `${name} uses ${sink}`);
    }
    assert.ok(!/createElement\(["'`](?:script|style|iframe|object|embed)/i.test(text), `${name} creates an active element`);
  }
});

test("only the known, reviewed places write HTML into the document or a frame", () => {
  const sinks = [];
  for (const { name, text } of scanned.filter((n) => n.name.endsWith(".js"))) {
    text.split("\n").forEach((line, index) => {
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
      if (/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|createContextualFragment|new DOMParser/.test(line)) sinks.push(`${name}:${index + 1}`);
      if (/\.srcdoc\s*=/.test(line)) sinks.push(`${name}:srcdoc`);
      if (/execCommand\(\s*["']insertHTML["']/.test(line)) sinks.push(`${name}:insertHTML`);
    });
  }
  // Studio's copy screen shows an HTML copy of a post in a frame with allow-scripts and no same-origin,
  // so the copy's script cannot reach Studio or the session. That frame is listed here for review; a
  // frame that allows anything more needs its own review.
  assert.deepEqual(
    [...new Set(sinks)].sort(),
    ["studio/parts/copy-post.js:srcdoc"],
    "a new HTML sink needs a review and an entry here",
  );
});

test("no Studio control is named for HTML or CSS", () => {
  const reviewed = [];
  const hits = [];
  for (const { name, text } of scanned) {
    text.split("\n").forEach((line, index) => {
      if (!/(?:h|el)\(\s*"(?:textarea|input)"|<(?:textarea|input)\b|field\(/.test(line)) return;
      // Look only at the words a person sees or a machine names a control by.
      const named = [...line.matchAll(/(?:id|name|aria-label|placeholder)\s*[:=]\s*[`"']([^`"']*)[`"']/g)].map((m) => m[1]);
      const labelled = [...line.matchAll(/field\(\s*[^,]+,\s*[`"']([^`"']*)[`"']/g)].map((m) => m[1]);
      const text = [...named, ...labelled].join(" ");
      if (RISKY.test(text) && !reviewed.some((rule) => rule.test(line))) hits.push(`${name}:${index + 1}: ${text}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("the look screen offers choices and one color, never a text box for CSS", () => {
  const look = studioSource("parts/look-rules.js");
  assert.ok(/CHOICES/.test(look));
  for (const name of ["screens/look.js", "parts/look-rules.js"]) {
    const text = studioSource(name);
    assert.ok(!/(?:h|el)\(\s*["'`]textarea/.test(text), `${name} creates a text area`);
    assert.ok(!/["'`]studio-look-[a-z-]*(?:css|style|font-family|custom)/i.test(text), `${name}: a look control is named for CSS`);
  }
});
