// Who wrote a post (Studio R5). The first three tests are the old Admin's credit tests
// (admin-behavior.test.mjs), ported with the rules they test; the rest are Studio's own.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHOR_ROLE, byLine, creditHasAuthor, creditLineProblems, creditNames, creditPayload, creditState, creditsToSend,
  moveCredit, nextCredit, normalizeCreditDraft, toggleCreditRole, unknownRoles, validateCreditDraft,
} from "../../web/studio/parts/credit-rules.js";

const author = { vocabulary: "crossref", role: "author" };
const software = { vocabulary: "credit", role: "software" };

test("credit drafts preserve inherited, explicit empty, and ordered contributor semantics", () => {
  const credits = normalizeCreditDraft([
    { contributor: "ada", roles: [{ vocabulary: "crossref", role: "author" }] },
    { contributor: "grace", roles: [{ vocabulary: "credit", role: "software" }] },
    null,
  ]);
  assert.equal(creditPayload("unresolved", credits), undefined);
  assert.equal(creditPayload("inherited", credits), null);
  assert.deepEqual(creditPayload("explicit", []), []);
  assert.deepEqual(moveCredit(credits, 1, 0).map((credit) => credit.contributor), ["grace", "ada"]);
  assert.deepEqual(credits.map((credit) => credit.contributor), ["ada", "grace"], "moving does not mutate the saved draft");
});

test("controlled credit roles toggle without duplicates and validate author intent", () => {
  let credit = { contributor: "ada", roles: [author] };
  credit = toggleCreditRole(credit, software, true);
  credit = toggleCreditRole(credit, software, true);
  assert.deepEqual(credit.roles, [author, software]);
  credit = toggleCreditRole(credit, author, false);
  assert.deepEqual(credit.roles, [software]);
  assert.equal(validateCreditDraft("unresolved", []), "Choose how to repair the malformed contributor credits.");
  assert.equal(validateCreditDraft("inherited", []), "");
  assert.equal(validateCreditDraft("explicit", []), "");
  assert.match(validateCreditDraft("explicit", [{ contributor: "ada", roles: [] }]), /at least one role/);
  assert.match(validateCreditDraft("explicit", [{ contributor: "ada", roles: [author] }, { contributor: "ada", roles: [software] }]), /only once/);
  assert.equal(creditHasAuthor([{ contributor: "ada", roles: [author] }], { ada: { name: "Ada" } }), true);
  assert.equal(creditHasAuthor([{ contributor: "ada", roles: [software] }], { ada: { name: "Ada" } }), false);
  assert.equal(creditHasAuthor([{ contributor: "missing", roles: [author] }], {}), false);
  assert.deepEqual(normalizeCreditDraft([{ contributor: "ada", roles: [author, author] }])[0].roles, [author]);
});

test("a moved line moves only itself, and out-of-range moves change nothing", () => {
  const list = [{ contributor: "a", roles: [author] }, { contributor: "b", roles: [author] }];
  assert.deepEqual(moveCredit(list, 0, 5).map((c) => c.contributor), ["a", "b"]);
  assert.deepEqual(moveCredit(list, 1, 1).map((c) => c.contributor), ["a", "b"]);
});

test("a post's credits are in one of four states", () => {
  assert.equal(creditState({ credits: null }), "inherited");
  assert.equal(creditState({}), "inherited");
  assert.equal(creditState({ credits: [] }), "empty");
  assert.equal(creditState({ credits: [{ contributor: "ruth", roles: [author] }] }), "explicit");
  assert.equal(creditState({ credits: null, creditError: "cannot parse" }), "broken");
});

test("credits are sent only when they changed", () => {
  const ruth = [{ contributor: "ruth", roles: [author] }];
  // Never edited, or edited back to the same: the key is left out and the file untouched.
  assert.equal(creditsToSend(null, undefined), undefined);
  assert.equal(creditsToSend(ruth, undefined), undefined);
  assert.equal(creditsToSend(ruth, [{ contributor: "ruth", roles: [author, author] }]), undefined);
  assert.equal(creditsToSend(null, null), undefined);
  // "Just me": back to the blog's usual name.
  assert.equal(creditsToSend(ruth, null), null);
  // Name no one, and a new list.
  assert.deepEqual(creditsToSend(null, []), []);
  assert.deepEqual(creditsToSend(null, ruth), ruth);
  assert.deepEqual(creditsToSend(ruth, [...ruth, { contributor: "ann", roles: [author] }]).map((c) => c.contributor), ["ruth", "ann"]);
});

test("names on a post in order, and the by-line", () => {
  const registry = { ruth: { name: "Ruth Nichols" } };
  assert.deepEqual(creditNames(null, registry, { name: "Grammi" }), ["Grammi"]);
  assert.deepEqual(creditNames([{ contributor: "ruth", roles: [author] }, { contributor: "gone", roles: [author] }], registry), ["Ruth Nichols", "gone"]);
  assert.equal(byLine(["Grammi"]), "By Grammi");
  assert.equal(byLine(["Grammi", "Ruth"]), "By Grammi and Ruth");
  assert.equal(byLine(["Grammi", "Ruth", "Ann"]), "By Grammi, Ruth and Ann");
  assert.equal(byLine([]), "No one named");
});

test("each line names someone once; new lines are authors; unknown roles are found", () => {
  const problems = creditLineProblems([{ contributor: "", roles: [author] }, { contributor: "ruth", roles: [author] }, { contributor: "ruth", roles: [author] }]);
  assert.equal(problems.get(0), "Choose who, or remove this line.");
  assert.equal(problems.has(1), false);
  assert.match(problems.get(2), /listed already/);
  assert.deepEqual(nextCredit([{ contributor: "ruth", roles: [author] }], ["ruth", "ann"]), { contributor: "ann", roles: [AUTHOR_ROLE] });
  assert.equal(nextCredit([{ contributor: "ruth", roles: [author] }], ["ruth"]), null);
  assert.deepEqual(unknownRoles({ contributor: "ruth", roles: [author, { vocabulary: "credit", role: "foo" }] }, [author]), ["credit:foo"]);
});
