// Provider publishing adapters of optional social publishing (epic #353, story #358, ADR 0490):
// one narrow interface, `publish(post, credentials)`, that the scheduled worker calls and that
// answers `{ status: "published" | "failed" | "unknown", providerPostId, retryable, code, ... }`.
// Server-only. Every provider call goes through an injected `fetchImpl`; tests use fakes and
// recorded fixtures and never reach a network.
//
// The worker, not this module, decides what a result means for the queue. This module only says
// what the provider told us, conservatively:
//   - `published` needs a 2xx AND a well-formed provider post id. A 2xx without one is `unknown`.
//   - a refusal the provider made before doing anything (400/401/403/422, a throttle) is `failed`.
//   - anything that may have been processed without us seeing the answer (network error, timeout,
//     5xx, an unreadable 2xx) is `unknown`, with `retryable: false`: the worker reconciles, it
//     does not post again blindly.
// A provider's reply text is parsed for a few fields and never copied, so a token, a message or an
// injected string cannot reach a log, an attempt row or an Admin screen. The access token travels
// only in the Authorization header.

import { checkCaption, ScheduleError, providerOf } from "./social-schedule.mjs";

export const PUBLISH_TIMEOUT_MS = 15_000;
const MAX_REPLY_CHARS = 64 * 1024;
const MAX_RETRY_AFTER_SECONDS = 3600;

// Fixed, redacted text for every code a result can carry. Shown to the author; nothing else is.
export const PUBLISH_MESSAGES = Object.freeze({
  "invalid-post": "The post could not be sent because its details are not valid.",
  "unsupported-provider": "That destination is not supported yet.",
  "provider-not-configured": "That provider is not set up on this server.",
  "no-credentials": "There is no usable access for this account. Reconnect it.",
  "auth-rejected": "The provider no longer accepts this account's access. Reconnect it.",
  "permission-denied": "The provider says this account may not post here. Check its permissions and role.",
  throttled: "The provider asked us to slow down. It will be tried again later.",
  "request-rejected": "The provider refused the post.",
  "provider-unexpected": "The provider answered in a way that was not expected.",
  "outcome-unknown": "The provider's answer was not clear, so the post may or may not be live. Check the page and mark the result.",
  "provider-error": "The provider had a problem. The post may or may not be live. Check the page and mark the result.",
  "network-error": "The provider did not answer in time. The post may or may not be live. Check the page and mark the result.",
});

const result = (status, code, extra = {}) =>
  Object.freeze({ status, providerPostId: null, retryable: false, code, message: PUBLISH_MESSAGES[code] || "", httpStatus: 0, reauth: false, retryAfterSeconds: null, ...extra });
const failed = (code, extra) => result("failed", code, extra);
const unknown = (code, extra) => result("unknown", code, extra);
const published = (providerPostId, httpStatus) => result("published", "published", { providerPostId, httpStatus });

const TOKEN = /^[\x21-\x7e]{8,4096}$/;
const LINKEDIN_AUTHOR = /^urn:li:(person:[A-Za-z0-9_-]{1,64}|organization:\d{1,20})$/;
const LINKEDIN_POST_ID = /^urn:li:(share|ugcPost):\d{1,30}$/;

// LinkedIn reads `commentary` as "little text": these characters are markup and must be escaped
// so a caption such as "(beta) | v2 *new*" is posted as typed and mentions cannot be injected.
const LINKEDIN_RESERVED = /[\\|{}@[\]()<>#*_~]/g;
export const escapeLinkedInCommentary = (text) => text.replace(LINKEDIN_RESERVED, "\\$&");

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

function retryAfter(response) {
  const seconds = Number(header(response, "retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS) : null;
}

// What an HTTP status alone says, for a provider that did not use its own error codes.
function byStatus(status, response) {
  if (status === 401) return failed("auth-rejected", { httpStatus: status, reauth: true });
  if (status === 403) return failed("permission-denied", { httpStatus: status });
  if (status === 429) return failed("throttled", { httpStatus: status, retryable: true, retryAfterSeconds: retryAfter(response) });
  if (status >= 500) return unknown("provider-error", { httpStatus: status });
  if (status === 400 || status === 404 || status === 409 || status === 422) return failed("request-rejected", { httpStatus: status });
  return failed("provider-unexpected", { httpStatus: status });
}

async function send(fetchImpl, url, init, timeoutMs) {
  try {
    return await fetchImpl(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
}

async function linkedin(settings, post, token, fetchImpl, timeoutMs) {
  if (!LINKEDIN_AUTHOR.test(String(post.destination?.id))) return failed("invalid-post");
  const kind = post.destination.id.startsWith("urn:li:person:") ? "member" : "organization";
  if (post.destination.kind && post.destination.kind !== kind) return failed("invalid-post");
  const title = String(post.title ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || "Read the full post";
  const body = {
    author: post.destination.id,
    commentary: escapeLinkedInCommentary(post.caption),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { article: { source: post.url, title } },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const response = await send(
    fetchImpl,
    `${settings.apiBase}/rest/posts`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
        // The versioned REST API. The dated version is a setting (docs/social-publishing.md).
        "linkedin-version": settings.version,
        "x-restli-protocol-version": "2.0.0",
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  if (!response) return unknown("network-error");
  const status = Number(response.status) || 0;
  if (status === 201 || status === 200) {
    // LinkedIn answers 201 with the new post's URN in `x-restli-id` and an empty body.
    const id = header(response, "x-restli-id") || (await readJson(response))?.id;
    return typeof id === "string" && LINKEDIN_POST_ID.test(id) ? published(id, status) : unknown("outcome-unknown", { httpStatus: status });
  }
  if (status >= 200 && status < 300) return unknown("outcome-unknown", { httpStatus: status });
  return byStatus(status, response);
}

const ADAPTERS = { linkedin };

// `providers` is socialProviders(env). `post` is
//   { provider, destination: { id, kind? }, caption, url, title? }
// and `credentials` is { accessToken } (a Page token for Facebook), opened by the credential store.
export function createPublisher({ providers = {}, fetchImpl = globalThis.fetch, timeoutMs = PUBLISH_TIMEOUT_MS } = {}) {
  return {
    async publish(post, credentials) {
      let name;
      try {
        name = providerOf(post?.provider).name;
      } catch {
        return failed("unsupported-provider");
      }
      const settings = providers[name];
      if (!settings) return failed("provider-not-configured");
      const token = credentials?.accessToken;
      if (typeof token !== "string" || !TOKEN.test(token)) return failed("no-credentials", { reauth: true });
      let caption;
      try {
        caption = checkCaption(name, post.caption);
      } catch (error) {
        if (!(error instanceof ScheduleError)) throw error;
        return failed("invalid-post");
      }
      const url = httpsUrl(post.url);
      if (!url || !post.destination || typeof post.destination !== "object") return failed("invalid-post");
      return ADAPTERS[name](settings, { ...post, caption, url }, token, fetchImpl, timeoutMs);
    },
  };
}
