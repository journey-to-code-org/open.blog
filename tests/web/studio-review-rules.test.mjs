// Research checks in Before you publish (Studio R7): the old Admin's post cases from
// admin-publication-review.test.mjs and admin-readiness-report.test.mjs, in their Studio form. Which
// posts are reviewed, groups and gates in her words, every finding placed, Mark as checked sends
// exactly the finding's key, and the counts sentence stays `openblog check`'s for the details.
// Site cases move to R12 with What will be public.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  REVIEW_GROUPS, acknowledgementRequest, blockingCount, gateWords, groupWords, markProblem, markWords, publicationReviewCountsText,
  publicationReviewPlace, researchReviewApplies, reviewCountsWords, reviewGroups, reviewPlaceWords, reviewTarget,
} from "../../web/studio/parts/review-rules.js";
import { HER_BANNED } from "../../web/studio/parts/plain-words.js";

// A review exactly as `POST /admin/api/research/review` serializes it (see the Rust tests).
const REVIEW = () => ({
  version: 1,
  applies: true,
  post: "posts/cave.md",
  firstBodyLine: 8,
  findings: [
    { validator: "atlas", check: "atlas-integrity", code: "file-unreadable", outcome: "detected", gate: "refuses", scope: { object: "atlas" }, message: "cannot read <img src=x onerror=alert(1)>", repair: "Fix the named record.", fingerprint: "77a7d3481ffc4ddc94f4bf1cf3337fe5" },
    { validator: "publication-context", check: "context-link", code: "context-link-unpublished", outcome: "detected", gate: "advisory", scope: { object: "post", path: "posts/cave.md", line: 12 }, message: "The link names a page the next build does not publish.", repair: "Approve it, or remove the link.", fingerprint: "0123456789abcdef0123456789abcdef" },
    { validator: "citation-review", check: "citation-resolution", code: "citation-unresolved", outcome: "detected", gate: "refuses-when-published", scope: { object: "post", path: "posts/cave.md", line: 14 }, message: "`nobody` is not in the library.", repair: "Fix the citation.", fingerprint: "8408ef31a285b52fac97121f8fe1d81f" },
    { validator: "claim-review", check: "evidence-relation", code: "claim-evidence-missing", outcome: "potential", gate: "advisory", scope: { object: "claim", id: "c1", path: "posts/cave.md", field: "claims[c1]" }, message: "The claim has no evidence link.", repair: "Link evidence.", fingerprint: "2644c97cec4452539895e6c76c474a61", acknowledgement: "stale" },
    { validator: "claim-review", check: "evidence-location", code: "claim-locator-missing", outcome: "potential", gate: "withholds", scope: { object: "evidence-link", id: "l1", path: "posts/cave.md" }, message: "The link gives no location.", repair: "Add a locator.", fingerprint: "bf8b645d02a756974b6974272f48ef92" },
    { validator: "citation-review", check: "location-review", code: "citation-location-review", outcome: "needs-review", gate: "advisory", scope: { object: "post", path: "posts/cave.md", line: 10 }, message: "1 located citation.", repair: "Compare it.", fingerprint: "0fcdc3e673e71ef97ae4f405edaa8656", acknowledgement: "current" },
  ],
  groups: [{ name: "blocking", findings: [0, 2] }, { name: "detected", findings: [1] }, { name: "potential", findings: [3, 4] }, { name: "needs-review", findings: [5] }],
  counts: { detected: { found: 3, acknowledged: 0 }, potential: { found: 2, acknowledged: 0 }, needsReview: { found: 1, acknowledged: 1 } },
  notReviewed: [],
  acknowledgements: { file: ".openblog/private/research/acknowledgements.json", revision: "rev-1", error: null },
});

const BODY = "## Abstract\n\nThe cave educates the soul by turning it toward the light [@slings].\n\nSee [the Good](/atlas/the-good/).\n\nAlso [@nobody].\n";

test("the review applies to research and cited posts only", () => {
  assert.equal(researchReviewApplies({ title: "A" }, "research"), true);
  assert.equal(researchReviewApplies({ citations: "notes" }, "article"), true);
  assert.equal(researchReviewApplies({ profile: "Research" }), true);
  assert.equal(researchReviewApplies({ title: "Plain" }, "article"), false);
  assert.equal(researchReviewApplies({ citations: "  " }, ""), false);
});

test("groups come in the server's order and codes; only the blocking group blocks", () => {
  const review = REVIEW();
  const groups = reviewGroups(review);
  assert.deepEqual(groups.map((g) => g.name), REVIEW_GROUPS);
  assert.deepEqual(groups.map((g) => g.findings.map((f) => f.code)), review.groups.map((g) => g.findings.map((i) => review.findings[i].code)));
  assert.equal(blockingCount(review), 2);
  assert.equal(blockingCount({ groups: [{ name: "detected", findings: [1] }] }), 0);
  assert.deepEqual(groupWords("blocking", 2), { heading: "Needs fixing before it can go up (2)", help: "Your blog won't publish the post with these. They can't be marked as checked." });
  assert.equal(groupWords("needs-review", 3).heading, "Only you can check these (3)");
  assert.deepEqual(reviewGroups({ findings: [], groups: [{ name: "blocking", findings: [] }] }), [], "an empty group is not shown");
});

test("only advisory findings can be marked; a withheld one says it stays out until approved again", () => {
  assert.equal(gateWords("advisory"), "");
  assert.match(gateWords("withholds"), /stays off your site until you look at the place and approve it again/);
  assert.doesNotMatch(gateWords("withholds"), /refuses/, "a withheld finding isn't one the build refuses");
  assert.match(gateWords("refuses-when-published"), /once the post is published/);
  assert.equal(gateWords("refuses"), "This can't be marked as checked: your blog refuses it, so it has to be fixed.");
});

test("a mark keeps the finding listed and counted, and says so", () => {
  assert.equal(markWords("current"), "You marked this as checked. It stays on the list until it changes.");
  assert.match(markWords("stale"), /earlier version/);
  assert.equal(markWords(null), "");
  assert.equal(reviewCountsWords(REVIEW()), "Found by a check: 3. Might need a look: 2. Only you can check: 1 (1 checked).");
});

test("Mark as checked sends exactly the finding's key and fingerprint with the revision", () => {
  const review = REVIEW();
  assert.deepEqual(acknowledgementRequest(review.findings[3], "rev-1"), {
    revision: "rev-1",
    acknowledgement: { validator: "claim-review", code: "claim-evidence-missing", object: "claim", path: "posts/cave.md", id: "c1", field: "claims[c1]", fingerprint: "2644c97cec4452539895e6c76c474a61" },
  });
  assert.deepEqual(Object.keys(acknowledgementRequest(review.findings[1], "r").acknowledgement), ["validator", "code", "object", "path", "fingerprint"]);
});

test("a refused mark changes nothing and says why", () => {
  assert.match(markProblem({ status: 409, data: { code: "changed", revision: "rev-9" } }), /changed on another computer/);
  assert.equal(markProblem({ status: 422, data: { code: "invalid-acknowledgement" } }), "That wasn't marked. Nothing changed.");
  assert.equal(markProblem({ status: 413, data: { code: "too-large" } }), "That wasn't marked. Nothing changed.");
  assert.equal(markProblem({ status: 0 }), "Waiting for a signal. Nothing was marked.");
});

test("every finding has a place in her words, and Show me goes there", () => {
  const context = { post: "posts/cave.md", firstBodyLine: 8, body: BODY };
  const review = REVIEW();
  const places = review.findings.map((f) => reviewPlaceWords(f, context));
  assert.deepEqual(places, [
    "In your research notes",
    "In your words, near “See the Good.”",
    "In your words, near “Also [@nobody].”",
    "In your research: claim c1",
    "In your research: claim l1",
    "In your words, near “The cave educates the soul by…”",
  ]);
  for (const place of places) assert.doesNotMatch(place, HER_BANNED);
  assert.equal(reviewPlaceWords({ scope: { object: "post", path: "posts/other.md", line: 3 } }, context), "In another of your posts");
  assert.equal(reviewPlaceWords({ scope: { object: "post", path: "posts/cave.md", field: "description" } }, context), "In Summary");
  assert.equal(reviewPlaceWords({ scope: { object: "alignment", id: "cave" } }, context), "In your research: comparison cave");
  assert.deepEqual(reviewTarget(review.findings[1], context), { kind: "line", line: 5 });
  assert.deepEqual(reviewTarget({ scope: { object: "post", path: "posts/cave.md", field: "doi" } }, context), { kind: "field", field: "doi" });
  assert.equal(reviewTarget({ scope: { object: "post", path: "posts/other.md", line: 3 } }, context), null);
  assert.equal(reviewTarget(review.findings[3], context), null, "research objects get their buttons in R11/R12");
});

test("the details keep the terminal's words", () => {
  const review = REVIEW();
  assert.equal(publicationReviewCountsText({ ...review, scope: "post" }), "2 must be fixed before publishing. Detected: 3. Potential: 2. Needs review: 1 (1 acknowledged).");
  assert.equal(publicationReviewCountsText({ counts: {}, groups: [] }), "Detected: 0. Potential: 0. Needs review: 0.");
  assert.equal(publicationReviewPlace(review.findings[1], { post: "posts/cave.md", firstBodyLine: 8 }), "line 5 of the draft");
  assert.equal(publicationReviewPlace({ scope: { object: "alignment", id: "cave", field: "members[1]" } }), "comparison cave, members[1]");
  assert.equal(publicationReviewPlace({ place: "posts/cave.md, line 12", scope: {} }), "posts/cave.md, line 12");
});

test("the readiness fixture's places and counts read as the terminal prints them", () => {
  const fixture = (name) => readFileSync(new URL(`../fixtures/research-readiness/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const report = JSON.parse(fixture("report.json"));
  const lines = fixture("report.txt").trimEnd().split("\n");
  assert.equal(`Research checks: ${publicationReviewCountsText(report)}`, lines.at(-1));
  for (const finding of report.findings) assert.ok(reviewPlaceWords(finding, {}).startsWith("In "));
});
