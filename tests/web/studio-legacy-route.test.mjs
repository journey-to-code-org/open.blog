import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyRoute, parseRoute } from "../../web/studio/router.js";

test("Studio's own addresses are left alone", () => {
  for (const hash of ["#/", "#/posts", "#/write/posts%2Fx.md", "#/comments/shown", "#/cards/new", "#/front-page", "#/look"]) assert.equal(legacyRoute(hash), null, hash);
});

test("an old editor address opens the right Studio editor by folder", () => {
  assert.equal(legacyRoute("#/edit/posts/pecan-pie.md"), "#/write/posts%2Fpecan-pie.md");
  assert.equal(legacyRoute("#/edit/posts%2Fpecan-pie.md"), "#/write/posts%2Fpecan-pie.md");
  assert.equal(legacyRoute("#/edit/pages/about.md"), "#/page/pages%2Fabout.md");
  assert.equal(legacyRoute("#/edit/series/cookies.md"), "#/collection/series%2Fcookies.md");
  assert.equal(legacyRoute("#/edit/services/roof-repair.md"), "#/service/services%2Froof-repair.md");
  assert.equal(legacyRoute("#/edit/proof/pat.md"), "#/review/proof%2Fpat.md");
  assert.equal(parseRoute(legacyRoute("#/edit/posts/a b.md")).arg, "posts/a b.md");
});

test("renamed screens, new things and the old inbox's states", () => {
  assert.equal(legacyRoute("#/overview"), "#/");
  assert.equal(legacyRoute("#/new/recipe"), "#/write/new/recipe");
  assert.equal(legacyRoute("#/new/post"), "#/write");
  assert.equal(legacyRoute("#/series"), "#/collections");
  assert.equal(legacyRoute("#/landing"), "#/front-page");
  assert.equal(legacyRoute("#/appearance"), "#/look");
  assert.equal(legacyRoute("#/seasons"), "#/decorations");
  assert.equal(legacyRoute("#/greetings"), "#/cards");
  assert.equal(legacyRoute("#/analytics"), "#/visitors");
  assert.equal(legacyRoute("#/social"), "#/sharing");
  assert.equal(legacyRoute("#/moderation/pending?kind=comment"), "#/comments?kind=comment");
  assert.equal(legacyRoute("#/moderation/approved"), "#/comments/shown");
  assert.equal(legacyRoute("#/moderation/removed"), "#/comments/taken-down");
});

test("an old screen Studio doesn't have yet says so, never a blank Home", () => {
  for (const name of ["research", "voice", "capture", "notifications", "contributors"]) assert.equal(legacyRoute(`#/${name}`), `#/not-yet/${name}`);
});

test("R1: Where it went is a view of Sharing, and Share this job lives under it", () => {
  assert.equal(legacyRoute("#/distribution"), "#/sharing?view=posts");
  assert.equal(legacyRoute("#/distribution?days=90"), "#/sharing?view=posts&days=90");
  assert.notEqual(legacyRoute("#/distribution"), "#/not-yet/distribution");
  assert.equal(legacyRoute("#/share/posts%2Foak-floor.md"), "#/sharing/job/posts%2Foak-floor.md");
  assert.equal(legacyRoute("#/share/posts/oak-floor.md"), "#/sharing/job/posts/oak-floor.md");
  assert.equal(parseRoute(legacyRoute("#/share/posts%2Foak floor.md")).arg, "job/posts/oak floor.md");
  assert.equal(legacyRoute("#/share"), "#/sharing");
  assert.deepEqual(parseRoute(legacyRoute("#/distribution")), { name: "sharing", arg: "", query: { view: "posts" } });
  assert.equal(legacyRoute("#/sharing/job/posts%2Fx.md"), null, "Studio's own address is left alone");
});
