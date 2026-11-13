import { test } from "node:test";
import assert from "node:assert/strict";
import { RECORDS, reviewLine, tradeSite, longDay } from "../../web/studio/parts/record-kinds.js";

test("a review's line says stars, where and when, in words", () => {
  assert.equal(reviewLine({ rating: "5", platform: "google", date: "2026-10-20" }), "5 stars · Google · October 20, 2026");
  assert.equal(reviewLine({ rating: "1", platform: "other", date: "" }), "1 star · Somewhere else");
  assert.equal(reviewLine({ rating: "", platform: "", date: "nonsense" }), "");
  assert.equal(longDay("2026-01-02"), "January 2, 2026");
});

test("drafts say they're off the site; reviews keep the server's newest-first order", () => {
  assert.equal(RECORDS.services.row({ status: "draft" }), "Off your site");
  assert.equal(RECORDS.services.row({ status: "published" }), "");
  assert.match(RECORDS.proof.row({ status: "draft", rating: "4" }), /^4 stars · Off your site$/);
  assert.equal(RECORDS.proof.sort, "server");
});

test("only a trade site shows Services, Reviews and Business", () => {
  assert.equal(tradeSite({ siteUses: { trade: true } }), true);
  assert.equal(tradeSite({ siteUses: { trade: false, reviews: true } }), false);
  assert.equal(tradeSite({}), false);
});
