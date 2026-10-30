// Provider publishing adapters of optional social publishing (epic #353, story #358, ADRs 0319 to
// 0321; Bluesky: epic #382, story #391, ADR 0761): the LinkedIn Posts API, the Facebook Pages feed
// and a Bluesky post record, each implementing the adapter
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
//   - neither provider honours an idempotency key on these calls, so the worker's `idempotencyKey`
//     is not sent; only an answer that means "definitely not processed" is ever retried (ADR 0319).
// A provider's reply is parsed for a few fields and never copied, so a token, a message or an
// injected string cannot reach a log, an attempt row or an Admin screen. The access token travels
// only in the Authorization header. Nothing here logs.

import { checkCaption, ScheduleError } from "./social-schedule.mjs";
import { DeliveryError, kindOfStatus, parseRetryAfter } from "./social-delivery.mjs";
import { DID, POST_COLLECTION, announcementKey, cardTitle, facetsFor, withinPostLimits, xrpcError } from "./social-atproto.mjs";

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

// ---- Bluesky (story #391, ADR 0761)
//
// One `com.atproto.repo.createRecord` of an `app.bsky.feed.post` in the author's own repository:
// the caption as the text, its links and hashtags as facets (UTF-8 byte offsets), and the canonical
// post as an `app.bsky.embed.external` link card. The record key is derived from the announcement
// (social-atproto.mjs), so every attempt of one announcement names the same record: a retry after
// an attempt that did land is refused by the repository instead of posting twice, and reconcile can
// ask for exactly that record. The post's `at://` URI is the provider post id.

const BLUESKY_AUTH = new Set(["ExpiredToken", "InvalidToken", "AuthenticationRequired", "AuthMissing"]);
const BLUESKY_THROTTLE = new Set(["RateLimitExceeded"]);

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
  return Object.freeze({
    provider: "bluesky",
    async publish({ post, account, accessToken, signal } = {}) {
      const { repo, caption, url, rkey, uri } = await plan({ post, account, accessToken });
      const record = { $type: POST_COLLECTION, text: caption, createdAt: new Date(now()).toISOString() };
      const facets = facetsFor(caption);
      if (facets.length) record.facets = facets;
      record.embed = { $type: "app.bsky.embed.external", external: { uri: url, title: cardTitle(caption), description: "" } };
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
      throw blueskyError(status, body, response, now);
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
}

export const ADAPTER_FACTORIES = Object.freeze({ linkedin: linkedinAdapter, facebook: facebookAdapter, bluesky: blueskyAdapter });
