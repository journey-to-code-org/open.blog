import { test } from "node:test";
import assert from "node:assert/strict";
import { needs } from "../../web/studio/parts/site-health.js";

const site = { repo: true, remote: "origin", auto: false, changed: [], ahead: 0 };

test("all well says nothing needs her", () => {
  assert.deepEqual(needs({ lastError: null }, site), []);
  assert.deepEqual(needs({}, { repo: false }), [], "no repository: nothing to send, nothing to nag about");
  assert.deepEqual(needs({}, { ...site, auto: true, changed: ["a.md"] }), [], "a site that sends itself out");
});

test("a failed update, waiting changes and a forgetful server are each said once, in her words", () => {
  const found = needs({ lastError: "theme `x` not found", filesMayVanish: true }, { ...site, changed: ["content/posts/a.md", "openblog.json"] });
  assert.deepEqual(found.map((n) => n.id), ["build", "send", "vanish"]);
  assert.equal(found[1].words, "2 changes are waiting to go out to your site.");
  assert.doesNotMatch(found.map((n) => n.words).join(" "), /theme|json|commit|push|git/i);
  assert.equal(needs({}, { ...site, ahead: 2 })[0].words, "Some saved changes haven't reached your site yet.");
});
