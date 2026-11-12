// Visit attribution for the hosted engagement function (epic DIST9, #615; ADR 0407).
//
// The block between the markers is generated from openblog_core::outcome::attribution_js, the same
// rules the built-in counter and the Cloudflare Worker use, and a test fails if it drifts. Only a
// destination from the fixed vocabulary is ever returned, so a visitor cannot write a key of their own.
import { serviceOrigin } from "./social-providers.mjs";

// BEGIN openblog attribution: generated from openblog_core::outcome::attribution_js. Do not edit by hand.
// The destinations a visit may be attributed to (ADRs 0404 and 0407). Nothing else is ever stored.
const ATTRIBUTION_DESTINATIONS = Object.freeze(["dev", "hashnode", "ghost", "wordpress", "medium", "linkedin", "facebook", "bluesky", "mastodon", "pinterest", "youtube", "hacker-news", "reddit", "product-hunt", "google-business-profile", "nextdoor"]);
// Referring hosts that stand for a destination, longest first. A host matches itself and its subdomains.
const ATTRIBUTION_REFERRERS = Object.freeze([
  ["news.ycombinator.com", "hacker-news"],
  ["business.google.com", "google-business-profile"],
  ["producthunt.com", "product-hunt"],
  ["pinterest.com", "pinterest"],
  ["hashnode.com", "hashnode"],
  ["hashnode.dev", "hashnode"],
  ["linkedin.com", "linkedin"],
  ["facebook.com", "facebook"],
  ["nextdoor.com", "nextdoor"],
  ["youtube.com", "youtube"],
  ["medium.com", "medium"],
  ["reddit.com", "reddit"],
  ["bsky.app", "bluesky"],
  ["youtu.be", "youtube"],
  ["lnkd.in", "linkedin"],
  ["redd.it", "reddit"],
  ["dev.to", "dev"],
  ["fb.com", "facebook"],
  ["pin.it", "pinterest"],
  ["g.page", "google-business-profile"],
  ["fb.me", "facebook"],
]);
const ATTRIBUTION_MAX_OWN_HOSTS = 32;
const attributionLower = (value) => String(value ?? "").trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
const attributionMatches = (host, known) => host === known || host.endsWith(`.${known}`);
// The destination a `utm_source` value names, or null.
function attributionForUtm(value) {
  const name = attributionLower(value);
  return ATTRIBUTION_DESTINATIONS.includes(name) ? name : null;
}
// The destination a referring host stands for, or null: the author's own hosts first, then the fixed table.
function attributionForHost(value, ownHosts = []) {
  let host = attributionLower(value).replace(/\.+$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host) return null;
  for (const [ownHost, destination] of ownHosts) {
    const known = attributionLower(ownHost);
    if (known && attributionMatches(host, known)) return ATTRIBUTION_DESTINATIONS.includes(destination) ? destination : null;
  }
  const found = ATTRIBUTION_REFERRERS.find(([known]) => attributionMatches(host, known));
  return found ? found[1] : null;
}
// A bare host name, by the same rules as the engine's clean_host, or null.
function attributionCleanHost(value) {
  let host = attributionLower(value);
  if (host.startsWith("www.")) host = host.slice(4);
  const ok = host.length > 0 && host.length <= 253 && host.includes(".") && /^[a-z0-9.-]+$/.test(host) && !/^[.-]|[.-]$/.test(host) && !host.includes("..");
  return ok ? host : null;
}
// The author's own hosts from a setting of `host=destination` pairs separated by commas; anything else is dropped.
function attributionOwnHosts(setting) {
  const out = [];
  for (const pair of String(setting ?? "").split(",")) {
    const [raw, destination, extra] = pair.split("=");
    const host = attributionCleanHost(raw);
    const name = attributionLower(destination);
    if (extra === undefined && host && ATTRIBUTION_DESTINATIONS.includes(name) && !out.some(([known]) => known === host) && out.length < ATTRIBUTION_MAX_OWN_HOSTS) out.push([host, name]);
  }
  return out;
}
// The destination a counted view came from: the page address's utm_source when campaign tags are on and it
// names a destination, otherwise the referring host when it stands for one. Nothing else is attributed.
function attributionArrival({ campaigns = false, source = null, referrerHost = null, ownHosts = [] } = {}) {
  if (campaigns === true && typeof source === "string") {
    const found = attributionForUtm(source);
    if (found) return found;
  }
  return typeof referrerHost === "string" && referrerHost ? attributionForHost(referrerHost, ownHosts) : null;
}
// END openblog attribution

// The function's attribution settings from its environment: campaign tags, the author's own hosts,
// and the social Mastodon instance, whose host is attributed to `mastodon` when it is configured.
export function attributionSettings(env = {}) {
  const ownHosts = attributionOwnHosts(env.OPENBLOG_ANALYTICS_OWN_HOSTS);
  const origin = serviceOrigin(String(env.OPENBLOG_SOCIAL_MASTODON_INSTANCE || ""));
  const instance = origin ? attributionCleanHost(new URL(origin).hostname) : null;
  if (instance && !ownHosts.some(([host]) => host === instance) && ownHosts.length < ATTRIBUTION_MAX_OWN_HOSTS) ownHosts.push([instance, "mastodon"]);
  return {
    enabled: String(env.OPENBLOG_ARRIVALS_ENABLED || "").trim() === "true",
    campaigns: String(env.OPENBLOG_ANALYTICS_CAMPAIGNS || "").trim() === "true",
    ownHosts,
  };
}

export { ATTRIBUTION_DESTINATIONS, attributionArrival, attributionForHost, attributionForUtm, attributionOwnHosts };
