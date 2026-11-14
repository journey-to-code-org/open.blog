// The old Admin's bridge to Studio (Studio R3, G25; deleted with the old Admin in R15):
// Notifications opens Studio's screen, and an iPhone app installed from the old Admin, whose start
// address never updates, opens Studio when launched from its icon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { studioBridge } from "../../web/admin/admin.js";

test("Notifications, from any old address, goes to Studio's", () => {
  for (const hash of ["#/notifications", "#notifications", "#/notifications/x"]) assert.equal(studioBridge(hash, false), "/admin/studio/#/notifications", hash);
  // The query comes along, so the Home Screen sheet still opens.
  assert.equal(studioBridge("#/notifications?sheet=home-screen", false), "/admin/studio/#/notifications?sheet=home-screen");
  assert.equal(studioBridge("#/notifications/devices?sheet=home-screen", true), "/admin/studio/#/notifications?sheet=home-screen");
  assert.equal(studioBridge("#/notificationsx", false), null);
});

test("R4 G28: Capture, from any old address, is Studio's New job, with its query", () => {
  for (const hash of ["#/capture", "#capture", "#/capture/x"]) assert.equal(studioBridge(hash, false), "/admin/studio/#/new-job", hash);
  assert.equal(studioBridge("#/capture?from=x", true), "/admin/studio/#/new-job?from=x");
  assert.equal(studioBridge("#/captures", false), null);
});

test("launched from an old icon with no address, it opens Studio; anything else stays", () => {
  assert.equal(studioBridge("", true), "/admin/studio/");
  assert.equal(studioBridge("#", true), "/admin/studio/");
  assert.equal(studioBridge("", false), null, "a browser tab on /admin/ stays in the old Admin");
  assert.equal(studioBridge("#/quotes", true), null, "a page she asked for stays");
  assert.equal(studioBridge("#/", true), null, "Studio's Open the old Admin (/admin/#/) stays in the old Admin");
});
