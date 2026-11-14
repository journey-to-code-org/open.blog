// People (Studio R5). The first test is the old Admin's Contributors draft test
// (admin-behavior.test.mjs), ported with the rules it tests; the rest are Studio's own.
import assert from "node:assert/strict";
import test from "node:test";

import {
  contributorDraftPayload, newId, normalizeContributorDraft, orcidOk, peopleProblem, personProblem, siteWords, validateContributorDraft,
} from "../../web/studio/parts/people-rules.js";

test("contributor drafts preserve stable ids and prefill editable identity fields", () => {
  const draft = normalizeContributorDraft({
    ada: { name: " Ada Lovelace ", url: "/people/ada/", sameAs: ["https://example.test/ada"], orcid: "0000-0002-1825-0097" },
  });
  assert.deepEqual(draft, [{ id: "ada", originalId: "ada", name: " Ada Lovelace ", url: "/people/ada/", sameAs: "https://example.test/ada", orcid: "0000-0002-1825-0097" }]);
  assert.equal(validateContributorDraft(draft), "");
  assert.deepEqual(contributorDraftPayload(draft), {
    ada: { name: "Ada Lovelace", url: "/people/ada/", sameAs: ["https://example.test/ada"], orcid: "0000-0002-1825-0097" },
  });
  assert.match(validateContributorDraft([{ ...draft[0], id: "Ada Lovelace" }]), /lowercase ASCII slug/);
  assert.match(validateContributorDraft([{ ...draft[0], id: "renamed", originalId: "ada" }]), /cannot be renamed/);
  assert.match(validateContributorDraft([{ ...draft[0], sameAs: "javascript:alert(1)" }]), /HTTP/);
});

test("a new person's id comes from their name and is never someone else's", () => {
  assert.equal(newId("Ruth Nichols"), "ruth-nichols");
  assert.equal(newId("Zoë  O'Brien!"), "zoe-o-brien");
  assert.equal(newId("Ruth Nichols", ["ruth-nichols"]), "ruth-nichols-2");
  assert.equal(newId("Ruth Nichols", ["ruth-nichols", "ruth-nichols-2"]), "ruth-nichols-3");
  assert.equal(newId("!!!"), "person");
  assert.match(newId("x".repeat(100)), /^x{1,60}$/);
});

test("an ORCID iD needs its check digit", () => {
  assert.equal(orcidOk("0000-0002-1825-0097"), true);
  assert.equal(orcidOk("https://orcid.org/0000-0002-1825-0097"), true);
  assert.equal(orcidOk("0000-0002-1694-233X"), true);
  assert.equal(orcidOk("0000-0002-1825-0098"), false);
  assert.equal(orcidOk("1234"), false);
});

test("her checks name the field and say the fix", () => {
  assert.deepEqual(personProblem({ name: " " }), { field: "name", words: "Add their name." });
  assert.deepEqual(personProblem({ name: "Ruth", url: "ruthbakes.com" }), { field: "url", words: "A full web address, starting with https://." });
  assert.equal(personProblem({ name: "Ruth", url: "https://ruthbakes.com", orcid: "0000-0002-1825-0098" }).field, "orcid");
  assert.equal(personProblem({ name: "Ruth", url: "https://ruthbakes.com" }), null);
  assert.equal(siteWords("https://www.ruthbakes.com/"), "ruthbakes.com");
  assert.equal(siteWords("https://example.com/ruth/"), "example.com/ruth");
});

test("every refusal the server names is said in her words", () => {
  assert.equal(peopleProblem({ status: 409, data: { code: "changed" } }).reload, true);
  const named = peopleProblem({ status: 422, data: { code: "named-on-posts", posts: [{ path: "posts/a.md", title: "Cornbread" }, { path: "posts/b.md", title: "Pie" }] } }, "Ruth");
  assert.equal(named.words, "Ruth is named on 2 posts, so Ruth stays for now. Take Ruth off them first:");
  assert.equal(named.posts.length, 2);
  assert.match(peopleProblem({ status: 422, data: { code: "in-shared-reflection" } }, "Ruth").words, /reflection with others/);
  assert.match(peopleProblem({ status: 422, data: { code: "named-in-sources" } }, "Ruth").words, /research notes/);
  assert.deepEqual(peopleProblem({ status: 422, data: { code: "invalid", field: "url" } }), { words: "A full web address, starting with https://.", field: "url" });
  assert.equal(peopleProblem({ status: 500, data: {} }).words, "That didn't save. Tell the person who set up your site.");
  // An older server's answer, with only the paths.
  assert.equal(peopleProblem({ status: 422, data: { code: "named-on-posts", paths: ["posts/a.credits.json"] } }, "Ruth").posts[0].path, "posts/a.credits.json");
});
