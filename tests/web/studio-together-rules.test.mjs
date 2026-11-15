import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_SHARED_SOURCES, REVEAL_POLICIES, ROLE_CHOICES, SHARED_SOURCE_KINDS, TOGETHER_CODES, canInvite, emptySharedSource,
  invitationPayload, invitationShareLink, invitationStatusText, joinNames, memberWarnings, peopleWords, previewSectionText,
  previewStateText, removalImpact, revealSlotText, roleChangeImpact, roleChoice, roleWords, sharedReflectionFieldId,
  sharedReflectionPayload, sharedSourceHref, sourceWords, stepButtonWords, suggestSignInName, togetherPeopleRows,
  togetherProblem, togetherStep, validateInvitationDraft, validateSharedReflectionDraft,
} from "../../web/studio/parts/together-rules.js";
import { catalog, configureWords, say } from "../../web/studio/parts/words.js";
import { HER_BANNED, bannedExcept } from "../../web/studio/parts/plain-words.js";

// Ported from tests/web/admin-shared-reflection, -invitations and -members (Studio R14a, the rules
// half; the old panels' chrome is covered by tests/browser/studio-together.spec.mjs), then the
// states, rows and refusals the old Admin never had.

const draft = (overrides = {}) => ({
  title: "On attention",
  guidingQuestion: "",
  contributorId: "ada",
  sources: [{ ...emptySharedSource("video"), title: "The Art of Noticing", url: "https://www.youtube.com/watch?v=abc" }],
  ...overrides,
});

test("what started it: video, article, podcast, book or something else, each with an example", () => {
  assert.deepEqual(SHARED_SOURCE_KINDS.map((kind) => kind.value), ["video", "article", "podcast", "book", "other"]);
  for (const kind of SHARED_SOURCE_KINDS) assert.ok(kind.words() && kind.example(), kind.value);
  assert.deepEqual(emptySharedSource(), { kind: "video", title: "", url: "", creator: "", publisher: "", published: "", isbn: "" });
  assert.equal(sourceWords({ kind: "video", title: "How to Listen" }), "A video: How to Listen");
  assert.equal(sourceWords({ kind: "mystery", title: "X" }), "Something else: X");
  assert.equal(MAX_SHARED_SOURCES, 20);
});

test("a start needs a titled source, then a question or a name, then her name, in that order", () => {
  assert.equal(validateSharedReflectionDraft(draft()), null);
  assert.equal(validateSharedReflectionDraft(draft({ title: "", guidingQuestion: "What changed?" })), null);
  assert.equal(validateSharedReflectionDraft(draft({ title: "  ", guidingQuestion: " " })).field, "title");
  assert.equal(validateSharedReflectionDraft(draft({ title: "  ", guidingQuestion: " " })).words, say("together.needQuestion"));
  assert.equal(validateSharedReflectionDraft(draft({ sources: [] })).field, "sources");
  assert.equal(validateSharedReflectionDraft(draft({ sources: [{ ...emptySharedSource("book"), title: " " }] })).field, "sources.0.title");
  assert.equal(validateSharedReflectionDraft(draft({ contributorId: "" })).words, say("together.needYourName"));
  assert.equal(validateSharedReflectionDraft({ title: "", guidingQuestion: "", contributorId: "", sources: [emptySharedSource()] }).field, "sources.0.title");
});

test("links are http(s) without a name or password, and the refusal never repeats what was typed", () => {
  for (const url of ["https://example.org/a", "http://example.com", "https://bücher.example/straße"]) {
    assert.equal(validateSharedReflectionDraft(draft({ sources: [{ ...emptySharedSource("article"), title: "Link", url }] })), null, url);
  }
  for (const url of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "mailto:ada@example.org", "//example.org", "example.org", "https://ada:secret@example.org/"]) {
    const problem = validateSharedReflectionDraft(draft({ sources: [{ ...emptySharedSource("video"), title: "Talk" }, { ...emptySharedSource("article"), title: "Link", url }] }));
    assert.equal(problem?.field, "sources.1.url", url);
    assert.doesNotMatch(problem.words, /secret|alert|passwd/);
  }
  assert.equal(sharedSourceHref("https://example.org/a"), "https://example.org/a");
  assert.equal(sharedSourceHref("javascript:alert(1)"), "");
  assert.equal(sharedSourceHref(undefined), "");
  assert.equal(sharedSourceHref("https://user:pass@example.org/"), "");
});

test("an ISBN is checked for shape and only sent for a book", () => {
  for (const isbn of ["12345", "ISBN 0-86547-454-X", "X865474549"]) {
    assert.equal(validateSharedReflectionDraft(draft({ sources: [{ ...emptySharedSource("book"), title: "Book", isbn }] })).field, "sources.0.isbn", isbn);
  }
  const switched = { ...emptySharedSource("video"), title: "Talk", isbn: "not used" };
  assert.equal(validateSharedReflectionDraft(draft({ sources: [switched] })), null);
  assert.equal(sharedReflectionPayload(draft({ sources: [switched] })).sources[0].isbn, "");
  const book = { ...emptySharedSource("book"), title: "Über das Zuhören — 聴く", creator: "Ada", publisher: "Press", published: "1843", isbn: "0-86547-454-X" };
  assert.deepEqual(sharedReflectionPayload(draft({ sources: [book] })).sources[0], { kind: "book", title: "Über das Zuhören — 聴く", url: "", creator: "Ada", publisher: "Press", published: "1843", isbn: "0-86547-454-X" });
});

test("the start request keeps the order, names no one but her, and starts sharing when everyone's ready", () => {
  const payload = sharedReflectionPayload(draft({ title: "  Working title ", guidingQuestion: " What changed? ",
    sources: [{ ...emptySharedSource("podcast"), title: " Second ", url: " https://example.org/2 " }, { ...emptySharedSource("other"), title: "Third" }] }));
  assert.deepEqual(Object.keys(payload).sort(), ["contributorId", "guidingQuestion", "revealPolicy", "sources", "title"]);
  assert.equal(payload.title, "Working title");
  assert.deepEqual(payload.sources.map((s) => s.title), ["Second", "Third"]);
  assert.equal(payload.revealPolicy, "allReady", "⚑ 5: the default");
  assert.equal(sharedReflectionPayload({ ...draft(), revealPolicy: "voluntary" }).revealPolicy, "voluntary");
  assert.equal(sharedReflectionPayload({ ...draft(), revealPolicy: "independent" }).revealPolicy, "allReady", "never on her layer");
  assert.doesNotMatch(JSON.stringify(payload), /adminUser|participant|roles|binding/);
  assert.deepEqual(REVEAL_POLICIES.map((p) => p.value), ["allReady", "voluntary"]);
});

test("the server's field names land on the start form's own fields", () => {
  assert.deepEqual(sharedReflectionFieldId("title"), { field: "title", index: -1 });
  assert.deepEqual(sharedReflectionFieldId("guidingQuestion"), { field: "question", index: -1 });
  assert.deepEqual(sharedReflectionFieldId("contributorId"), { field: "yourName", index: -1 });
  assert.deepEqual(sharedReflectionFieldId("sources.2.url"), { field: "url", index: 2 });
  for (const bad of ["sources.x.url", '"><img src=x>', ""]) assert.deepEqual(sharedReflectionFieldId(bad), { field: "", index: -1 });
});

// ---- people and invitations

test("what someone does is her words, every stored set reads back, and unknown roles are kept", () => {
  assert.deepEqual(ROLE_CHOICES.map((c) => c.value), ["writes", "writesRuns", "reads", "inCharge"]);
  assert.equal(ROLE_CHOICES.filter((c) => c.ownerOnly).length, 1);
  for (const choice of ROLE_CHOICES) assert.equal(roleChoice(choice.roles)?.value, choice.value);
  assert.equal(roleWords(["contributor"]), "Writes a part");
  assert.equal(roleWords(["coordinator", "contributor"]), "Writes a part and helps run it");
  assert.equal(roleWords(["reader", "coordinator"]), "Helps run it, only reads");
  assert.equal(roleWords(["editor"]), "Edits", "⚑ 9: kept as stored, never offered");
  assert.equal(roleWords(["bogus"]), "Something else");
  assert.equal(roleWords([]), "Something else");
  // Every combination of the five roles has words, and none of them names a role as stored.
  const all = ["siteOwner", "coordinator", "contributor", "editor", "reader"];
  for (let mask = 1; mask < 32; mask++) {
    const roles = all.filter((_, i) => mask & (1 << i));
    assert.doesNotMatch(roleWords(roles), /siteOwner|coordinator|contributor|editor|reader|undefined/, roles.join());
  }
});

test("a co-writer can't invite someone new, an owner account, or put anyone in charge", () => {
  const owner = { coWriter: false, roles: ["siteOwner", "contributor"] };
  const runner = { coWriter: true, roles: ["coordinator", "contributor"] };
  assert.equal(canInvite(owner, { choice: "inCharge", newAccount: true }), true);
  assert.equal(canInvite({ coWriter: false, roles: ["coordinator"] }, { choice: "inCharge" }), false, "only someone in charge");
  assert.equal(canInvite(runner, { choice: "writes", newAccount: true }), false);
  assert.equal(canInvite(runner, { choice: "writes" }), true);
  assert.equal(canInvite(runner, { choice: "inCharge" }), false);
  assert.equal(canInvite({ coWriter: true, roles: ["contributor"] }, { choice: "writes" }), false, "writing a part isn't running it");
  assert.equal(canInvite(owner, { choice: "editor" }), false, "not a choice");
});

test("the invitation request carries only what was chosen, and a new person's sign-in under newAccount", () => {
  assert.deepEqual(invitationPayload("shared-0a1b2c3d4e5f", { contributorId: "lee", newAccount: true, signInName: " leepark ", choice: "writes", lifetimeDays: "3", token: "x" }),
    { publicationId: "shared-0a1b2c3d4e5f", contributorId: "lee", roles: ["contributor"], newAccount: { signInName: "leepark" }, lifetimeDays: 3 });
  assert.deepEqual(invitationPayload("p", { contributorId: "sam", signInName: "sam", choice: "writesRuns" }),
    { publicationId: "p", contributorId: "sam", roles: ["contributor", "coordinator"], adminUser: "sam" });
  assert.deepEqual(invitationPayload("p", { contributorId: "sam", signInName: "sam", choice: "bogus" }).roles, ["contributor"]);
  assert.equal("lifetimeDays" in invitationPayload("p", { lifetimeDays: "" }), false);
});

test("an invitation names its first problem in reading order", () => {
  assert.equal(validateInvitationDraft({}).field, "name");
  assert.equal(validateInvitationDraft({ contributorId: "lee", newAccount: true }).field, "signIn");
  assert.equal(validateInvitationDraft({ contributorId: "lee", signInName: "Lee Park" }).field, "signIn");
  assert.equal(validateInvitationDraft({ contributorId: "lee", signInName: "leepark", lifetimeDays: "31" }).field, "days");
  assert.equal(validateInvitationDraft({ contributorId: "lee", signInName: "leepark", lifetimeDays: "7" }), null);
});

test("a sign-in name is suggested from the name: plain letters, short, and never one already taken", () => {
  assert.equal(suggestSignInName("Lee Park"), "leepark");
  assert.equal(suggestSignInName("Zoë Ångström"), "zoeangstrom");
  assert.equal(suggestSignInName("李"), "writer");
  assert.equal(suggestSignInName("Lee Park", ["leepark", "leepark2"]), "leepark3");
  assert.ok(suggestSignInName("x".repeat(80)).length <= 32);
  assert.match(suggestSignInName("<script>"), /^[a-z0-9]+$/);
});

test("a link to copy is only ever this blog's join address, in either form", () => {
  const secret = "a".repeat(64);
  assert.equal(invitationShareLink("https://blog.example", `/admin/studio/#/together/join/shared-0a1b2c3d4e5f.${secret}`), `https://blog.example/admin/studio/#/together/join/shared-0a1b2c3d4e5f.${secret}`);
  assert.equal(invitationShareLink("https://blog.example", `/admin/#/shared/accept/shared-0a1b2c3d4e5f.${secret}`), `https://blog.example/admin/#/shared/accept/shared-0a1b2c3d4e5f.${secret}`);
  for (const bad of ["https://evil.example/", "//evil.example", "/other", "", null]) assert.equal(invitationShareLink("https://blog.example", bad), "");
});

test("roles, invitations and warnings are words, never colour alone; impact is said before it happens", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  for (const state of ["pending", "accepted", "declined", "revoked", "expired"]) {
    assert.match(invitationStatusText({ state, expiresAt: Date.parse("2026-11-21T12:00:00Z") / 1000 }, "Lee", { now, timeZone: "UTC" }), /\w+ \w+/, state);
  }
  assert.equal(invitationStatusText({ state: "pending", expiresAt: Date.parse("2026-11-21T12:00:00Z") / 1000 }, "Lee", { now, timeZone: "UTC" }), "Waiting for Lee to say yes, until Saturday, November 21.");
  assert.equal(invitationStatusText({ state: "revoked" }), say("people.inviteStateRevoked"));
  const member = (over = {}) => ({ displayName: "Ruth", adminUser: "ruth", roles: ["contributor", "coordinator"], hasContributions: true, bindingCurrent: true, ...over });
  assert.deepEqual(memberWarnings(member()), []);
  assert.match(memberWarnings(member({ bindingCurrent: false }))[0], /Ruth's sign-in/);
  assert.equal(removalImpact(member()), say("people.stopText"));
  assert.equal(removalImpact(member({ hasContributions: false })), say("people.stopTextNothing"));
  assert.deepEqual(roleChangeImpact(member(), ["contributor", "coordinator", "reader"]), [], "adding takes nothing away");
  assert.deepEqual(roleChangeImpact(member(), ["contributor"]), [say("people.loseRun", { name: "Ruth" }), say("people.keepsWords")]);
  assert.ok(roleChangeImpact(member({ roles: ["siteOwner", "contributor"] }), ["contributor"]).includes(say("people.loseCharge", { name: "Ruth" })));
  assert.ok(roleChangeImpact(member({ roles: ["contributor"] }), ["reader"]).includes(say("people.loseWrite", { name: "Ruth" })));
});

// ---- reading

test("each part says only what the reader may know", () => {
  assert.equal(revealSlotText({ kind: "own", displayName: "Ada" }), say("read.yourPart"));
  assert.equal(revealSlotText({ kind: "revealed", displayName: "Grace", stamp: { number: 2 } }), "Grace");
  const offered = revealSlotText({ kind: "private", displayName: "Linus", ready: true });
  const quiet = revealSlotText({ kind: "private", displayName: "Linus", ready: false });
  assert.equal(offered, quiet, "whether someone has offered isn't the reader's to know here");
  assert.doesNotMatch(offered + quiet, /\d/);
});

test("preview lines say where each agreement stands, never a version number", () => {
  assert.equal(previewSectionText({ displayName: "Ada", shown: true, revision: 2, approval: "approved", required: true }), "Ada agreed");
  assert.equal(previewSectionText({ displayName: "Grace", shown: false, revision: 3, approval: "stale" }), "Grace's part isn't shared with you yet");
  assert.equal(previewSectionText({ displayName: "Linus", shown: true, revision: 1, approval: "stale" }), "Linus agreed to an earlier version");
  assert.equal(previewSectionText({ displayName: "Linus", shown: true, revision: 1, approval: "awaiting", required: false }), "Linus: their agreement isn't needed");
  assert.equal(previewStateText({ ready: true }), say("read.allAgreed"));
  assert.equal(previewStateText({ complete: true, sections: [{ displayName: "Sam", approval: "awaiting" }, { displayName: "Lee", approval: "stale" }, { displayName: "Ann", approval: "approved" }] }), "Not ready: Sam and Lee still need to agree.");
  assert.equal(previewStateText({}), say("read.incomplete"));
  assert.equal(joinNames(["Ruth"]), "Ruth");
  assert.equal(joinNames(["Ruth", "Sam", "Lee"]), "Ruth, Sam and Lee");
  assert.equal(joinNames([" ", null]), "");
});

// ---- where it stands

const person = (displayName, where, you = false) => ({ displayName, where, you });
const summary = (over = {}) => ({
  publicationId: "shared-0a1b2c3d4e5f", title: "What we noticed", guidingQuestion: "What changed?", sources: [{ kind: "video", title: "How to Listen" }],
  roles: ["siteOwner", "contributor"], state: "started", policy: "allReady", people: [person("Ann", "notStarted", true)], invitationsWaiting: 0, invited: [],
  you: { drafter: true, wrote: false, shared: false, changedSinceShared: false, agreed: false, agreedStale: false, canPublish: true, canInvite: true, runsIt: true, inCharge: true },
  complete: false, missing: [], unmetNamed: [], unmetRoles: [], publishAt: null, path: null, archived: false, publisherName: "Ann", ...over,
});
const withYou = (s, you) => ({ ...s, you: { ...s.you, ...you } });

test("every state has one badge, one sentence and at most one primary step", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  const two = [person("Ann", "writing", true), person("Ruth", "ready")];
  const cases = [
    [summary(), "Just started", "Invite someone to write with you.", "invite"],
    [summary({ invitationsWaiting: 1, invited: [{ forName: "Lee", expiresAt: 0 }] }), "Waiting to hear back", "Waiting for Lee to say yes. Start your part meanwhile.", "write"],
    [summary({ people: two }), "Waiting on you", "Write your part.", "write"],
    [withYou(summary({ people: two }), { wrote: true }), "Waiting on you", "Let the others read it when you're ready.", "share"],
    [withYou(summary({ people: [person("Ann", "ready", true), person("Sam", "notReady"), person("Lee", "notReady")] }), { wrote: true, shared: true }), "Waiting on others", "Waiting for Sam and Lee to be ready.", "read"],
    [withYou(summary({ people: two, complete: true }), { wrote: true, shared: true }), "Waiting on you", "Read everyone's parts and say if you agree.", "read"],
    [withYou(summary({ people: [person("Ann", "agreed", true), person("Ruth", "ready")], complete: true }), { wrote: true, shared: true, agreed: true }), "Waiting on others", "Waiting for Ruth to agree.", null],
    [withYou(summary({ people: two, complete: true }), { wrote: true, shared: true, agreedStale: true }), "Waiting on you", say("together.stepReadAgain"), "read"],
    [withYou(summary({ people: two, complete: true }), { wrote: true, shared: true, changedSinceShared: true }), "Waiting on you", say("together.stepShareChanges"), "share"],
    [summary({ state: "ready", people: two }), "Ready to publish", "Everyone agreed.", "publish"],
    [withYou(summary({ state: "ready", people: two }), { canPublish: false }), "Ready to publish", "Everyone agreed. Waiting for Ann to publish it.", null],
    [summary({ state: "scheduled", publishAt: "2026-11-27T13:00:00Z" }), "Goes up Friday, November 27 at 1 PM", "It goes up on Friday, November 27 at 1 PM.", null],
    [summary({ state: "published", path: "posts/shared-0a1b2c3d4e5f.md" }), "On your blog", "It's on your blog.", "open"],
    [summary({ state: "stuck", unmetNamed: ["Sam"] }), "Stuck", "It can't be published as it stands: Sam can't agree any more.", null],
    [summary({ state: "privateParts" }), "Each part private", say("together.stepPrivate"), "change"],
    [summary({ archived: true }), "Put away", "", "bringBack"],
  ];
  for (const [s, badge, step, primary] of cases) {
    const at = togetherStep(s, { now, timeZone: "UTC" });
    assert.equal(at.badge, badge, step);
    assert.equal(at.step, step, badge);
    assert.equal(at.primary, primary, `${badge}: ${step}`);
    if (at.primary) assert.ok(stepButtonWords(at.primary), at.primary);
  }
  // A co-writer never publishes, opens the post in Write, or brings one back.
  assert.equal(togetherStep(summary({ state: "published" }), { coWriter: true }).primary, null);
  assert.equal(togetherStep(summary({ archived: true }), { coWriter: true }).primary, null);
  assert.equal(togetherStep(withYou(summary({ state: "ready" }), { canPublish: false, }), { coWriter: true }).primary, null);
  // Readers-only: no writing or agreeing.
  const reader = togetherStep(withYou(summary({ people: two }), { drafter: false }));
  assert.equal(reader.primary, null);
  assert.equal(reader.step, say("together.stepReads"));
  // Schedule is a second button beside Publish, never a second primary.
  assert.equal(togetherStep(summary({ state: "ready" })).secondary, "schedule");
  assert.equal(togetherStep(summary({ state: "scheduled", publishAt: "2026-11-27T13:00:00Z" })).secondary, "unschedule");
});

test("each person is one row of text, and invitations say who and until when", () => {
  const rows = togetherPeopleRows(summary({ people: [person("Ann", "writing", true), person("Ruth", "ready"), person("Sam", "left"), person("Bo", "agreedEarlier")],
    invited: [{ forName: "Lee", expiresAt: Date.parse("2026-11-20T12:00:00Z") / 1000 }] }), { now: new Date("2026-11-14T12:00:00Z"), timeZone: "UTC" });
  assert.deepEqual(rows.map((row) => row.text), ["You: writing", "Ruth: ready", "Sam: isn't in it any more", "Bo: agreed to an earlier version", "Waiting for Lee to say yes, until Friday, November 20."]);
  assert.equal(togetherPeopleRows(summary({ invitationsWaiting: 2 })).at(-1).text, "2 invitations waiting for an answer.");
  assert.equal(peopleWords(summary({ people: [person("Ann", "writing", true), person("Ruth", "ready"), person("Sam", "left")] })), "You and Ruth");
});

// ---- refusals

const RUST = readFileSync(new URL("../../crates/openblog-cli/src/admin/together.rs", import.meta.url), "utf8");

test("every code the server can send has her words, from the server's own list", () => {
  const block = RUST.slice(RUST.indexOf("pub(crate) const CODES"), RUST.indexOf("];", RUST.indexOf("pub(crate) const CODES")));
  const codes = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length > 20);
  assert.deepEqual([...TOGETHER_CODES], codes, "TOGETHER_CODES matches CODES in together.rs: add the new code's words");
  for (const code of codes) {
    for (const place of ["start", "part", "read", "publish", "invite", "join", "page"]) {
      const said = togetherProblem({ status: 409, data: { code, missing: ["Sam"], unmetNamed: ["Sam"] } }, place);
      assert.ok(said.words && !said.words.includes("{"), `${code} at ${place}`);
      assert.equal(bannedExcept(said.words), "", `${code} at ${place}: ${said.words}`);
      assert.doesNotMatch(said.words, /\b\d{3}\b|code|revision|reveal|contributor/i, `${code}: ${said.words}`);
    }
  }
  assert.equal(togetherProblem({ status: 409, data: { code: "unapproved", missing: ["Sam", "Lee"] } }).words, "Sam and Lee still need to agree.");
  assert.equal(togetherProblem({ status: 409, data: { code: "changed" } }, "part").words, say("part.conflict"));
  assert.equal(togetherProblem({ status: 404, data: { code: "not-found" } }).reload, true);
  assert.equal(togetherProblem({ status: 422, data: { code: "invalid", field: "sources.1.url" } }, "start").words, say("together.badLink"));
  assert.equal(togetherProblem({ status: 403, data: { code: "owner-only", field: "adminUser" } }, "invite").words, say("people.coWriterOnly"));
  assert.equal(togetherProblem({ status: 0 }).words, say("together.needsSignal"));
  assert.equal(togetherProblem({ status: 500 }).code, "storage");
  assert.equal(togetherProblem({ status: 418, data: { code: "never-heard-of-it" } }).words, `${say("together.failed")} ${say("common.tell")}`);
});

// ---- words

test("Writing together's words are generic, plain and her own", () => {
  const ids = Object.keys(catalog()).filter((id) => /^(together|people|join|part|read)\./.test(id));
  assert.ok(ids.length > 250, String(ids.length));
  const EXTRA = /\b(revision|reveal|participant|publication|binding|token|policy|coordinator|site owner|synthesis|assembly|Studio|Admin|contributor|editor)s?\b/i;
  const PERSONA = /Grammi|Mikey|Pumpkin|\bRuth\b|\bElkins\b|\bDana\b|\bLee\b|\bSam\b/;
  for (const id of ids) {
    const entry = catalog()[id];
    assert.doesNotMatch(entry.text, PERSONA, id);
    if (entry.layer !== "her") continue;
    assert.equal(bannedExcept(entry.text, entry.allows), "", id);
    assert.doesNotMatch(entry.text, EXTRA, id);
    assert.doesNotMatch(entry.text, /\{owner\}/, `${id}: people are named from data`);
  }
  assert.ok(HER_BANNED.test("contributor"));
  // With any helper and any product, every sentence still reads.
  configureWords({ vars: { helper: "Hillside Web Care", product: "your website" } });
  assert.equal(say("part.cantWrite"), "You read this one; you don't write a part. Hillside Web Care or whoever runs it can change that.");
  assert.equal(say("together.lede").endsWith("Nothing goes on your website until everyone agrees."), true);
  configureWords();
});
