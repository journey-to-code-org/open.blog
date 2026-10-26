import { createHash, timingSafeEqual } from "node:crypto";
import { FEEDBACK_KINDS, canonicalTime, readFeedbackSubmissionJson, receiveFeedback } from "../../web/components/passage-feedback.js";
import { MODERATION_STATES, auditActor, planModeration } from "../lib/feedback-moderation.mjs";
import { INBOX_ACTIONS, MODERATOR_ROLES, PARTICIPATION_KINDS, commentState, commentStateFilter, legacyCommentStatus, legacySupports, planTransition } from "../lib/participation-moderation.mjs";

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

// A stored feedback row as the moderation item Admin reads (ADRs 0081 and
// 0083): the ADR 0079 record with its provenance, plus the row id, its
// moderation state, the version every change must name, and the last reason;
// with the inbox's schema (ADR 0105), also the facts the state machine
// decides on. The reader's name is shown to moderators only, with their
// publication choice; Admin decides who among them may see it (ADR 0102).
const moderationFacts = (row) => (row.item_revision === undefined ? {} : {
  itemRevision: row.item_revision,
  approvedRevision: row.approved_revision ?? null,
  clarificationAsked: row.clarification_asked ?? null,
  clarificationConsent: row.clarification_consent === true,
});
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
    version: row.version,
    moderatedAt: row.moderated_at ? canonicalTime(row.moderated_at) : null,
    reason: row.moderation_reason ?? null,
    feedback: { version: row.format_version, kind: row.kind, body: row.body, details: row.details || {}, provenance },
    ...moderationFacts(row),
  };
};

const FEEDBACK_COLUMNS = "id,status,version,moderated_at,moderation_reason,format_version,kind,work,revision,target,body,details,seen_at,received_at,channel,reader_name,publish_name";
// What supabase/feedback.sql adds for the moderation inbox (ADR 0105).
const FEEDBACK_INBOX_COLUMNS = `${FEEDBACK_COLUMNS},item_revision,approved_revision,clarification_asked,clarification_consent`;
const COMMENT_COLUMNS = "id,path,author_name,body,status,created_at,moderated_at";
// What supabase/moderation.sql adds to comments (ADR 0105).
const COMMENT_INBOX_COLUMNS = `${COMMENT_COLUMNS},version,moderation_state,moderation_reason`;

// A comment row as an inbox item (ADR 0104). Without the inbox's schema a
// comment has only its three statuses and is always at version 1; with it,
// its full state, unless a write made without the schema has since changed
// its status (ADR 0105).
const inboxComment = (row) => ({
  source: "comment",
  id: row.id,
  status: commentState(row.moderation_state, row.status),
  version: row.version ?? 1,
  moderatedAt: row.moderated_at ? canonicalTime(row.moderated_at) : null,
  reason: row.moderation_reason ?? null,
  comment: { path: row.path, authorName: row.author_name, body: row.body, createdAt: canonicalTime(row.created_at) },
});
const inboxFeedback = (row) => ({ source: "feedback", ...hostedFeedback(row) });
const inboxItem = (source, row) => (source === "comment" ? inboxComment(row) : inboxFeedback(row));

// The inbox's keyset cursor: a row's own time, to the microsecond, in UTC,
// and its id. Rows of both stores are merged in this order.
const ROW_TIME = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/;
const timeKey = (value) => {
  const match = ROW_TIME.exec(String(value || ""));
  if (!match) return null;
  const date = new Date(`${match[1]}${match[3]}`);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 19)}.${(match[2] || "").padEnd(6, "0")}Z`;
};
const CURSOR = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)~([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const INBOX_PAGE = 50;
const INBOX_UNAVAILABLE = "Run supabase/moderation.sql (and supabase/feedback.sql again if you use passage feedback), then set OPENBLOG_MODERATION_ENABLED=true, to take this decision.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      // supabase/feedback.sql and set this explicitly (ADR 0081).
      feedback: String(env.OPENBLOG_FEEDBACK_ENABLED || "").trim() === "true",
      // The moderation inbox's full schema (ADR 0105): set only after
      // running supabase/moderation.sql, and feedback.sql again if feedback
      // is on. Without it the inbox stores what the older schema can.
      moderation: String(env.OPENBLOG_MODERATION_ENABLED || "").trim() === "true",
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

  // One of the deployed site's generated manifests, or null when it is not
  // published (`missing`) or cannot be read.
  const MODES = ["open", "locked", "hidden"];
  const siteManifest = async (settings, manifest) => {
    const target = new URL(`${settings.basePath}${manifest}`, `${settings.origin}/`);
    if (target.origin !== new URL(settings.origin).origin) return { value: null };
    const response = await siteFetchImpl(target.href, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) return { value: null, missing: response.status === 404 };
    const value = await response.json();
    return { value: value && typeof value === "object" && !Array.isArray(value) ? value : null };
  };
  // The policy the deployed site publishes for one post, from a path-to-mode
  // manifest; anything missing or unexpected is "hidden".
  const publishedPolicy = async (settings, manifest, path) => {
    const { value } = await siteManifest(settings, manifest);
    const policy = value && Object.hasOwn(value, path) ? value[path] : "";
    return MODES.includes(policy) ? policy : "hidden";
  };
  const feedbackRows = (settings, filters) => {
    const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, ...filters, select: settings.moderation ? FEEDBACK_INBOX_COLUMNS : FEEDBACK_COLUMNS, order: "received_at.asc", limit: "200" });
    return database(settings, `/rest/v1/openblog_feedback?${params}`);
  };

  // ---- The moderation inbox (ADRs 0104 and 0105)

  const inboxTable = (source) => (source === "comment" ? "openblog_comments" : "openblog_feedback");
  const inboxColumns = (settings, source) => (source === "comment"
    ? (settings.moderation ? COMMENT_INBOX_COLUMNS : COMMENT_COLUMNS)
    : (settings.moderation ? FEEDBACK_INBOX_COLUMNS : FEEDBACK_COLUMNS));

  // One store's rows in one state after a cursor, oldest first, at most
  // `limit`. Comments never wait for clarification or are withdrawn, and
  // without the inbox's schema they are only pending, approved or rejected.
  const inboxRows = async (settings, source, { state, kind, after, limit }) => {
    const time = source === "comment" ? "created_at" : "received_at";
    const conditions = [];
    if (source === "comment") {
      const filter = settings.moderation ? commentStateFilter(state) : null;
      if (filter) conditions.push(filter);
      else if (!settings.moderation && ["pending", "approved", "rejected"].includes(state)) conditions.push(`status.eq.${state}`);
      else return [];
    } else {
      conditions.push(`status.eq.${state}`);
      if (kind) conditions.push(`kind.eq.${kind}`);
    }
    if (after) conditions.push(`or(${time}.gt."${after.time}",and(${time}.eq."${after.time}",id.gt.${after.id}))`);
    const params = new URLSearchParams({
      site_id: `eq.${settings.siteId}`,
      and: `(${conditions.join(",")})`,
      select: inboxColumns(settings, source),
      order: `${time}.asc,id.asc`,
      limit: String(limit),
    });
    const rows = await database(settings, `/rest/v1/${inboxTable(source)}?${params}`);
    return (Array.isArray(rows) ? rows : [])
      .map((row) => ({ source, row, key: timeKey(row[time]), id: String(row.id).toLowerCase() }))
      .filter((entry) => entry.key);
  };
  const inboxRow = async (settings, source, id) => {
    const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, id: `eq.${id}`, select: inboxColumns(settings, source) });
    const rows = await database(settings, `/rest/v1/${inboxTable(source)}?${params}`);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };
  // The facts the state machine decides on, from a stored row.
  const inboxFacts = (source, row) => {
    const item = inboxItem(source, row);
    return {
      kind: source === "comment" ? "comment" : row.kind,
      state: item.status,
      version: item.version,
      revision: item.itemRevision ?? 1,
      clarificationAsked: item.clarificationAsked ?? null,
      clarificationConsent: item.clarificationConsent === true,
    };
  };
  // Apply one planned change, only while the row still has the state and
  // version both Admin and this function saw, with its audit event.
  const applyInboxChange = (settings, source, id, change, version, actor, role) => {
    const at = canonicalTime(now());
    if (settings.moderation) {
      return database(settings, `/rest/v1/rpc/${source === "comment" ? "openblog_moderate_comment" : "openblog_moderate_feedback_item"}`, {
        method: "POST",
        body: JSON.stringify({
          p_site_id: settings.siteId, p_id: id, p_expected_version: version, p_from: change.from, p_to: change.to,
          p_action: change.action, p_reason: change.reason, p_actor: actor, p_actor_role: role, p_at: at,
        }),
      });
    }
    if (source === "feedback") {
      return database(settings, "/rest/v1/rpc/openblog_moderate_feedback", {
        method: "POST",
        body: JSON.stringify({
          p_site_id: settings.siteId, p_id: id, p_expected_version: version, p_from: change.from, p_to: change.to,
          p_action: change.action, p_reason: change.reason, p_actor: actor, p_at: at,
        }),
      });
    }
    // An older comment table has no version: the change applies only while
    // the row still has the status it was read with.
    const params = new URLSearchParams({ id: `eq.${id}`, site_id: `eq.${settings.siteId}`, status: `eq.${legacyCommentStatus(change.from)}`, select: COMMENT_COLUMNS });
    return database(settings, `/rest/v1/openblog_comments?${params}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: legacyCommentStatus(change.to), moderated_at: at }),
    });
  };
  const commentPolicy = (settings, path) => publishedPolicy(settings, "openblog-comments.json", path);
  // One passage feedback kind's mode on one post (ADR 0100), from the
  // participation manifest; a missing post or kind is "hidden". A site built
  // before that manifest existed still publishes B5's openblog-feedback.json,
  // which is read only when the participation manifest is not published.
  const feedbackPolicy = async (settings, path, kind) => {
    const { value, missing } = await siteManifest(settings, "openblog-participation.json");
    if (missing) return publishedPolicy(settings, "openblog-feedback.json", path);
    const modes = value && Object.hasOwn(value, path) ? value[path] : null;
    const mode = modes && typeof modes === "object" && Object.hasOwn(modes, kind) ? modes[kind] : "";
    return MODES.includes(mode) ? mode : "hidden";
  };

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
    // validator can check how its numbers are written (ADR 0079).
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
        const policy = await feedbackPolicy(settings, submission.work, submission.kind);
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
        // One item by id, whatever its state (Admin re-reads an item before
        // acting on it), or the queue of one state.
        if (query.id !== undefined) {
          if (!UUID.test(String(query.id))) return json(422, { error: "Invalid feedback id." }, corsOrigin);
          const rows = await feedbackRows(settings, { id: `eq.${String(query.id).toLowerCase()}` });
          return json(200, { feedback: rows.map(hostedFeedback) }, corsOrigin);
        }
        const status = MODERATION_STATES.includes(query.status) ? query.status : "pending";
        const kind = query.kind === undefined || query.kind === "" ? "" : String(query.kind);
        if (kind && !Object.hasOwn(FEEDBACK_KINDS, kind)) return json(422, { error: "Unknown feedback kind." }, corsOrigin);
        const rows = await feedbackRows(settings, { status: `eq.${status}`, ...(kind ? { kind: `eq.${kind}` } : {}) });
        return json(200, { feedback: rows.map(hostedFeedback) }, corsOrigin);
      }
      if (operation === "admin/feedback" && event.httpMethod === "PATCH") {
        // A change names the state and version the moderator saw (ADR 0083).
        // The database applies it and records its audit event in one
        // statement, only if the row still has both, so concurrent moderation
        // is refused instead of overwritten.
        const id = String(body.id || "").toLowerCase();
        const version = body.expectedVersion;
        if (!UUID.test(id) || !Number.isInteger(version) || version < 1 || version > 2147483647 || !MODERATION_STATES.includes(body.from)) {
          return json(422, { error: "Invalid moderation change." }, corsOrigin);
        }
        const plan = planModeration(body.from, body.action, body.reason);
        if (!plan.ok) return json(422, { error: plan.message, code: plan.code }, corsOrigin);
        const { change } = plan;
        // With the inbox's schema the change goes through its function, so
        // the item's revisions and the audit event's kind, revision and role
        // are kept as the inbox keeps them (ADR 0105).
        const rows = await applyInboxChange(settings, "feedback", id, change, version, auditActor(body.actor), "site-admin");
        if (Array.isArray(rows) && rows.length === 1) return json(200, { ok: true, item: hostedFeedback(rows[0]) }, corsOrigin);
        const current = await feedbackRows(settings, { id: `eq.${id}` });
        if (!current.length) return json(404, { error: "No such feedback item.", code: "notFound" }, corsOrigin);
        return json(409, { error: "This item changed since you loaded it. Review it again before acting.", code: "conflict", item: hostedFeedback(current[0]) }, corsOrigin);
      }
      if (operation === "admin/moderation") {
        // The one moderation inbox (ADR 0104): comments and passage feedback
        // in one list, decided by the one state machine. Admin calls it with
        // the token, which is the site Admin, naming the role its viewer has
        // on the item's work (ADR 0102); nothing here is public.
        if (!admin) return json(401, { error: "Admin authorization is required." }, corsOrigin);
        const protocol = settings.moderation ? "full" : "legacy";
        const sourceOf = (value) => (value === "comment" || (value === "feedback" && settings.feedback) ? value : "");
        if (event.httpMethod === "GET") {
          if (query.id !== undefined) {
            const source = sourceOf(query.source);
            if (!UUID.test(String(query.id)) || !source) return json(422, { error: "Name an item by its source and id." }, corsOrigin);
            const row = await inboxRow(settings, source, String(query.id).toLowerCase());
            return json(200, { protocol, items: row ? [inboxItem(source, row)] : [], next: null }, corsOrigin);
          }
          const state = MODERATION_STATES.includes(query.state) ? query.state : "pending";
          const kind = query.kind === undefined || query.kind === "" ? "" : String(query.kind);
          if (kind && !PARTICIPATION_KINDS.includes(kind)) return json(422, { error: "Unknown participation kind." }, corsOrigin);
          let after = null;
          if (query.after !== undefined && query.after !== "") {
            const match = CURSOR.exec(String(query.after));
            if (!match) return json(422, { error: "Invalid page cursor." }, corsOrigin);
            after = { time: match[1], id: match[2] };
          }
          const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || INBOX_PAGE, 1), 100);
          const sources = [];
          if (!kind || kind === "comment") sources.push("comment");
          if (settings.feedback && (!kind || Object.hasOwn(FEEDBACK_KINDS, kind))) sources.push("feedback");
          // Each store's first `limit + 1` rows after the cursor; merged, the
          // first `limit` are this page's, oldest first.
          const merged = (await Promise.all(sources.map((source) => inboxRows(settings, source, { state, kind, after, limit: limit + 1 }))))
            .flat()
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          const page = merged.slice(0, limit);
          const last = page.at(-1);
          return json(200, {
            protocol,
            items: page.map((entry) => inboxItem(entry.source, entry.row)),
            next: merged.length > limit && last ? `${last.key}~${last.id}` : null,
          }, corsOrigin);
        }
        if (event.httpMethod === "PATCH") {
          const source = sourceOf(body.source);
          const id = String(body.id || "").toLowerCase();
          const version = body.expectedVersion;
          const role = body.actorRole === undefined ? "site-admin" : body.actorRole;
          if (!source || !UUID.test(id) || !Number.isInteger(version) || version < 1 || version > 2147483647 || !MODERATION_STATES.includes(body.from)
            || !INBOX_ACTIONS.includes(body.action) || !MODERATOR_ROLES.includes(role)) {
            return json(422, { error: "Invalid moderation change.", code: "invalid" }, corsOrigin);
          }
          const row = await inboxRow(settings, source, id);
          if (!row) return json(404, { error: "No such item.", code: "notFound" }, corsOrigin);
          const facts = inboxFacts(source, row);
          const conflict = (current) => json(409, { error: "This item changed since you loaded it. Review it again before acting.", code: "conflict", item: inboxItem(source, current) }, corsOrigin);
          if (facts.state !== body.from || facts.version !== version) return conflict(row);
          // Decided again here, from the stored row, before anything is written.
          const plan = planTransition(facts, { action: body.action, expectedVersion: version, reason: body.reason, role });
          if (!plan.ok) {
            if (plan.code === "stale") return conflict(row);
            return json(plan.code === "denied" ? 403 : 422, { error: "This moderation change is not allowed.", code: plan.code }, corsOrigin);
          }
          if (!settings.moderation && !legacySupports(facts.kind, body.action)) {
            return json(422, { error: INBOX_UNAVAILABLE, code: "notAllowed" }, corsOrigin);
          }
          const rows = await applyInboxChange(settings, source, id, plan.change, version, auditActor(body.actor), role);
          if (Array.isArray(rows) && rows.length === 1) return json(200, { ok: true, item: inboxItem(source, rows[0]) }, corsOrigin);
          const current = await inboxRow(settings, source, id);
          if (!current) return json(404, { error: "No such item.", code: "notFound" }, corsOrigin);
          return conflict(current);
        }
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
        // With the inbox's schema, a bare status change would skip the
        // comment's version, its full state and its audit event (ADR 0105).
        if (settings.moderation) return json(409, { error: "Comments are moderated through /admin/moderation on this site.", code: "useModerationInbox" }, corsOrigin);
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
