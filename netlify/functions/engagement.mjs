import { createHash, timingSafeEqual } from "node:crypto";

const json = (statusCode, value, origin = "") => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  },
  body: JSON.stringify(value),
});

const safeEqual = (left, right) => {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};

const cleanPath = (value) => {
  const path = String(value || "").trim();
  if (path.length < 2 || path.length > 500 || !path.startsWith("/") || !path.endsWith("/") || /[\\?#\u0000-\u001F]/.test(path)) return "";
  return path.split("/").some((segment) => segment === "." || segment === "..") ? "" : path;
};

const publicComment = (row) => ({
  id: row.id,
  authorName: row.author_name,
  body: row.body,
  createdAt: row.created_at,
  ...(row.status ? { status: row.status } : {}),
});

export function createHandler({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  const configured = () => {
    const values = {
      url: String(env.SUPABASE_URL || "").replace(/\/$/, ""),
      key: String(env.SUPABASE_SERVICE_ROLE_KEY || ""),
      siteId: String(env.OPENBLOG_SITE_ID || "").trim(),
      origin: String(env.OPENBLOG_SITE_ORIGIN || "").replace(/\/$/, ""),
      adminKey: String(env.OPENBLOG_ADMIN_API_KEY || ""),
      salt: String(env.OPENBLOG_ANALYTICS_SALT || ""),
    };
    return Object.values(values).every(Boolean) ? values : null;
  };

  const database = async (settings, path, options = {}) => {
    const response = await fetchImpl(`${settings.url}${path}`, {
      ...options,
      headers: {
        apikey: settings.key,
        Authorization: `Bearer ${settings.key}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
    return value;
  };

  return async (event) => {
    const settings = configured();
    if (!settings) return json(503, { error: "Hosted engagement is not configured." });
    const requestOrigin = String(event.headers?.origin || "").replace(/\/$/, "");
    const corsOrigin = requestOrigin === settings.origin ? requestOrigin : "";
    if (event.httpMethod === "OPTIONS") {
      if (!corsOrigin) return json(403, { error: "Origin is not allowed." });
      return {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
          Vary: "Origin",
        },
        body: "",
      };
    }
    const segments = event.path.split("/").filter(Boolean);
    const leaf = segments.at(-1) || "";
    const operation = segments.at(-2) === "admin" ? `admin/${leaf}` : leaf;
    const mutating = event.httpMethod === "POST" || event.httpMethod === "PATCH";
    const token = String(event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
    const admin = safeEqual(token, settings.adminKey);
    if (mutating && !corsOrigin && !admin) return json(403, { error: "Origin is not allowed." });
    const query = event.queryStringParameters || {};
    let body = {};
    if (mutating) {
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Invalid JSON." }, corsOrigin);
      }
    }
    try {
      if (operation === "comments" && event.httpMethod === "GET") {
        const path = cleanPath(query.path);
        if (!path) return json(400, { error: "Invalid post path." }, corsOrigin);
        const params = new URLSearchParams({
          site_id: `eq.${settings.siteId}`,
          path: `eq.${path}`,
          status: "eq.approved",
          select: "id,author_name,body,created_at",
          order: "created_at.asc",
          limit: "200",
        });
        const rows = await database(settings, `/rest/v1/openblog_comments?${params}`);
        return json(200, { comments: rows.map(publicComment) }, corsOrigin);
      }
      if (operation === "comments" && event.httpMethod === "POST") {
        const path = cleanPath(body.path);
        const authorName = String(body.authorName || "").trim().replace(/\s+/g, " ");
        const commentBody = String(body.body || "").trim();
        if (!path || authorName.length < 1 || authorName.length > 80 || commentBody.length < 1 || commentBody.length > 4000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(commentBody)) {
          return json(422, { error: "Enter a valid name and a comment no longer than 4,000 characters." }, corsOrigin);
        }
        const address = String(event.headers?.["x-nf-client-connection-ip"] || "").trim();
        const hour = now().toISOString().slice(0, 13) + ":00:00Z";
        const subject = createHash("sha256").update(`${settings.salt}\0comments\0${address}`).digest("hex");
        const allowed = await database(settings, "/rest/v1/rpc/openblog_consume_rate_limit", {
          method: "POST",
          body: JSON.stringify({ p_site_id: settings.siteId, p_bucket: "comments", p_window_start: hour, p_subject_hash: subject, p_subject_limit: 5, p_site_limit: 500 }),
        });
        if (!(allowed?.allowed ?? allowed)) return json(429, { error: "Too many comments. Please try again later." }, corsOrigin);
        const rows = await database(settings, "/rest/v1/openblog_comments?select=id,status,created_at", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ site_id: settings.siteId, path, author_name: authorName, body: commentBody, status: "pending" }),
        });
        return json(202, { id: rows[0]?.id, status: "pending" }, corsOrigin);
      }
      if (operation === "admin/comments" && event.httpMethod === "GET") {
        if (!admin) return json(401, { error: "Admin authorization is required." }, corsOrigin);
        const status = ["pending", "approved", "rejected"].includes(query.status) ? query.status : "pending";
        const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, status: `eq.${status}`, select: "id,path,author_name,body,status,created_at", order: "created_at.asc", limit: "200" });
        const rows = await database(settings, `/rest/v1/openblog_comments?${params}`);
        return json(200, { comments: rows.map(publicComment).map((comment, index) => ({ ...comment, path: rows[index].path })) }, corsOrigin);
      }
      if (operation === "admin/comments" && event.httpMethod === "PATCH") {
        if (!admin) return json(401, { error: "Admin authorization is required." }, corsOrigin);
        const id = String(body.id || "");
        const status = String(body.status || "");
        if (!/^[0-9a-f-]{36}$/i.test(id) || !["approved", "rejected"].includes(status)) return json(422, { error: "Invalid moderation change." }, corsOrigin);
        await database(settings, `/rest/v1/openblog_comments?id=eq.${encodeURIComponent(id)}&site_id=eq.${encodeURIComponent(settings.siteId)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status, moderated_at: now().toISOString() }),
        });
        return json(200, { ok: true, status }, corsOrigin);
      }
      if (operation === "hit" && event.httpMethod === "POST") {
        if (event.headers?.dnt === "1" || event.headers?.["sec-gpc"] === "1") {
          return { statusCode: 204, headers: corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin, Vary: "Origin" } : {}, body: "" };
        }
        const path = cleanPath(body.path);
        if (!path) return json(400, { error: "Invalid page path." }, corsOrigin);
        const day = now().toISOString().slice(0, 10);
        const address = String(event.headers?.["x-nf-client-connection-ip"] || event.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
        const agent = String(event.headers?.["user-agent"] || "").slice(0, 500);
        const visitor = createHash("sha256").update(`${settings.salt}\0${day}\0${address}\0${agent}`).digest("hex");
        const hour = now().toISOString().slice(0, 13) + ":00:00Z";
        const rateSubject = createHash("sha256").update(`${settings.salt}\0analytics\0${address}`).digest("hex");
        const allowed = await database(settings, "/rest/v1/rpc/openblog_consume_rate_limit", {
          method: "POST",
          body: JSON.stringify({ p_site_id: settings.siteId, p_bucket: "analytics", p_window_start: hour, p_subject_hash: rateSubject, p_subject_limit: 120, p_site_limit: 20000 }),
        });
        if (!(allowed?.allowed ?? allowed)) return json(429, { error: "Analytics rate limit reached." }, corsOrigin);
        let referrer = "";
        try { referrer = new URL(String(body.referrer || "")).hostname.toLowerCase().slice(0, 253); } catch { /* no referrer */ }
        const result = await database(settings, "/rest/v1/rpc/openblog_record_view", {
          method: "POST",
          body: JSON.stringify({ p_site_id: settings.siteId, p_day: day, p_path: path, p_visitor_hash: visitor, p_referrer: referrer }),
        });
        return json(200, { views: Number(result?.views ?? result ?? 0) }, corsOrigin);
      }
      if (operation === "views" && event.httpMethod === "GET") {
        const path = cleanPath(query.path);
        if (!path) return json(400, { error: "Invalid page path." }, corsOrigin);
        const result = await database(settings, "/rest/v1/rpc/openblog_page_views", { method: "POST", body: JSON.stringify({ p_site_id: settings.siteId, p_path: path }) });
        return json(200, { views: Number(result?.views ?? result ?? 0) }, corsOrigin);
      }
      if (operation === "admin/analytics" && event.httpMethod === "GET") {
        if (!admin) return json(401, { error: "Admin authorization is required." }, corsOrigin);
        const days = [7, 30, 90, 365].includes(Number(query.days)) ? Number(query.days) : 30;
        const result = await database(settings, "/rest/v1/rpc/openblog_analytics_summary", { method: "POST", body: JSON.stringify({ p_site_id: settings.siteId, p_days: days }) });
        return json(200, result, corsOrigin);
      }
      return json(404, { error: "No such engagement operation." }, corsOrigin);
    } catch (error) {
      console.error("open.blog engagement:", error.message);
      return json(502, { error: "The hosted data service is unavailable." }, corsOrigin);
    }
  };
}

export const handler = createHandler();
