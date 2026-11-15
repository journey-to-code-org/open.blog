// The writing helper's rules (Studio R8, docs/specs/studio/r8/ux.md). Ports the old Admin's
// admin-assistant-review, admin-assistant-skills and admin-behavior assistant cases in their
// Studio form (code-point ranges, one re-anchor, the source changed, a passage in code points,
// skill presentation and selectable ids), and adds what R8 decided: what goes is computed from her
// choices only and names everything sent, where she was never goes, and a suggestion can only swap
// its quoted words inside one box, outside any card, with an Undo that is exact.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  MAX_PASSAGE, NEVER_SENT, applyAssistantSuggestion, applyFinding, assistantReviewPassage, boxSpans, captureTarget, cardRanges, clip, companyName, detailGroups, findingInBoxes, findingPlace,
  helperLine, helperProblem, helperSource, helperState, lookForChoices, markdownHeadingStarts, moreThanWords, orderFindings, passageFor, plainSuggestion, reasonWords, reviewRequest, scopeOf,
  selectableSkillIds, shiftUsed, skillFitsScope, skillPresentation, skillsFor, sourceChanged, stateWords, undoFinding, usableFinding, whatGoes, wordsAbout,
} from "../../web/studio/parts/helper-rules.js";
import { defaultContextIds } from "../../web/studio/parts/helper-context-rules.js";
import { plainCompletion } from "../../web/studio/parts/suggest-rules.js";
import { configureWords } from "../../web/studio/parts/words.js";
import { transcribeTrouble, writeUpTrouble } from "../../web/studio/parts/job-words.js";

const SKILLS = [
  { id: "copy-review", name: "Copy review", version: "1", scopes: ["selection", "section", "document"], output: "review", valid: true, selectable: true },
  { id: "developmental-review", name: "Developmental review", version: "1", scopes: ["section", "document"], output: "review", valid: true, selectable: true },
  { id: "voice-review", name: "Voice review", version: "2", scopes: ["selection", "section", "document"], output: "review", valid: true, selectable: true },
  { id: "voice-match", name: "Voice match", version: "1", scopes: ["selection", "section"], output: "review", valid: true, selectable: true },
  { id: "source-review", name: "Source review", version: "1", scopes: ["section", "document"], output: "review", valid: true, selectable: true },
  { id: "technical-review", name: "Technical review", version: "3", scopes: ["selection", "section", "document"], output: "review", valid: true, selectable: true },
  { id: "release-review", name: "Release review", version: "1", scopes: ["document"], output: "review", valid: true, selectable: true },
  { id: "voice-guide", name: "Voice guide", version: "1", scopes: ["document"], output: "voice-guide", valid: true, selectable: true },
  { id: "broken", name: "Broken", version: "", scopes: [], output: "review", valid: false, selectable: false, errors: ["Add `description`."] },
];
const CATALOG = {
  documents: [
    { id: "private:author", name: "author.md", contextType: "author", visibility: "private", exists: true, valid: true, characters: 40 },
    { id: "portable:author", name: "author.md", contextType: "author", visibility: "portable", exists: false, valid: true, characters: 0 },
    { id: "portable:site", name: "site.md", contextType: "site", visibility: "portable", exists: true, valid: true, characters: 20 },
    { id: "private:site", name: "site.md", contextType: "site", visibility: "private", exists: false, valid: true, characters: 0 },
    { id: "private:post:pie.md", name: "pie.md", contextType: "post", visibility: "private", exists: true, valid: true, characters: 60 },
  ],
  voiceGuides: [{ id: "private:voice", name: "voice.md", contextType: "voice", visibility: "private", exists: true, valid: true, characters: 300 }],
  references: [{ id: "private:reference:style.md", name: "style.md", visibility: "private", exists: true, valid: true, characters: 90 }],
  postSnapshots: [{ id: "post:posts/other.md", name: "other.md", path: "posts/other.md", kind: "postSnapshot", visibility: "source", exists: true, valid: true, characters: 900 }],
  voiceSamples: [{ id: "voice:private:a-rough.md", name: "a-rough.md", kind: "voiceSample", visibility: "private", exists: true, valid: true, characters: 100 }],
  voiceBudget: { samples: 8, characters: 120000 },
};
const STATUS = { configured: true, providerType: "anthropic", company: "Anthropic", model: "claude-test", destination: "https://api.anthropic.com", reason: "ready" };

// ---- lifted: suggestions in code points

test("suggestions use Unicode code-point ranges and preserve unrelated text", () => {
  assert.deepEqual(applyAssistantSuggestion("Lead 🏮 glows", { evidence: "🏮", suggestion: "lantern", range: { start: 5, end: 6 } }), { ok: true, markdown: "Lead lantern glows", start: 5, sourceEnd: 6, end: 12 });
});

test("suggestions re-anchor only one exact stale evidence match", () => {
  assert.equal(applyAssistantSuggestion("New intro. Draft body", { evidence: "Draft body", suggestion: "A clear guide", range: { start: 0, end: 10 } }).markdown, "New intro. A clear guide");
  assert.deepEqual(applyAssistantSuggestion("Draft body and Draft body", { evidence: "Draft body", suggestion: "A clear guide", range: { start: 50, end: 60 } }), { ok: false, error: "twice" });
  assert.deepEqual(applyAssistantSuggestion("Completely rewritten", { evidence: "Draft body", suggestion: "A clear guide", range: { start: 0, end: 10 } }), { ok: false, error: "moved" });
});

test("an anchored suggestion applies to exactly its passage, and advice has nothing to apply", () => {
  const markdown = "Opening.\n\nIt is what it is, and so on.";
  const finding = { evidence: "It is what it is", suggestion: "That is that", range: { start: 10, end: 26 } };
  const applied = applyAssistantSuggestion(markdown, finding);
  assert.equal(applied.markdown, "Opening.\n\nThat is that, and so on.");
  const undone = applyAssistantSuggestion(applied.markdown, { evidence: finding.suggestion, suggestion: finding.evidence, range: { start: applied.start, end: applied.end } });
  assert.equal(undone.markdown, markdown);
  const advice = { evidence: "Words the author never wrote", suggestion: null, range: { start: 0, end: 0 } };
  assert.deepEqual(applyAssistantSuggestion("Opening.", advice), { ok: false, error: "none" });
  assert.equal(applyAssistantSuggestion("Opening.", { ...advice, suggestion: "Warmer" }).ok, false, "evidence that isn't in the post is never applied");
});

test("the source changed when the title, the words or the details moved on", () => {
  const sent = { title: "Pie", markdown: "Body", metadata: { tags: ["a"] } };
  assert.equal(sourceChanged(sent, { ...sent, metadata: { tags: ["a"] } }), false);
  assert.equal(sourceChanged(sent, { ...sent, title: "Pies" }), true);
  assert.equal(sourceChanged(sent, { ...sent, markdown: "Body." }), true);
  assert.equal(sourceChanged(sent, { ...sent, metadata: { tags: ["b"] } }), true);
});

test("a selection or part is sent as a bounded passage in code points", () => {
  const text = "# One\n\nFirst 🏮 part.\n\n## Two\n\nSecond part here.\n\n```sh\n# not a heading\n```\n\n## Three\n\nEnd.";
  assert.deepEqual(markdownHeadingStarts(text), [0, text.indexOf("## Two"), text.indexOf("## Three")]);
  const start = text.indexOf("Second");
  assert.deepEqual(assistantReviewPassage(text, start - 2, start + 11, "selection"), { passage: { kind: "selection", start: Array.from(text.slice(0, start)).length, end: Array.from(text.slice(0, start + 11)).length }, text: "Second part" });
  const section = assistantReviewPassage(text, start, start, "section");
  assert.equal(section.text.startsWith("## Two"), true);
  assert.equal(section.text.includes("# not a heading"), true, "a # line inside code is code");
  assert.equal(section.text.includes("## Three"), false);
  assert.deepEqual(assistantReviewPassage(text, 5, 5, "selection"), { error: "empty" });
  assert.deepEqual(assistantReviewPassage(text, 0, 4, "paragraph"), { error: "kind" });
  const long = "x".repeat(MAX_PASSAGE + 1);
  assert.equal(assistantReviewPassage(long, 0, long.length, "selection").error, "too-long");
  assert.equal(assistantReviewPassage("x".repeat(MAX_PASSAGE), 0, MAX_PASSAGE, "selection").error, undefined);
});

// ---- lifted: skills

test("a skill is shown with where it's from, its version, what it reads, and what needs fixing", () => {
  configureWords();
  assert.deepEqual(skillPresentation({ id: "copy-review", name: "Local copy review", source: "project", version: "2", scopes: ["selection", "document"], valid: true, selectable: true, overrideState: "active", errors: [] }), {
    title: "Local copy review", source: "Yours", line: "Yours · version 2 · reads selected words, the whole post", note: "Replaces the built-in one", disabled: false, editable: true, errors: [],
  });
  assert.deepEqual(skillPresentation({ id: "broken", source: "project", version: "", scopes: [], valid: false, selectable: false, errors: ["Add required front matter field `description`.", 7] }), {
    title: "broken", source: "Yours", line: "Yours · needs fixing", note: "", disabled: true, editable: true, errors: ["Add required front matter field `description`."],
  });
  assert.equal(skillPresentation({ id: "copy-review", name: "Copy review", source: "built-in", version: "1", scopes: ["section"], valid: true, selectable: false, overrideState: "overridden" }).note, "Replaced by yours");
  assert.equal(skillPresentation({ id: "x", source: "built-in", valid: true, selectable: true, scopes: ["section"] }).editable, false);
});

test("skill selection excludes invalid, overridden and unknown ids", () => {
  const skills = [{ id: "copy-review", valid: true, selectable: false }, { id: "copy-review", valid: true, selectable: true, source: "project" }, { id: "broken", valid: false, selectable: false }, { id: "technical-review", valid: true, selectable: true }];
  assert.deepEqual(selectableSkillIds(skills, ["copy-review", "broken", "missing", "technical-review", "copy-review"]), ["copy-review", "technical-review"]);
  assert.equal(skillFitsScope({ scopes: ["document"] }, "selection"), false);
  assert.equal(skillFitsScope({ scopes: ["document"] }), true);
  assert.equal(skillFitsScope({}, "document"), false);
});

// ---- its state and words

test("the helper's state comes from facts, never from the server's sentences", () => {
  configureWords();
  assert.deepEqual(helperState(null, { loading: true }), { state: "checking", reason: "" });
  assert.deepEqual(helperState(STATUS), { state: "ready", reason: "ready" });
  assert.deepEqual(helperState({ configured: false, reason: "no-key", message: "Add a private credential in Provider settings below" }), { state: "off", reason: "no-key" });
  assert.deepEqual(helperState({ configured: false, state: "invalid" }), { state: "off", reason: "bad-endpoint" }, "a server before G56");
  assert.deepEqual(helperState(STATUS, { online: false }), { state: "no-signal", reason: "" });
  assert.equal(stateWords({ state: "ready" }), "Your helper reads what you choose and suggests changes. Nothing changes until you say so.");
  assert.equal(stateWords({ state: "no-signal" }), "Your helper needs a signal. Your words are kept here.");
  assert.equal(stateWords({ state: "checking" }), "Checking your writing helper…");
  for (const [reason, words] of [["no-key", "No key is set."], ["no-model", "No model is chosen."], ["bad-endpoint", "The address isn't https."], ["key-other-provider", "The saved key is for another company or address."]]) assert.equal(reasonWords(reason), words);
});

test("the side card says what the helper is doing or has left", () => {
  configureWords();
  assert.equal(helperLine({ kind: "idle" }), "Read it over, or get a quiz.");
  assert.equal(helperLine({ kind: "reading" }), "Reading it over…");
  assert.equal(helperLine({ kind: "left", count: 3 }), "3 suggestions left");
  assert.equal(helperLine({ kind: "left", count: 1 }), "1 suggestion left");
  assert.equal(helperLine({ kind: "left", count: 0 }), "Nothing left to look at.");
  assert.equal(helperLine({ kind: "finished", count: 4 }), "Your helper finished reading. 4 suggestions.");
  assert.equal(helperLine({ kind: "no-signal" }), "Needs a signal.");
});

test("the company is named, never an address, a path or a model", () => {
  assert.equal(companyName({ company: "Anthropic" }), "Anthropic");
  for (const [provider, name] of [["anthropic", "Anthropic"], ["open-ai", "OpenAI"], ["gemini", "Google"], ["xai", "xAI"], ["deep-seek", "DeepSeek"], ["open-router", "OpenRouter"], ["mistral", "Mistral"]]) assert.equal(companyName({ providerType: provider }), name);
  assert.equal(companyName({ provider: "generic-https", destination: "https://user:pw@helper.example:8443/v1?api_key=q" }), "helper.example", "a custom address is its host");
  assert.equal(companyName({ provider: "generic-https", destination: "https://api.openai.com/v1" }), "OpenAI");
  assert.equal(companyName({ provider: "generic-https", destination: "https://notopenai.example" }), "notopenai.example", "a host that only contains a name isn't that company");
  assert.equal(companyName({ company: "<img src=x>", providerType: "anthropic" }), "Anthropic", "a name that isn't plain words is not used");
  assert.equal(companyName({}), "another company");
});

test("every failed helper call has one sentence for her and the facts for the helper", () => {
  configureWords();
  const say_ = (status, data, options = { company: "Anthropic" }) => helperProblem({ status, data }, options);
  assert.equal(say_(429, { code: "concurrency-limit" }).words, "Your writing helper is busy with something else. Try again in a minute.");
  const busy = say_(502, { code: "provider-busy", retryAfter: 7 });
  assert.equal(busy.words, "Anthropic is busy right now. Try again in a few minutes.");
  assert.deepEqual(busy.details, ["Provider answered HTTP 429; retry after 7 s."]);
  assert.deepEqual(say_(502, { code: "provider-busy" }).details, ["Provider answered HTTP 429."]);
  assert.equal(say_(502, { code: "provider-down", error: "Anthropic returned HTTP 500" }).words, "Anthropic didn't answer, so nothing came back. Your words are as they were. Try again later.");
  assert.deepEqual(say_(502, { code: "provider-error", error: "Anthropic returned HTTP 400" }).details, ["Anthropic returned HTTP 400"]);
  assert.equal(say_(504, { code: "timeout" }).words, "Anthropic took too long, so nothing came back. Try a smaller part.");
  assert.equal(say_(502, { code: "invalid-result" }).words, "Your helper sent back something that didn't make sense, so nothing changed. Try again.");
  assert.equal(say_(502, { code: "refused" }).words, "Anthropic wouldn't answer this one. Your words are as they were.");
  assert.equal(say_(502, { code: "cut-short" }).words, "The answer was cut off, so nothing changed. Try a smaller part.");
  const rejected = say_(502, { code: "key-rejected", error: "Anthropic returned HTTP 401" });
  assert.equal(rejected.words, "Anthropic didn't accept the key for your blog. Tell the person who set up your site.");
  assert.equal(rejected.setup, true);
  for (const code of ["missing-credential", "not-configured", "invalid-configuration"]) {
    const off = say_(code === "not-configured" ? 404 : 503, { code });
    assert.equal(off.words, "Your writing helper was turned off. Tell the person who set up your site.");
    assert.equal(off.off, true, code);
  }
  assert.equal(say_(400, { code: "too-long", field: "passage", max: 20000, unit: "characters" }, { company: "Anthropic", task: "review" }).words, "That's more than your helper can read at once. Choose the part you're in, or select less.");
  assert.deepEqual(say_(400, { code: "too-long", field: "passage", max: 20000, unit: "characters" }).details, ["At most 20,000 characters (passage)."]);
  assert.match(say_(400, { code: "over-budget", samples: 9, characters: 99, budget: { samples: 8, characters: 120000 } }).details[0], /9 samples, 99 letters; one request carries at most 8 and 120,000/);
  for (const code of ["skill-scope", "context-unavailable"]) assert.equal(say_(400, { code, id: "private:author" }).words, "Something your helper uses has changed. Close this and open it again.");
  assert.equal(say_(401, {}).code, "signed-out");
  const none = helperProblem({ status: 0 }, { company: "Anthropic" });
  assert.equal(none.signal, true);
  assert.equal(none.words, "Your helper needs a signal. Your words are kept here.");
  assert.equal(say_(500, { error: "disk full at /srv/blog" }).words, "That didn't work, and nothing changed. Try again.");
  assert.deepEqual(say_(500, { error: "disk full at /srv/blog" }).details, ["disk full at /srv/blog"], "the server's sentence is only ever a detail");
  // What only a later try may clear is quiet for suggestions as she types.
  for (const code of ["concurrency-limit", "provider-busy", "timeout"]) assert.equal(say_(502, { code }).quiet, true, code);
  for (const code of ["key-rejected", "invalid-result", "provider-down"]) assert.equal(say_(502, { code }).quiet, false, code);
});

test("a server that doesn't send codes yet is read from today's sentences", () => {
  configureWords();
  const from = (status, error) => helperProblem({ status, data: { error } }, { company: "OpenAI" }).code;
  assert.equal(from(502, "OpenAI returned HTTP 401"), "key-rejected");
  assert.equal(from(502, "OpenAI returned HTTP 403"), "key-rejected");
  assert.equal(from(502, "OpenAI returned HTTP 429"), "provider-busy");
  assert.equal(from(502, "OpenAI returned HTTP 503"), "provider-down");
  assert.equal(from(400, "The passage is longer than 20000 characters; select less or review the document"), "too-long");
  assert.equal(from(400, "Review Markdown is too large or invalid"), "too-long");
  assert.equal(from(429, "Two Assistant operations are already running; try again shortly"), "concurrency-limit");
  assert.equal(from(400, "Something nobody expected"), "other");
});

test("R4's voice note and write-up keep their own lines and share the rest", () => {
  configureWords();
  assert.equal(transcribeTrouble({ status: 404, data: { code: "not-configured" } }), "");
  assert.match(transcribeTrouble({ data: { code: "empty-transcript" } }), /No words were heard/);
  assert.equal(transcribeTrouble({ status: 429, data: { code: "concurrency-limit" } }), "Your writing helper is busy with something else. Try again in a minute. Your voice note is still here.");
  assert.equal(transcribeTrouble({ status: 502, data: { code: "provider-down" } }, { company: "OpenAI" }), "OpenAI didn't answer, so nothing came back. Your words are as they were. Try again later. Your voice note is still here.");
  // Turned into words on her blog's own computer: no company is blamed for it.
  assert.equal(transcribeTrouble({ status: 504, data: { code: "timeout" } }), "Your helper took too long, so nothing came back. Try a smaller part. Your voice note is still here.");
  assert.match(writeUpTrouble({ data: { code: "notes-too-long" } }), /Shorten them/);
  assert.match(writeUpTrouble({ data: { code: "no-notes" } }), /Write a few words/);
  assert.equal(writeUpTrouble({ status: 502, data: { code: "key-rejected" } }, { company: "Anthropic" }), "Anthropic didn't accept the key for your blog. Tell the person who set up your site.");
  assert.equal(writeUpTrouble({}), "Your helper sent back something that didn't make sense, so nothing changed. Try again.");
});

test("numbers and long text are said the way she'd say them", () => {
  assert.equal(wordsAbout(37), "37");
  assert.equal(wordsAbout(1243), "1,240");
  assert.equal(wordsAbout(-4), "0");
  assert.deepEqual(clip("abc", 5), { text: "abc", clipped: false });
  assert.deepEqual(clip("🏮🏮🏮🏮", 2), { text: "🏮🏮…", clipped: true }, "whole characters");
  assert.equal(plainSuggestion("a\r\nb\u0000‮​c"), "a\nbc");
});

// ---- what is sent

test("where she was never goes to the helper, whatever is chosen", () => {
  const form = { title: "Trip", body: "Words", fields: {
    title: "Trip", tags: ["hike"], description: "A walk", profile: "field-journal", distanceKm: "12", location: "The ridge",
    trackToken: "tok-123", captureId: "cap-9", route: "media/route.gpx", routeShape: "0,0 1,1", elevationProfile: "1,2,3", _draftOf: "x", credits: [{ id: "a" }], creditEtag: "e", empty: "", gone: null, none: [],
  } };
  const source = helperSource(form);
  for (const key of ["trackToken", "captureId", "route", "routeShape", "elevationProfile", "_draftOf", "credits", "creditEtag", "empty", "gone", "none"]) assert.equal(key in source, false, key);
  assert.deepEqual(Object.keys(source).sort(), ["description", "distanceKm", "location", "profile", "tags"], "the title goes once, as the title");
  for (const key of ["trackToken", "captureId", "route", "routeShape", "elevationProfile"]) assert.ok(NEVER_SENT.includes(key), key);
  const request = JSON.stringify(reviewRequest({ form, skillIds: ["copy-review"] }));
  for (const secret of ["tok-123", "cap-9", "route.gpx", "0,0 1,1", "1,2,3"]) assert.equal(request.includes(secret), false, secret);
});

test("the details that go are named by group, in her words", () => {
  configureWords();
  assert.deepEqual(detailGroups({ title: "x", date: "2026-11-01", tags: ["a"], description: "s", servings: "8", prepTime: "20" }), ["when it appears", "tags", "summary", "recipe facts"]);
  assert.deepEqual(detailGroups({ "job.trade": "roofing", "job.place.town": "Springfield" }), ["job details"]);
  assert.deepEqual(detailGroups({ profile: "video", duration: "PT4M", videoUrl: "https://v" }), ["video facts", "what kind of post it is"]);
  assert.deepEqual(detailGroups({ profile: "field-journal", duration: "PT4H", distanceKm: "12" }), ["trip numbers", "what kind of post it is"]);
  assert.deepEqual(detailGroups({}), []);
});

test("what goes lists her words, her details and every note she left on, and names the company", () => {
  configureWords();
  const form = { title: "Pie", body: "one two three four five", fields: { tags: ["pie"], description: "A pie." } };
  const ids = defaultContextIds(CATALOG, { useNotes: true, soundLikeMe: true });
  assert.deepEqual(ids, ["private:author", "portable:site", "private:post:pie.md", "private:voice"]);
  const goes = whatGoes(reviewRequest({ form, skillIds: ["copy-review"], contextIds: ids }), CATALOG, STATUS, { skills: SKILLS });
  assert.equal(goes.heading, "What goes to Anthropic");
  assert.deepEqual(goes.lines, ["Your title and your words, about 5", "This post's details: tags, summary", "Your notes: About you, About your blog, About this post", "Your voice guide"]);
  assert.equal(goes.never, "Not your photos, other posts, or anything about your readers. It doesn't look anything up on the web. Anthropic's own rules cover what it keeps.");
  assert.deepEqual(goes.sent.map((item) => item.id), ids);
  assert.match(goes.details[0], /^Skills: copy-review 1$/);
  assert.match(goes.details[1], /private:author \(private, 40\)/);
  assert.match(goes.details.at(-1), /Model: claude-test\. Destination: https:\/\/api\.anthropic\.com\. Research: off\./);

  const none = whatGoes(reviewRequest({ form, skillIds: ["copy-review"] }), CATALOG, STATUS);
  assert.deepEqual(none.lines, ["Your title and your words, about 5", "This post's details: tags, summary"]);
  assert.equal(none.details[1], "Context: none");

  const passage = whatGoes(reviewRequest({ form, passage: { kind: "selection", start: 4, end: 13 }, skillIds: ["copy-review"] }), CATALOG, STATUS);
  assert.equal(passage.lines[0], "Your title and the words you selected, about 2, and the rest of the post, so it reads them in place");
  const part = whatGoes(reviewRequest({ form, passage: { kind: "section", start: 0, end: 7 }, skillIds: ["copy-review"] }), CATALOG, STATUS);
  assert.match(part.lines[0], /^Your title and the part you're in, about 2,/);

  // What only the helper person can add is still said on her layer, and "other posts" is no longer promised.
  const extra = whatGoes(reviewRequest({ form, skillIds: ["copy-review"], contextIds: ["private:reference:style.md", "post:posts/other.md", "voice:private:a-rough.md"] }), CATALOG, STATUS);
  assert.equal(extra.lines.at(-1), "Also, chosen by the person who set up your site: style.md, posts/other.md, a-rough.md");
  assert.doesNotMatch(extra.never, /other posts/);
  assert.ok(extra.details.some((line) => line === "1 of 8 samples, 100 of 120,000 letters"));
});

test("what goes names every context id the request carries and nothing else, whatever is chosen", () => {
  configureWords();
  const all = [...CATALOG.documents, ...CATALOG.voiceGuides, ...CATALOG.references, ...CATALOG.postSnapshots, ...CATALOG.voiceSamples].filter((doc) => doc.exists);
  let seed = 20261114;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const form = { title: "Pie", body: "Some words here.", fields: {} };
  for (let round = 0; round < 300; round += 1) {
    const useNotes = random() < 0.5;
    const soundLikeMe = random() < 0.5;
    const extra = all.filter(() => random() < 0.3).map((doc) => doc.id).concat(random() < 0.2 ? ["private:reference:gone.md"] : []);
    const ids = defaultContextIds(CATALOG, { useNotes, soundLikeMe, extra });
    const request = reviewRequest({ form, skillIds: ["copy-review"], contextIds: ids });
    const goes = whatGoes(request, CATALOG, STATUS);
    assert.deepEqual(goes.sent.map((item) => item.id), request.contextIds, `round ${round}`);
    assert.equal(ids.includes("private:reference:gone.md"), false, "something that no longer exists is never sent");
    const said = goes.lines.join(" | ");
    for (const item of goes.sent) assert.ok(said.includes(item.label), `${item.id} is sent, so a line names it (${said})`);
    // And nothing is named that isn't sent.
    const notes = (goes.lines.find((text) => text.startsWith("Your notes: ")) || "").replace("Your notes: ", "").split(", ").filter(Boolean);
    assert.equal(notes.includes("About you"), ids.includes("private:author"), `round ${round}: About you`);
    assert.equal(notes.includes("About your blog"), ids.includes("portable:site"), `round ${round}: About your blog`);
    assert.equal(notes.includes("About this post"), ids.includes("private:post:pie.md"), `round ${round}: About this post`);
    assert.equal(said.includes("Your voice guide"), ids.includes("private:voice"), `round ${round}: voice guide`);
    assert.equal(said.includes("style.md"), ids.includes("private:reference:style.md"), `round ${round}: a text`);
    assert.equal(said.includes("posts/other.md"), ids.includes("post:posts/other.md"), `round ${round}: another post`);
  }
});

// ---- what to read, what to look for

const RECIPE = { body: "Story about pie.\n\n## Ingredients\n\n- 2 cups flour\n\n## Notes\n\nKeep it cold.", boxes: [{ name: "Your story", value: "Story about pie." }, { name: "Notes", value: "Keep it cold." }] };

test("each box of her words is found in the post, in order", () => {
  const spans = boxSpans(RECIPE);
  assert.deepEqual(spans.map((s) => [s.index, s.name, s.start, s.end]), [[0, "Your story", 0, 16], [1, "Notes", RECIPE.body.indexOf("Keep"), RECIPE.body.length]]);
  assert.deepEqual(boxSpans({ body: "abc", boxes: [{ name: "Words", value: "" }] }), [], "an empty box has no place");
  // Two boxes with the same words are told apart by order.
  const twice = boxSpans({ body: "## A\n\nSame.\n\n## B\n\nSame.", boxes: [{ name: "A", value: "Same." }, { name: "B", value: "Same." }] });
  assert.deepEqual(twice.map((s) => s.start), [6, 19]);
  assert.equal(boxSpans({ body: "x 🏮 y", boxes: [{ name: "Words", value: "x 🏮 y" }] })[0].endPoint, 5, "and in code points too");
});

test("what she selected is captured when the sheet opens, in the whole post's places", () => {
  const target = captureTarget(RECIPE, { box: 1, at: 7, text: "it" });
  const at = RECIPE.body.indexOf("Keep it") + 5;
  assert.deepEqual(target, { box: 1, name: "Notes", start: at, end: at + 2, caret: at + 2, words: 1 });
  assert.equal(captureTarget(RECIPE, null), null);
  assert.equal(captureTarget(RECIPE, { box: 5, at: 0, text: "" }), null);
  assert.equal(captureTarget(RECIPE, { box: 0, at: 5, text: "" }).words, 0, "a caret with nothing selected");
  assert.equal(captureTarget(RECIPE, { box: 0, at: 5, text: "not what is there" }).words, 0, "a selection that no longer matches is only a caret");
});

test("what to read: the whole post, the words she selected, or the part she's in", () => {
  configureWords();
  const target = captureTarget(RECIPE, { box: 1, at: 7, text: "Keep it" });
  assert.deepEqual(passageFor(target, "whole", RECIPE), { choice: "whole", passage: null, text: RECIPE.body, label: "", error: "" });
  const selected = passageFor(target, "selected", RECIPE);
  assert.equal(selected.text, "Keep it");
  assert.equal(selected.passage.kind, "selection");
  const part = passageFor(target, "part", RECIPE);
  assert.equal(part.text, "## Notes\n\nKeep it cold.");
  assert.equal(part.label, "From “Notes” to the next heading");
  // No heading above her: the box she's in.
  const first = passageFor(captureTarget(RECIPE, { box: 0, at: 3, text: "" }), "part", RECIPE);
  assert.equal(first.text, "Story about pie.");
  assert.equal(first.label, "All of Your story");
  assert.equal(first.passage.kind, "section");
  assert.equal(passageFor(null, "selected", RECIPE).choice, "whole", "nothing captured: the whole post");
  assert.equal(passageFor(null, "whole", { body: "  " }).error, "empty");
  const long = { body: "y".repeat(MAX_PASSAGE + 5), boxes: [{ name: "Words", value: "y".repeat(MAX_PASSAGE + 5) }] };
  assert.equal(passageFor(captureTarget(long, { box: 0, at: 3, text: "" }), "part", long).error, "too-long");
  assert.deepEqual(["whole", "selected", "part"].map(scopeOf), ["document", "selection", "section"]);
});

test("what to look for: four plain choices, each only when it can be used", () => {
  configureWords();
  const guide = { id: "private:voice" };
  const story = lookForChoices(SKILLS, { kind: "" }, null, "document");
  assert.deepEqual(story.choices, [{ id: "copy", label: "Spelling, grammar and clear sentences", on: true }, { id: "flow", label: "How it flows from start to finish", on: false }]);
  assert.deepEqual(lookForChoices(SKILLS, { kind: "" }, guide, "document").choices.map((c) => c.id), ["copy", "flow", "voice"]);
  assert.deepEqual(lookForChoices(SKILLS, { kind: "research" }, guide, "document").choices.map((c) => [c.id, c.on]), [["copy", true], ["flow", false], ["voice", false], ["facts", true]]);
  // A selection: how it flows can't be judged from a few words, so it isn't offered (never greyed).
  assert.deepEqual(lookForChoices(SKILLS, { kind: "research" }, guide, "selection").choices.map((c) => c.id), ["copy", "voice"]);
  // A skill that is missing, invalid, or replaced by an invalid one hides its choice.
  const broken = SKILLS.map((skill) => (skill.id === "copy-review" ? { ...skill, selectable: false } : skill));
  assert.deepEqual(lookForChoices(broken, { kind: "" }, null, "document").choices.map((c) => c.id), ["flow"]);
  assert.deepEqual(lookForChoices([], { kind: "" }, guide, "document").choices, []);
  // Every other usable review skill is the helper person's, named with its version.
  assert.deepEqual(story.others, [{ id: "technical-review", label: "Technical review (3)", fits: true }, { id: "release-review", label: "Release review (1)", fits: true }]);
  assert.equal(lookForChoices(SKILLS, { kind: "" }, null, "selection").others.find((o) => o.id === "release-review").fits, false);
});

test("her choices become skill ids that fit what is read", () => {
  assert.deepEqual(skillsFor(["copy", "flow"], "document", SKILLS), ["copy-review", "developmental-review"]);
  assert.deepEqual(skillsFor(["copy", "flow"], "selection", SKILLS), ["copy-review"], "a skill that doesn't fit is never sent");
  assert.deepEqual(skillsFor(["voice"], "document", SKILLS), ["voice-review"]);
  assert.deepEqual(skillsFor(["voice"], "selection", SKILLS), ["voice-review", "voice-match"], "a selection also gets the closer match");
  assert.deepEqual(skillsFor(["voice"], "section", SKILLS), ["voice-review", "voice-match"]);
  assert.deepEqual(skillsFor(["copy"], "document", SKILLS, ["technical-review", "release-review", "broken", "voice-guide", "nope"]), ["copy-review", "technical-review", "release-review"]);
  assert.deepEqual(skillsFor([], "document", SKILLS), []);
  const request = reviewRequest({ form: { title: "T", body: "B", fields: { tags: ["a"] } }, passage: { kind: "selection", start: 0, end: 1, extra: "x" }, skillIds: ["copy-review", "copy-review"], contextIds: ["private:author"] });
  assert.deepEqual(request, { source: { title: "T", metadata: { tags: ["a"] }, markdown: "B" }, passage: { kind: "selection", start: 0, end: 1 }, skillIds: ["copy-review"], contextIds: ["private:author"] });
});

// ---- what it found

const finding = (evidence, suggestion, start, more = {}) => ({ id: `f${start}`, evidence, suggestion, explanation: "Because.", range: { start, end: start + Array.from(evidence).length }, severity: "low", ...more });

test("suggestions are shown in post order, the weightiest first in one place, and malformed ones are dropped", () => {
  const list = [finding("c", "C", 20), finding("a", "A", 3, { severity: "note" }), finding("b", "B", 3, { severity: "high" }), { evidence: 4 }, null, { evidence: "x", explanation: "y", range: { start: "0", end: 1 } }, finding("d", null, 1)];
  assert.deepEqual(orderFindings(list).map((f) => f.evidence), ["d", "b", "a", "c"]);
  assert.deepEqual(orderFindings("nonsense"), []);
  assert.equal(usableFinding({ evidence: "x", explanation: "y", range: { start: 0, end: 1 }, suggestion: { html: "<b>" } }), false);
});

test("a suggestion's place is said by the box it is in", () => {
  configureWords();
  const spans = boxSpans(RECIPE);
  const at = Array.from(RECIPE.body.slice(0, RECIPE.body.indexOf("Keep"))).length;
  assert.equal(findingPlace({ start: at, end: at + 4 }, spans, "Keep"), "In Notes");
  assert.equal(findingPlace({ start: 2, end: 8 }, spans, "ory ab"), "In Your story");
  assert.equal(findingPlace({ start: 10, end: 40 }, spans, "pie.\n\n## Ingredients and then quite a lot more"), "Near “pie. ## Ingredients and then q…”", "one that spans boxes");
});

const POSTS = [
  { body: "I use alot of butter.", boxes: [{ name: "Words", value: "I use alot of butter." }] },
  RECIPE,
  { body: "## Problem\n\nThe 🏮 lamp leaked alot.\n\n## What we found\n\nA cracked seal.\n\n## What we did\n\nReplaced it.\n\n## Result\n\nDry.", boxes: [{ name: "Problem", value: "The 🏮 lamp leaked alot." }, { name: "What we found", value: "A cracked seal." }, { name: "What we did", value: "Replaced it." }, { name: "Result", value: "Dry." }] },
  { body: "Before the photo.\n\n![A pie cooling](/media/pie.jpg)\n\nAfter the photo, alot.", boxes: [{ name: "Words", value: "Before the photo.\n\n![A pie cooling](/media/pie.jpg)\n\nAfter the photo, alot." }] },
];
const point = (text, needle) => Array.from(text.slice(0, text.indexOf(needle))).length;

test("Use this swaps the quoted words inside one box and leaves every other byte alone", () => {
  for (const post of POSTS) {
    const needle = post.body.includes("alot") ? "alot" : "cold";
    const f = finding(needle, needle === "alot" ? "a lot" : "chilled", point(post.body, needle));
    const out = applyFinding(post, f, []);
    assert.equal(out.ok, true, post.body);
    const box = post.boxes[out.box];
    assert.equal(out.text, box.value.replace(needle, f.suggestion));
    // The post put back together is the old post with only that swap.
    const at = post.body.indexOf(box.value);
    assert.equal(post.body.slice(0, at) + out.text + post.body.slice(at + box.value.length), post.body.replace(needle, f.suggestion));
    assert.equal(out.text.slice(out.at, out.end), f.suggestion);
    // Undo restores the box's bytes exactly.
    assert.deepEqual(undoFinding(out.text, out.record), { ok: true, text: box.value, at: out.record.at, end: out.record.at + needle.length });
  }
});

test("Use this refuses anything it can't place exactly: two boxes, a card, twice, or overlapping one used", () => {
  const job = POSTS[2];
  // Words that run from one box into the next (through the heading between them).
  const across = "leaked alot.\n\n## What we found\n\nA cracked";
  assert.deepEqual(applyFinding(job, finding(across, "leaked. A cracked", point(job.body, across)), []), { ok: false, why: "across" });
  // Words in the post that are in no box at all (a recipe's ingredient row).
  assert.deepEqual(applyFinding(RECIPE, finding("2 cups flour", "3 cups flour", point(RECIPE.body, "2 cups")), []), { ok: false, why: "across" });
  // Inside a photo card: its description is changed through its own form.
  const photo = POSTS[3];
  assert.deepEqual(cardRanges(photo.boxes[0].value), [[19, 51]]);
  assert.deepEqual(applyFinding(photo, finding("A pie cooling", "A pie, cooling", point(photo.body, "A pie cooling")), []), { ok: false, why: "card" });
  // Found twice: never guessed.
  const twice = { body: "alot here and alot there", boxes: [{ name: "Words", value: "alot here and alot there" }] };
  assert.deepEqual(applyFinding(twice, finding("alot", "a lot", 0), []), { ok: false, why: "twice" });
  // No longer there.
  assert.deepEqual(applyFinding(POSTS[0], finding("a great deal of", "lots of", 6), []), { ok: false, why: "moved" });
  // Advice only, or a "suggestion" that changes nothing.
  assert.deepEqual(applyFinding(POSTS[0], finding("alot", null, 6), []), { ok: false, why: "advice" });
  assert.deepEqual(applyFinding(POSTS[0], finding("alot", "alot", 6), []), { ok: false, why: "same" });
  assert.deepEqual(applyFinding(POSTS[0], { evidence: "alot", suggestion: { markup: "<b>" }, explanation: "x", range: { start: 6, end: 10 } }, []), { ok: false, why: "advice" });
  // Overlapping one already used.
  const post = { body: "I use alot of butter every day.", boxes: [{ name: "Words", value: "I use alot of butter every day." }] };
  const first = applyFinding(post, finding("alot of butter", "a lot of butter", 6), []);
  const after = { body: first.text, boxes: [{ name: "Words", value: first.text }] };
  assert.deepEqual(applyFinding(after, finding("of butter every", "of good butter every", point(first.text, "of butter")), [first.record]), { ok: false, why: "overlap" });
  assert.equal(applyFinding(after, finding("every day", "daily", point(first.text, "every day")), [first.record]).ok, true, "one beside it still fits");
});

test("what a helper suggests is made plain before it enters her words", () => {
  const post = { body: "I use alot of butter.", boxes: [{ name: "Words", value: "I use alot of butter." }] };
  const out = applyFinding(post, finding("alot", "a‮ lot\u0000\r\n", 6), []);
  assert.equal(out.text, "I use a lot\n of butter.");
});

// B1: her post is Markdown, and Markdown on her site becomes a page. A suggestion is words or it
// is advice.
const TABLE = JSON.parse(readFileSync(new URL("../fixtures/helper-plain-words.json", import.meta.url), "utf8"));

test("a suggestion with more than words in it is told apart by one table, shared with the server", () => {
  for (const words of TABLE.words) assert.equal(moreThanWords(words), false, JSON.stringify(words));
  for (const more of TABLE.more) assert.equal(moreThanWords(more), true, JSON.stringify(more));
  // Characters that hide (a direction mark, a null) don't hide markup.
  assert.equal(moreThanWords("see [this]\u200b(https://evil.example)"), true);
  assert.equal(moreThanWords("a <\u0000script>"), true);
  assert.equal(moreThanWords("line one\r\n# heading"), true);
  for (const nothing of [null, undefined, ""]) assert.equal(moreThanWords(nothing), false);
});

test("a suggestion with more than words in it never goes into her post", () => {
  const post = { body: "I use alot of butter.", boxes: [{ name: "Words", value: "I use alot of butter." }] };
  const repro = 'a lot of butter <img src=x onerror="window.__pwn=1"> [click](https://evil.example/x) <script>window.__pwn=2</script>';
  assert.deepEqual(applyFinding(post, finding("alot of butter", repro, 6), []), { ok: false, why: "more" });
  for (const more of TABLE.more) assert.deepEqual(applyFinding(post, finding("alot", more, 6), []), { ok: false, why: "more" }, JSON.stringify(more));
  // The server's word is honoured even when the words look plain.
  assert.deepEqual(applyFinding(post, { ...finding("alot", "a lot", 6), applicable: false }, []), { ok: false, why: "more" });
  assert.equal(applyFinding(post, { ...finding("alot", "a lot", 6), applicable: true }, []).ok, true);
  // Suggested next words follow the same table.
  for (const more of TABLE.more) assert.equal(plainCompletion(more), "", JSON.stringify(more));
});

test("Undo reverses only its own swap, so what she typed since stays", () => {
  const post = { body: "I use alot of butter. Its good.", boxes: [{ name: "Words", value: "I use alot of butter. Its good." }] };
  const a = applyFinding(post, finding("alot", "a lot", 6), []);
  const post2 = { body: a.text, boxes: [{ name: "Words", value: a.text }] };
  const b = applyFinding(post2, finding("Its", "It's", point(a.text, "Its")), [a.record]);
  assert.equal(b.text, "I use a lot of butter. It's good.");
  const used = [...shiftUsed([a.record], b.record), b.record];
  assert.equal(used[0].at, a.record.at, "one used before it, earlier in the box, hasn't moved");
  // The first is undone after the second was used, and after she typed at the end.
  const typed = `${b.text} More.`;
  assert.deepEqual(undoFinding(typed, a.record), { ok: true, text: "I use alot of butter. It's good. More.", at: 6, end: 10 });
  // Her words there changed: it can't be put back for her, and nothing is guessed.
  assert.deepEqual(undoFinding("I use plenty of butter.", a.record), { ok: false });
  assert.deepEqual(undoFinding("a lot and a lot", { ...a.record, at: 99 }), { ok: false }, "found twice somewhere else");
  // A later use before an earlier one moves it along.
  const early = { box: 0, at: 0, end: 5, evidence: "I", suggestion: "We all", before: "", after: "" };
  assert.equal(shiftUsed([a.record], early)[0].at, a.record.at + 5);
  assert.equal(shiftUsed([{ ...a.record, box: 1 }], early)[0].at, a.record.at, "another box doesn't move");
});

test("Show me finds the quoted words in their box", () => {
  const job = POSTS[2];
  assert.deepEqual(findingInBoxes(job, finding("cracked seal", null, point(job.body, "cracked"))), { box: 1, start: 2, end: 14 });
  // Gone since: the place it was, with nothing selected.
  const gone = findingInBoxes(job, finding("no longer here", null, point(job.body, "Replaced")));
  assert.equal(gone.box, 2);
  assert.equal(gone.start, gone.end);
});

// ---- her words

test("her layer never says the machinery's words, and says AI once", async () => {
  configureWords();
  const { WORDS } = await import("../../web/studio/parts/writing-helper-words.js");
  const { HER_BANNED } = await import("../../web/studio/parts/plain-words.js");
  const { say } = await import("../../web/studio/parts/words.js");
  // R8's own list (ux.md, "Never on her layer"), beside the one every her-layer id is held to.
  const MACHINERY = /\b(AI provider|provider|model|API key|credential|endpoint|prompt|tokens?|completion|autocomplete|skills?|context|snapshot|references?|findings?|severity|scope|portable|Git|capability|schema|JSON|Studio|Admin|review)\b/i;
  const her = Object.entries(WORDS).filter(([, entry]) => entry.layer === "her");
  assert.ok(her.length > 100, "the writing helper's her-layer words are in one table");
  const withAi = [];
  for (const [id, entry] of her) {
    assert.doesNotMatch(entry.text, MACHINERY, id);
    assert.doesNotMatch(entry.text, HER_BANNED, id);
    if (/\bAI\b/.test(entry.text)) withAi.push(id);
    // No pronoun for whoever helps her: the sentence must read right with any name.
    if (entry.text.includes("{helper}")) assert.doesNotMatch(entry.text, /\b(him|her|his|he|she)\b/i, id);
  }
  assert.deepEqual(withAi.sort(), ["hsetup.lede", "hsetup.ledeOff"], "only the setup screen's opening sentence (one of the two shows)");
  // Every failure's sentence for her is free of codes and statuses, whatever the server sent.
  for (const code of ["concurrency-limit", "provider-busy", "provider-down", "provider-error", "timeout", "invalid-result", "refused", "cut-short", "key-rejected", "missing-credential", "too-long", "over-budget", "skill-scope", "context-unavailable", "bad-language", "nonsense"]) {
    const problem = helperProblem({ status: 502, data: { code, error: "Provider returned HTTP 500 with JSON {\"token\": 1}" } }, { company: "Anthropic" });
    assert.doesNotMatch(problem.words, /HTTP|\d{3}|JSON|token|provider|code/i, code);
  }
  assert.equal(say("hsetup.lede", { company: "Anthropic" }), "Your blog can read your posts over and suggest changes, using Anthropic's AI. It only sends what you choose, and says what before it does.");
  // A site that names its helper person reads right everywhere.
  configureWords({ vars: { helper: "Hillside Web Care", product: "your website" } });
  assert.equal(say("helper.offText"), "Hillside Web Care can turn it on.");
  assert.equal(helperProblem({ status: 502, data: { code: "key-rejected" } }, { company: "Anthropic" }).words, "Anthropic didn't accept the key for your website. Tell Hillside Web Care.");
  configureWords();
});
