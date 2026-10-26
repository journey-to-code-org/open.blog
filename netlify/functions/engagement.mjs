import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FEEDBACK_KINDS, canonicalTime, readFeedbackSubmissionJson, receiveFeedback } from "../../web/components/passage-feedback.js";
import { MODERATION_STATES, auditActor, planModeration } from "../lib/feedback-moderation.mjs";
import {
  INBOX_ACTIONS, MODERATOR_ROLES, PARTICIPATION_KINDS, REPORT_GROUNDS, commentState, commentStateFilter, issuesReceipts, legacyCommentStatus,
  legacySupports, planErasure, planTransition, planUphold, retentionStep, timeKey,
} from "../lib/participation-moderation.mjs";

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
// moderation state, the version every change must name, and the last reason.
// This is B5's /admin/feedback shape, kept exactly as v0.33.0 sent it so an
// older Admin, which refuses unknown fields, still reads every item; only the
// inbox's items add the facts the state machine decides on (ADR 0105). The
// reader's name is shown to moderators only, with their publication choice;
// Admin decides who among them may see it (ADR 0102).
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
  };
};

const FEEDBACK_COLUMNS = "id,status,version,moderated_at,moderation_reason,format_version,kind,work,revision,target,body,details,seen_at,received_at,channel,reader_name,publish_name";
// What supabase/feedback.sql adds for the moderation inbox (ADR 0105).
const FEEDBACK_INBOX_COLUMNS = `${FEEDBACK_COLUMNS},item_revision,approved_revision,clarification_asked,clarification_consent`;
const COMMENT_COLUMNS = "id,path,author_name,body,status,created_at,moderated_at";
// What supabase/moderation.sql adds to comments (ADR 0105).
const COMMENT_INBOX_COLUMNS = `${COMMENT_COLUMNS},version,moderation_state,moderation_reason`;
// What engagement protection adds (ADR 0131). A receipt's digest is never read back out.
const FEEDBACK_PROTECTED_COLUMNS = `${FEEDBACK_INBOX_COLUMNS},purged_at`;
const COMMENT_PROTECTED_COLUMNS = `${COMMENT_INBOX_COLUMNS},purged_at`;
const REPORT_COLUMNS = "id,target_source,target_id,work,ground,body,status,version,received_at,moderated_at,moderation_reason,purged_at";

// An item whose text, details and name were purged (ADR 0103): its facts only.
const purgedItem = (source, row) => ({
  source,
  id: row.id,
  kind: source === "comment" ? "comment" : source === "report" ? "abuse-report" : row.kind,
  status: source === "comment" ? commentState(row.moderation_state, row.status) : row.status,
  version: row.version ?? 1,
  revision: source === "feedback" ? row.item_revision ?? 1 : 1,
  moderatedAt: row.moderated_at ? canonicalTime(row.moderated_at) : null,
  reason: row.moderation_reason ?? null,
  receivedAt: canonicalTime(source === "comment" ? row.created_at : row.received_at),
  work: source === "comment" ? row.path : row.work,
  purgedAt: canonicalTime(row.purged_at),
});

// The item an abuse report names, as moderators see it with the report: never a feedback reader's
// name, and no text once it was purged.
const reportedTarget = (source, row) => {
  if (!row) return null;
  const purged = Boolean(row.purged_at);
  if (source === "comment") {
    return {
      source, id: row.id, kind: "comment", status: commentState(row.moderation_state, row.status), version: row.version ?? 1, revision: 1,
      authorName: purged ? null : row.author_name, body: purged ? null : row.body,
    };
  }
  return { source, id: row.id, kind: row.kind, status: row.status, version: row.version, revision: row.item_revision ?? 1, body: purged ? null : row.body };
};

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
const inboxFeedback = (row) => ({ source: "feedback", ...hostedFeedback(row), ...moderationFacts(row) });
const inboxReport = (row, targets) => ({
  source: "report",
  id: row.id,
  status: row.status,
  version: row.version,
  moderatedAt: row.moderated_at ? canonicalTime(row.moderated_at) : null,
  reason: row.moderation_reason ?? null,
  receivedAt: canonicalTime(row.received_at),
  work: row.work,
  report: { ground: row.ground, body: row.body ?? null },
  target: reportedTarget(row.target_source, targets?.get(`${row.target_source}:${String(row.target_id).toLowerCase()}`)),
});
const inboxItem = (source, row, targets) => {
  if (row.purged_at) return purgedItem(source, row);
  if (source === "comment") return inboxComment(row);
  if (source === "report") return inboxReport(row, targets);
  return inboxFeedback(row);
};

// What a reader sees of their own note by its receipt (ADR 0130): its kind,
// state and version, their own words until they are purged, whether the
// author asked them to clarify it and why, and whether they agreed to be
// asked. Never anything about a moderator.
const receiptView = (row) => {
  const purged = Boolean(row.purged_at);
  const revision = row.item_revision ?? 1;
  const asked = row.status === "clarification" && row.clarification_asked === revision;
  return {
    kind: row.kind,
    status: row.status,
    version: row.version,
    work: row.work,
    receivedAt: canonicalTime(row.received_at),
    clarification: asked ? { reason: row.moderation_reason ?? null } : null,
    consent: row.clarification_consent === true,
    published: row.status === "approved" && row.approved_revision === revision,
    purged,
    ...(purged ? {} : { body: row.body, details: row.details || {} }),
  };
};

// The inbox's keyset cursor (timeKey): a row's own time, to the microsecond,
// in UTC, and its id. Rows of every store are merged in this order.
const CURSOR = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)~([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const INBOX_PAGE = 50;
const INBOX_UNAVAILABLE = "Run supabase/moderation.sql (and supabase/feedback.sql again if you use passage feedback), then set OPENBLOG_MODERATION_ENABLED=true, to take this decision.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEEDBACK_UNAVAILABLE = "Passage feedback is not available on this site. The page itself is unchanged; you can copy your note and send it to the author instead.";
// Engagement protection (ADRs 0130 and 0131).
const PROTECTION_UNAVAILABLE = "This site does not offer receipts or reports through the form. You can write to the author instead.";
const RECEIPT = /^[A-Za-z0-9_-]{43}$/;
const receiptDigest = (receipt) => createHash("sha256").update(receipt).digest("hex");
const RECEIPT_UNKNOWN = "No note matches this receipt. Check that you copied all of it.";
// The audit trail's names for a reader acting by receipt and for the retention job.
const READER_ACTOR = "@reader";
const RETENTION_ACTOR = "@retention";
const MAX_REPORT_CHARS = 1000;
const RETENTION_BATCH = 200;
const DAY_MS = 86_400_000;

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
    // Receipts, abuse reports, deletion and retention (ADR 0131): set only
    // after running supabase/protection.sql, on top of the inbox's schema.
    values.protection = values.moderation && String(env.OPENBLOG_PROTECTION_ENABLED || "").trim() === "true";
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
    const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, ...filters, select: FEEDBACK_COLUMNS, order: "received_at.asc", limit: "200" });
    return database(settings, `/rest/v1/openblog_feedback?${params}`);
  };

  // ---- The moderation inbox (ADRs 0104 and 0105)

  const inboxTable = (source) => (source === "comment" ? "openblog_comments" : source === "report" ? "openblog_abuse_reports" : "openblog_feedback");
  const inboxColumns = (settings, source) => {
    if (source === "report") return REPORT_COLUMNS;
    if (source === "comment") return settings.protection ? COMMENT_PROTECTED_COLUMNS : settings.moderation ? COMMENT_INBOX_COLUMNS : COMMENT_COLUMNS;
    return settings.protection ? FEEDBACK_PROTECTED_COLUMNS : settings.moderation ? FEEDBACK_INBOX_COLUMNS : FEEDBACK_COLUMNS;
  };
  const rowTimeColumn = (source) => (source === "comment" ? "created_at" : "received_at");
  // The items abuse reports name, read with them so a moderator sees what was reported.
  const reportTargets = async (settings, reportRows) => {
    const targets = new Map();
    for (const source of ["comment", "feedback"]) {
      if (source === "feedback" && !settings.feedback) continue;
      const ids = [...new Set(reportRows.filter((row) => row.target_source === source).map((row) => String(row.target_id).toLowerCase()).filter((id) => UUID.test(id)))];
      if (!ids.length) continue;
      const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, id: `in.(${ids.join(",")})`, select: inboxColumns(settings, source) });
      const rows = await database(settings, `/rest/v1/${inboxTable(source)}?${params}`);
      for (const row of Array.isArray(rows) ? rows : []) targets.set(`${source}:${String(row.id).toLowerCase()}`, row);
    }
    return targets;
  };
  // A retention run's cutoffs as Admin sent them (ADR 0131): canonical UTC
  // times, each at least a day before this function's own clock, so no run
  // can reach anything newer whatever it is sent, and an audit cutoff no
  // later than the closed-item cutoff, since audit events are kept at least
  // as long as closed items (ADR 0103); null when any is not.
  const UTC_SECOND = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
  const retentionCutoffs = (input) => {
    const latest = now().getTime() - DAY_MS;
    const cutoffs = { comments: input?.comments === true || input?.comments === "true" };
    const times = {};
    for (const key of ["pendingUntil", "clarificationUntil", "closedUntil", "auditUntil"]) {
      const value = input?.[key];
      const time = typeof value === "string" && UTC_SECOND.test(value) ? Date.parse(value) : Number.NaN;
      if (!Number.isFinite(time) || time > latest) return null;
      cutoffs[key] = value;
      times[key] = time;
    }
    return times.auditUntil > times.closedUntil ? null : cutoffs;
  };
  // One store's rows a run may owe a step, oldest first, at most a batch;
  // retentionStep then decides each exactly.
  const retentionCandidates = async (settings, source, cutoffs) => {
    const time = rowTimeColumn(source);
    const since = (until) => `or(moderated_at.lte."${until}",and(moderated_at.is.null,${time}.lte."${until}"))`;
    const branches = {
      comment: [
        `and(status.eq.pending,${since(cutoffs.pendingUntil)})`,
        `and(status.eq.rejected,purged_at.is.null,${since(cutoffs.closedUntil)})`,
      ],
      feedback: [
        `and(status.eq.pending,${since(cutoffs.pendingUntil)})`,
        `and(status.eq.clarification,${since(cutoffs.clarificationUntil)})`,
        `and(status.in.(rejected,removed),purged_at.is.null,${since(cutoffs.closedUntil)})`,
        "and(status.eq.withdrawn,purged_at.is.null)",
      ],
      report: [
        `and(status.eq.pending,${since(cutoffs.pendingUntil)})`,
        `and(status.in.(rejected,approved),purged_at.is.null,${since(cutoffs.closedUntil)})`,
      ],
    }[source];
    const params = new URLSearchParams({
      site_id: `eq.${settings.siteId}`,
      or: `(${branches.join(",")})`,
      select: inboxColumns(settings, source),
      order: `${time}.asc,id.asc`,
      limit: String(RETENTION_BATCH),
    });
    const rows = await database(settings, `/rest/v1/${inboxTable(source)}?${params}`);
    return Array.isArray(rows) ? rows : [];
  };
  // Audit events recorded at or before the run's audit cutoff: counted for
  // the dry run (at most 10,001 per table), deleted when the run asks.
  const auditDue = async (settings, cutoffs, deleteNow) => {
    const tables = { comment: "openblog_comment_events", ...(settings.feedback ? { feedback: "openblog_feedback_events" } : {}), report: "openblog_abuse_report_events" };
    const counts = {};
    for (const [source, table] of Object.entries(tables)) {
      const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, at: `lte.${cutoffs.auditUntil}`, select: "id" });
      if (!deleteNow) params.set("limit", "10001");
      const rows = await database(settings, `/rest/v1/${table}?${params}`, deleteNow ? { method: "DELETE", headers: { Prefer: "return=representation" } } : {});
      counts[source] = Array.isArray(rows) ? rows.length : 0;
    }
    return counts;
  };
  const inboxItems = async (settings, entries) => {
    const reports = entries.filter((entry) => entry.source === "report").map((entry) => entry.row);
    const targets = reports.length ? await reportTargets(settings, reports) : null;
    return entries.map((entry) => inboxItem(entry.source, entry.row, targets));
  };

  // One store's rows in one state after a cursor, oldest first, at most
  // `limit`. Comments never wait for clarification or are withdrawn, and
  // without the inbox's schema they are only pending, approved or rejected.
  const inboxRows = async (settings, source, { state, kind, after, limit }) => {
    const time = rowTimeColumn(source);
    const conditions = [];
    if (source === "comment") {
      const filter = settings.moderation ? commentStateFilter(state) : null;
      if (filter) conditions.push(filter);
      else if (!settings.moderation && ["pending", "approved", "rejected"].includes(state)) conditions.push(`status.eq.${state}`);
      else return [];
    } else if (source === "report") {
      // Reports are pending, dismissed (rejected) or upheld (approved).
      if (!["pending", "approved", "rejected"].includes(state)) return [];
      conditions.push(`status.eq.${state}`);
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
    const retained = !row.purged_at;
    return {
      kind: source === "comment" ? "comment" : source === "report" ? "abuse-report" : row.kind,
      state: source === "comment" ? commentState(row.moderation_state, row.status) : row.status,
      version: row.version ?? 1,
      revision: source === "feedback" ? row.item_revision ?? 1 : 1,
      clarificationAsked: source === "feedback" ? row.clarification_asked ?? null : null,
      clarificationConsent: row.clarification_consent === true,
      contentRetained: retained,
      retained,
      parent: source === "report" ? String(row.target_id).toLowerCase() : null,
      since: row.moderated_at || row[rowTimeColumn(source)],
    };
  };
  // Apply one planned change, only while the row still has the state and
  // version both Admin and this function saw, with its audit event.
  const applyInboxChange = (settings, source, id, change, version, actor, role) => {
    const at = canonicalTime(now());
    if (settings.moderation) {
      const functionName = { comment: "openblog_moderate_comment", feedback: "openblog_moderate_feedback_item", report: "openblog_moderate_report" }[source];
      return database(settings, `/rest/v1/rpc/${functionName}`, {
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
  // which is read only when the participation manifest is not published,
  // and only for B5's four passage kinds: every other kind, abuse reports
  // among them, is hidden on a site that never published its mode.
  const feedbackPolicy = async (settings, path, kind) => {
    const { value, missing } = await siteManifest(settings, "openblog-participation.json");
    if (missing) return Object.hasOwn(FEEDBACK_KINDS, kind) ? publishedPolicy(settings, "openblog-feedback.json", path) : "hidden";
    const modes = value && Object.hasOwn(value, path) ? value[path] : null;
    const mode = modes && typeof modes === "object" && Object.hasOwn(modes, kind) ? modes[kind] : "";
    return MODES.includes(mode) ? mode : "hidden";
  };

  // The existing Supabase-backed hourly quota, per client (or per `subject`,
  // such as a reported item or a repeated submission) and per site. The
  // stored digest mixes in the hour, so no row links one hour's requests to
  // another's, and the address itself is never stored (ADR 0131).
  const quotaWindow = (settings, bucket, subject) => {
    const hour = now().toISOString().slice(0, 13) + ":00:00Z";
    return { bucket, hour, digest: createHash("sha256").update(`${settings.salt}\0${bucket}\0${hour}\0${subject}`).digest("hex") };
  };
  const consumeWindow = async (settings, { bucket, hour, digest }, subjectLimit, siteLimit) => {
    const allowed = await database(settings, "/rest/v1/rpc/openblog_consume_rate_limit", {
      method: "POST",
      body: JSON.stringify({ p_site_id: settings.siteId, p_bucket: bucket, p_window_start: hour, p_subject_hash: digest, p_subject_limit: subjectLimit, p_site_limit: siteLimit }),
    });
    return Boolean(allowed?.allowed ?? allowed);
  };
  const consumeQuota = (settings, event, bucket, subjectLimit, siteLimit, subject = null) => {
    const address = String(event.headers?.["x-nf-client-connection-ip"] || "").trim();
    return consumeWindow(settings, quotaWindow(settings, bucket, subject ?? address), subjectLimit, siteLimit);
  };
  // A replay bound (ADR 0131): the same submission from the same client is
  // taken once an hour. Only a digest of it is kept, for the hour. It
  // answers null when the submission was already taken this hour, or else
  // the claim on it, which `storedOnce` releases when storing the submission
  // fails, so a reader who retries is never told it was already sent.
  const firstTimeThisHour = async (settings, event, bucket, parts) => {
    const address = String(event.headers?.["x-nf-client-connection-ip"] || "").trim();
    const window = quotaWindow(settings, `${bucket}-repeat`, [address, ...parts].join("\0"));
    return await consumeWindow(settings, window, 1, 1_000_000) ? window : null;
  };
  const storedOnce = async (settings, claim, store) => {
    try {
      return await store();
    } catch (error) {
      if (claim) {
        const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, bucket: `eq.${claim.bucket}`, window_start: `eq.${claim.hour}`, subject_hash: `eq.${claim.digest}` });
        await database(settings, `/rest/v1/openblog_rate_limits?${params}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => null);
      }
      throw error;
    }
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
        const claim = settings.protection ? await firstTimeThisHour(settings, event, "comments", [path, authorName, commentBody]) : null;
        if (settings.protection && !claim) {
          return json(409, { error: "This comment was already sent and is waiting for review.", code: "duplicate" }, corsOrigin);
        }
        const rows = await storedOnce(settings, claim, () => database(settings, "/rest/v1/openblog_comments?select=id,status,created_at", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ site_id: settings.siteId, path, author_name: authorName, body: commentBody, status: "pending" }),
        }));
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
        const claim = settings.protection ? await firstTimeThisHour(settings, event, "feedback", [submission.work, submission.kind, JSON.stringify(submission.target), submission.body]) : null;
        if (settings.protection && !claim) {
          return json(409, { error: "This note was already sent and is waiting for review.", code: "duplicate" }, corsOrigin);
        }
        // The receiver stamps the time; the reader's clock is only seenAt.
        const record = receiveFeedback(submission, canonicalTime(now()), "hosted");
        const { provenance } = record;
        // A private receipt (ADR 0130): returned to the reader once, kept
        // only as its digest.
        const receipt = settings.protection && issuesReceipts(record.kind) ? randomBytes(32).toString("base64url") : null;
        const rows = await storedOnce(settings, claim, () => database(settings, "/rest/v1/openblog_feedback?select=id,status,received_at", {
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
            ...(receipt ? { receipt_hash: receiptDigest(receipt) } : {}),
          }),
        }));
        return json(202, { id: rows[0]?.id, status: "pending", receivedAt: provenance.receivedAt, ...(receipt ? { receipt } : {}) }, corsOrigin);
      }
      if (operation === "receipt" || operation === "reports") {
        if (!settings.protection || (operation === "receipt" && !settings.feedback)) return json(404, { error: PROTECTION_UNAVAILABLE, code: "unavailable" }, corsOrigin);
        if (event.httpMethod !== "POST") return json(405, { error: "Use POST." }, corsOrigin);
      }
      if (operation === "receipt") {
        // A reader acting on their own note by its private receipt (ADR
        // 0130): read it, answer a clarification request, agree to be asked,
        // or withdraw and delete it. The receipt is the only proof; nothing
        // identifies the reader, and nothing is e-mailed.
        const receipt = typeof body.receipt === "string" ? body.receipt : "";
        if (!RECEIPT.test(receipt)) return json(404, { error: RECEIPT_UNKNOWN, code: "unknownReceipt" }, corsOrigin);
        if (!await consumeQuota(settings, event, "receipts", 30, 3000)) return json(429, { error: "Too many requests from here. Please try again later.", code: "rateLimited" }, corsOrigin);
        const lookup = async () => {
          const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, receipt_hash: `eq.${receiptDigest(receipt)}`, select: FEEDBACK_PROTECTED_COLUMNS });
          const rows = await database(settings, `/rest/v1/openblog_feedback?${params}`);
          return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
        };
        const row = await lookup();
        if (!row) return json(404, { error: RECEIPT_UNKNOWN, code: "unknownReceipt" }, corsOrigin);
        const action = body.action ?? "read";
        if (action === "read") return json(200, { item: receiptView(row) }, corsOrigin);
        const version = body.expectedVersion;
        if (!Number.isInteger(version) || version < 1 || version > 2147483647) return json(422, { error: "Reload your note and try again.", code: "invalid" }, corsOrigin);
        const facts = inboxFacts("feedback", row);
        const answered = (rows) => (Array.isArray(rows) && rows.length === 1
          ? json(200, { item: receiptView(rows[0]) }, corsOrigin)
          : lookup().then((current) => json(409, { error: "Your note changed since you loaded it. Review it again.", code: "conflict", item: current ? receiptView(current) : null }, corsOrigin)));
        if (version !== facts.version) return answered([]);
        if (action === "withdraw") {
          const plan = planErasure(facts, "submitter", version);
          if (!plan.ok) return json(plan.code === "stale" ? 409 : 422, { error: "This note cannot be withdrawn now.", code: plan.code, item: receiptView(row) }, corsOrigin);
          return answered(await database(settings, "/rest/v1/rpc/openblog_erase_feedback", {
            method: "POST",
            body: JSON.stringify({ p_site_id: settings.siteId, p_id: row.id, p_expected_version: version, p_withdraw: plan.withdraw, p_actor: READER_ACTOR, p_actor_role: "submitter", p_at: canonicalTime(now()) }),
          }));
        }
        if (action === "consent") {
          if (typeof body.consent !== "boolean" || facts.state !== "pending" || !facts.retained) {
            return json(422, { error: "You can change this only while your note is waiting for review.", code: "notAllowed" }, corsOrigin);
          }
          const params = new URLSearchParams({ site_id: `eq.${settings.siteId}`, id: `eq.${row.id}`, receipt_hash: `eq.${receiptDigest(receipt)}`, status: "eq.pending", version: `eq.${version}`, purged_at: "is.null", select: FEEDBACK_PROTECTED_COLUMNS });
          return answered(await database(settings, `/rest/v1/openblog_feedback?${params}`, {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ clarification_consent: body.consent }),
          }));
        }
        if (action === "clarify") {
          const plan = planTransition(facts, { action: "clarify", expectedVersion: version, role: "submitter" });
          if (!plan.ok) return json(plan.code === "stale" ? 409 : 422, { error: "Your note is not waiting for clarification.", code: plan.code, item: receiptView(row) }, corsOrigin);
          // The answer is read exactly as a new submission about the same
          // passage would be, so it meets every rule the first one did.
          const read = readFeedbackSubmissionJson(JSON.stringify({
            version: 1, kind: row.kind, work: row.work, revision: row.revision, target: row.target, body: body.body,
            ...(body.details && typeof body.details === "object" ? { details: body.details } : {}),
          }));
          if (!read.ok) return json(422, { error: read.error.message, code: read.error.code }, corsOrigin);
          return answered(await database(settings, "/rest/v1/rpc/openblog_moderate_feedback_item", {
            method: "POST",
            body: JSON.stringify({
              p_site_id: settings.siteId, p_id: row.id, p_expected_version: version, p_from: "clarification", p_to: "pending", p_action: "clarify",
              p_reason: null, p_actor: READER_ACTOR, p_actor_role: "submitter", p_at: canonicalTime(now()), p_body: read.submission.body, p_details: read.submission.details,
            }),
          }));
        }
        return json(422, { error: "Choose to read, clarify, agree to be asked, or withdraw your note.", code: "invalid" }, corsOrigin);
      }
      if (operation === "reports") {
        // An abuse report (ADR 0130): accepted only for an item that is
        // public now, answering `unavailable` exactly as for one that does
        // not exist. It never changes the item, is never public and never
        // counted, and names nobody.
        const source = body.source === "comment" || (body.source === "feedback" && settings.feedback) ? body.source : "";
        const id = String(body.id || "").toLowerCase();
        const ground = typeof body.ground === "string" ? body.ground : "";
        const text = body.body === undefined || body.body === null ? "" : String(body.body).trim();
        if (!source || !UUID.test(id) || !REPORT_GROUNDS.includes(ground) || Array.from(text).length > MAX_REPORT_CHARS || /[\u0000-\u0008\u000B\u000C\u000E-\u001F‪-‮⁦-⁩]/.test(text)) {
          return json(422, { error: "Choose why you are reporting it, and write at most 1,000 characters.", code: "invalid" }, corsOrigin);
        }
        const unavailable = () => json(404, { error: "This item cannot be reported.", code: "unavailable" }, corsOrigin);
        const target = await inboxRow(settings, source, id);
        if (!target) return unavailable();
        const facts = inboxFacts(source, target);
        const work = source === "comment" ? target.path : target.work;
        const shown = source === "comment"
          ? facts.state === "approved" && await commentPolicy(settings, work) !== "hidden"
          : facts.state === "approved" && target.approved_revision === facts.revision && facts.clarificationAsked !== facts.revision && await feedbackPolicy(settings, work, facts.kind) !== "hidden";
        if (!facts.retained || !shown) return unavailable();
        const mode = await feedbackPolicy(settings, work, "abuse-report");
        if (mode !== "open") return unavailable();
        if (!await consumeQuota(settings, event, "reports", 5, 500)) return json(429, { error: "Too many reports from here. Please try again later.", code: "rateLimited" }, corsOrigin);
        // One item can be reported only so often an hour, and the same report from the same place once.
        if (!await consumeQuota(settings, event, "reports-item", 20, 500, `${source}:${id}`)) return json(202, { status: "pending" }, corsOrigin);
        const claim = await firstTimeThisHour(settings, event, "reports", [source, id]);
        if (!claim) return json(202, { status: "pending" }, corsOrigin);
        await storedOnce(settings, claim, () => database(settings, "/rest/v1/openblog_abuse_reports?select=id", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ site_id: settings.siteId, target_source: source, target_id: id, work, ground, body: text || null, status: "pending", received_at: canonicalTime(now()) }),
        }));
        return json(202, { status: "pending" }, corsOrigin);
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
        const protocol = settings.protection ? "protected" : settings.moderation ? "full" : "legacy";
        const sourceOf = (value) => (value === "comment" || (value === "feedback" && settings.feedback) || (value === "report" && settings.protection) ? value : "");
        if (event.httpMethod === "GET") {
          if (query.id !== undefined) {
            const source = sourceOf(query.source);
            if (!UUID.test(String(query.id)) || !source) return json(422, { error: "Name an item by its source and id." }, corsOrigin);
            const row = await inboxRow(settings, source, String(query.id).toLowerCase());
            return json(200, { protocol, items: row ? await inboxItems(settings, [{ source, row }]) : [], next: null }, corsOrigin);
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
          if (settings.protection && (!kind || kind === "abuse-report")) sources.push("report");
          // Each store's first `limit + 1` rows after the cursor; merged, the
          // first `limit` are this page's, oldest first.
          const merged = (await Promise.all(sources.map((source) => inboxRows(settings, source, { state, kind, after, limit: limit + 1 }))))
            .flat()
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          const page = merged.slice(0, limit);
          const last = page.at(-1);
          return json(200, {
            protocol,
            items: await inboxItems(settings, page),
            next: merged.length > limit && last ? `${last.key}~${last.id}` : null,
          }, corsOrigin);
        }
        if (event.httpMethod === "PATCH") {
          const source = sourceOf(body.source);
          const id = String(body.id || "").toLowerCase();
          const version = body.expectedVersion;
          const role = body.actorRole === undefined ? "site-admin" : body.actorRole;
          const protectedAction = settings.protection && (body.action === "erase" || (body.action === "uphold-report" && source === "report"));
          if (!source || !UUID.test(id) || !Number.isInteger(version) || version < 1 || version > 2147483647 || !MODERATION_STATES.includes(body.from)
            || !(INBOX_ACTIONS.includes(body.action) || protectedAction) || !MODERATOR_ROLES.includes(role)) {
            return json(422, { error: "Invalid moderation change.", code: "invalid" }, corsOrigin);
          }
          const row = await inboxRow(settings, source, id);
          if (!row) return json(404, { error: "No such item.", code: "notFound" }, corsOrigin);
          const facts = inboxFacts(source, row);
          const itemOf = async (current) => (await inboxItems(settings, [{ source, row: current }]))[0];
          const conflict = async (current) => json(409, { error: "This item changed since you loaded it. Review it again before acting.", code: "conflict", item: await itemOf(current) }, corsOrigin);
          if (facts.state !== body.from || facts.version !== version) return conflict(row);
          const refused = (code) => json(code === "denied" ? 403 : 422, { error: "This moderation change is not allowed.", code }, corsOrigin);
          const changed = async (rows) => {
            if (Array.isArray(rows) && rows.length === 1) return json(200, { ok: true, item: await itemOf(rows[0]) }, corsOrigin);
            const current = await inboxRow(settings, source, id);
            if (!current) return json(404, { error: "No such item.", code: "notFound" }, corsOrigin);
            return conflict(current);
          };
          if (body.action === "erase") {
            // A deletion request taken by the site Admin (ADR 0130).
            const plan = planErasure(facts, role, version);
            if (!plan.ok) return plan.code === "stale" ? conflict(row) : refused(plan.code);
            const at = canonicalTime(now());
            const actor = auditActor(body.actor);
            if (source === "feedback") {
              return changed(await database(settings, "/rest/v1/rpc/openblog_erase_feedback", {
                method: "POST",
                body: JSON.stringify({ p_site_id: settings.siteId, p_id: id, p_expected_version: version, p_withdraw: false, p_actor: actor, p_actor_role: role, p_at: at }),
              }));
            }
            return changed(await database(settings, `/rest/v1/rpc/${source === "comment" ? "openblog_purge_comment" : "openblog_purge_report"}`, {
              method: "POST",
              body: JSON.stringify({ p_site_id: settings.siteId, p_id: id, p_expected_version: version, p_actor: actor, p_actor_role: role, p_at: at }),
            }));
          }
          if (body.action === "uphold-report") {
            // Upheld with the item the report names, exactly as Admin saw it
            // (ADR 0103): removed in the same transaction while approved.
            const targetSource = row.target_source;
            const target = targetSource === "comment" || (targetSource === "feedback" && settings.feedback) ? await inboxRow(settings, targetSource, String(row.target_id).toLowerCase()) : null;
            const targetFacts = target ? inboxFacts(targetSource, target) : null;
            if ((targetFacts ? targetFacts.version : null) !== (body.targetVersion ?? null)) return conflict(row);
            const plan = planUphold(facts, target ? { id: String(target.id).toLowerCase(), state: targetFacts.state, version: targetFacts.version } : null, { role, reason: body.reason, expectedVersion: version });
            if (!plan.ok) return plan.code === "stale" ? conflict(row) : refused(plan.code);
            const result = await database(settings, "/rest/v1/rpc/openblog_uphold_report", {
              method: "POST",
              body: JSON.stringify({
                p_site_id: settings.siteId, p_id: id, p_expected_version: version, p_target_version: plan.removal ? targetFacts.version : null,
                p_reason: plan.change.reason, p_actor: auditActor(body.actor), p_actor_role: role, p_at: canonicalTime(now()),
              }),
            });
            if (!result || typeof result !== "object" || !result.report) {
              const current = await inboxRow(settings, source, id);
              return current ? conflict(current) : json(404, { error: "No such item.", code: "notFound" }, corsOrigin);
            }
            const removed = result.target && typeof result.target === "object" ? (await inboxItems(settings, [{ source: targetSource, row: result.target }]))[0] : null;
            return json(200, { ok: true, item: await itemOf(result.report), removed }, corsOrigin);
          }
          // Decided again here, from the stored row, before anything is written.
          const plan = planTransition(facts, { action: body.action, expectedVersion: version, reason: body.reason, role });
          if (!plan.ok) {
            if (plan.code === "stale") return conflict(row);
            return refused(plan.code);
          }
          if (!settings.moderation && !legacySupports(facts.kind, body.action)) {
            return json(422, { error: INBOX_UNAVAILABLE, code: "notAllowed" }, corsOrigin);
          }
          return changed(await applyInboxChange(settings, source, id, plan.change, version, auditActor(body.actor), role));
        }
      }
      if (operation === "admin/retention") {
        // The retention job (ADRs 0103 and 0131), run by the site Admin from
        // Admin: GET is its dry run, the items due and the audit events old
        // enough to delete; POST applies exactly the items Admin confirmed,
        // each only while it is still as it was and still due. Nothing runs
        // on its own, and comments are touched only when Admin says the site
        // opted them in.
        if (!admin) return json(401, { error: "Admin authorization is required." }, corsOrigin);
        if (!settings.protection) return json(404, { error: "Run supabase/protection.sql and set OPENBLOG_PROTECTION_ENABLED=true to run retention.", code: "unavailable" }, corsOrigin);
        const input = event.httpMethod === "GET" ? query : body;
        const cutoffs = retentionCutoffs(input);
        if (!cutoffs) return json(422, { error: "Send the run's cutoffs, each at least a day in the past, with audit events kept at least as long as closed items.", code: "invalid" }, corsOrigin);
        const sources = [...(cutoffs.comments ? ["comment"] : []), ...(settings.feedback ? ["feedback"] : []), "report"];
        if (event.httpMethod === "GET") {
          const due = [];
          let truncated = false;
          for (const source of sources) {
            const rows = await retentionCandidates(settings, source, cutoffs);
            truncated ||= rows.length >= RETENTION_BATCH;
            for (const row of rows) {
              const step = retentionStep(inboxFacts(source, row), cutoffs);
              if (step) due.push({ source, row, step });
            }
          }
          // Facts are enough here: a report's item is not read for the dry run.
          return json(200, {
            protocol: "protected",
            items: due.map(({ source, row, step }) => ({ ...inboxItem(source, row, null), step })),
            audit: await auditDue(settings, cutoffs, false),
            truncated,
          }, corsOrigin);
        }
        if (event.httpMethod === "POST") {
          const wanted = Array.isArray(body.items) ? body.items : null;
          if (!wanted || wanted.length > RETENTION_BATCH || !wanted.every((item) => sources.includes(item?.source) && UUID.test(String(item.id || "")) && Number.isInteger(item.version) && ["expire", "purge-content"].includes(item.step))) {
            return json(422, { error: "Send at most 200 items the dry run listed.", code: "invalid" }, corsOrigin);
          }
          const done = { expired: 0, purged: 0, skipped: 0 };
          const at = canonicalTime(now());
          for (const item of wanted) {
            const id = String(item.id).toLowerCase();
            const row = await inboxRow(settings, item.source, id);
            const facts = row ? inboxFacts(item.source, row) : null;
            if (!facts || facts.version !== item.version || retentionStep(facts, cutoffs) !== item.step) {
              done.skipped += 1;
              continue;
            }
            let rows;
            if (item.step === "expire") {
              const change = { action: "expire", from: facts.state, to: "rejected", reason: "expired" };
              rows = await applyInboxChange(settings, item.source, id, change, facts.version, RETENTION_ACTOR, "system");
            } else if (item.source === "feedback") {
              rows = await database(settings, "/rest/v1/rpc/openblog_erase_feedback", {
                method: "POST",
                body: JSON.stringify({ p_site_id: settings.siteId, p_id: id, p_expected_version: facts.version, p_withdraw: false, p_actor: RETENTION_ACTOR, p_actor_role: "system", p_at: at }),
              });
            } else {
              rows = await database(settings, `/rest/v1/rpc/${item.source === "comment" ? "openblog_purge_comment" : "openblog_purge_report"}`, {
                method: "POST",
                body: JSON.stringify({ p_site_id: settings.siteId, p_id: id, p_expected_version: facts.version, p_actor: RETENTION_ACTOR, p_actor_role: "system", p_at: at }),
              });
            }
            if (Array.isArray(rows) && rows.length === 1) done[item.step === "expire" ? "expired" : "purged"] += 1;
            else done.skipped += 1;
          }
          const audit = body.audit === true ? await auditDue(settings, cutoffs, true) : null;
          console.info(`open.blog engagement: retention expired ${done.expired}, purged ${done.purged}, skipped ${done.skipped}`);
          return json(200, { ok: true, ...done, auditDeleted: audit }, corsOrigin);
        }
        return json(405, { error: "Use GET for the dry run and POST to run it." }, corsOrigin);
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
        if (!await consumeQuota(settings, event, "analytics", 120, 20000, address)) return json(429, { error: "Analytics rate limit reached." }, corsOrigin);
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
