// Received Webmentions, the hosted half (epic #387, story #402, ADRs 0863 and 0864). Pure: settings
// from the environment, the request checks of W3C Webmention 3.2.1 and the shape of the answers.
// The receiver never fetches a source: a stranger names that address, so fetching it here would
// let anyone make this function request any address. `openblog mentions pull` fetches it later,
// through the command-line tool's public-only fetcher, and decides everything else.
//
// The checks mirror openblog_core::webmention_inbox::check_request, which the pull applies again.

import { MIN_SERVER_KEY_CHARS } from "./social-scope.mjs";

export const MAX_URL_BYTES = 2048;
export const MAX_FORM_BYTES = 8192;
// Waiting requests one source host, and the whole site, may have before new ones are refused.
export const HOST_LIMIT = 20;
export const SITE_LIMIT = 1000;
export const MAX_TAKE = 100;

const text = (value) => (typeof value === "string" ? value : value == null ? "" : String(value));

const httpsOrigin = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
};

// Host names, comma separated, whose requests are refused before anything is stored.
export function parseHosts(value) {
  return text(value)
    .split(",")
    .map((host) => host.trim().replace(/\.$/, "").toLowerCase())
    .filter((host) => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host));
}

export const hostMatches = (host, blocked) => {
  const name = text(host).replace(/\.$/, "").toLowerCase();
  return Boolean(blocked) && (name === blocked || name.endsWith(`.${blocked}`));
};

// The deployment's settings. Off unless OPENBLOG_WEBMENTION_ENABLED is exactly "true"; when it is
// on but incomplete, still off, with the names (never the values) of what is wrong.
export function webmentionSettings(env = {}) {
  if (text(env.OPENBLOG_WEBMENTION_ENABLED).trim() !== "true") return { enabled: false, problems: [] };
  const url = text(env.SUPABASE_URL).replace(/\/$/, "");
  const key = text(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  const siteId = text(env.OPENBLOG_SITE_ID).trim();
  const origin = text(env.OPENBLOG_SITE_ORIGIN).replace(/\/$/, "");
  const adminKey = text(env.OPENBLOG_WEBMENTION_ADMIN_KEY);
  const problems = [];
  if (!httpsOrigin(`${url}/`)) problems.push("SUPABASE_URL");
  if (!key) problems.push("SUPABASE_SECRET_KEY");
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(siteId)) problems.push("OPENBLOG_SITE_ID");
  if (!httpsOrigin(`${origin}/`)) problems.push("OPENBLOG_SITE_ORIGIN");
  // Its own secret: never the moderation token, the social keys or a Supabase key, so holding one
  // of those never lets anyone read what other sites sent.
  const others = [key, env.OPENBLOG_ADMIN_API_KEY, env.OPENBLOG_SOCIAL_ADMIN_KEY, env.OPENBLOG_SOCIAL_WORKER_KEY, env.SUPABASE_ANON_KEY, env.SUPABASE_PUBLISHABLE_KEY].map(text).filter(Boolean);
  if (adminKey.length < MIN_SERVER_KEY_CHARS || /\s/.test(adminKey) || others.includes(adminKey)) problems.push("OPENBLOG_WEBMENTION_ADMIN_KEY");
  if (problems.length) return { enabled: false, problems };
  return { enabled: true, problems: [], url, key, siteId, origin, adminKey, blockedHosts: parseHosts(env.OPENBLOG_WEBMENTION_BLOCKED_HOSTS) };
}

const webUrl = (value) => {
  const raw = text(value).trim();
  if (Buffer.byteLength(raw) > MAX_URL_BYTES) return { problem: "too-long" };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { problem: "not-web" };
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return { problem: "not-web" };
  if (url.username || url.password) return { problem: "credentials" };
  return { url };
};

// W3C Webmention 3.2.1: both are web addresses, they differ, the target is on this site and the
// source is not. Returns { source, target, sourceHost } (the target without its fragment) or
// { problem } with a fixed code.
export function checkRequest(source, target, origin) {
  const from = webUrl(source);
  if (from.problem) return from;
  const to = webUrl(target);
  if (to.problem) return to;
  to.url.hash = "";
  const bare = new URL(from.url.href);
  bare.hash = "";
  if (bare.href === to.url.href) return { problem: "same-address" };
  const site = new URL(origin);
  if (to.url.origin !== site.origin) return { problem: "other-site" };
  const sourceHost = from.url.hostname.replace(/\.$/, "").toLowerCase();
  if (sourceHost === site.hostname.toLowerCase()) return { problem: "own-site" };
  return { source: from.url.href, target: to.url.href, sourceHost };
}

// The form body of a Webmention request: exactly one `source` and one `target`.
export function readForm(raw) {
  if (Buffer.byteLength(raw) > MAX_FORM_BYTES) return { problem: "too-large" };
  const form = new URLSearchParams(raw);
  const sources = form.getAll("source");
  const targets = form.getAll("target");
  if (sources.length !== 1 || targets.length !== 1) return { problem: "missing-parameters" };
  return { source: sources[0], target: targets[0] };
}

// The published list of posts that accept mentions (openblog-webmention.json), or null when it
// cannot be read. Only absolute addresses on the site's own origin count.
export function acceptedTargets(value, origin) {
  if (!value || typeof value !== "object" || value.version !== 1 || !Array.isArray(value.targets)) return null;
  const site = new URL(origin).origin;
  const targets = new Set();
  for (const entry of value.targets.slice(0, 50_000)) {
    try {
      const url = new URL(text(entry));
      if (url.origin === site) targets.add(url.href);
    } catch {
      // A malformed entry accepts nothing.
    }
  }
  return targets;
}

// Fixed messages for a sender. Never a stored value, never what the database said.
export const PROBLEM_MESSAGES = {
  "too-large": "The request is too large.",
  "missing-parameters": "Send exactly one source and one target, form-encoded.",
  "not-web": "source and target must be http or https URLs.",
  "too-long": "source and target must be at most 2048 bytes.",
  credentials: "source and target must not carry a user name or password.",
  "same-address": "source and target must differ.",
  "other-site": "target is not on this site.",
  "own-site": "source is on this site.",
  "not-accepted": "target is not a post that accepts Webmentions.",
};
