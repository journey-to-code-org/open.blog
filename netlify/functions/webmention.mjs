// The site's Webmention endpoint (epic #387, story #402, ADRs 0863 and 0864), advertised by each
// post as <link rel="webmention" href=".../api/webmention"> while webmention.receive is on.
//
//   POST /api/webmention               a Webmention: form-encoded `source` and `target`. Checked
//                                      (W3C Webmention 3.2.1), stored, answered 202. Never fetched.
//   GET  /api/webmention/inbox         `openblog mentions pull` takes what is waiting,
//   POST /api/webmention/inbox/settle  and deletes what it handled, by version.
//
// The inbox routes need `Authorization: Bearer <OPENBLOG_WEBMENTION_ADMIN_KEY>`. Off unless
// OPENBLOG_WEBMENTION_ENABLED=true and every setting is valid: then every request is a 404 and
// nothing touches Supabase. The schema is supabase/webmention.sql.

import { createHash, timingSafeEqual } from "node:crypto";
import { HOST_LIMIT, MAX_TAKE, PROBLEM_MESSAGES, SITE_LIMIT, acceptedTargets, checkRequest, hostMatches, readForm, webmentionSettings } from "../lib/webmention-receiver.mjs";

const MAX_SETTLE_BODY = 64 * 1024;
const SECURITY = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};
const json = (statusCode, value, extra = {}) => ({ statusCode, headers: { ...SECURITY, ...extra, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(value) });
const failure = (statusCode, code, message, extra) => json(statusCode, { error: code, message }, extra);
const accepted = () => ({ statusCode: 202, headers: { ...SECURITY, "content-type": "text/plain; charset=utf-8" }, body: "Accepted. The source will be checked and a person will review the mention.\n" });

const sameSecret = (presented, expected) => {
  const a = createHash("sha256").update(String(presented || "")).digest();
  const b = createHash("sha256").update(String(expected || "")).digest();
  return Boolean(presented) && timingSafeEqual(a, b);
};

const header = (headers, wanted) => String(Object.entries(headers || {}).find(([name]) => name.toLowerCase() === wanted)?.[1] || "");

const bearer = (headers) => {
  const match = /^Bearer\s+(\S+)$/i.exec(header(headers, "authorization").trim());
  return match ? match[1] : "";
};

// The path below the function's own name, whichever of /api/webmention/... or
// /.netlify/functions/webmention/... the request used.
const segmentsOf = (event) => {
  const parts = String(event.path || "").split("/").filter(Boolean);
  const at = parts.indexOf("webmention");
  return at < 0 ? [] : parts.slice(at + 1);
};

const rawBody = (event) => (event.isBase64Encoded ? Buffer.from(String(event.body || ""), "base64").toString("utf8") : String(event.body || ""));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createHandler({ env = process.env, fetchImpl = globalThis.fetch, siteFetchImpl = fetchImpl } = {}) {
  const database = async (settings, path, body) => {
    const response = await fetchImpl(`${settings.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        apikey: settings.key,
        ...(!settings.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${settings.key}` } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error("storage");
    return value;
  };

  // The site's own list of posts that accept mentions: always this deployment's origin, never an
  // address from the request.
  const targets = async (settings) => {
    const response = await siteFetchImpl(`${settings.origin}/openblog-webmention.json`, { headers: { Accept: "application/json" }, redirect: "error" });
    if (!response.ok) return null;
    return acceptedTargets(await response.json().catch(() => null), settings.origin);
  };

  const receive = async (settings, event) => {
    const type = header(event.headers, "content-type").split(";")[0].trim().toLowerCase();
    if (type !== "application/x-www-form-urlencoded") return failure(400, "invalid-request", "Send the Webmention as application/x-www-form-urlencoded.");
    const form = readForm(rawBody(event));
    if (form.problem) return failure(form.problem === "too-large" ? 413 : 400, form.problem, PROBLEM_MESSAGES[form.problem]);
    const checked = checkRequest(form.source, form.target, settings.origin);
    if (checked.problem) return failure(400, checked.problem, PROBLEM_MESSAGES[checked.problem]);
    // A blocked host gets the same answer as anyone, and nothing is stored.
    if (settings.blockedHosts.some((blocked) => hostMatches(checked.sourceHost, blocked))) return accepted();
    const accepting = await targets(settings).catch(() => null);
    if (!accepting) return failure(503, "unavailable", "Webmentions cannot be taken just now. Please try again later.", { "retry-after": "3600" });
    if (!accepting.has(checked.target)) return failure(400, "not-accepted", PROBLEM_MESSAGES["not-accepted"]);
    const outcome = await database(settings, "/rest/v1/rpc/openblog_webmention_receive", {
      p_site_id: settings.siteId,
      p_source: checked.source,
      p_target: checked.target,
      p_source_host: checked.sourceHost,
      p_host_limit: HOST_LIMIT,
      p_site_limit: SITE_LIMIT,
    });
    if (outcome === "host-limit" || outcome === "site-limit") return failure(429, "rate-limited", "Too many Webmentions are waiting. Please try again later.", { "retry-after": "3600" });
    if (outcome !== "accepted" && outcome !== "repeat") throw new Error("storage");
    return accepted();
  };

  const take = async (settings, event) => {
    const query = new URLSearchParams(typeof event.rawQuery === "string" ? event.rawQuery : event.queryStringParameters || {});
    const limit = Math.min(Math.max(Number.parseInt(query.get("limit") || "", 10) || MAX_TAKE, 1), MAX_TAKE);
    const site = encodeURIComponent(settings.siteId);
    const rows = await database(settings, `/rest/v1/openblog_webmention_requests?site_id=eq.${site}&select=id,version,source,target,received_at&order=received_at.asc,id.asc&limit=${limit}`);
    const requests = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: String(row.id),
      version: Number(row.version),
      source: String(row.source),
      target: String(row.target),
      receivedAt: Math.floor(Date.parse(row.received_at) / 1000) || 0,
    }));
    return json(200, { requests });
  };

  const settle = async (settings, event) => {
    const raw = rawBody(event);
    if (raw.length > MAX_SETTLE_BODY) return failure(413, "too-large", "The request is too large.");
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return failure(400, "invalid-request", "The request is not valid JSON.");
    }
    const items = Array.isArray(body?.items) ? body.items : null;
    if (!items || items.length > 200 || !items.every((item) => item && UUID.test(String(item.id)) && Number.isInteger(item.version) && item.version >= 1)) {
      return failure(400, "invalid-request", "items must be at most 200 {id, version} pairs.");
    }
    const settled = await database(settings, "/rest/v1/rpc/openblog_webmention_settle", { p_site_id: settings.siteId, p_items: items.map(({ id, version }) => ({ id, version })) });
    return json(200, { settled: Number(settled) || 0 });
  };

  return async (event) => {
    try {
      const settings = webmentionSettings(env);
      if (!settings.enabled) return failure(404, "not-enabled", "This site does not accept Webmentions.");
      const method = String(event.httpMethod || "GET").toUpperCase();
      const route = segmentsOf(event).join("/");
      if (route === "") {
        if (method !== "POST") return failure(405, "method-not-allowed", "Send a Webmention with POST.", { allow: "POST" });
        return await receive(settings, event);
      }
      if (route !== "inbox" && route !== "inbox/settle") return failure(404, "not-found", "Not found.");
      // The key is checked before anything is read or stored.
      if (!sameSecret(bearer(event.headers), settings.adminKey)) return failure(401, "unauthorized", "A valid key is required.", { "www-authenticate": "Bearer" });
      if (route === "inbox") return method === "GET" ? await take(settings, event) : failure(405, "method-not-allowed", "Use GET.", { allow: "GET" });
      return method === "POST" ? await settle(settings, event) : failure(405, "method-not-allowed", "Use POST.", { allow: "POST" });
    } catch {
      // Nothing is logged with the error: it could carry a stored address or a credential.
      return failure(500, "internal", "Something went wrong. Please try again later.");
    }
  };
}

export const handler = createHandler();
