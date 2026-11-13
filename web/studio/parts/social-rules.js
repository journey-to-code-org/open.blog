// Her accounts in her words (Studio R2, "Make my posts go to my Facebook Page, and keep it
// working"): which provider address may be followed, what each permission means, why a place can't
// be picked, what came back from the provider, which attempts still wait, and the one thing to do
// next. The pure half of the old Admin's social.js, plus Studio's own. DOM-free, tested in
// tests/web/studio-social-rules.test.mjs; docs/specs/studio/r2/ux.md.
import { providerName } from "./share-words.js";
import { sayClock } from "./dates.js";

// ---- Safety ------------------------------------------------------------------------------------

/** Only these two hosts may be the target of "Continue to Facebook"; the server checks too. */
export const AUTHORIZE_HOSTS = Object.freeze(["www.linkedin.com", "www.facebook.com"]);

/** The address to continue at, or null. Mastodon's is accepted only at `/oauth/authorize` of `instance`. */
export function safeAuthorizeUrl(value, instance = null) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!url.port && AUTHORIZE_HOSTS.includes(url.hostname)) return url.toString();
    return instance && url.origin === instance && url.pathname === "/oauth/authorize" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Bluesky's app-password shape: four groups of four letters or digits. */
export const isAppPassword = (value) => /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/.test(String(value ?? "").trim());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The connection id a provider's return carries (`?connection=<id>`), or null for anything else. */
export function returnConnectionId(query) {
  const value = query?.connection;
  return typeof value === "string" && UUID.test(value) ? value : null;
}

// ---- Words -------------------------------------------------------------------------------------

export const SCOPE_WORDS = Object.freeze({
  openid: "Know it's you",
  profile: "See your name",
  w_member_social: "Post as you",
  r_organization_admin: "See the company pages you run",
  w_organization_social: "Post as your company pages",
  pages_show_list: "See the Pages you run",
  pages_manage_posts: "Make posts on your Pages",
  pages_read_engagement: "See basic details of your Pages",
  "read:accounts": "See your account's name",
  "write:statuses": "Post as you",
  "read:statuses": "Read your posts, to check whether one went out",
  "write:media": "Add your post's photo",
});

/** One permission in her words; one she wouldn't recognise is "One more permission". */
export const scopeWords = (scope) => SCOPE_WORDS[scope] || "One more permission";

/**
 * What a provider will ask for: her words for each, and for details the code and whether she may
 * say no (requested but not required).
 */
export const permissions = (provider) => (provider?.scopes || []).map((scope) => ({
  scope,
  words: scopeWords(scope),
  optional: Array.isArray(provider?.requiredScopes) && !provider.requiredScopes.includes(scope),
}));

/** How a Mastodon post is shown to people, in her words. */
export const VISIBILITY_WORDS = Object.freeze({
  public: "Anyone can see your posts there.",
  unlisted: "Anyone with the link can see them, but they stay out of public timelines.",
  private: "Only your followers see them.",
});

/** The Bluesky sheet's help, under the app-password field. */
export const appPasswordHelp = "Bluesky lets you make a separate password just for your blog, so your own password stays private. In Bluesky: Settings, then Privacy and security, then App passwords. Paste that one here.";

const host = (origin) => {
  try { return new URL(origin).host; } catch { return ""; }
};

/** The line under a provider's card in "Add an account". */
export function providerLine(provider, { connected = false } = {}) {
  switch (provider?.provider) {
    case "facebook": return connected ? "Add another Facebook Page you run." : "Post to a Facebook Page you run.";
    case "bluesky": return "Post as your Bluesky account.";
    case "linkedin": return provider.organizations ? "Post as yourself, or as a company page you run." : "Post as yourself on LinkedIn.";
    case "mastodon": return `Post as your account on ${host(provider.instance) || "your Mastodon server"}.`;
    default: return "";
  }
}

/** Step 1 of the Connect sheet: what happens, in order. */
export function stepOneWords(provider) {
  const name = providerName(provider?.provider);
  if (provider?.provider === "mastodon") {
    const where = host(provider.instance) || "your Mastodon server";
    return [
      `Studio sends you to ${where}. Sign in there and say yes; you come back here to finish.`,
      VISIBILITY_WORDS[provider.visibility] || "",
      provider.media === "cover" ? "Your post's photo goes with it." : "",
    ].filter(Boolean);
  }
  const pick = provider?.provider === "facebook" ? "pick your Facebook Page"
    : provider?.provider === "linkedin" ? (provider.organizations ? "pick where posts go: your profile, or a company page you run" : "pick where posts go")
      : "finish";
  return [`Studio sends you to ${name}. Sign in there and say yes; ${name} sends you back here to ${pick}.`];
}

/** An account's provider and kind: "Facebook Page", "LinkedIn company page". */
export function accountKind(account) {
  const name = providerName(account?.provider);
  if (account?.provider === "facebook") return "Facebook Page";
  if (account?.provider === "linkedin") return account.kind === "organization" ? "LinkedIn company page" : "LinkedIn profile";
  return name;
}

/** A place she can pick in step 2. */
export function destinationLabel(destination) {
  const name = String(destination?.name || "");
  switch (destination?.kind) {
    case "page": return `${name}, Facebook Page`;
    case "member": return `Your profile, ${name}`;
    case "organization": return `${name}, company page`;
    default: return name;
  }
}

const REASONS = Object.freeze({
  "missing-scope": "Facebook didn't allow posting here. Connect again and leave every box ticked.",
  "not-administrator": "LinkedIn doesn't let your account post on this page.",
  "no-posting-role": "Facebook doesn't let your account post on this Page.",
  "role-unverified": "Facebook didn't say what you can do on this Page, so Studio can't use it.",
  "no-page-token": "Facebook didn't give access to this Page. Connect again and choose it on Facebook.",
  "account-inactive": "Bluesky says this account isn't active.",
  "account-suspended": "Mastodon says this account is suspended.",
});

/** Why a place can't be picked. `missing-scope` names the provider it came from. */
export function reasonWords(reason, provider = "facebook") {
  if (reason === "missing-scope" && provider !== "facebook") return `${providerName(provider) || "It"} didn't allow posting here. Connect again and leave every box ticked.`;
  return REASONS[reason] || "Studio can't post here.";
}

const FIRST_NOTES = Object.freeze({
  "pages-truncated": "Facebook sent only some of your Pages. If yours isn't here, tell the person who set up your site.",
  "organizations-truncated": "LinkedIn sent only some of your company pages. If yours isn't here, tell the person who set up your site.",
  "media-not-granted": "Your post's photo won't be added on Mastodon; it shows its own preview.",
  "instance-limit-low": "This Mastodon server takes short posts only, so keep what you say short.",
});

/** A note from the provider: her words when it's hers to know (`first`), else the server's text for details. */
export function noteWords(note) {
  const code = note?.code;
  if (FIRST_NOTES[code]) return { text: FIRST_NOTES[code], first: true };
  return { text: String(note?.text || code || ""), first: false };
}

/** What came back from the provider, in her words. `name` is the account being reconnected. */
export function outcomeWords(code, provider, { reconnecting = false, name = "" } = {}) {
  const p = providerName(provider) || "It";
  switch (code) {
    case "denied": return `You said no on ${p}, so nothing was connected.`;
    case "scopes-missing": return `${p} didn't allow everything Studio needs to post. Try again and leave every box ticked.`;
    case "no-destination":
      if (provider === "facebook") return "Facebook didn't show any Page you can post to. You need to run the Page. If you do, ask the person who set up your site to add you to its Facebook app.";
      if (provider === "linkedin") return "LinkedIn didn't show anywhere you can post.";
      return `${p} says this account can't post.`;
    case "expired": return "That took too long, so it stopped. Try again.";
    case "invalid-state": return "That sign-in link was already used. Try again.";
    case "code-rejected":
    case "provider-error":
    case "invalid-request": return `${p} didn't finish connecting. Try again.`;
    case "provider-unavailable": return `${p} couldn't be reached. Try again in a few minutes.`;
    case "provider-rate-limited": return `${p} asked Studio to slow down. Wait a few minutes, then try again.`;
    case "identity-mismatch": return mismatchWords(provider, { reconnecting, name });
    case "storage-failed": return "Your site couldn't save the connection. Try again.";
    default: return "That didn't connect. Try again.";
  }
}

/** A sign-in as someone else during a reconnect: nothing changed. */
export function mismatchWords(provider, { name = "" } = {}) {
  if (provider === "bluesky") return `That's a different Bluesky account. Use an app password from ${name || "the account you connected"}.`;
  const p = providerName(provider) || "It";
  return `That was a different ${p} account, so nothing changed. Sign in as the person who runs ${name || "it"}, then try again.`;
}

/** A refused action (G18 codes), in her words; never the server's text. */
export function actionTrouble(error, provider = "") {
  const status = error?.status ?? 0;
  const code = error?.data?.code;
  const p = providerName(provider) || "That place";
  if (!status) return "Studio couldn't reach your sharing service. Try again in a minute.";
  if (code === "too-many-attempts") return "Too many connections are unfinished. Stop one above, or wait 10 minutes.";
  if (code === "provider-not-configured") return `${p} isn't set up on your site any more. Tell the person who set up your site.`;
  if (code === "hosted-key-rejected" || code === "hosted-unavailable" || code === "not-set-up" || status === 404) return "Sharing isn't working right now. Tell the person who set up your site.";
  if (code === "provider-unavailable") return `${p} couldn't be reached. Try again in a few minutes.`;
  if (code === "provider-rate-limited" || status === 429) return `${p} asked Studio to slow down. Wait a few minutes, then try again.`;
  if (status === 502 || status === 503 || status === 504) return "Studio couldn't reach your sharing service. Try again in a minute.";
  return "That didn't go through. Try again.";
}

/** The Bluesky sheet's field errors, by where they belong. Null when it isn't a field's. */
export function blueskyFieldError(error) {
  const code = error?.data?.code;
  if (code === "invalid-identifier") return { field: "name", text: BLUESKY.name };
  if (code === "invalid-app-password") return { field: "password", text: BLUESKY.shape };
  if (code === "credentials-rejected") return { field: "password", text: BLUESKY.rejected };
  if (code === "no-destination") return { field: "", text: "Bluesky says this account can't post. Check it in Bluesky." };
  return null;
}

export const BLUESKY = Object.freeze({
  name: "Type your Bluesky name, like grammi.bsky.social.",
  empty: "Paste the app password you made in Bluesky.",
  shape: "That isn't an app password. One looks like abcd-efgh-ijkl-mnop. Never use your real password. Paste an app password.",
  rejected: "Bluesky didn't accept that name and app password. Check the name, then paste the app password again, or make a new one.",
});

/** The device check before anything is sent: the first problem, or null. */
export function blueskyCheck(name, password) {
  if (!String(name ?? "").trim()) return { field: "name", text: BLUESKY.name };
  if (!String(password ?? "").trim()) return { field: "password", text: BLUESKY.empty };
  if (!isAppPassword(password)) return { field: "password", text: BLUESKY.shape };
  return null;
}

/** "You have until 3:35 PM to finish." */
export const untilWords = (iso, { timeZone } = {}) => {
  const at = sayClock(iso, { timeZone });
  return at ? `You have until ${at} to finish.` : "";
};

// ---- Screen state ------------------------------------------------------------------------------

const LIVE = ["pending", "exchanging", "authorized"];
const ms = (iso) => Date.parse(iso || "") || 0;

/** Attempts still going: live status, not run out, the newest per provider (and per account being reconnected). */
export function liveAttempts(connections, now = Date.now()) {
  const at = now instanceof Date ? now.getTime() : now;
  const seen = new Set();
  return (Array.isArray(connections) ? connections : [])
    .filter((c) => LIVE.includes(c?.status) && ms(c.expiresAt) > at)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .filter((c) => {
      const key = c.reauthAccountId ? `re:${c.reauthAccountId}` : `new:${c.provider}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * What an attempt's card says and offers: { heading, words, buttons } where buttons are
 * "continue" (the provider link held in this page), "again" (start again), "choose" and "stop".
 */
export function attemptCard(connection, { hasLink = false, timeZone } = {}) {
  const p = providerName(connection?.provider);
  const until = untilWords(connection?.expiresAt, { timeZone });
  if (connection?.status === "exchanging") {
    return { heading: `${p} said yes`, words: "Studio is finishing up. This takes a few seconds.", buttons: [] };
  }
  if (connection?.status === "authorized") {
    const what = connection.provider === "facebook" ? "choose your Facebook Page" : connection.provider === "linkedin" ? "choose where posts go" : "choose your account";
    return { heading: `Almost done: ${what}`, words: [`${p} said yes.`, until].filter(Boolean).join(" "), buttons: ["choose", "stop"] };
  }
  if (hasLink) return { heading: `Waiting for ${p}`, words: [`Finish on ${p}: sign in and say yes.`, until].filter(Boolean).join(" "), buttons: ["continue", "stop"] };
  return { heading: `You didn't finish connecting ${p}`, words: until || "Start again to finish connecting.", buttons: ["again", "stop"] };
}

/** Facebook first when offered, then Bluesky, LinkedIn, Mastodon; anything else after. */
export function providerOrder(providers) {
  const rank = { facebook: 0, bluesky: 1, linkedin: 2, mastodon: 3 };
  return [...(Array.isArray(providers) ? providers : [])].sort((a, b) => (rank[a?.provider] ?? 9) - (rank[b?.provider] ?? 9));
}

const needsHer = (a) => a?.health === "needs-reauth" || a?.health === "expiring";

/** The one thing to do next on Your accounts. */
export function primaryAction({ connections = [], accounts = [], providers = [], now = Date.now() } = {}) {
  const choosing = liveAttempts(connections, now).find((c) => c.status === "authorized" && !c.reauthAccountId);
  if (choosing) return { kind: "choose", connection: choosing };
  const live = accounts.filter((a) => a?.status !== "disconnected");
  const reconnect = live.find(needsHer);
  if (reconnect) return { kind: "reconnect", account: reconnect };
  if (!live.length) {
    const first = providerOrder(providers)[0];
    return first ? { kind: "connect", provider: first } : { kind: "none" };
  }
  return { kind: "share" };
}

const WAITING = ["pending", "retrying", "processing"];
const FAILED_FOR_ACCOUNT = ["provider-auth", "needs-reauth", "account-not-connected"];

const delivery = (item) => {
  if (item?.delivery) return item.delivery;
  if (item?.status === "scheduled") return !item.lastErrorCode || item.lastErrorCode === "deferred" ? "pending" : "retrying";
  if (item?.status === "claimed") return "processing";
  return item?.status;
};

/** How many of this account's shares are still to go out. */
export const waitingFor = (items, accountId) => (Array.isArray(items) ? items : []).filter((i) => i?.accountId === accountId && WAITING.includes(delivery(i))).length;

/** This account's shares that failed because it needed reconnecting: the ones "Try them again" retries. */
export const toRetry = (items, accountId) => (Array.isArray(items) ? items : []).filter((i) => i?.accountId === accountId && delivery(i) === "failed" && FAILED_FOR_ACCOUNT.includes(i.lastErrorCode));

/** "2 posts will be tried again within a minute." with the partial case. */
export function retriedWords(done, failed) {
  const posts = (n) => (n === 1 ? "1 post" : `${n} posts`);
  if (!failed) return `${posts(done)} will be tried again within a minute.`;
  if (!done) return `${posts(failed)} couldn't be tried again, because ${failed === 1 ? "it" : "they"} changed. Look at ${failed === 1 ? "it" : "them"} in Sharing.`;
  return `${posts(done)} will be tried again. ${failed} couldn't be, because ${failed === 1 ? "it" : "they"} changed. Look at ${failed === 1 ? "it" : "them"} in Sharing.`;
}

/** The Disconnect question's words. */
export function disconnectWords(waiting) {
  if (waiting > 0) return `${waiting === 1 ? "1 post waiting to go there won't" : `${waiting} posts waiting to go there won't`} be shared. Studio forgets how to post to it; you can connect it again later.`;
  return "Studio forgets how to post to it. You can connect it again later.";
}

/** "Disconnected Grammi's House." plus how many waiting posts won't be shared. */
export function disconnectedWords(name, canceled) {
  const n = Number.isSafeInteger(canceled) && canceled > 0 ? canceled : 0;
  return `Disconnected ${name}.${n ? ` ${n === 1 ? "1 waiting post won't" : `${n} waiting posts won't`} be shared.` : ""}`;
}

/** The status after a connect. */
export function connectedWords(account) {
  const extra = account?.provider === "facebook" ? " To add another Facebook Page, connect Facebook again." : "";
  return `Connected. Studio can post to ${account?.displayName || "it"} on ${providerName(account?.provider)} now.${extra}`;
}

/**
 * Where "connect an account" goes from Sharing: named for the one provider when only one is set up
 * ("Connect Facebook", straight to its sheet), else Your accounts.
 */
export function connectTarget(providers) {
  const list = Array.isArray(providers) ? providers : [];
  if (list.length === 1 && list[0]?.provider) {
    return { label: `Connect ${providerName(list[0].provider) || list[0].label}`, href: `#/sharing/accounts?connect=${encodeURIComponent(list[0].provider)}` };
  }
  return { label: "Connect an account", href: "#/sharing/accounts" };
}

/** Where a Reconnect from Sharing goes: Your accounts with that account's sheet open. */
export const reconnectHref = (accountId) => (UUID.test(String(accountId || "")) ? `#/sharing/accounts?reconnect=${accountId}` : "#/sharing/accounts");
