// Your accounts' rules (Studio R2), ported from the old Admin's social.js tests and extended: only a
// provider's own address is followed, the app password's shape is checked on the device, a return
// carries only a connection id, and every word she sees is hers.
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../../web/studio/parts/social-rules.js";
import { healthBadge, healthWords, HEALTH_BADGES, usableUntil } from "../../web/studio/parts/share-words.js";
import { sayClock, sayShortDay } from "../../web/studio/parts/dates.js";

const NOW = Date.parse("2026-11-13T15:00:00Z");
const ID = (n) => `${String(n).repeat(8)}-1111-4111-8111-${String(n).repeat(12)}`;
const later = (ms) => new Date(NOW + ms).toISOString();
const conn = (over = {}) => ({ id: ID(1), provider: "facebook", status: "pending", expiresAt: later(10 * 60000), createdAt: new Date(NOW).toISOString(), reauthAccountId: null, destinations: [], notes: [], ...over });
const account = (over = {}) => ({ id: ID(2), provider: "facebook", kind: "page", displayName: "Grammi's House", externalId: "111", status: "connected", health: "ok", credential: { accessExpiresAt: "2026-11-27T15:00:00Z", refreshExpiresAt: null }, ...over });

test("a provider address that is not the provider's own is never followed (every old Admin case)", () => {
  for (const bad of ["https://evil.example/oauth", "http://www.linkedin.com/x", "https://www.linkedin.com.evil.example/", "https://u:p@www.linkedin.com/", "javascript:alert(1)", "https://www.linkedin.com:8443/x", null, ""]) {
    assert.equal(R.safeAuthorizeUrl(bad), null, String(bad));
  }
  assert.equal(R.safeAuthorizeUrl("https://www.facebook.com/v23.0/dialog/oauth?x=1"), "https://www.facebook.com/v23.0/dialog/oauth?x=1");
  assert.equal(R.safeAuthorizeUrl("https://evil.example/phish"), null);
  assert.deepEqual(R.AUTHORIZE_HOSTS, ["www.linkedin.com", "www.facebook.com"]);
});

test("a Mastodon sign-in address must be that instance's own /oauth/authorize", () => {
  assert.equal(R.safeAuthorizeUrl("https://social.example.org/oauth/authorize?state=x", "https://social.example.org"), "https://social.example.org/oauth/authorize?state=x");
  assert.equal(R.safeAuthorizeUrl("https://social.example.org/oauth/authorize?state=abc", "https://social.example.org"), "https://social.example.org/oauth/authorize?state=abc");
  for (const [bad, instance] of [
    ["https://social.example.org/oauth/authorize?state=x", null],
    ["https://evil.example/oauth/authorize", "https://social.example.org"],
    ["https://social.example.org/login", "https://social.example.org"],
    ["https://social.example.org:8443/oauth/authorize", "https://social.example.org"],
    ["http://social.example.org/oauth/authorize", "https://social.example.org"],
  ]) assert.equal(R.safeAuthorizeUrl(bad, instance), null, bad);
});

test("an app password is four groups of four letters or digits; anything else is refused on the device", () => {
  for (const good of ["abcd-efgh-ijkl-mnop", "ABCD-1234-ijkl-MNOP", " abcd-efgh-ijkl-mnop "]) assert.equal(R.isAppPassword(good), true, good);
  for (const bad of ["correct horse battery", "abcd-efgh-ijkl", "abcd-efgh-ijkl-mnop-qrst", "abcd_efgh_ijkl_mnop", "abcd-efgh-ijkl-mnø1", "", null]) assert.equal(R.isAppPassword(bad), false, String(bad));
  assert.deepEqual(R.blueskyCheck("", "abcd-efgh-ijkl-mnop"), { field: "name", text: "Type your Bluesky name, like grammi.bsky.social." });
  assert.deepEqual(R.blueskyCheck("grammi.bsky.social", ""), { field: "password", text: "Paste the app password you made in Bluesky." });
  assert.match(R.blueskyCheck("grammi.bsky.social", "hunter2").text, /^That isn't an app password\. .*Never use your real password/);
  assert.equal(R.blueskyCheck("grammi.bsky.social", "abcd-efgh-ijkl-mnop"), null);
  assert.equal(R.blueskyFieldError({ data: { code: "credentials-rejected" } }).field, "password");
  assert.equal(R.blueskyFieldError({ data: { code: "invalid-identifier" } }).field, "name");
  assert.equal(R.blueskyFieldError({ data: { code: "no-destination" } }).field, "");
  assert.equal(R.blueskyFieldError({ data: { code: "provider-unavailable" } }), null);
  assert.doesNotMatch(R.appPasswordHelp, /Never type your real/, "the warning is only for the wrong-shape error");
});

test("a return carries only a connection id; anything else is ignored", () => {
  assert.equal(R.returnConnectionId({ connection: ID(3) }), ID(3));
  for (const bad of [{}, null, { connection: "" }, { connection: ID("a").toUpperCase() }, { connection: `${ID(3)}x` }, { connection: "https://evil.example/" }, { connection: ["x"] }, { connect: ID(3) }]) {
    assert.equal(R.returnConnectionId(bad), null, JSON.stringify(bad));
  }
});

test("permissions in her words, the ones she may decline marked only for details", () => {
  const facebook = { provider: "facebook", scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "brand_new"], requiredScopes: ["pages_show_list", "pages_manage_posts"] };
  assert.deepEqual(R.permissions(facebook).map((p) => [p.words, p.optional]), [
    ["See the Pages you run", false], ["Make posts on your Pages", false], ["See basic details of your Pages", true], ["One more permission", true],
  ]);
  for (const words of Object.values(R.SCOPE_WORDS)) assert.doesNotMatch(words, /optional|say no/);
  assert.equal(R.scopeWords("write:media"), "Add your post's photo");
});

test("each provider's line and first step say what happens, in her words", () => {
  assert.equal(R.providerLine({ provider: "facebook" }), "Post to a Facebook Page you run.");
  assert.equal(R.providerLine({ provider: "facebook" }, { connected: true }), "Add another Facebook Page you run.");
  assert.equal(R.providerLine({ provider: "linkedin", organizations: true }), "Post as yourself, or as a company page you run.");
  assert.equal(R.providerLine({ provider: "linkedin" }), "Post as yourself on LinkedIn.");
  assert.equal(R.providerLine({ provider: "mastodon", instance: "https://mastodon.social" }), "Post as your account on mastodon.social.");
  assert.equal(R.providerLine({ provider: "bluesky" }), "Post as your Bluesky account.");
  assert.deepEqual(R.stepOneWords({ provider: "facebook" }), ["Studio sends you to Facebook. Sign in there and say yes; Facebook sends you back here to pick your Facebook Page."]);
  assert.deepEqual(R.stepOneWords({ provider: "mastodon", instance: "https://mastodon.social", visibility: "unlisted", media: "cover" }), [
    "Studio sends you to mastodon.social. Sign in there and say yes; you come back here to finish.",
    "Anyone with the link can see them, but they stay out of public timelines.",
    "Your post's photo goes with it.",
  ]);
  assert.match(R.stepOneWords({ provider: "linkedin", organizations: true })[0], /your profile, or a company page you run/);
});

test("places, reasons and notes say what she needs and nothing technical", () => {
  assert.equal(R.destinationLabel({ kind: "page", name: "Grammi's House" }), "Grammi's House, Facebook Page");
  assert.equal(R.destinationLabel({ kind: "member", name: "Ada" }), "Your profile, Ada");
  assert.equal(R.destinationLabel({ kind: "organization", name: "Lantern" }), "Lantern, company page");
  assert.equal(R.destinationLabel({ kind: "account", name: "@grammi.bsky.social" }), "@grammi.bsky.social");
  assert.equal(R.reasonWords("no-posting-role"), "Facebook doesn't let your account post on this Page.");
  assert.equal(R.reasonWords("not-administrator", "linkedin"), "LinkedIn doesn't let your account post on this page.");
  assert.match(R.reasonWords("missing-scope", "linkedin"), /^LinkedIn didn't allow posting here/);
  assert.equal(R.reasonWords("something-new"), "Studio can't post here.");
  assert.deepEqual(R.noteWords({ code: "pages-truncated", text: "x" }).first, true);
  assert.deepEqual(R.noteWords({ code: "organizations-not-approved", text: "LinkedIn refused" }), { text: "LinkedIn refused", first: false });
  assert.equal(R.accountKind({ provider: "facebook" }), "Facebook Page");
  assert.equal(R.accountKind({ provider: "linkedin", kind: "organization" }), "LinkedIn company page");
  assert.equal(R.accountKind({ provider: "linkedin", kind: "member" }), "LinkedIn profile");
  assert.equal(R.accountKind({ provider: "bluesky" }), "Bluesky");
});

test("what came back from the provider, and refused actions, are hers; never a code or the server's text", () => {
  assert.equal(R.outcomeWords("denied", "facebook"), "You said no on Facebook, so nothing was connected.");
  assert.equal(R.outcomeWords("expired", "facebook"), "That took too long, so it stopped. Try again.");
  assert.match(R.outcomeWords("no-destination", "facebook"), /You need to run the Page\./);
  assert.equal(R.outcomeWords("no-destination", "linkedin"), "LinkedIn didn't show anywhere you can post.");
  assert.equal(R.outcomeWords("identity-mismatch", "facebook", { reconnecting: true, name: "Grammi's House" }), "That was a different Facebook account, so nothing changed. Sign in as the person who runs Grammi's House, then try again.");
  assert.equal(R.outcomeWords("identity-mismatch", "bluesky", { name: "@grammi.bsky.social" }), "That's a different Bluesky account. Use an app password from @grammi.bsky.social.");
  assert.equal(R.outcomeWords("whatever", "facebook"), "That didn't connect. Try again.");
  for (const code of ["denied", "scopes-missing", "expired", "invalid-state", "code-rejected", "provider-unavailable", "provider-rate-limited", "storage-failed"]) {
    assert.doesNotMatch(R.outcomeWords(code, "facebook"), /minute[s]? \(|\d+ minutes/, code);
  }
  const err = (status, code) => ({ status, data: code ? { code } : null });
  assert.match(R.actionTrouble(err(429, "too-many-attempts")), /^Too many connections are unfinished/);
  assert.match(R.actionTrouble(err(409, "provider-not-configured"), "facebook"), /^Facebook isn't set up on your site any more/);
  for (const e of [err(502, "hosted-key-rejected"), err(502, "hosted-unavailable"), err(404, "not-set-up")]) assert.match(R.actionTrouble(e), /^Sharing isn't working right now/);
  for (const e of [err(502, "bad-reply"), err(504, "hosted-timeout"), err(0)]) assert.match(R.actionTrouble(e), /^Studio couldn't reach your sharing service/);
  assert.match(R.actionTrouble(err(503, "provider-unavailable"), "bluesky"), /^Bluesky couldn't be reached/);
  assert.match(R.actionTrouble(err(429, "provider-rate-limited"), "bluesky"), /^Bluesky asked Studio to slow down/);
});

test("live attempts: still going, not run out, the newest per provider; a reconnect is its account's", () => {
  const list = [
    conn({ id: ID(1), createdAt: later(-5000) }),
    conn({ id: ID(2), createdAt: later(-1000) }),
    conn({ id: ID(3), status: "failed" }),
    conn({ id: ID(4), expiresAt: later(-1) }),
    conn({ id: ID(5), provider: "linkedin", status: "authorized" }),
    conn({ id: ID(6), reauthAccountId: ID(9) }),
  ];
  assert.deepEqual(R.liveAttempts(list, NOW).map((c) => c.id).sort(), [ID(2), ID(5), ID(6)].sort());
});

test("an attempt card says where it is, with one clock", () => {
  const tz = "America/New_York";
  assert.deepEqual(R.attemptCard(conn(), { hasLink: true, timeZone: tz }), { heading: "Waiting for Facebook", words: "Finish on Facebook: sign in and say yes. You have until 10:10 AM to finish.", buttons: ["continue", "stop"] });
  assert.deepEqual(R.attemptCard(conn(), { timeZone: tz }), { heading: "You didn't finish connecting Facebook", words: "You have until 10:10 AM to finish.", buttons: ["again", "stop"] });
  assert.deepEqual(R.attemptCard(conn({ status: "exchanging" })).buttons, []);
  const chosen = R.attemptCard(conn({ status: "authorized", expiresAt: "2026-11-13T20:35:00Z" }), { timeZone: tz });
  assert.equal(chosen.heading, "Almost done: choose your Facebook Page");
  assert.equal(chosen.words, "Facebook said yes. You have until 3:35 PM to finish.");
  assert.deepEqual(chosen.buttons, ["choose", "stop"]);
  assert.equal(R.attemptCard(conn({ provider: "linkedin", status: "authorized" })).heading, "Almost done: choose where posts go");
  assert.equal(R.attemptCard(conn({ provider: "bluesky", status: "authorized" })).heading, "Almost done: choose your account");
  assert.equal(R.untilWords("2026-11-13T20:35:00Z", { timeZone: tz }), "You have until 3:35 PM to finish.");
  assert.equal(R.untilWords(""), "");
});

test("the one thing to do next: choose, then reconnect, then connect the first offered, then share", () => {
  const providers = [{ provider: "linkedin" }, { provider: "bluesky" }, { provider: "facebook" }, { provider: "mastodon" }];
  assert.deepEqual(R.providerOrder(providers).map((p) => p.provider), ["facebook", "bluesky", "linkedin", "mastodon"]);
  assert.equal(R.primaryAction({ providers, now: NOW }).kind, "connect");
  assert.equal(R.primaryAction({ providers, now: NOW }).provider.provider, "facebook");
  assert.equal(R.primaryAction({ providers: [], now: NOW }).kind, "none");
  assert.equal(R.primaryAction({ accounts: [account()], providers, now: NOW }).kind, "share");
  assert.equal(R.primaryAction({ accounts: [account(), account({ id: ID(3), health: "expiring" })], providers, now: NOW }).account.id, ID(3));
  assert.equal(R.primaryAction({ accounts: [account({ status: "disconnected", health: "disconnected" })], providers, now: NOW }).kind, "connect");
  const choosing = conn({ status: "authorized" });
  assert.equal(R.primaryAction({ connections: [choosing], accounts: [account({ health: "needs-reauth" })], providers, now: NOW }).kind, "choose");
  assert.equal(R.primaryAction({ connections: [conn({ status: "authorized", reauthAccountId: ID(2) })], accounts: [account()], providers, now: NOW }).kind, "share", "a reconnect isn't a choice");
});

test("waiting counts and the shares to try again belong to the one account", () => {
  const items = [
    { accountId: ID(2), status: "scheduled", delivery: "pending" },
    { accountId: ID(2), status: "scheduled", lastErrorCode: "rate-limited" },
    { accountId: ID(2), status: "claimed" },
    { accountId: ID(2), status: "failed", delivery: "failed", lastErrorCode: "provider-auth", id: "a", version: 2 },
    { accountId: ID(2), status: "failed", delivery: "failed", lastErrorCode: "provider-rejected", id: "b" },
    { accountId: ID(3), status: "failed", delivery: "failed", lastErrorCode: "needs-reauth", id: "c" },
    { accountId: ID(2), status: "published", delivery: "published" },
  ];
  assert.equal(R.waitingFor(items, ID(2)), 3);
  assert.equal(R.waitingFor(null, ID(2)), 0);
  assert.deepEqual(R.toRetry(items, ID(2)).map((i) => i.id), ["a"]);
  assert.equal(R.retriedWords(2, 0), "2 posts will be tried again within a minute.");
  assert.equal(R.retriedWords(1, 1), "1 post will be tried again. 1 couldn't be, because it changed. Look at it in Sharing.");
  assert.equal(R.retriedWords(0, 2), "2 posts couldn't be tried again, because they changed. Look at them in Sharing.");
});

test("disconnect and connect say what happened", () => {
  assert.equal(R.disconnectWords(2), "2 posts waiting to go there won't be shared. Studio forgets how to post to it; you can connect it again later.");
  assert.equal(R.disconnectWords(0), "Studio forgets how to post to it. You can connect it again later.");
  assert.equal(R.disconnectedWords("Grammi's House", 2), "Disconnected Grammi's House. 2 waiting posts won't be shared.");
  assert.equal(R.disconnectedWords("Grammi's House", "3; drop"), "Disconnected Grammi's House.");
  assert.equal(R.connectedWords(account()), "Connected. Studio can post to Grammi's House on Facebook now. To add another Facebook Page, connect Facebook again.");
  assert.equal(R.connectedWords(account({ provider: "bluesky", displayName: "@grammi.bsky.social" })), "Connected. Studio can post to @grammi.bsky.social on Bluesky now.");
});

test("Sharing's connect and reconnect links stay in Studio", () => {
  assert.deepEqual(R.connectTarget([{ provider: "facebook" }]), { label: "Connect Facebook", href: "#/sharing/accounts?connect=facebook" });
  assert.deepEqual(R.connectTarget([{ provider: "facebook" }, { provider: "bluesky" }]), { label: "Connect an account", href: "#/sharing/accounts" });
  assert.deepEqual(R.connectTarget(null), { label: "Connect an account", href: "#/sharing/accounts" });
  assert.equal(R.reconnectHref(ID(2)), `#/sharing/accounts?reconnect=${ID(2)}`);
  assert.equal(R.reconnectHref("x\"><script>"), "#/sharing/accounts");
});

test("health: the badge names the day to sign in again by; the words name the account to use", () => {
  const now = new Date(NOW);
  const tz = "America/New_York";
  const expiring = account({ health: "expiring", credential: { accessExpiresAt: "2026-11-20T15:00:00Z", refreshExpiresAt: "2026-11-27T15:00:00Z" } });
  assert.equal(usableUntil(expiring), "2026-11-27T15:00:00Z", "the later of the two");
  assert.equal(healthBadge(expiring, { now, timeZone: tz }), "Sign in again by Nov 27");
  assert.equal(healthBadge(account({ health: "expiring", credential: {} }), { now }), "Sign in again soon");
  assert.equal(HEALTH_BADGES.expiring, "Sign in again soon");
  assert.equal(healthBadge(account({ health: "needs-reauth" })), "Needs reconnecting");
  assert.equal(healthWords(expiring, { now, timeZone: tz }), "Facebook stops taking posts from Studio on Friday, November 27. Reconnect it before then, signing in to the Facebook account you used the first time.");
  assert.equal(healthWords(account({ health: "expiring", credential: {} }), { now }), "Facebook stops taking posts from Studio soon. Reconnect it before then, signing in to the Facebook account you used the first time.");
  assert.equal(healthWords(account({ health: "needs-reauth" })), "Facebook stopped taking posts from Studio. Reconnect it, signing in to the Facebook account you used the first time.");
  assert.equal(sayShortDay("2027-01-02T15:00:00Z", { now, timeZone: tz }), "Jan 2, 2027");
  assert.equal(sayClock("2026-11-13T20:05:00Z", { timeZone: tz }), "3:05 PM");
  assert.equal(sayClock("2026-11-13"), "");
});
