// Sharing in her words: where a post went out and what's going out next, grouped by what she needs
// to do; the badge for each; the shortest caption limit across the accounts she chose; and account
// health. DOM-free, tested. Studio slice 10c; docs/specs/studio/slice-10bc/ux.md.

const LIMITS = { linkedin: 3000, facebook: 3000, bluesky: 300, mastodon: 475 };
const PROVIDERS = { linkedin: "LinkedIn", facebook: "Facebook", bluesky: "Bluesky", mastodon: "Mastodon" };
const KINDS = { member: "profile", page: "Page", account: "account", organization: "page" };

export const providerName = (provider) => PROVIDERS[provider] || String(provider || "");

/** "Facebook, Ridgeline Roofing". */
export const accountLabel = (d) => (d ? `${providerName(d.provider)}, ${d.displayName}` : "An account");

/** The delivery state, the server's or worked out the old Admin's way. */
export function deliveryOf(item) {
  const known = ["pending", "processing", "retrying", "published", "failed", "unknown", "canceled"];
  if (known.includes(item?.delivery)) return item.delivery;
  if (item?.status === "scheduled") return !item.lastErrorCode || item.lastErrorCode === "deferred" ? "pending" : "retrying";
  if (item?.status === "claimed") return "processing";
  return known.includes(item?.status) ? item.status : "unknown";
}

/** The badge, in words. */
export const BADGES = {
  pending: "Scheduled",
  processing: "Sending",
  retrying: "Trying again",
  published: "Shared",
  failed: "Didn't go out",
  unknown: "Check this",
  canceled: "Not shared",
};

/** Needs you, Going out, Shared; cancelled ones aren't listed. */
export function groups(items) {
  const by = (states) => items.filter((i) => states.includes(deliveryOf(i)));
  const time = (a, b) => String(a.scheduledFor || "").localeCompare(String(b.scheduledFor || ""));
  return [
    { id: "needs", heading: "Needs you", items: by(["failed", "unknown"]).sort(time) },
    { id: "going", heading: "Going out", items: by(["pending", "processing", "retrying"]).sort(time) },
    { id: "shared", heading: "Shared", items: by(["published"]).sort(time).reverse() },
  ].filter((g) => g.items.length);
}

/** The caption's count against the shortest limit of the chosen accounts. */
export function captionWords(caption, providers) {
  const count = Array.from(String(caption || "").replace(/\r\n?/g, "\n").trim()).length;
  const chosen = [...new Set(providers)].filter(Boolean);
  if (!chosen.length) return { count, over: false, text: `${count} characters` };
  const limit = Math.min(...chosen.map((p) => LIMITS[p] || 3000));
  const shortest = chosen.find((p) => (LIMITS[p] || 3000) === limit);
  const which = chosen.length > 1 ? ` (${providerName(shortest)} is the shortest)` : "";
  const over = count > limit;
  return { count, limit, over, text: over ? `${count - limit} characters too many for ${providerName(shortest)}` : `${count} of ${limit}${which}` };
}

/** What a card says about an account's health, or "". */
export function healthWords(account) {
  const name = providerName(account.provider);
  if (account.health === "expiring") return `${name} stops working soon. Reconnect it, signing in as the same account.`;
  if (account.health === "needs-reauth") return `${name} stopped working. Reconnect it, signing in as the same account.`;
  if (account.health === "disconnected") return "Disconnected.";
  return "";
}

export const HEALTH_BADGES = { ok: "Connected", expiring: "Expiring soon", "needs-reauth": "Needs reconnecting", disconnected: "Disconnected" };

/** The list's problem line for a failed or unclear share. */
const PROBLEMS = {
  "rate-limited": "The site asked us to slow down.",
  "provider-unavailable": "It couldn't take it just then.",
  "provider-rejected": "It refused the post.",
  "provider-auth": "It refused the saved sign-in. Reconnect the account.",
  "needs-reauth": "The account needs reconnecting.",
  "account-not-connected": "That account isn't connected any more.",
  "attempts-exhausted": "It was tried as many times as allowed.",
  timeout: "It didn't answer, so it may or may not have been shared.",
  "not-delivered": "It said the post didn't go out.",
  "needs-review": "Studio couldn't tell whether it went out. Look at the account.",
  "account-disconnected": "Its account was disconnected.",
};
export const problemLine = (code) => PROBLEMS[code] || (code ? "Something went wrong." : "");

/** Whether a failed share needs the account reconnected rather than trying again. */
export const needsReconnect = (code) => code === "provider-auth" || code === "needs-reauth" || code === "account-not-connected";

/** "On its way. Facebook and Bluesky get it in about 5 minutes." */
export function sentWords(names, when) {
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `On its way. ${list} ${names.length === 1 ? "gets" : "get"} it ${when}.`;
}

/** A failure in her words; server text (which may name settings) goes in details. */
export function shareTrouble(error) {
  const status = error?.status ?? 0;
  const code = error?.data?.code;
  if (!status) return "Studio couldn't reach your site's server. Check your connection, then try again.";
  if (code === "hosted-key-rejected" || code === "hosted-unavailable" || status === 404) return "Sharing isn't working right now. Tell the person who set up your site.";
  if (status === 502 || status === 503 || status === 504) return "Studio couldn't reach your sharing service. Try again in a minute.";
  return "That didn't go through. Try again.";
}
