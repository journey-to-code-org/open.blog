// Operations of optional scheduled social publishing (epic #353, story #359, ADR 0701): redacted
// logs, queue health and backlog alerts, the sweep of expired leases and abandoned handshakes, and
// opt-in retention. Server-only, behind the site scope of ADR 0293.
//
// Everything here is off unless the deployment asks for it:
//   OPENBLOG_SOCIAL_OPS=true                 supabase/social-ops.sql is installed: each worker run
//                                            sweeps, checks health and logs backlog alerts
//   OPENBLOG_SOCIAL_RETENTION_DAYS=<30-3650> each run also deletes history older than that
//   OPENBLOG_SOCIAL_BACKLOG_ALERT_MINUTES    how late an announcement is before it is an alert (default 15)
//
// A log line is built only from an allow-list of shapes (whole numbers, true/false and short codes),
// so a token, a caption, a name, an address or anything a provider or the database said cannot reach
// a log however it was passed in. Storage is PostgREST over `fetchImpl`; a storage reply never
// reaches an error.

import { SocialScopeError } from "./social-scope.mjs";

const CODE = /^[a-z][a-z0-9-]{0,39}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;

export const OPS_DEFAULTS = Object.freeze({ overdueMinutes: 15, pruneBatch: 200 });

/** The operations settings. A value out of range is ignored and named in `problems` (never its value). */
export function opsPolicy(env = {}) {
  const problems = [];
  const read = (name, low, high) => {
    const raw = String(env[name] ?? "").trim();
    if (!raw) return null;
    const number = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
    if (Number.isInteger(number) && number >= low && number <= high) return number;
    problems.push(name);
    return null;
  };
  const enabled = String(env.OPENBLOG_SOCIAL_OPS ?? "").trim() === "true";
  const retentionDays = read("OPENBLOG_SOCIAL_RETENTION_DAYS", 30, 3650);
  const overdueMinutes = read("OPENBLOG_SOCIAL_BACKLOG_ALERT_MINUTES", 1, 1440) ?? OPS_DEFAULTS.overdueMinutes;
  // Retention needs the functions social-ops.sql installs; asking for it alone is a setup problem.
  if (retentionDays !== null && !enabled) problems.push("OPENBLOG_SOCIAL_RETENTION_DAYS");
  return Object.freeze({
    enabled,
    retentionDays: enabled ? retentionDays : null,
    overdueMinutes,
    problems: Object.freeze([...new Set(problems)]),
  });
}

// ------------------------------------------------------------------ redaction

const safeValue = (value, depth) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (typeof value === "string") return CODE.test(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && CODE.test(item)).slice(0, 20);
  }
  if (value && typeof value === "object" && depth < 2) return redact(value, depth + 1);
  return undefined;
};

/**
 * The fields of `value` that are safe to log: keys that are plain words, values that are whole
 * numbers, booleans, short codes, lists of short codes, or objects of the same (two levels).
 * Everything else is dropped silently.
 */
export function redact(value, depth = 0) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, inner] of Object.entries(value)) {
    if (!KEY.test(key)) continue;
    const kept = safeValue(inner, depth);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

/** Writes one JSON line: `{"event": ..., ...redacted fields}`. A warning goes to `sink.warn`. */
export function logEvent(event, fields = {}, { sink = console, level = "info" } = {}) {
  if (!CODE.test(event)) return null;
  const line = JSON.stringify({ event, ...redact(fields) });
  try {
    (level === "warn" ? sink.warn : sink.log).call(sink, line);
  } catch {
    // A log that cannot be written must never break delivery.
  }
  return line;
}

// ------------------------------------------------------------------ health

const HEALTH_FIELDS = Object.freeze({
  due: "due",
  overdue: "overdue",
  processing: "processing",
  expired_leases: "expiredLeases",
  retrying: "retrying",
  unknown_waiting: "unknownWaiting",
  needs_review: "needsReview",
  failed_recently: "failedRecently",
  accounts_need_reconnect: "accountsNeedReconnect",
  accounts_paused: "accountsPaused",
  stale_connections: "staleConnections",
});

/** Fixed alert codes for a health reading, most urgent first. */
export function alertsOf(health) {
  if (!health || health.installed !== true) return [];
  const alerts = [];
  if (health.overdue > 0) alerts.push("backlog-overdue");
  if (health.expiredLeases > 0) alerts.push("expired-leases");
  if (health.accountsNeedReconnect > 0) alerts.push("accounts-need-reconnect");
  if (health.needsReview > 0) alerts.push("needs-review");
  if (health.failedRecently > 0) alerts.push("failed-recently");
  if (health.staleConnections > 0) alerts.push("stale-connections");
  return alerts;
}

const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const instant = (value) => {
  const ms = Date.parse(value);
  return value && Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
};

export class OpsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OpsError";
    this.code = code;
  }
}

export function createOps({ settings, fetchImpl = globalThis.fetch, policy = opsPolicy({}) } = {}) {
  if (!settings || settings.enabled !== true) throw new SocialScopeError(404, "not-enabled", "Social publishing is not enabled.");

  // An RPC call. A function PostgREST does not know (social-ops.sql not run) is `null`.
  const rpc = async (name, body) => {
    let response;
    try {
      response = await fetchImpl(`${settings.url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: settings.key, authorization: `Bearer ${settings.key}`, "content-type": "application/json" },
        body: JSON.stringify({ p_site_id: settings.siteId, ...body }),
      });
    } catch {
      throw new OpsError("storage-unavailable", "The queue could not be reached.");
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new OpsError("storage-failed", "The queue refused the request.");
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) throw new OpsError("storage-failed", "The queue sent an answer that could not be read.");
    return rows;
  };

  return {
    policy,

    /** Counts only. `{ installed: false }` when social-ops.sql has not been run. */
    async health() {
      const rows = await rpc("openblog_social_health", { p_overdue_seconds: policy.overdueMinutes * 60 });
      if (rows === null) return { installed: false, overdueMinutes: policy.overdueMinutes, alerts: [] };
      const row = rows[0] || {};
      const health = { installed: true, overdueMinutes: policy.overdueMinutes, oldestDueAt: instant(row.oldest_due_at) };
      for (const [column, field] of Object.entries(HEALTH_FIELDS)) health[field] = count(row[column]);
      health.alerts = alertsOf(health);
      return health;
    },

    /** Reaps expired leases and expires abandoned handshakes. `null` when not installed. */
    async sweep({ maxAttempts = 5 } = {}) {
      const rows = await rpc("openblog_social_sweep", { p_max_attempts: maxAttempts });
      if (rows === null) return null;
      return { reaped: count(rows[0]?.reaped), expiredConnections: count(rows[0]?.expired_connections) };
    },

    /** Deletes history older than the retention period, one bounded batch. `null` when off or not installed. */
    async prune() {
      if (policy.retentionDays === null) return null;
      const rows = await rpc("openblog_social_prune", { p_keep_days: policy.retentionDays, p_limit: OPS_DEFAULTS.pruneBatch });
      if (rows === null) return null;
      const row = rows[0] || {};
      return { posts: count(row.posts), attempts: count(row.attempts), connections: count(row.connections), accounts: count(row.accounts) };
    },
  };
}

/**
 * What a worker run does after delivery when operations are on: sweep, read health, prune, and log
 * one line (a warning when there is an alert). Never throws: an operations failure is reported as a
 * code and delivery is unaffected.
 */
export async function afterRun(ops, { maxAttempts, sink = console } = {}) {
  const report = { alerts: [] };
  try {
    const swept = await ops.sweep({ maxAttempts });
    if (swept === null) {
      report.error = "ops-not-installed";
    } else {
      report.swept = swept;
      const health = await ops.health();
      report.health = health;
      report.alerts = health.alerts;
      const pruned = await ops.prune();
      if (pruned) report.pruned = pruned;
    }
  } catch (error) {
    report.error = error instanceof OpsError ? error.code : "ops-failed";
  }
  const { oldestDueAt: _hidden, ...counts } = report.health || {};
  logEvent("openblog-social-ops", { ...report, health: report.health ? counts : undefined }, { sink, level: report.alerts.length || report.error ? "warn" : "info" });
  return report;
}
