import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GLOSSARY, TOUR_STEPS } from "../../web/admin/landing.js";
import {
  FILES_MAY_VANISH_BODY,
  FILES_MAY_VANISH_SHORT,
  glossaryFor,
  savedMessage,
  tourBodyFor,
} from "../../web/admin/lasting.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const admin = read("web/admin/admin.js");
const blueprint = read("render.yaml");
const deploy = read("docs/deploy.md");
const publishing = read("docs/publishing.md");
const site = read("crates/openblog-cli/src/site.rs");

test("the notice says what can happen, to what, and who to ask, with no jargon", () => {
  for (const words of ["restarts", "drafts", "photos", "whoever set up this site", "Keep your work safe on Render"]) {
    assert.ok(FILES_MAY_VANISH_BODY.includes(words), words);
  }
  for (const text of [FILES_MAY_VANISH_BODY, FILES_MAY_VANISH_SHORT]) {
    assert.doesNotMatch(text, /\b(git|ephemeral|filesystem|container|Supabase|deploy)\b/i);
  }
});

test("a save says it can vanish only where it can", () => {
  assert.equal(savedMessage("Saved.", false), "Saved.");
  const said = savedMessage("Saved.", true);
  assert.match(said, /^Saved\. /);
  assert.match(said, /can still vanish if the server restarts/);
});

test("the Landing page stops saying Save keeps your changes only where that is false", () => {
  const saveEntry = (list) => list.find((entry) => entry.term === "Save").meaning;
  assert.match(saveEntry(glossaryFor(GLOSSARY, false)), /^Keeps your changes/);
  assert.doesNotMatch(saveEntry(glossaryFor(GLOSSARY, true)), /Keeps your changes/);
  assert.match(saveEntry(glossaryFor(GLOSSARY, true)), /can vanish/);

  const last = TOUR_STEPS[TOUR_STEPS.length - 1];
  assert.match(tourBodyFor(last, false), /Save keeps your changes/);
  assert.doesNotMatch(tourBodyFor(last, true), /Save keeps your changes/);
  assert.match(tourBodyFor(last, true), /can vanish/);
  // The other steps do not talk about saving, so they stay as they are.
  assert.equal(tourBodyFor(TOUR_STEPS[0], true), TOUR_STEPS[0].body);
});

test("Admin reads the answer on every path and no longer says drafts are kept local", () => {
  assert.doesNotMatch(admin, /kept local/i);
  assert.match(admin, /status\.filesMayVanish === true \? h\("div", \{ class: "oba-notice", "data-files-may-vanish": "true" \}/);
  assert.match(admin, /this\.filesMayVanish = st\.filesMayVanish === true/);
  assert.match(admin, /savedMessage\(message, this\.app\.filesMayVanish === true\)/);
  assert.equal(admin.match(/publishFailureDetail\(/g).length, 4, "the header, the Landing page, Customize look, and its definition");
});

test("the module is served and embedded like the other Admin modules", () => {
  assert.match(read("crates/openblog-cli/src/admin.rs"), /"\/admin\/lasting\.js" => "lasting\.js"/);
  assert.match(site, /include_str!\("\.\.\/\.\.\/\.\.\/web\/admin\/lasting\.js"\)/);
});

test("the blueprint asks for each setting that keeps her work, without a value", () => {
  for (const name of ["OPENBLOG_GIT_TOKEN", "OPENBLOG_WORKSPACE_SUPABASE_URL", "OPENBLOG_WORKSPACE_SECRET_KEY", "OPENBLOG_WORKSPACE_NAMESPACE"]) {
    assert.match(blueprint, new RegExp(`- key: ${name}\\n\\s+sync: false`), name);
  }
});

test("the blueprint and the docs no longer claim what is false", () => {
  assert.doesNotMatch(blueprint, /survive through the analytics branch/);
  assert.doesNotMatch(blueprint, /only until the next deploy/);
  assert.match(blueprint, /A disk here \(paid plans\) keeps only the \.openblog folder/);
  assert.doesNotMatch(deploy, /view counts survive through the analytics branch/);
  assert.doesNotMatch(publishing, /read it\s+back from the branch/);
  assert.doesNotMatch(publishing, /kept local/);
});

test("the deploy guide names what to create and does not claim a live test", () => {
  const section = deploy.slice(deploy.indexOf("### Keep your work safe on Render"), deploy.indexOf("The Dockerfile assumes the blog lives"));
  for (const name of ["OPENBLOG_GIT_TOKEN", "OPENBLOG_WORKSPACE_SUPABASE_URL", "OPENBLOG_WORKSPACE_SECRET_KEY", "OPENBLOG_WORKSPACE_NAMESPACE", "supabase/workspace.sql"]) {
    assert.ok(section.includes(name), name);
  }
  assert.match(section, /No one has\s+run this setup against a live Render service/);
});
