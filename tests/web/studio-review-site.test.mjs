// The whole site's research checks on What readers see (Studio R12; R7 deferred the site cases of
// the old admin-readiness-report.test.mjs here). The Rust tests write the shared fixtures from the
// contract (crates/openblog-core/tests/readiness_report.rs); these read the same files, so Studio's
// order and counts are the terminal's, and each finding opens where it's changed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicationReviewCountsText, reviewGroups, reviewTarget } from "../../web/studio/parts/review-rules.js";
import { openItHash } from "../../web/studio/parts/research-rules.js";

const fixture = (name) => readFileSync(new URL(`../fixtures/research-readiness/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const report = JSON.parse(fixture("report.json"));
const lines = fixture("report.txt").trimEnd().split("\n");
const terminalCodes = lines.filter((line) => line.startsWith("research ")).map((line) => line.slice(line.lastIndexOf("[") + 1, -1));
const at = (code) => report.findings.find((finding) => finding.code === code);
const site = (finding) => openItHash({ ...finding.scope, related: finding.related }, { site: true });

test("Studio lists the codes the terminal prints, in the order the terminal prints them", () => {
  const codes = reviewGroups(report).flatMap((group) => group.findings.map((finding) => `${finding.validator}: ${finding.code}`));
  assert.deepEqual(codes, terminalCodes);
  assert.ok(codes.length >= 6, "the fixture holds a mixed-severity report");
  assert.deepEqual(reviewGroups(report).map((group) => group.name), ["blocking", "detected", "potential", "needs-review"]);
});

test("the counts are the terminal's, outcomes apart and never a total, and say the next build", () => {
  assert.equal(`Research checks: ${publicationReviewCountsText(report)}`, lines.at(-1));
  assert.doesNotMatch(lines.at(-1), /score|total|ready|passed|resolved/i);
  assert.match(publicationReviewCountsText(report), /^1 must be fixed before the next build\./);
  assert.match(publicationReviewCountsText({ ...report, scope: "post" }), /^1 must be fixed before publishing\./);
});

test("acknowledged and stale findings stay listed and counted", () => {
  assert.ok(report.findings.some((finding) => finding.acknowledgement === "current"));
  assert.ok(report.findings.some((finding) => finding.acknowledgement === "stale"));
  assert.equal(report.counts.potential.found, 1, "an acknowledged finding is still counted");
  assert.equal(report.counts.detected.acknowledged, 0, "a stale acknowledgement counts for nothing");
});

test("each site finding opens where it's changed, and nothing claims to be in an open post", () => {
  assert.equal(site(at("citation-unresolved")), "#/write/posts%2Fcave.md", "a post's finding opens the post");
  assert.equal(site(at("file-unreadable")), "#/research/atlas");
  assert.equal(site(at("stale-approval")), "#/research/compare/cave-places");
  assert.equal(openItHash({ object: "claim", id: "c1", path: "posts/cave.md" }, { site: true }), "#/write/posts%2Fcave.md?sheet=claims&claim=c1");
  assert.equal(openItHash({ object: "claims-file" }, { site: true }), "", "nothing to open without a post");
  assert.equal(openItHash({ object: "relationship", id: "r/1" }), "#/research/atlas/relationships/r%2F1");
  assert.equal(openItHash({ object: "entry", id: "plato" }), "#/research/atlas/plato");
  assert.equal(openItHash({ object: "interpretation", id: "mine" }), "#/research/sources");
  assert.equal(openItHash({ object: "post", path: "posts/cave.md" }), "", "in a post's own review, a post finding is Show me, not Open it");
  // The site report has no open post: Show me is never offered for it.
  assert.equal(reviewTarget(at("citation-unresolved"), { post: "posts/other.md" }), null);
});

test("the fixture carries no statement, note or excerpt, only ids, fields and the validators' sentences", () => {
  assert.doesNotMatch(JSON.stringify(report), /ZqxLeak|"facts"/);
  for (const finding of report.findings) assert.match(finding.fingerprint, /^[0-9a-f]{32}$/);
});
