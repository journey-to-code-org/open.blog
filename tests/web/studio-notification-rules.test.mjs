// Notifications' rules (Studio R3), ported from admin-notifications.test.mjs: every old
// browserState case is a hereState case, plus the phones the spec names (iOS 16.3/16.4/18 in a tab
// and from the icon, Facebook's in-app page, plain http, Firefox private), the switches the site
// offers and the kinds kept, her sentences, the denied steps for this phone only, and Add to Home
// Screen's way for each phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_WORDS, herePhone, hereState, deviceNoun, guessLabel, uniqueLabel, endpointHash, keyBytes, sameKey,
  offeredKinds, keptKinds, kindsSummary, savedKindsWords, lastToldWords, deniedSteps, didntSeeIt, pushTrouble,
  stateWords, stateBadge, stopWords, ledeWords,
} from "../../web/studio/parts/notification-rules.js";
import { installWay, installSteps, menuLabel, sheetLabel, promptOutcomeWords } from "../../web/studio/parts/install-rules.js";

const PUBLIC = "BNJXQLrFqB91iIEvDTQE-lvUxvYyB_Hj57arqlCDifnNudW0TeOybFZdAm45MSdoDRrmo7yK48iuCh2rOHYV7MM";
const ios = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v.replace(".", "_")} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Mobile/15E148 Safari/604.1`;
const IPHONE = ios("18.1");
const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const FACEBOOK = `${IPHONE} [FBAN/FBIOS;FBAV/480.0]`;
const MAC_SAFARI = IPAD_DESKTOP;
const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
const CRIOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1";

/** A browser as herePhone sees it. */
function phone({ userAgent = PIXEL, permission = "default", standalone = false, capable = true, secure = true, platform = "Linux", touch = 0 } = {}) {
  const navigator = { userAgent, platform, maxTouchPoints: touch, standalone, ...(capable ? { serviceWorker: {} } : {}) };
  const window = { isSecureContext: secure, matchMedia: () => ({ matches: standalone }), ...(capable ? { PushManager: function PushManager() {}, Notification: { permission } } : {}) };
  return herePhone({ navigator, window });
}

test("a device gets a sensible name, and a second of the same name gets a number", () => {
  assert.equal(guessLabel(IPHONE), "iPhone");
  assert.equal(guessLabel(PIXEL), "Android phone");
  assert.equal(guessLabel(WIN_CHROME), "Windows computer");
  assert.equal(uniqueLabel("iPhone", [{ label: "iPhone" }]), "iPhone 2");
  assert.equal(uniqueLabel("iPhone", [{ label: "iPhone" }, { label: "iphone 2" }]), "iPhone 3");
  assert.equal(uniqueLabel("Kitchen iPad", [{ label: "iPhone" }]), "Kitchen iPad");
  assert.equal(uniqueLabel("  ", []), "Phone");
});

test("every old browserState case is a hereState case", () => {
  // install-first: an iPhone not opened from the Home Screen.
  assert.equal(hereState(phone({ userAgent: IPHONE, capable: false })), "home-screen-first");
  assert.equal(hereState(phone({ capable: false })), "unsupported");
  assert.equal(hereState(phone({ permission: "denied" })), "denied");
  assert.equal(hereState(phone()), "off");
  assert.equal(hereState(phone({ permission: "granted" }), { id: "x" }, true), "on");
});

test("iPhones by version and where they're opened, in-app pages, plain http and Firefox private", () => {
  assert.equal(hereState(phone({ userAgent: ios("16.3"), capable: false })), "update-first");
  assert.equal(hereState(phone({ userAgent: ios("16.3"), standalone: true, capable: false })), "update-first");
  assert.equal(hereState(phone({ userAgent: ios("16.4"), capable: false })), "home-screen-first");
  assert.equal(hereState(phone({ userAgent: ios("16.4"), standalone: true })), "off");
  assert.equal(hereState(phone({ userAgent: ios("18.1"), capable: false })), "home-screen-first");
  assert.equal(hereState(phone({ userAgent: ios("18.1"), standalone: true, permission: "granted" }), { id: "x" }, true), "on");
  assert.equal(phone({ userAgent: ios("16.4") }).ios, 16.04);
  assert.equal(hereState(phone({ userAgent: FACEBOOK, capable: false })), "in-app");
  assert.equal(hereState(phone({ secure: false })), "not-secure");
  // Firefox private windows have no service worker.
  assert.equal(hereState(phone({ userAgent: FIREFOX, capable: false })), "unsupported");
  // Allowed, but removed on another device: off.
  assert.equal(hereState(phone({ permission: "granted" }), null, true), "off");
  // An iPad that says it's a Mac.
  const ipad = phone({ userAgent: IPAD_DESKTOP, platform: "MacIntel", touch: 5, capable: false });
  assert.equal(ipad.ipad, true);
  assert.equal(hereState(ipad), "home-screen-first");
});

test("the card names the phone in her hand, and every state has words; banned words stay off her layer", () => {
  assert.equal(deviceNoun(phone({ userAgent: IPHONE })), "iPhone");
  assert.equal(deviceNoun(phone({ userAgent: IPAD_DESKTOP, platform: "MacIntel", touch: 5 })), "iPad");
  assert.equal(deviceNoun(phone({ userAgent: PIXEL })), "phone");
  assert.equal(deviceNoun(phone({ userAgent: PIXEL.replace(" Mobile", "") })), "tablet");
  assert.equal(deviceNoun(phone({ userAgent: WIN_CHROME })), "computer");
  const here = phone({ userAgent: IPHONE });
  assert.match(stateWords("in-app", phone({ userAgent: FACEBOOK })), /Open your blog in Safari/);
  assert.match(stateWords("in-app", phone({ userAgent: `${PIXEL} FB_IAB/FB4A` })), /Open your blog in Chrome/);
  assert.match(stateWords("home-screen-first", here), /four taps/);
  assert.deepEqual(stateBadge("on"), ["On", "success"]);
  assert.deepEqual(stateBadge("denied"), ["Not allowed", "warning"]);
  assert.equal(stateBadge("in-app"), null);
  const all = [
    ...["denied", "home-screen-first", "update-first", "in-app", "not-secure"].map((s) => stateWords(s, here)),
    ...deniedSteps(here), ...didntSeeIt(here), kindsSummary(["comment"]), lastToldWords(null),
    ...Object.values(KIND_WORDS).map((k) => k.switch), ledeWords(["comment"]),
  ].join(" ");
  assert.doesNotMatch(all, /\b(Studio|Admin|push|subscription|PWA|service worker|permission|endpoint|device)\b/i);
});

test("the switches are only what the site offers; a change keeps every kind it doesn't show", () => {
  const status = { kinds: ["comment", "feedback", "quote", "app"].map((id) => ({ id, label: id })), otherApps: true };
  assert.deepEqual(offeredKinds({ engagement: true }, status), ["comment", "feedback", "app"]);
  assert.deepEqual(offeredKinds({ engagementSetUp: true, quote: true }, { ...status, otherApps: false }), ["comment", "feedback", "quote"]);
  assert.deepEqual(offeredKinds({ quote: true }, { ...status, kinds: [{ id: "comment" }] }), []);
  assert.deepEqual(offeredKinds({}, { kinds: [], otherApps: false }), []);
  // Quote isn't offered here, so it is kept as the server holds it.
  assert.deepEqual(keptKinds(["app"], ["comment", "feedback", "app"], ["comment", "quote", "app"]), ["quote", "app"]);
  assert.deepEqual(keptKinds([], ["comment"], ["comment"]), []);
  assert.deepEqual(keptKinds(["comment", "quote"], ["comment"], []), ["comment"], "never what isn't offered");
});

test("summaries, saved words and when it last told her", () => {
  assert.equal(kindsSummary(["app", "comment"]), "Tells you about comments and news from your other apps.");
  assert.equal(kindsSummary(["comment", "feedback", "quote"]), "Tells you about comments, notes from readers and quote requests.");
  assert.equal(kindsSummary([]), "Nothing is on, so it stays quiet.");
  assert.equal(savedKindsWords(["comment", "app"], "This iPhone"), "Saved. This iPhone will tell you about comments and news from your other apps.");
  assert.equal(savedKindsWords([], "This iPhone"), "Saved. Nothing is on, so this iPhone stays quiet. To stop them for good, turn notifications off.");
  assert.equal(savedKindsWords(["comment"], "Kitchen iPad"), "Saved. Kitchen iPad will tell you about comments.");
  const now = Date.parse("2026-11-13T12:00:00Z");
  assert.equal(lastToldWords(null, now), "Hasn't told you anything yet.");
  assert.equal(lastToldWords("2026-11-13T11:59:30Z", now), "Last told you just now.");
  assert.equal(lastToldWords("2026-11-13T11:00:00Z", now), "Last told you an hour ago.");
  assert.equal(lastToldWords("2026-11-13T09:00:00Z", now), "Last told you 3 hours ago.");
  assert.equal(lastToldWords("2026-11-12T12:00:00Z", now), "Last told you yesterday.");
  assert.equal(lastToldWords("2026-11-08T12:00:00Z", now), "Last told you 5 days ago.");
  assert.equal(ledeWords(["quote"]), "Your phone can tell you when someone asks for a quote, even when your blog is closed.");
});

test("denied steps and 'didn't see it' are this phone's only", () => {
  assert.equal(deniedSteps(phone({ userAgent: IPHONE })).length, 4);
  assert.match(deniedSteps(phone({ userAgent: PIXEL, standalone: true }))[0], /Touch and hold your blog's icon/);
  assert.match(deniedSteps(phone({ userAgent: PIXEL })).join(" "), /Permissions/);
  assert.match(deniedSteps(phone({ userAgent: WIN_CHROME })).join(" "), /in Edge/);
  assert.match(deniedSteps(phone({ userAgent: MAC_SAFARI })).join(" "), /Safari menu/);
  assert.match(deniedSteps(phone({ userAgent: FIREFOX })).join(" "), /Blocked: Send notifications/);
  assert.match(deniedSteps(phone({ userAgent: "Mozilla/5.0 (X11) SomethingElse/1.0" }))[0], /browser's settings/);
  const iphone = didntSeeIt(phone({ userAgent: IPHONE })).join(" ");
  assert.match(iphone, /Lock Screen and Banners/);
  assert.doesNotMatch(iphone, /System Settings|Apps, then/);
  assert.match(didntSeeIt(phone({ userAgent: WIN_CHROME })).join(" "), /System, Notifications/);
});

test("trouble is told by the server's code, never as a code", () => {
  const e = (status, code) => ({ status, data: code ? { code } : {} });
  assert.match(pushTrouble(e(409, "too-many"), { limit: 25 }), /up to 25 phones and computers/);
  assert.match(pushTrouble(e(400, "invalid-subscription")), /Try Safari, Chrome, Edge or Firefox/);
  for (const code of ["hosted-unavailable", "hosted-timeout", "storage-unavailable", "bad-reply"]) assert.match(pushTrouble(e(502, code)), /couldn't reach its notification service/);
  for (const code of ["hosted-key-rejected", "not-enabled", "not-set-up"]) assert.match(pushTrouble(e(502, code)), /Tell the person who set up your site/);
  assert.match(pushTrouble(e(410, "gone"), { during: "test" }), /This iPhone stopped taking notifications/);
  assert.match(pushTrouble(e(404, "not-found"), { during: "test" }), /taken off your list on another phone or computer/);
  assert.match(pushTrouble(e(502, "send-failed"), { during: "test" }), /didn't reach this iPhone/);
  assert.equal(pushTrouble(e(410, "gone"), { during: "other-test", name: "Kitchen iPad" }), "Kitchen iPad stopped taking notifications, so your blog forgot it.");
  assert.equal(pushTrouble(e(400, "label-required")), "Give it a name, like Kitchen iPad.");
  assert.match(stopWords("dismissed"), /choose Allow/);
  assert.match(stopWords("worker", "iPad"), /couldn't get this iPad ready/);
});

test("a sign-up made with another key is made again; bytes and hashes are the server's", async () => {
  assert.equal(keyBytes(PUBLIC).length, 65);
  assert.equal(sameKey({ options: { applicationServerKey: keyBytes(PUBLIC).buffer } }, PUBLIC), true);
  const other = keyBytes(PUBLIC);
  other[10] ^= 1;
  assert.equal(sameKey({ options: { applicationServerKey: other.buffer } }, PUBLIC), false);
  assert.equal(sameKey({ options: {} }, PUBLIC), true, "unknown counts as the same");
  assert.equal((await endpointHash("https://fcm.googleapis.com/x")).length, 32);
  assert.equal(await endpointHash("https://fcm.googleapis.com/x"), await endpointHash("https://fcm.googleapis.com/x"));
});

test("Add to Home Screen: one way per phone, its steps only, and the menu says it only where it can", () => {
  const iphone = phone({ userAgent: IPHONE, capable: false });
  assert.equal(installWay(iphone), "ios-safari");
  assert.equal(installWay(phone({ userAgent: CRIOS, capable: false })), "ios-other");
  assert.equal(installWay(phone({ userAgent: FACEBOOK, capable: false })), "in-app");
  assert.equal(installWay(phone({ userAgent: PIXEL })), "android-menu");
  assert.equal(installWay(phone({ userAgent: PIXEL }), true), "prompt");
  assert.equal(installWay(phone({ userAgent: WIN_CHROME })), "desktop-chromium");
  assert.equal(installWay(phone({ userAgent: MAC_SAFARI })), "mac-safari");
  assert.equal(installWay(phone({ userAgent: FIREFOX })), "firefox-desktop");
  assert.equal(installWay(phone({ userAgent: IPHONE, standalone: true }), true), "installed");

  const steps = installSteps("ios-safari", iphone);
  assert.equal(steps.steps.length, 4);
  assert.match(steps.steps[0].text, /bottom of the screen/);
  assert.equal(steps.steps[0].share, true);
  const ipad = phone({ userAgent: IPAD_DESKTOP, platform: "MacIntel", touch: 5, capable: false });
  assert.match(installSteps("ios-safari", ipad).steps[0].text, /top right/);
  assert.equal(installSteps("ios-other", iphone).copy, true);
  assert.equal(installSteps("prompt", phone({ userAgent: WIN_CHROME })).ask, true);
  assert.match(installSteps("prompt", phone({ userAgent: WIN_CHROME })).intro, /its own window/);

  assert.equal(sheetLabel(iphone), "Add your blog to your Home Screen");
  assert.equal(sheetLabel(phone({ userAgent: WIN_CHROME })), "Install your blog as an app");
  assert.equal(menuLabel(iphone), "Add to Home Screen");
  assert.equal(menuLabel(phone({ userAgent: IPHONE, standalone: true })), null, "already opened from the icon");
  assert.equal(menuLabel(phone({ userAgent: WIN_CHROME })), null, "a computer only when the browser can install");
  assert.equal(menuLabel(phone({ userAgent: WIN_CHROME }), true), "Install as an app");
  assert.equal(menuLabel(phone({ userAgent: FIREFOX })), null);
  assert.equal(promptOutcomeWords("accepted", phone({ userAgent: PIXEL })), "Added. Open your blog from its icon from now on.");
  assert.equal(promptOutcomeWords("dismissed", phone({ userAgent: PIXEL })), "Not added. You can add it any time from your name's menu.");
});
