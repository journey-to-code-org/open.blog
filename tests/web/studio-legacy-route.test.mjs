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
  assert.equal(legacyRoute("#/moderation/pending?kind=comment"), "#/comments?kind=comment");
  assert.equal(legacyRoute("#/moderation/approved"), "#/comments/shown");
  assert.equal(legacyRoute("#/moderation/removed"), "#/comments/taken-down");
});

test("an old screen Studio doesn't have yet says so, never a blank Home", () => {
  for (const name of ["research", "voice", "design"]) assert.equal(legacyRoute(`#/${name}`), `#/not-yet/${name}`);
});

test("R5: Contributors is People, and a post's Settings pane is About this post", () => {
  assert.equal(legacyRoute("#/contributors"), "#/people");
  assert.equal(legacyRoute("#/people"), null, "Studio's own address stays");
  assert.equal(legacyRoute("#/edit/posts/2026-11-06-pie.md?pane=settings"), "#/write/posts%2F2026-11-06-pie.md?sheet=about");
  assert.equal(legacyRoute("#/edit/posts/2026-11-06-pie.md?pane=social"), "#/write/posts%2F2026-11-06-pie.md", "other panes open the post");
  assert.equal(legacyRoute("#/edit/pages/about.md?pane=settings"), "#/page/pages%2Fabout.md");
});

test("R4: Capture, whatever came after it, is New job, and the query stays", () => {
  assert.equal(legacyRoute("#/capture"), "#/new-job");
  assert.equal(legacyRoute("#/capture/anything/else"), "#/new-job");
  assert.equal(legacyRoute("#/capture?from=checklist"), "#/new-job?from=checklist");
  assert.equal(legacyRoute("#/new-job"), null, "Studio's own address stays");
});

test("R3: Notifications is Studio's own; anything after it goes, the query stays", () => {
  assert.equal(legacyRoute("#/notifications"), null);
  assert.equal(legacyRoute("#/notifications?sheet=home-screen"), null);
  assert.equal(legacyRoute("#/notifications/devices"), "#/notifications");
  assert.equal(legacyRoute("#/notifications/x/y?sheet=home-screen"), "#/notifications?sheet=home-screen");
  // Old notice addresses the worker hands over as Studio's keep landing on their screens.
  assert.equal(legacyRoute("#/moderation"), "#/comments");
  assert.equal(legacyRoute("#/feedback"), "#/comments");
  assert.equal(legacyRoute("#/quotes"), null);
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

test("R2: the old accounts page, and anything after it, opens Your accounts; announcements still open Sharing", () => {
  for (const old of ["#/social", "#/social/", "#/social/connections", "#/social/linkedin/x?y=1", "#social", "#/social?connection=11111111-1111-4111-8111-111111111111"]) {
    assert.equal(legacyRoute(old), "#/sharing/accounts", old);
  }
  assert.equal(legacyRoute("#/announcements"), "#/sharing");
  assert.equal(legacyRoute("#/sharing/accounts"), null, "Studio's own address is left alone");
  assert.equal(legacyRoute("#/sharing/accounts?connection=11111111-1111-4111-8111-111111111111"), null);
});
