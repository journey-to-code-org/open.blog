// The hosted quote request function (epic #474, story #485; ADR 0381). Off unless
// OPENBLOG_QUOTE_ENABLED=true and every setting is valid: then every route answers 404 and nothing
// touches Supabase.
//
// A visitor needs no account, so the endpoint is fenced instead: same-origin posts only, a signed
// single-use form token with a minimum fill time, a honeypot, per-visitor and per-site hourly
// limits counted from stored rows, hard size bounds, image sniffing, and no third-party captcha.
// GET /api/quote/token hands the token to the page's script; a form posted without JavaScript has
// none, so its first post is answered with the same form to send again (ADR 0382).
//
// Routes (netlify.toml maps /api/quote/* here):
//   GET  /token   -> { token }
//   POST /submit  -> multipart or urlencoded form; JSON for `Accept: application/json`, else a plain page
// Visitor values are never logged and never returned.

import { randomUUID } from "node:crypto";
import {
  PER_CLIENT_PER_HOUR, PER_SITE_PER_HOUR, QuoteError, checkToken, clientHash, issueToken, quoteSettings, readForm, tokenHash, validateRequest,
} from "../lib/quote-intake.mjs";
import { createStore } from "../lib/quote-store.mjs";
import { createNotifier, MAX_ATTEMPTS, notifySettings, resendTransport, retryFailed } from "../lib/quote-notify.mjs";
import { timingSafeEqual } from "node:crypto";
import { erasePreview, eraseConfirmed, exportCsv, listRequests, retentionSetting, retentionSweep, setRetention, setStatus } from "../lib/quote-admin.mjs";

const HOUR = 60 * 60 * 1000;
const SECURITY = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

const json = (statusCode, value) => ({ statusCode, headers: { ...SECURITY, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(value) });
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MESSAGES = {
  received: ["Request received", "Thank you. We have your request and will get back to you."],
  invalid: ["Please check your details", "Some details need fixing. Each one is named below. Correct them and press Send again."],
  retry: ["One more step", "Please check your details and press Send once more. This stops automated posts."],
  limited: ["Please try again later", "Too many requests were sent just now. Please try again in a little while, or call us."],
  failed: ["We could not save your request", "Nothing was sent. Please try again in a little while, or call us."],
  "too-large": ["Photos too large", "Your photos are too large. Send fewer or smaller photos."],
  refused: ["Not accepted", "This request could not be accepted."],
};

function page(status, key, extra = "") {
  const [heading, message] = MESSAGES[key];
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${heading}</title><style>body{font:1rem/1.5 system-ui,sans-serif;margin:0;padding:2rem 1rem;background:#fff;color:#1a1a1a}main{max-width:32rem;margin:0 auto}label{display:block;margin-top:.8rem;font-weight:600}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.4rem}button{margin-top:1rem;font:inherit;padding:.5rem 1rem}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}input,textarea{background:#222;color:#eee}}</style></head><body><main><h1>${heading}</h1><p>${message}</p>${extra}</main></body></html>`;
  return {
    statusCode: status,
    headers: { ...SECURITY, "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" },
    body,
  };
}

// What to do about a field the function refused, in plain words, by field and fixed reason.
const FIELD_LABELS = { name: "Your name", phone: "Phone", email: "Email", town: "Town", service: "Service", description: "What do you need?", photos: "Photos" };
const PHOTO_ADVICE = "Send at most 5 photos, JPEG, PNG or WebP, each under 900 KB.";
function fieldAdvice(field, reason) {
  if (field === "photos") return PHOTO_ADVICE;
  if (field === "phone") return "Write a phone number of at least 7 digits, using only numbers, spaces, +, brackets, dots or dashes.";
  if (field === "email") return "This email address does not look right. Check it, or leave it empty.";
  if (field === "description" && reason === "links") return "Include at most two links.";
  if (field === "description" && reason === "required") return "Describe the job in at least a sentence (10 characters or more).";
  if (reason === "too-long") return "This is too long. Shorten it.";
  return "Fill this in.";
}

// The form again, for a visitor without JavaScript: its typed text and a fresh token. After a
// refusal (`problems`), each wrong field is named in a list at the top, marked invalid and given
// its own message, so nobody is left to guess what "the highlighted fields" are (ADR 0386).
function resendForm(settings, fields, now, problems = []) {
  const wrong = new Map();
  for (const problem of problems) if (FIELD_LABELS[problem.field] && !wrong.has(problem.field)) wrong.set(problem.field, fieldAdvice(problem.field, problem.reason));
  const marks = (name) => (wrong.has(name) ? ` aria-invalid="true" aria-describedby="q-${name}-error"` : "");
  const advice = (name) => (wrong.has(name) ? `<p class="error" id="q-${name}-error"><strong>${escapeHtml(FIELD_LABELS[name])}:</strong> ${escapeHtml(wrong.get(name))}</p>` : "");
  const field = (name, label, big) => `<label for="q-${name}">${label}</label>${advice(name)}${big ? `<textarea id="q-${name}" name="${name}" rows="5" required${marks(name)}>${escapeHtml(fields[name] || "")}</textarea>` : `<input id="q-${name}" name="${name}" value="${escapeHtml(fields[name] || "")}"${name === "phone" ? ' type="tel" minlength="7" maxlength="30" pattern="\\+?[0-9 \\(\\)\\.\\-]{7,30}"' : ""}${name === "email" ? ' type="email"' : " required"}${marks(name)}>`}`;
  const summary = wrong.size
    ? `<div role="alert"><h2>Fix ${wrong.size === 1 ? "this" : `these ${wrong.size}`}</h2><ul>${[...wrong.keys()].map((name) => `<li><a href="#q-${name}">${escapeHtml(FIELD_LABELS[name])}</a>: ${escapeHtml(wrong.get(name))}</li>`).join("")}</ul></div>`
    : "";
  return `${summary}<form method="post" action="${escapeHtml(new URL("/api/quote/submit", settings.origin).pathname)}" enctype="multipart/form-data">${field("name", "Your name")}${field("phone", "Phone")}${field("email", "Email (optional)")}${field("town", "Town")}${field("service", "Service")}${field("description", "What do you need?", true)}<label for="q-photos">Photos (attach again if you added any)</label>${advice("photos")}<input id="q-photos" type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple${marks("photos")}><input type="hidden" name="token" value="${escapeHtml(issueToken(settings.secret, now()))}"><button type="submit">Send</button></form>`;
}

const wantsJson = (headers) => /application\/json/i.test(String(headers.accept || headers.Accept || ""));
const lower = (headers) => Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));

const sameKey = (given, wanted) => {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(wanted || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

// Routes under /api/quote/ for the owner. `segments` ends with one of:
//   GET requests | POST requests/<id>/status | GET export | POST erase/preview | POST erase | POST retention/run
//   | POST retention ({ days }: the owner's retention choice, ADR 0387)
async function manage({ settings, env, method, segments, query, body, store, now, notifyEnabled }) {
  const at = segments.indexOf("quote") + 1;
  const parts = segments.slice(at);
  const input = () => {
    try {
      const value = JSON.parse(body || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      throw new QuoteError(400, "malformed");
    }
  };
  const retention = () => retentionSetting({ store, env });
  if (method === "GET" && parts.length === 1 && parts[0] === "requests") {
    const { days, source } = await retention();
    return json(200, await listRequests({ store, settings, query, days, source, notifyEnabled }));
  }
  if (method === "POST" && parts.length === 1 && parts[0] === "retention") {
    const days = input().days;
    return json(200, await setRetention({ store, env, days: days === null || days === undefined ? null : days }));
  }
  if (method === "POST" && parts.length === 3 && parts[0] === "requests" && parts[2] === "status") return json(200, await setStatus({ store, id: parts[1], status: input().status, now }));
  if (method === "GET" && parts.length === 1 && parts[0] === "export") return json(200, await exportCsv({ store, query }));
  if (method === "POST" && parts.length === 2 && parts[0] === "erase" && parts[1] === "preview") return json(200, await erasePreview({ store, settings, ids: input().ids, now }));
  if (method === "POST" && parts.length === 1 && parts[0] === "erase") {
    const value = input();
    return json(200, await eraseConfirmed({ store, settings, ids: value.ids, token: value.token, now }));
  }
  if (method === "POST" && parts.length === 2 && parts[0] === "retention" && parts[1] === "run") return json(200, await retentionSweep({ store, settings, days: (await retention()).days, now }));
  return json(404, { error: "not-found" });
}

export function createHandler({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), uuid = randomUUID, transport = null, sleep, notifyBudgetMs } = {}) {
  return async (event) => {
    const settings = quoteSettings(env);
    if (!settings.enabled) return json(404, { error: "not-enabled" });
    // Owner notification is off unless a provider is named and complete (ADR 0383).
    const mail = notifySettings(env);
    const send = mail.enabled ? transport || resendTransport({ apiKey: mail.apiKey, fetchImpl }) : null;
    const notify = send ? createNotifier({ settings: mail, transport: send, ...(sleep ? { sleep } : {}), ...(notifyBudgetMs ? { budgetMs: notifyBudgetMs } : {}) }) : null;
    const method = String(event.httpMethod || "GET").toUpperCase();
    const headers = lower(event.headers);
    const route = String(event.path || "").split("/").filter(Boolean).pop();
    const asJson = wantsJson(headers);
    const origin = headers.origin;
    if (origin && origin !== settings.origin) return asJson || method === "GET" ? json(403, { error: "refused" }) : page(403, "refused");

    let admin = false;
    let form = null;
    try {
      if (method === "GET" && route === "token") return json(200, { token: issueToken(settings.secret, now()) });
      const segments = String(event.path || "").split("/").filter(Boolean);
      if (["requests", "export", "erase", "retention"].includes(segments[segments.indexOf("quote") + 1])) {
        // Admin management of stored requests (ADR 0384): admin key only, JSON replies only.
        admin = true;
        const bearer = String(headers.authorization || "").replace(/^Bearer /i, "");
        if (!settings.adminKey || !sameKey(bearer, settings.adminKey)) return json(settings.adminKey ? 401 : 404, { error: settings.adminKey ? "unauthorized" : "not-found" });
        return await manage({ settings, env, method, segments, query: event.queryStringParameters || {}, body: event.body, store: createStore({ settings, fetchImpl, now }), now, notifyEnabled: Boolean(send) });
      }
      if (segments.includes("notifications")) {
        // Admin-only and personal-data-free: states and counts, then a bounded retry. JSON replies only.
        admin = true;
        const bearer = String(headers.authorization || "").replace(/^Bearer /i, "");
        if (!settings.adminKey || !sameKey(bearer, settings.adminKey)) return json(settings.adminKey ? 401 : 404, { error: settings.adminKey ? "unauthorized" : "not-found" });
        const store = createStore({ settings, fetchImpl, now });
        if (method === "GET" && route === "notifications") {
          const rows = await store.notificationOverview();
          return json(200, { enabled: Boolean(send), notifications: rows.map((r) => ({ id: r.id, status: r.notify_status, attempts: r.notify_attempts, error: r.notify_error_code, createdAt: r.created_at })) });
        }
        if (method === "POST" && route === "retry") {
          if (!send) return json(409, { error: "notifications-off" });
          const rows = await store.retryable({ staleMs: 10 * 60 * 1000, maxAttempts: MAX_ATTEMPTS });
          return json(200, await retryFailed({ settings: mail, transport: send, store, rows }));
        }
        return json(404, { error: "not-found" });
      }
      if (method !== "POST" || route !== "submit") return json(404, { error: "not-found" });

      form = readForm(headers, event.body, event.isBase64Encoded);
      const reply = (status, key, body) => (asJson ? json(status, body) : page(status, key));

      // A honeypot is answered like a success, so a script learns nothing from it.
      if (String(form.fields.website || "").trim() !== "") return reply(200, "received", { status: "received" });

      const token = String(form.fields.token || "");
      const checked = checkToken(token, settings.secret, now());
      if (!checked.ok) {
        if (!asJson && ["missing", "too-fast"].includes(checked.reason)) return page(200, "retry", resendForm(settings, form.fields, now));
        return json(checked.reason === "too-fast" ? 429 : 422, { error: "token", reason: checked.reason });
      }

      const { values, photos } = (() => {
        try {
          return validateRequest(form);
        } catch (error) {
          if (error instanceof QuoteError) throw error;
          throw new QuoteError(400, "malformed");
        }
      })();

      const client = clientHash(settings.secret, headers["x-nf-client-connection-ip"] || String(headers["x-forwarded-for"] || "").split(",")[0].trim());
      const store = createStore({ settings, fetchImpl, now });
      if ((await store.count({ client, sinceMs: HOUR })) >= PER_CLIENT_PER_HOUR || (await store.count({ sinceMs: HOUR })) >= PER_SITE_PER_HOUR) {
        return reply(429, "limited", { error: "rate-limited" });
      }

      const id = uuid();
      const stored = [];
      try {
        for (const [index, photo] of photos.entries()) {
          const path = `${settings.siteId}/${id}/${index + 1}.${photo.ext}`;
          await store.uploadPhoto(path, photo.bytes, photo.type);
          stored.push({ path, type: photo.type, bytes: photo.bytes.length });
        }
        await store.insert({
          id,
          name: values.name,
          phone: values.phone,
          email: values.email || null,
          town: values.town,
          service: values.service,
          description: values.description,
          page: values.page || null,
          photos: stored,
          client_hash: client,
          token_hash: tokenHash(settings.secret, token),
          notify_status: notify ? "pending" : "off",
        });
      } catch (error) {
        await store.removePhotos(stored.map((photo) => photo.path));
        throw error;
      }
      // The request is safe from here: a notification can fail without losing it (ADR 0383), and
      // it is bounded so the visitor's answer never waits on a slow provider (ADR 0386).
      if (notify) await notify({ id, values, photoCount: stored.length, store });
      return reply(201, "received", { status: "received" });
    } catch (error) {
      if (error instanceof QuoteError) {
        // Without JavaScript a refused field comes back as the form, with each wrong field named.
        if (error.status === 422 && error.fields.length && form && !wantsJson(headers) && !admin) return page(422, "invalid", resendForm(settings, form.fields, now, error.fields));
        const key = error.status === 413 ? "too-large" : error.status === 422 ? "invalid" : error.status === 409 ? "retry" : error.status >= 500 ? "failed" : "refused";
        const body = { error: error.code, ...(error.fields.length ? { fields: error.fields } : {}) };
        return wantsJson(headers) || admin ? json(error.status, body) : page(error.status === 409 ? 409 : error.status, key);
      }
      return wantsJson(headers) || admin ? json(500, { error: "failed" }) : page(500, "failed");
    }
  };
}

export const handler = createHandler();
