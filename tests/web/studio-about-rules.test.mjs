// About this post (Studio R5): values written under the post's own names and only when changed,
// the line on the button, the address rule, the checks before a save, kind changes, and her words
// for every coded refusal. The old Admin's profile tests (admin-behavior.test.mjs) are ported in
// their Studio form: a value under another name shows and is written back under that name.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ABOUT_KEYS, aboutExtra, aboutFromDocument, aboutKeys, aboutLine, aboutProblems, cardSummary, fileSlug, issueWords, kindChange,
  kindOf, otherKeys, pinCounts, saveProblem, slugEditable, slugPreview, slugProblem, slugify, summaryCount, withRecipeParts,
} from "../../web/studio/parts/about-rules.js";
import { fieldsForSave } from "../../web/studio/parts/post-session.js";
import { kindChoices, groupFor, groupKeys } from "../../web/studio/parts/profile-words.js";

const PROFILES = [
  { id: "article", fields: [] },
  { id: "recipe", starter: "Intro\n\n## Ingredients\n\n- 1 cup\n\n## Steps\n\n1. Mix\n", fields: [
    { key: "servings", aliases: ["serves"] }, { key: "course", aliases: ["category", "recipeCategory"] }, { key: "cuisine", aliases: [] },
    { key: "yield", aliases: ["makes"] }, { key: "prepTime", aliases: ["prep", "prep_time"] }, { key: "cookTime", aliases: ["cook", "cook_time"] },
    { key: "totalTime", aliases: ["total", "total_time"] }, { key: "calories", aliases: [] }, { key: "adaptedFrom", aliases: ["adapted_from", "basedOn"] },
  ] },
  { id: "research", fields: [{ key: "doi" }, { key: "license" }] },
  { id: "video", fields: [{ key: "videoUrl" }, { key: "duration" }, { key: "videoTitle" }] },
  { id: "field-journal", fields: [{ key: "distanceKm" }, { key: "locationPrivacy" }] },
  { id: "job", fields: [] },
];

const save = (received, about) => {
  const keys = aboutKeys(received, PROFILES);
  const initial = aboutFromDocument(received, keys);
  const extra = aboutExtra(keys, initial, { ...initial, ...about });
  return fieldsForSave(received, { cover: "", coverAlt: "" }, { title: received.title, date: received.date, tags: [], extra }, "draft", { now: new Date("2026-11-13T12:00:00Z") });
};

test("a post with summary: keeps summary:, and a change rewrites only that", () => {
  const received = { title: "Pie", date: "2026-11-06", draft: "true", summary: "Old words.", prep: "15 min" };
  const fields = save(received, { description: "New words." });
  assert.equal(fields.summary, "New words.");
  assert.equal("description" in fields, false);
  assert.equal(fields.prep, "15 min", "the recipe number stays as it came");
});

test("the line under the title is written as subtitle, and its older names go when it changes", () => {
  const received = { title: "Pie", date: "2026-11-06", subheading: "From my mother", dek: "x" };
  assert.equal(aboutFromDocument(received, aboutKeys(received)).subtitle, "From my mother");
  const fields = save(received, { subtitle: "From my\nmother's kitchen" });
  assert.equal(fields.subtitle, "From my mother's kitchen");
  assert.equal(fields.subheading, null);
  assert.equal(fields.dek, null);
  // Unchanged: nothing moves.
  const same = save(received, {});
  assert.equal(same.subheading, "From my mother");
  assert.equal("subtitle" in same, false);
});

test("a recipe value under another name shows and is written back under it", () => {
  const received = { title: "Bread", date: "2026-11-06", profile: "recipe", makes: "2 loaves", category: "Bread", basedOn: "https://example.com/r" };
  const keys = aboutKeys(received, PROFILES);
  assert.equal(keys.yield, "makes");
  assert.equal(keys.course, "category");
  assert.equal(keys.adaptedFrom, "basedOn");
  const about = aboutFromDocument(received, keys);
  assert.equal(about.yield, "2 loaves");
  assert.equal(about.course, "Bread");
  const fields = save(received, { yield: "3 loaves", course: "" });
  assert.equal(fields.makes, "3 loaves");
  assert.equal(fields.category, null, "clearing the field clears its own name");
  assert.equal("yield" in fields, false);
  assert.equal(fields.basedOn, "https://example.com/r");
  // The recipe numbers are Write's own, never the sheet's.
  assert.equal("servings" in keys, false);
});

test("story to recipe to story keeps yield", () => {
  const received = { title: "Bread", date: "2026-11-06", profile: "recipe", yield: "2 loaves" };
  const asStory = save(received, { profile: "article" });
  assert.equal(asStory.profile, "article");
  assert.equal(asStory.yield, "2 loaves");
  const back = save({ ...received, profile: "article" }, { profile: "recipe" });
  assert.equal(back.profile, "recipe");
  assert.equal(back.yield, "2 loaves");
});

test("a legacy recipe shows as a recipe and writes nothing until changed", () => {
  const received = { title: "Old", date: "2020-01-01", recipe: "true" };
  assert.equal(kindOf(received), "recipe");
  assert.equal("profile" in save(received, {}), false);
  assert.equal(save(received, { profile: "article" }).profile, "article");
});

test("a value never touched is never sent, and keys Studio doesn't edit go back as they came", () => {
  const received = { title: "Pie", date: "2026-11-06", aliases: ["/old/"], participation: ["notes:open"], highlight: "true", description: "A" };
  const fields = save(received, {});
  assert.deepEqual(fields.aliases, ["/old/"]);
  assert.deepEqual(fields.participation, ["notes:open"]);
  assert.equal(fields.highlight, "true");
  assert.deepEqual(otherKeys(received, aboutKeys(received)), ["aliases", "highlight", "participation"]);
  assert.ok(ABOUT_KEYS.includes("coverCredit"));
});

test("comments Open is no key; closed and hidden are written", () => {
  const received = { title: "Pie", date: "2026-11-06", comments: "locked" };
  assert.equal(save(received, { comments: "" }).comments, null);
  assert.equal(save({ title: "Pie", date: "2026-11-06" }, { comments: "hidden" }).comments, "hidden");
});

test("the About this post line", () => {
  assert.equal(aboutLine({ about: { profile: "article", description: "x" }, commentsSetUp: true, names: ["Grammi"] }), "Summary set · Comments open · By Grammi");
  assert.equal(aboutLine({ about: { profile: "recipe", description: "" }, commentsSetUp: false, names: ["Grammi", "Ruth"] }), "A recipe · No summary yet · By Grammi and Ruth");
  assert.equal(aboutLine({ about: { profile: "recipe", description: "x", comments: "locked" }, commentsSetUp: true, names: [] }), "A recipe · Summary set · No one named");
  assert.equal(aboutLine({ about: { profile: "article", comments: "hidden" }, commentsSetUp: true, names: ["G"], unsent: true }), "Changes not on your site yet · No summary yet · No comments · By G");
});

test("the address is editable only while a post was never on the site", () => {
  assert.equal(slugEditable({ state: "new" }), true);
  assert.equal(slugEditable({ state: "draft", wasPublished: false }), true);
  assert.equal(slugEditable({ state: "draft", wasPublished: true }), false);
  // Unknown counts as "it was": a draft with a past date from an older server stays put.
  assert.equal(slugEditable({ state: "draft" }), false);
  assert.equal(slugEditable({ state: "scheduled", wasPublished: false }), false);
  assert.equal(slugEditable({ state: "published", wasPublished: true }), false);
});

test("the address preview, its checks, and the engine's slug", () => {
  assert.equal(slugify(" Pumpkin Bread! "), "pumpkin-bread");
  assert.equal(slugify("Déjà vu"), "déjà-vu");
  assert.equal(fileSlug("posts/2026-11-06-pumpkin-bread.md"), "pumpkin-bread");
  assert.equal(slugPreview({ siteUrl: "https://www.grammishouse.com/", postPath: "/{slug}/", slug: "Pumpkin Bread" }), "grammishouse.com/pumpkin-bread/");
  assert.equal(slugPreview({ siteUrl: "https://x.dev/blog/", slug: "", path: "posts/2026-11-06-pie.md" }), "x.dev/blog/posts/pie/");
  assert.equal(slugPreview({ title: "New one" }), "your blog's address/posts/new-one/");
  assert.equal(slugProblem("x".repeat(81)), "Shorter, please: 80 letters at most.");
  assert.equal(slugProblem("!!!"), "An address needs at least one letter or number.");
  assert.equal(slugProblem(""), "");
});

test("checks before a save name the value and the fix", () => {
  assert.deepEqual(aboutProblems({ profile: "recipe", adaptedFrom: "Aunt Ruth" }), [{ name: "adaptedFrom", words: "That needs to be a web address, starting with https://. To thank a person, say so in your words." }]);
  assert.deepEqual(aboutProblems({ profile: "article", adaptedFrom: "Aunt Ruth" }), [], "only the post's own kind is checked");
  assert.equal(aboutProblems({ profile: "video", videoUrl: "https://vimeo.com/1" })[0].name, "videoUrl");
  assert.deepEqual(aboutProblems({ profile: "video", videoUrl: "https://youtu.be/abc" }), []);
  assert.equal(aboutProblems({ seriesOrder: "three" }, { collection: true })[0].words, "A whole number, like 3.");
  assert.deepEqual(aboutProblems({ seriesOrder: "three" }, { collection: false }), []);
  assert.equal(aboutProblems({ canonical: "medium" })[0].name, "canonical");
  assert.equal(aboutProblems({ slug: "!!!" }, { slugOpen: true })[0].name, "slug");
  assert.equal(aboutProblems({ profile: "field-journal", distanceKm: "far" })[0].words, "A number, like 4.2.");
});

test("counters say a limit only when crossing it", () => {
  assert.equal(summaryCount("x".repeat(160)), "");
  assert.equal(summaryCount("x".repeat(212)), "Google usually shows about 160 letters; this has 212. The rest may be cut off.");
  assert.equal(pinCounts({ cardTitle: "x".repeat(112) }).title, "Pinterest shows up to 100 letters; this has 112.");
  assert.match(pinCounts({ cardDescription: "x".repeat(495), coverCredit: "Ruth" }).description, /this has 509/);
  assert.equal(cardSummary("x".repeat(200)).length, 160);
  assert.ok(cardSummary("x".repeat(200)).endsWith("…"));
});

test("changing the kind says what happens to her words", () => {
  const starter = PROFILES[1].starter;
  assert.deepEqual(kindChange("article", "recipe", "", { starter }), { help: "Your recipe boxes are ready.", body: starter });
  assert.deepEqual(kindChange("article", "recipe", "My words.", { starter }), { help: "Your words stay as they are.", addParts: true });
  assert.deepEqual(kindChange("article", "recipe", "x\n\n## Ingredients\n\n- a\n\n## Steps\n\n1. b", { starter }), { help: "Your words stay as they are.", addParts: false });
  assert.match(kindChange("recipe", "article", "x").help, /numbers are kept if you change back/);
  assert.deepEqual(kindChange("article", "job", "", { scaffold: "## The job\n" }), { help: "Fill in About this job, under the title.", body: "## The job\n" });
  assert.equal(kindChange("job", "article", "x").help, "The job details are kept if you change back.");
  assert.equal(withRecipeParts("My words.\n", starter), "My words.\n\n## Ingredients\n\n## Steps\n");
});

test("kinds she can choose: no Job on Grammi's site; a video keeps its own; unknown is kept", () => {
  const meta = { profiles: PROFILES };
  assert.deepEqual(kindChoices(meta, "recipe").map((c) => c.label), ["A story", "A recipe"]);
  assert.deepEqual(kindChoices(meta, "article", { trade: true }).map((c) => c.value), ["article", "recipe", "job"]);
  assert.deepEqual(kindChoices(meta, "video").map((c) => c.label), ["A story", "A recipe", "A video"]);
  const odd = kindChoices(meta, "field-notes").at(-1);
  assert.equal(odd.value, "field-notes");
  assert.equal(odd.label, "Something else");
  assert.equal(groupFor("article"), null);
  assert.equal(groupFor("job"), null, "the sheet never shows job.*: About this job is under the title");
  assert.ok(!groupKeys("job").some((key) => key.startsWith("job.")));
  assert.equal(groupFor("recipe").heading, "This recipe");
});

test("every refusal is said in her words, beside the right field", () => {
  const e = (status, data) => ({ status, data });
  assert.deepEqual(saveProblem(e(409, { code: "exists" })), { where: "title", field: "title", words: "There's already a post with this title. Change it a little and it will save." });
  assert.equal(saveProblem(e(409, { code: "exists", slug: true })).field, "slug");
  assert.equal(saveProblem(e(409, { code: "changed" })).where, "conflict");
  assert.equal(saveProblem(e(409, { code: "credits-changed" })).where, "credits");
  assert.match(saveProblem(e(413, { code: "too-large" })).words, /Split it into two posts/);
  assert.equal(saveProblem(e(422, { code: "slug-taken", issues: [{ code: "slug-taken", field: "slug" }] })).field, "slug");
  assert.equal(saveProblem(e(422, { issues: [{ code: "date", field: "date" }] })).where, "date");
  assert.equal(saveProblem(e(422, { issues: [{ code: "missing", field: "job.trade" }] })).where, "job");
  assert.equal(saveProblem(e(422, { issues: [{ code: "profile-field", field: "videoUrl" }] })).words, "That isn't a YouTube link. Copy it from Share under the video.");
  assert.equal(saveProblem(e(422, { issues: [{ code: "build" }] })).where, "banner");
  assert.equal(saveProblem(e(404, {})).where, "gone");
  assert.equal(saveProblem(e(0, null)).where, "status");
  assert.equal(saveProblem(e(503, null)).where, "status");
  assert.equal(issueWords({ code: "shared-order" }).where, "credits");
  assert.equal(issueWords({ code: "credit-no-role" }).field, "roles");
});
