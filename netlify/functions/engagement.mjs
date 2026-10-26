import { createHash, timingSafeEqual } from "node:crypto";
import { FEEDBACK_KINDS, canonicalTime, readFeedbackSubmissionJson, receiveFeedback } from "../../web/components/passage-feedback.js";

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
  if (path.length < 2 || path.length > 500 || !path.startsWith("/") || path.startsWith("//") || !path.endsWith("/") || /[\\?#\u0000-\u001F]/.test(path)) return "";
  return path.split("/").some((segment) => segment === "." || segment === "..") ? "" : path;
};

const publicComment = (row) => ({
  id: row.id,
  authorName: row.author_name,
  body: row.body,
  createdAt: row.created_at,
  ...(row.status ? { status: row.status } : {}),
});

// A stored feedback row as the moderation item Admin reads (ADR 0089): the
// ADR 0087 record with its provenance, plus the row id and moderation state.
// The reader's name is shown to moderators only, with their publication choice.
const hostedFeedback = (row) => {
  const provenance = { version: 1, work: row.work, revision: row.revision, target: row.target };
  const seenAt = row.seen_at ? canonicalTime(row.seen_at) : null;
  if (seenAt) provenance.seenAt = seenAt;
  provenance.receivedAt = canonicalTime(row.received_at);
  provenance.channel = row.channel;
  provenance.attribution = row.reader_name ? { name: row.reader_name, publishName: row.publish_name === true } : { publishName: false };
  return {
    id: row.id,
    status: row.status,
    moderatedAt: row.moderated_at ? canonicalTime(row.moderated_at) : null,
    feedback: { version: row.format_version, kind: row.kind, body: row.body, details: row.details || {}, provenance },
  };
};

const FEEDBACK_COLUMNS = "id,status,moderated_at,format_version,kind,work,revision,target,body,details,seen_at,received_at,channel,reader_name,publish_name";
const FEEDBACK_UNAVAILABLE = "Passage feedback is not available on this site. The page itself is unchanged; you can copy your note and send it to the author instead.";

export function createHandler({ env = process.env, fetchImpl = fetch, siteFetchImpl = fetchImpl, now = () => new Date() } = {}) {
  const configured = () => {
    const values = {
      url: String(env.SUPABASE_URL || "").replace(/\/$/, ""),
      key: String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ""),
      siteId: String(env.OPENBLOG_SITE_ID || "").trim(),
      origin: String(env.OPENBLOG_SITE_ORIGIN || "").replace(/\/$/, ""),
      adminKey: String(env.OPENBLOG_ADMIN_API_KEY || ""),
      salt: String(env.OPENBLOG_ANALYTICS_SALT || ""),
      basePath: String(env.OPENBLOG_SITE_BASE_PATH || "/").trim(),
      // Typed passage feedback is off unless the deployer ran
      // supabase/feedback.sql and set this explicitly (ADR 0089).
      feedback: String(env.OPENBLOG_FEEDBACK_ENABLED || "").trim() === "true",
    };
    const required = [values.url, values.key, values.siteId, values.origin, values.adminKey, values.salt];
    if (!required.every(Boolean) || !/^\/(?:[^\\?#\u0000-\u001F]*\/)?$/.test(values.basePath) || values.basePath.includes("//") || values.basePath.split("/").some((segment) => segment === "." || segment === "..")) return null;
    return values;
  };

  const database = async (settings, path, options = {}) => {
    const response = await fetchImpl(`${settings.url}${path}`, {
      ...options,
      headers: {
        apikey: settings.key,
        ...(!settings.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${settings.key}` } : {}),
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
    return value;
  };

  // The policy the deployed site publishes for one post, from one of its
  // generated manifests; anything missing or unexpected is "hidden".
  const publishedPolicy = async (settings, manifest, path) => {
    const target = new URL(`${settings.basePath}${manifest}`, `${settings.origin}/`);
    if (target.origin !== new URL(settings.origin).origin) return "hidden";
    const response = await siteFetchImpl(target.href, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) return "hidden";
    const policies = await response.json();
    const policy = policies && typeof policies === "object" ? policies[path] : "";
    return ["open", "locked", "hidden"].includes(policy) ? policy : "hidden";
  };
  const commentPolicy = (settings, path) => publishedPolicy(settings, "openblog-comments.json", path);
  const feedbackPolicy = (settings, path) => publishedPolicy(settings, "openblog-feedback.json", path);

  // The existing Supabase-backed hourly quota, per client and per site.
  const consumeQuota = async (settings, event, bucket, subjectLimit, siteLimit) => {
    const address = String(event.headers?.["x-nf-client-connection-ip"] || "").trim();
    const hour = now().toISOString().slice(0, 13) + ":00:00Z";
    const subject = createHash("sha256").update(`${settings.salt}\0${bucket}\0${address}`).digest("hex");
    const allowed = await database(settings, "/rest/v1/rpc/openblog_consume_rate_limit", {
      method: "POST",
      body: JSON.stringify({ p_site_id: settings.siteId, p_bucket: bucket, p_window_start: hour, p_subject_hash: subject, p_subject_limit: subjectLimit, p_site_limit: siteLimit }),
    });
    return Boolean(allowed?.allowed ?? allowed);
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
    // A feedback submission is read from its exact text, so the shared
    // validator can check how its numbers are written (ADR 0087).
    const rawFeedback = operation === "feedback" && event.httpMethod === "POST";
    if (mutating && !rawFeedback) {
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
        if (await commentPolicy(settings, path) === "hidden") {
          return json(200, { comments: [] }, corsOrigin);
        }
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
        const policy = await commentPolicy(settings, path);
        if (policy !== "open") {
          return json(403, { error: policy === "locked" ? "This discussion is read-only." : "Comments are not available for this post." }, corsOrigin);
        }
        if (!await consumeQuota(settings, event, "comments", 5, 500)) return json(429, { error: "Too many comments. Please try again later." }, corsOrigin);
        const rows = await database(settings, "/rest/v1/openblog_comments?select=id,status,created_at", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ site_id: settings.siteId, path, author_name: authorName, body: commentBody, status: "pending" }),
        });
        return json(202, { id: rows[0]?.id, status: "pending" }, corsOrigin);
      }
      if (operation === "feedback" || operation === "admin/feedback") {
        if (operation === "admin/feedback" && !admin) return json(401, { error: "Admin authorization is required." }, corsOrigin);
        if (!settings.feedback) return json(404, { error: FEEDBACK_UNAVAILABLE, code: "unavailable" }, corsOrigin);
      }
      if (operation === "feedback" && event.httpMethod === "POST") {
        const text = event.isBase64Encoded ? Buffer.from(String(event.body || ""), "base64").toString("utf8") : String(event.body || "");
        const read = readFeedbackSubmissionJson(text);
        if (!read.ok) {
          const { code, message, target } = read.error;
          return json(code === "tooLarge" ? 413 : 422, { error: message, code, ...(target ? { target } : {}) }, corsOrigin);
        }
        const submission = read.submission;
        const policy = await feedbackPolicy(settings, submission.work);
        if (policy !== "open") {
          return json(403, policy === "locked"
            ? { error: "Feedback on this post is closed.", code: "closed" }
            : { error: FEEDBACK_UNAVAILABLE, code: "unavailable" }, corsOrigin);
        }
        if (!await consumeQuota(settings, event, "feedback", 5, 500)) {
          return json(429, { error: "Too much feedback from here. Please try again later.", code: "rateLimited" }, corsOrigin);
        }
        // The receiver stamps the time; the reader's clock is only seenAt.
        const record = receiveFeedback(submission, canonicalTime(now()), "hosted");
        const { provenance } = record;
        const rows = await database(settings, "/rest/v1/openblog_feedback?select=id,status,received_at", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            site_id: settings.siteId,
            format_version: record.version,
            kind: record.kind,
            work: provenance.work,
            revision: provenance.revision,
            target: provenance.target,
            body: record.body,
            details: record.details,
            seen_at: provenance.seenAt ?? null,
            received_at: provenance.receivedAt,
            channel: provenance.channel,
            reader_name: provenance.attribution.name ?? null,
            publish_name: provenance.attribution.publishName,
            status: "pending",
          }),
        });
        return json(202, { id: rows[0]?.id, status: "pending", receivedAt: provenance.receivedAt }, corsOrigin);
      }
      if (operation === "admin/feedback" && event.httpMethod === "GET") {
        const status = ["pending", "approved", "rejected"].includes(query.status) ? query.status : "pending";
        const kind = query.kind === undefined || query.kind === "" ? "" : String(query.kind);
        if (kind && !Object.hasOwn(FEEDBACK_KINDS, kind)) return json(422, { error: "Unknown feedback kind." }, corsOrigin);
        const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, status: `eq.${status}`, select: FEEDBACK_COLUMNS, order: "received_at.asc", limit: "200" });
        if (kind) params.set("kind", `eq.${kind}`);
        const rows = await database(settings, `/rest/v1/openblog_feedback?${params}`);
        return json(200, { feedback: rows.map(hostedFeedback) }, corsOrigin);
      }
      if (operation === "admin/feedback" && event.httpMethod === "PATCH") {
        const id = String(body.id || "");
        const status = String(body.status || "");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !["approved", "rejected"].includes(status)) {
          return json(422, { error: "Invalid moderation change." }, corsOrigin);
        }
        await database(settings, `/rest/v1/openblog_feedback?id=eq.${encodeURIComponent(id)}&site_id=eq.${encodeURIComponent(settings.siteId)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status, moderated_at: canonicalTime(now()) }),
        });
        return json(200, { ok: true, status }, corsOrigin);
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
