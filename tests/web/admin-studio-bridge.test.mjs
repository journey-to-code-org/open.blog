// The old Admin's bridge to Studio (Studio R3, G25; deleted with the old Admin in R15):
// Notifications opens Studio's screen, and an iPhone app installed from the old Admin, whose start
// address never updates, opens Studio when launched from its icon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { studioBridge } from "../../web/admin/admin.js";

test("Notifications, from any old address, goes to Studio's", () => {
  for (const hash of ["#/notifications", "#notifications", "#/notifications/x", "#/notifications?y=1"]) assert.equal(studioBridge(hash, false), "/admin/studio/#/notifications", hash);
  assert.equal(studioBridge("#/notificationsx", false), null);
});

test("launched from an old icon with no address, it opens Studio; anything else stays", () => {
  assert.equal(studioBridge("", true), "/admin/studio/");
  assert.equal(studioBridge("#", true), "/admin/studio/");
  assert.equal(studioBridge("", false), null, "a browser tab on /admin/ stays in the old Admin");
  assert.equal(studioBridge("#/quotes", true), null, "a page she asked for stays");
});
