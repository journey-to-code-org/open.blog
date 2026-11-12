// Provider publishing adapters of optional social publishing (epic #353, story #358, ADRs 0319 to
// 0321; Bluesky: epic #382, story #391, ADR 0358; Mastodon: story #392, ADR 0360): the
// LinkedIn Posts API, the Facebook Pages feed, a Bluesky post record and a Mastodon status, each
// implementing the adapter
// interface the delivery worker calls (documented at the top of social-delivery.mjs, ADRs 0316 to
// 0318). social-adapters.mjs registers an adapter only for a provider this deployment configured.
// Server-only. Every provider call goes through an injected `fetchImpl` with the worker's abort
// signal; tests use fakes and recorded-shape fixtures and never reach a network.
//
// What an adapter says, conservatively:
//   - `publish` resolves to `{ providerPostId }` only for a success the provider confirmed AND named
//     with a well-formed id of its own shape. A 2xx without one is "uncertain", never a success.
//   - everything else throws a DeliveryError: "auth" (401, an expired Graph token), "rejected" (a
//     refusal the provider made before acting, or a post this adapter cannot send at all),
//     "rate-limited" (429 or a Graph throttle code, with the provider's Retry-After), "transient"
//     (the request certainly never left: the signal was already aborted, the host did not resolve,
//     the connection was refused) and "uncertain" (anything that may have been processed without
//     us seeing the answer: a timeout, a dropped connection, a 5xx, an unreadable answer).
//   - LinkedIn and Facebook honour no idempotency key on these calls, so the worker's `idempotencyKey`
//     is not sent; only an answer that means "definitely not processed" is ever retried (ADR 0319).
//     Bluesky names its record from the announcement and Mastodon takes an Idempotency-Key derived
//     from it, which only narrows the harm of a retry; the rule above holds for them too.
// A provider's reply is parsed for a few fields and never copied, so a token, a message or an
// injected string cannot reach a log, an attempt row or an Admin screen. The access token travels
// only in the Authorization header. Nothing here logs.

import { checkCaption, ScheduleError } from "./social-schedule.mjs";
import { DeliveryError, kindOfStatus, parseRetryAfter } from "./social-delivery.mjs";
import { DID, POST_COLLECTION, announcementKey, cardTitle, facetsFor, withinPostLimits, xrpcError } from "./social-atproto.mjs";
import { ACCOUNT_ID, COVER_TYPES, DEFAULT_LIMITS, MAX_COVER_BYTES, STATUS_ID, coverOf, idempotencyHeader, instanceLimits, metaTags, rateLimitWaitMs, statusLength, statusText } from "./social-mastodon.mjs";

// Only used when a caller gives no signal; the worker always gives its own provider timeout.
export const PUBLISH_TIMEOUT_MS = 15_000;
const MAX_REPLY_CHARS = 64 * 1024;

const TOKEN = /^[\x21-\x7e]{8,4096}$/;
const LINKEDIN_AUTHOR = /^urn:li:(person:[A-Za-z0-9_-]{1,64}|organization:\d{1,20})$/;
const LINKEDIN_POST_ID = /^urn:li:(share|ugcPost):\d{1,30}$/;
const FACEBOOK_PAGE = /^\d{1,30}$/;
const FACEBOOK_POST_ID = /^\d{1,30}_\d{1,30}$/;

// Connection errors that happen before a byte of the request is sent.
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

// LinkedIn reads `commentary` as "little text": these characters are markup and must be escaped
// so a caption such as "(beta) | v2 *new*" is posted as typed and mentions cannot be injected.
const LINKEDIN_RESERVED = /[\\|{}@[\]()<>#*_~]/g;
export const escapeLinkedInCommentary = (text) => text.replace(LINKEDIN_RESERVED, "\\$&");

// The article title LinkedIn requires: the caption's first line as plain text, bounded.
export const linkedInTitle = (caption) =>
  String(caption ?? "")
    .split("\n")[0]
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "Read the full post";

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && value.length <= 2000 && /^[\x21-\x7e]+$/.test(value) ? url.href : null;
  } catch {
    return null;
  }
}

// Reads at most a bounded body and returns parsed JSON, or null for an empty or unreadable one.
async function readJson(response) {
  try {
    const raw = await response.text();
    if (raw.length > MAX_REPLY_CHARS) return null;
    const body = raw ? JSON.parse(raw) : null;
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

const header = (response, name) => {
  try {
    return response.headers?.get?.(name) || "";
  } catch {
    return "";
  }
};

// The checks every post must pass before any request; failing one is a final refusal with no call.
function prepare(provider, { post, accessToken }) {
  if (typeof accessToken !== "string" || !TOKEN.test(accessToken)) throw new DeliveryError("auth");
  let caption;
  try {
    caption = checkCaption(provider, post?.caption);
  } catch (error) {
    if (error instanceof ScheduleError) throw new DeliveryError("rejected");
    throw error;
  }
  const url = httpsUrl(post?.canonicalUrl);
  if (!url) throw new DeliveryError("rejected");
  return { caption, url };
}

// One provider call. A throw from fetch is told apart: certainly not sent, or may have been.
async function send(fetchImpl, url, init, signal) {
  const bound = signal || AbortSignal.timeout(PUBLISH_TIMEOUT_MS);
  if (bound.aborted) throw new DeliveryError("transient");
  try {
    return await fetchImpl(url, { redirect: "manual", ...init, signal: bound });
  } catch (error) {
    const code = error?.cause?.code ?? error?.code;
    throw new DeliveryError(typeof code === "string" && NOT_SENT.has(code) ? "transient" : "uncertain");
  }
}

// What an HTTP status alone says, for an answer that is not a success. Any other 4xx means the
// provider read the request and refused it; anything else (3xx, 5xx, odd codes) may have posted.
function statusError(status, response, now) {
  const kind = kindOfStatus(status);
  if (kind === "rate-limited") return new DeliveryError(kind, { status, retryAfterMs: parseRetryAfter(header(response, "retry-after"), now()) });
  if (kind === "uncertain" && status >= 400 && status < 500) return new DeliveryError("rejected", { status });
  return new DeliveryError(kind, { status });
}

export function linkedinAdapter(settings, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  return Object.freeze({
    provider: "linkedin",
    async publish({ post, account, accessToken, signal } = {}) {
      const author = String(account?.externalId ?? "");
      if (!LINKEDIN_AUTHOR.test(author)) throw new DeliveryError("rejected");
      const kind = author.startsWith("urn:li:person:") ? "member" : "organization";
      if (account.kind && account.kind !== kind) throw new DeliveryError("rejected");
      const { caption, url } = prepare("linkedin", { post, accessToken });
      const body = {
        author,
        commentary: escapeLinkedInCommentary(caption),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { article: { source: url, title: linkedInTitle(caption) } },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };
      const response = await send(
        fetchImpl,
        `${settings.apiBase}/rest/posts`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
            "content-type": "application/json",
            // The versioned REST API. The dated version is a setting (docs/social-publishing.md).
            "linkedin-version": settings.version,
            "x-restli-protocol-version": "2.0.0",
          },
          body: JSON.stringify(body),
        },
        signal,
      );
      const status = Number(response?.status) || 0;
      if (status === 201 || status === 200) {
        // LinkedIn answers 201 with the new post's URN in `x-restli-id` and an empty body.
        const id = header(response, "x-restli-id") || (await readJson(response))?.id;
        if (typeof id === "string" && LINKEDIN_POST_ID.test(id)) return { providerPostId: id };
        throw new DeliveryError("uncertain", { status });
      }
      if (status >= 200 && status < 300) throw new DeliveryError("uncertain", { status });
      throw statusError(status, response, now);
    },
    // No reconcile: finding a member's or organization's posts (`GET /rest/posts?q=author`) needs
    // r_member_social or r_organization_social, which LinkedIn grants only to approved partners and
    // this deployment never requests. An unknown LinkedIn outcome goes straight to a person (ADR 0319).
  });
}

// Facebook's own error codes, which arrive with a 400 as often as with the matching HTTP status.
const FACEBOOK_AUTH = new Set([102, 190]);
// 80000-80014 are Meta's business-use-case rate limits (80001 is the Pages one, "too many calls to this Page
// account"); they arrive as a 4xx and, like the others, are a temporary throttle, not a refusal.
const FACEBOOK_THROTTLE = new Set([4, 17, 32, 341, 613]);
const isFacebookThrottle = (code) => FACEBOOK_THROTTLE.has(code) || (code >= 80000 && code <= 80014);
const FACEBOOK_MAYBE = new Set([1, 2]);

function facebookError(status, body, response, now) {
  const code = Number(body?.error?.code);
  if (FACEBOOK_AUTH.has(code)) return new DeliveryError("auth", { status });
  if (code === 10 || (code >= 200 && code <= 299)) return new DeliveryError("rejected", { status });
  if (isFacebookThrottle(code)) return new DeliveryError("rate-limited", { status, retryAfterMs: parseRetryAfter(header(response, "retry-after"), now()) });
  // "An unknown error occurred" can follow a post that was in fact created.
  if (FACEBOOK_MAYBE.has(code)) return new DeliveryError("uncertain", { status });
  return statusError(status, response, now);
}

const RECONCILE_SKEW_SECONDS = 120;
const RECONCILE_LIMIT = 25;
// An attempt with no recorded end (a crash) is looked at up to the longest lease the queue grants.
const RECONCILE_OPEN_SECONDS = 900;

// Graph writes `created_time` as "2026-11-01T12:00:05+0000"; the offset gets its colon back.
const graphTime = (value) => (typeof value === "string" ? Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN);

export function facebookAdapter(settings, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const pageOf = (account) => {
    const page = String(account?.externalId ?? "");
    if (!FACEBOOK_PAGE.test(page) || (account.kind && account.kind !== "page")) throw new DeliveryError("rejected");
    return page;
  };
  return Object.freeze({
    provider: "facebook",
    async publish({ post, account, accessToken, signal } = {}) {
      const page = pageOf(account);
      const { caption, url } = prepare("facebook", { post, accessToken });
      // The Page token goes in the header, never in the URL or body, so no access log can keep it.
      const response = await send(
        fetchImpl,
        `${settings.apiBase}/${page}/feed`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ message: caption, link: url }).toString(),
        },
        signal,
      );
      const status = Number(response?.status) || 0;
      const body = await readJson(response);
      if (status >= 200 && status < 300) {
        const id = body?.id;
        if (status === 200 && typeof id === "string" && FACEBOOK_POST_ID.test(id) && id.startsWith(`${page}_`)) return { providerPostId: id };
        throw new DeliveryError("uncertain", { status });
      }
      throw facebookError(status, body, response, now);
    },
    // A read-only look at the Page's own published posts made during the attempt, give or take two
    // minutes (needs `pages_read_engagement`, requested by default). Only a post of this Page whose
    // message is the caption AND whose attachment links the canonical URL is the announcement, and
    // only when it is the one such post: two of them, or a post that matches by one of the two alone
    // (a hand-made share of the link, a caption edited on Facebook), is "unknown", because nothing
    // makes either unique to this announcement. "absent" is conclusive only when the whole window
    // came back in one page of results holding no post of this Page at all. Any failure, a missing
    // permission included, is "unknown": the worker keeps looking, then asks a person.
    async reconcile({ post, account, accessToken, attemptedAt, finishedAt, signal } = {}) {
      try {
        const page = pageOf(account);
        const { caption, url } = prepare("facebook", { post, accessToken });
        const started = Date.parse(attemptedAt ?? "");
        if (!Number.isFinite(started)) return { state: "unknown" };
        const finished = Date.parse(finishedAt ?? "");
        const since = Math.floor(started / 1000) - RECONCILE_SKEW_SECONDS;
        const until = (Number.isFinite(finished) && finished >= started ? Math.ceil(finished / 1000) : Math.ceil(started / 1000) + RECONCILE_OPEN_SECONDS) + RECONCILE_SKEW_SECONDS;
        const query = new URLSearchParams({
          fields: "id,message,created_time,attachments{url,unshimmed_url}",
          since: String(since),
          until: String(until),
          limit: String(RECONCILE_LIMIT),
        });
        const response = await send(fetchImpl, `${settings.apiBase}/${page}/published_posts?${query}`, { method: "GET", headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } }, signal);
        if (Number(response?.status) !== 200) return { state: "unknown" };
        const body = await readJson(response);
        if (!body || !Array.isArray(body.data)) return { state: "unknown" };
        const found = [];
        let near = false;
        let other = false;
        for (const item of body.data) {
          const id = item?.id;
          if (typeof id !== "string" || !FACEBOOK_POST_ID.test(id) || !id.startsWith(`${page}_`)) continue;
          // Graph honours since/until; a post outside the window it sends anyway is not this attempt.
          const created = graphTime(item.created_time);
          if (Number.isFinite(created) && (created < since * 1000 || created > until * 1000)) continue;
          const links = Array.isArray(item.attachments?.data) ? item.attachments.data.flatMap((a) => [a?.unshimmed_url, a?.url]) : [];
          const byCaption = item.message === caption;
          const byLink = links.includes(url);
          if (byCaption && byLink) found.push(id);
          else if (byCaption || byLink) near = true;
          else other = true;
        }
        if (found.length === 1 && !near) return { state: "published", providerPostId: found[0] };
        // Any other post of this Page in the window could still be the announcement in a form that
        // no longer compares exactly (an edited caption and a rewritten link), so it rules out
        // "absent": a wrong "absent" lets a person post the announcement twice.
        if (found.length || near || other) return { state: "unknown" };
        return { state: "absent", conclusive: !body.paging?.next };
      } catch {
        return { state: "unknown" };
      }
    },
  });
}

// ---- Bluesky (story #391, ADR 0358)
//
// One `com.atproto.repo.createRecord` of an `app.bsky.feed.post` in the author's own repository:
// the caption as the text, its links and hashtags as facets (UTF-8 byte offsets), and the canonical
// post as an `app.bsky.embed.external` link card. The card shows the post's own title and
// description, read from its canonical page's og:title and og:description (ADR 0386); a page that
// cannot be read in time leaves the card titled with the caption's first line, as before. The
// record key is derived from the announcement (social-atproto.mjs), so every attempt of one
// announcement names the same record: a retry after an attempt that did land is refused by the
// repository instead of posting twice, and that refusal is checked against exactly that record, so
// it settles as published, not failed. The post's `at://` URI is the provider post id.

const BLUESKY_AUTH = new Set(["ExpiredToken", "InvalidToken", "AuthenticationRequired", "AuthMissing"]);
const BLUESKY_THROTTLE = new Set(["RateLimitExceeded"]);
// The share of a delivery the post's page may use, at most, so the record itself always has time left.
export const BLUESKY_PAGE_BUDGET_MS = 3_000;
const BLUESKY_MAX_PAGE_CHARS = 1024 * 1024;
const BLUESKY_CARD_TEXT = 300;
const CARD_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu;
const cardText = (value) => Array.from(String(value ?? "").replace(CARD_UNSAFE, " ").replace(/\s+/g, " ").trim()).slice(0, BLUESKY_CARD_TEXT).join("");

// The link card of an announcement: the title and description the post's canonical page states,
// or the caption's first line when the page cannot be had. The page is public; no token goes to it.
async function blueskyCard(fetchImpl, url, caption, signal) {
  const fallback = { uri: url, title: cardTitle(caption), description: "" };
  let page;
  try {
    page = await send(fetchImpl, url, { method: "GET", headers: { accept: "text/html" } }, AbortSignal.any([signal || AbortSignal.timeout(PUBLISH_TIMEOUT_MS), AbortSignal.timeout(BLUESKY_PAGE_BUDGET_MS)]));
  } catch {
    return fallback;
  }
  if (Number(page?.status) !== 200 || !/^text\/html\b/i.test(header(page, "content-type"))) return fallback;
  const html = await readBounded(page, BLUESKY_MAX_PAGE_CHARS);
  if (!html) return fallback;
  const tags = metaTags(html);
  const title = cardText(tags.get("og:title"));
  return title ? { uri: url, title, description: cardText(tags.get("og:description")) } : fallback;
}

// When a 429 may be tried again: Retry-After if the service sent one, else RateLimit-Reset, read as
// an epoch second or, if small, as seconds from now. Anything else is no hint.
function blueskyRetryAfter(response, nowMs) {
  const hinted = parseRetryAfter(header(response, "retry-after"), nowMs);
  if (hinted !== null) return hinted;
  const reset = String(header(response, "ratelimit-reset")).trim();
  if (!/^\d{1,12}$/.test(reset)) return null;
  const value = Number(reset);
  return value > 1e9 ? Math.max(0, value * 1000 - nowMs) : value * 1000;
}

function blueskyError(status, body, response, now) {
  const name = xrpcError(body);
  if (status === 401 || ((status === 400 || status === 403) && BLUESKY_AUTH.has(name))) return new DeliveryError("auth", { status });
  if (status === 429 || BLUESKY_THROTTLE.has(name)) return new DeliveryError("rate-limited", { status, retryAfterMs: blueskyRetryAfter(response, now()) });
  return statusError(status, response, now);
}

export function blueskyAdapter(settings, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const repoOf = (account) => {
    const did = String(account?.externalId ?? "");
    if (!DID.test(did) || (account.kind && account.kind !== "account")) throw new DeliveryError("rejected");
    return did;
  };
  // Everything the record is built from, checked before any request.
  const plan = async ({ post, account, accessToken }) => {
    const repo = repoOf(account);
    const { caption, url } = prepare("bluesky", { post, accessToken });
    if (!withinPostLimits(caption)) throw new DeliveryError("rejected");
    const rkey = await announcementKey(post ?? {});
    if (!rkey) throw new DeliveryError("rejected");
    return { repo, caption, url, rkey, uri: `at://${repo}/${POST_COLLECTION}/${rkey}` };
  };
  const headers = (accessToken, extra = {}) => ({ authorization: `Bearer ${accessToken}`, accept: "application/json", ...extra });
  const adapter = Object.freeze({
    provider: "bluesky",
    async publish({ post, account, accessToken, signal } = {}) {
      const { repo, caption, url, rkey, uri } = await plan({ post, account, accessToken });
      const record = { $type: POST_COLLECTION, text: caption, createdAt: new Date(now()).toISOString() };
      const facets = facetsFor(caption);
      if (facets.length) record.facets = facets;
      record.embed = { $type: "app.bsky.embed.external", external: await blueskyCard(fetchImpl, url, caption, signal) };
      const response = await send(
        fetchImpl,
        `${settings.apiBase}/xrpc/com.atproto.repo.createRecord`,
        { method: "POST", headers: headers(accessToken, { "content-type": "application/json" }), body: JSON.stringify({ repo, collection: POST_COLLECTION, rkey, record }) },
        signal,
      );
      const status = Number(response?.status) || 0;
      const body = await readJson(response);
      if (status === 200) {
        // The service names the record it wrote; only the one this announcement asked for counts.
        if (body?.uri === uri && typeof body.cid === "string" && body.cid) return { providerPostId: uri };
        throw new DeliveryError("uncertain", { status });
      }
      if (status >= 200 && status < 300) throw new DeliveryError("uncertain", { status });
      const error = blueskyError(status, body, response, now);
      // A repeat of an attempt that did land is refused because the record key is taken. When the
      // record under that key is exactly this announcement, it was posted, not refused.
      if (error.kind === "rejected" && status === 400) {
        const found = await adapter.reconcile({ post, account, accessToken, signal });
        if (found.state === "published") return { providerPostId: found.providerPostId };
      }
      throw error;
    },
    // Asks for exactly this announcement's record. It is "published" only when it is there and is
    // the caption with the canonical link; "absent" is conclusive because the record key is this
    // announcement's alone and the repository answers RecordNotFound for it. Anything else, a
    // record that differs included, is "unknown" and goes to a person.
    async reconcile({ post, account, accessToken, signal } = {}) {
      try {
        const { repo, caption, url, rkey, uri } = await plan({ post, account, accessToken });
        const query = new URLSearchParams({ repo, collection: POST_COLLECTION, rkey });
        const response = await send(fetchImpl, `${settings.apiBase}/xrpc/com.atproto.repo.getRecord?${query}`, { method: "GET", headers: headers(accessToken) }, signal);
        const status = Number(response?.status) || 0;
        const body = await readJson(response);
        if (status === 200) {
          const value = body?.value;
          const same = body?.uri === uri && value?.$type === POST_COLLECTION && value.text === caption && value.embed?.external?.uri === url;
          return same ? { state: "published", providerPostId: uri } : { state: "unknown" };
        }
        if (status === 400 && xrpcError(body) === "RecordNotFound") return { state: "absent", conclusive: true };
        return { state: "unknown" };
      } catch {
        return { state: "unknown" };
      }
    },
  });
  return adapter;
}

// ---- Mastodon (story #392, ADR 0360)
//
// One `POST /api/v1/statuses` from the connected account: the caption, a blank line and the
// canonical link (Mastodon makes its own preview card from it), at the visibility the deployer
// chose, with an Idempotency-Key derived from the announcement so a repeat within Mastodon's hour
// returns the same status. The instance's own limits (GET /api/v2/instance, public) are read before
// each post and a status over them is refused without a call. With OPENBLOG_SOCIAL_MASTODON_MEDIA=cover
// the post's cover image, as its canonical page names it with og:image and og:image:alt, is uploaded
// with that description (POST /api/v2/media) and attached; a cover that cannot be had is left out,
// never posted without its description. The status id is the provider post id.

const MASTODON_MAX_INSTANCE_CHARS = 256 * 1024;
const MASTODON_MAX_PAGE_CHARS = 1024 * 1024;
// The share of a delivery the cover may use, at most, so the status itself always has time left.
export const MASTODON_MEDIA_BUDGET_MS = 6_000;
const MASTODON_MEDIA_POLLS = 2;
const MASTODON_POLL_WAIT_MS = 500;
const MASTODON_RECONCILE_LIMIT = 40;
// More statuses than this in the window is not looked through one by one: a person checks.
const MASTODON_RECONCILE_CANDIDATES = 5;

async function readBounded(response, max) {
  try {
    const raw = await response.text();
    if (raw.length > max) return null;
    return raw;
  } catch {
    return null;
  }
}

function mastodonError(status, response, now) {
  if (status === 401) return new DeliveryError("auth", { status });
  if (status === 429) {
    const wait = rateLimitWaitMs(parseRetryAfter(header(response, "retry-after"), now()), header(response, "x-ratelimit-reset"), now());
    return new DeliveryError("rate-limited", { status, retryAfterMs: wait });
  }
  return statusError(status, response, now);
}

const pause = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export function mastodonAdapter(settings, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const accountOf = (account) => {
    const id = String(account?.externalId ?? "");
    if (!ACCOUNT_ID.test(id) || (account.kind && account.kind !== "account")) throw new DeliveryError("rejected");
    return id;
  };
  const auth = (accessToken, extra = {}) => ({ authorization: `Bearer ${accessToken}`, accept: "application/json", ...extra });
  const quiet = async (url, init, signal) => {
    try {
      return await send(fetchImpl, url, init, signal);
    } catch {
      return null;
    }
  };

  // The instance's limits, or Mastodon's defaults when it does not say. Read once per run.
  let limits = null;
  const limitsFor = async (signal) => {
    if (limits) return limits;
    const response = await quiet(`${settings.apiBase}/api/v2/instance`, { method: "GET", headers: { accept: "application/json" } }, signal);
    if (Number(response?.status) !== 200) return DEFAULT_LIMITS;
    let body = null;
    try {
      body = JSON.parse((await readBounded(response, MASTODON_MAX_INSTANCE_CHARS)) ?? "null");
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object") return DEFAULT_LIMITS;
    limits = instanceLimits(body);
    return limits;
  };

  // The cover's media id, or null when there is none to attach. Only a refused token is an error:
  // the status would be refused too, so the account is flagged now.
  const coverMedia = async ({ url, accessToken, found, signal }) => {
    const bound = AbortSignal.any([signal, AbortSignal.timeout(MASTODON_MEDIA_BUDGET_MS)]);
    const page = await quiet(url, { method: "GET", headers: { accept: "text/html" } }, bound);
    if (Number(page?.status) !== 200 || !/^text\/html\b/i.test(header(page, "content-type"))) return null;
    const html = await readBounded(page, MASTODON_MAX_PAGE_CHARS);
    const cover = html && coverOf(html, url, found.descriptionLimit);
    if (!cover) return null;
    const image = await quiet(cover.url, { method: "GET", headers: { accept: COVER_TYPES.join(", ") } }, bound);
    const type = header(image, "content-type").split(";")[0].trim().toLowerCase();
    const allowed = found.mimeTypes ?? COVER_TYPES;
    const max = Math.min(found.imageSizeLimit, MAX_COVER_BYTES);
    if (Number(image?.status) !== 200 || !allowed.includes(type) || Number(header(image, "content-length") || 0) > max) return null;
    let bytes;
    try {
      bytes = await image.arrayBuffer();
    } catch {
      return null;
    }
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > max) return null;
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), `cover.${type.split("/")[1]}`);
    form.append("description", cover.description);
    const uploaded = await quiet(`${settings.apiBase}/api/v2/media`, { method: "POST", headers: auth(accessToken), body: form }, bound);
    const status = Number(uploaded?.status) || 0;
    if (status === 401) throw new DeliveryError("auth", { status });
    if (status !== 200 && status !== 202) return null;
    const id = (await readJson(uploaded))?.id;
    if (typeof id !== "string" || !STATUS_ID.test(id)) return null;
    if (status === 200) return id;
    // Still processing: look again briefly; a status cannot carry media that is not ready.
    for (let poll = 0; poll < MASTODON_MEDIA_POLLS && !bound.aborted; poll += 1) {
      await pause(MASTODON_POLL_WAIT_MS, bound);
      const ready = await quiet(`${settings.apiBase}/api/v1/media/${encodeURIComponent(id)}`, { method: "GET", headers: auth(accessToken) }, bound);
      if (Number(ready?.status) === 200) return id;
      if (Number(ready?.status) !== 206) return null;
    }
    return null;
  };

  const plan = ({ post, account, accessToken }) => {
    const id = accountOf(account);
    const { caption, url } = prepare("mastodon", { post, accessToken });
    return { id, caption, url, text: statusText(caption, url) };
  };

  return Object.freeze({
    provider: "mastodon",
    async publish({ post, account, accessToken, signal } = {}) {
      const { id, url, text } = plan({ post, account, accessToken });
      const key = await idempotencyHeader(post?.idempotencyKey);
      if (!key) throw new DeliveryError("rejected");
      const bound = signal || AbortSignal.timeout(PUBLISH_TIMEOUT_MS);
      if (bound.aborted) throw new DeliveryError("transient");
      const found = await limitsFor(bound);
      if (statusLength(text, found.charactersPerUrl) > found.maxCharacters) throw new DeliveryError("rejected");
      const form = new URLSearchParams({ status: text, visibility: settings.visibility || "public" });
      if (settings.media === "cover") {
        const media = await coverMedia({ url, accessToken, found, signal: bound });
        if (media) form.append("media_ids[]", media);
      }
      const response = await send(
        fetchImpl,
        `${settings.apiBase}/api/v1/statuses`,
        { method: "POST", headers: auth(accessToken, { "content-type": "application/x-www-form-urlencoded", "idempotency-key": key }), body: form.toString() },
        bound,
      );
      const status = Number(response?.status) || 0;
      const body = await readJson(response);
      if (status === 200) {
        // Only a status of this very account counts as the announcement.
        if (typeof body?.id === "string" && STATUS_ID.test(body.id) && body.account?.id === id) return { providerPostId: body.id };
        throw new DeliveryError("uncertain", { status });
      }
      if (status >= 200 && status < 300) throw new DeliveryError("uncertain", { status });
      throw mastodonError(status, response, now);
    },
    // A read-only look at the account's own recent statuses (needs read:statuses, requested by
    // default) made during the attempt, give or take two minutes. Each one in the window is read
    // back as its source text (GET /api/v1/statuses/:id/source); exactly one whose text is the
    // status this announcement sends is "published". "absent" is conclusive only when the window
    // holds no status of the account at all and the page reaches back past it. Anything else, a
    // missing permission included, is "unknown": the worker keeps looking, then asks a person.
    async reconcile({ post, account, accessToken, attemptedAt, finishedAt, signal } = {}) {
      try {
        const { id, text } = plan({ post, account, accessToken });
        const started = Date.parse(attemptedAt ?? "");
        if (!Number.isFinite(started)) return { state: "unknown" };
        const finished = Date.parse(finishedAt ?? "");
        const since = started - RECONCILE_SKEW_SECONDS * 1000;
        const until = (Number.isFinite(finished) && finished >= started ? finished : started + RECONCILE_OPEN_SECONDS * 1000) + RECONCILE_SKEW_SECONDS * 1000;
        const query = new URLSearchParams({ limit: String(MASTODON_RECONCILE_LIMIT), exclude_reblogs: "true" });
        const response = await send(fetchImpl, `${settings.apiBase}/api/v1/accounts/${encodeURIComponent(id)}/statuses?${query}`, { method: "GET", headers: auth(accessToken) }, signal);
        if (Number(response?.status) !== 200) return { state: "unknown" };
        let list = null;
        try {
          list = JSON.parse((await readBounded(response, MASTODON_MAX_PAGE_CHARS)) ?? "null");
        } catch {
          list = null;
        }
        if (!Array.isArray(list)) return { state: "unknown" };
        const inWindow = [];
        let oldest = Infinity;
        for (const item of list) {
          const created = Date.parse(item?.created_at ?? "");
          if (typeof item?.id !== "string" || !STATUS_ID.test(item.id) || !Number.isFinite(created)) return { state: "unknown" };
          oldest = Math.min(oldest, created);
          if (created >= since && created <= until) inWindow.push(item.id);
        }
        // The page must reach back past the window, or an older status could still be in it.
        const complete = list.length < MASTODON_RECONCILE_LIMIT || oldest < since;
        if (!inWindow.length) return complete ? { state: "absent", conclusive: true } : { state: "unknown" };
        if (inWindow.length > MASTODON_RECONCILE_CANDIDATES) return { state: "unknown" };
        const same = [];
        for (const candidate of inWindow) {
          const source = await send(fetchImpl, `${settings.apiBase}/api/v1/statuses/${encodeURIComponent(candidate)}/source`, { method: "GET", headers: auth(accessToken) }, signal);
          if (Number(source?.status) !== 200) return { state: "unknown" };
          const body = await readJson(source);
          if (body?.id !== candidate || typeof body.text !== "string") return { state: "unknown" };
          if (body.text === text) same.push(candidate);
        }
        return same.length === 1 ? { state: "published", providerPostId: same[0] } : { state: "unknown" };
      } catch {
        return { state: "unknown" };
      }
    },
  });
}

export const ADAPTER_FACTORIES = Object.freeze({ linkedin: linkedinAdapter, facebook: facebookAdapter, bluesky: blueskyAdapter, mastodon: mastodonAdapter });
