// How readers reach you, as rules: whether comments are working, what the key's state is, the
// request that saves the connection (never a key unless it is being replaced), the setup checklist
// (never "yes" for what it can't tell), what the old-notes check says and the request that runs it.
// DOM-free, tested. Studio R10; docs/specs/studio/r10/ux.md, "How readers reach you".
import { say } from "./words.js";
import { KINDS, kindFilterWords, readerWords } from "./reader-rules.js";

/**
 * The state line: `{ id }` for one of four sentences. `meta` says whether comments are set up at all;
 * `settings` is the server's answer (or null when it couldn't be read).
 */
export function setupState(settings, meta = {}) {
  if (!meta.engagementSetUp && !meta.engagement && !settings?.enabled) return { id: "readers.setupNotSetUp", helper: "canTurnOn" };
  if (settings && settings.comments === false) return { id: "readers.setupOff" };
  if (meta.engagement !== true) return { id: "readers.setupNotWorking", helper: "tell" };
  return { id: "readers.setupWorking" };
}

/** The state line in words, with who to ask when something is wrong. */
export function setupStateWords(state) {
  const words = readerWords(state.id);
  return state.helper === "tell" ? `${words} ${say("common.tell")}` : state.helper === "canTurnOn" ? `${words} ${say("common.canTurnOn")}` : words;
}

/** The four sentences about the key. Never says what the key is. */
export function keyStatus(credential) {
  if (credential?.source === "environment") {
    return credential.boundToEndpoint
      ? say("readers.connKeyEnv", { name: credential.environmentName || "OPENBLOG_ENGAGEMENT_API_KEY" })
      : say("readers.connKeyEnvOrigin", { name: credential.originEnvironmentName || "OPENBLOG_ENGAGEMENT_API_ORIGIN" });
  }
  if (credential?.configured) return say("readers.connKeySaved");
  if (credential?.privateConfigured) return say("readers.connKeyOther");
  return say("readers.connKeyNone");
}

const httpsAddress = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.host) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
};

/** What is wrong with the connection form before it is sent, as `{ field, id }`, or null. */
export function setupProblem(form) {
  const endpoint = String(form.endpoint ?? "").trim().replace(/\/+$/, "");
  if (form.enabled && !httpsAddress(endpoint)) return { field: "endpoint", id: "readers.connBadAddress" };
  const key = String(form.credential ?? "").trim();
  if (form.credentialAction === "replace") {
    if (!key || key.length > 16 * 1024) return { field: "credential", id: "readers.connBadKey" };
    if (!httpsAddress(endpoint)) return { field: "endpoint", id: "readers.connNeedAddress" };
  }
  if (form.captcha?.provider === "turnstile" && !String(form.captcha.siteKey ?? "").trim()) return { field: "siteKey", id: "readers.connNeedSiteKey" };
  return null;
}

/**
 * The body that saves the settings: everything the server shows (so nothing is dropped) with the
 * changes on top. A key is in it only when `credentialAction` is "replace"; the server's version is
 * sent back as `etag`, so a change made elsewhere is refused, never overwritten.
 */
export function settingsRequest(settings, form = {}) {
  const body = {
    enabled: form.enabled ?? settings.enabled,
    comments: form.comments ?? settings.comments !== false,
    analytics: form.analytics ?? settings.analytics,
    endpoint: String(form.endpoint ?? settings.endpoint ?? "").trim().replace(/\/+$/, ""),
    etag: settings.etag,
    credentialAction: form.credentialAction || "keep",
  };
  if (typeof settings.feedback === "boolean") body.feedback = settings.feedback;
  const captcha = form.captcha ?? settings.captcha;
  if (captcha) body.captcha = { provider: captcha.provider || "", scope: captcha.scope || "", siteKey: String(captcha.siteKey || "").trim() };
  if (body.credentialAction === "replace") body.credential = String(form.credential ?? "").trim();
  return body;
}

/** The robot check as one line for her layer, or "" when it is off. */
export function robotLine(settings) {
  const captcha = settings?.captcha;
  if (!captcha?.provider) return "";
  return captcha.scope === "every-comment" ? say("readers.setupRobotsEvery") : say("readers.setupRobots");
}

/** The kinds the site takes, each as its filter name, for her list; `[]` until the server says. */
export function kindsList(settings) {
  const on = new Set((settings?.kinds || []).filter((k) => k.setting !== "off").map((k) => k.id));
  return KINDS.filter((k) => k.id !== "comment" && on.has(k.id)).map((k) => kindFilterWords(k.id));
}

/**
 * The setup checklist, each `{ id, state: true | false | null, vars }` with its words. What can't be
 * told is `null` ("Can't tell"), never yes. `health` is the server's check (or null); `meta` is Studio's.
 */
export function setupChecklist(settings, health, meta = {}) {
  const checks = new Map((health?.checks || []).map((c) => [c.id, c.ok]));
  const from = (id) => (checks.has(id) ? checks.get(id) : null);
  // The tables this site's settings need: yes only when each the server checked is there, no when one is
  // missing, can't tell when none was checked or one didn't answer.
  const tables = (known) => {
    const seen = ["comments", "feedback", "moderation", "protection"].filter((id) => known.has(id)).map((id) => known.get(id));
    if (seen.includes(false)) return false;
    return seen.length && seen.every((ok) => ok === true) ? true : null;
  };
  const rows = [
    { id: "readers.checkAddress", state: settings ? httpsAddress(String(settings.endpoint || "")) : null },
    { id: "readers.checkKey", state: settings ? Boolean(settings.credential?.configured) : null },
    { id: "readers.checkAnswers", state: from("service") },
    { id: "readers.checkTables", state: tables(checks) },
    { id: "readers.checkVars", state: null, vars: { names: "SUPABASE_URL, SUPABASE_SECRET_KEY, OPENBLOG_SITE_ID, OPENBLOG_SITE_ORIGIN, OPENBLOG_ADMIN_API_KEY, OPENBLOG_ANALYTICS_SALT" } },
    { id: "readers.checkBuilt", state: null },
  ];
  return rows.map((r) => ({ ...r, vars: r.vars || {}, mark: r.state === true ? "✓" : r.state === false ? "✗" : "?" }));
}

/** One checklist row in words. */
export function checkWords(row) {
  const state = row.state === true ? say("readers.checkYes") : row.state === false ? say("readers.checkNo") : say("readers.checkUnknown");
  const what = row.id === "readers.checkAddress" ? say("readers.checkAddress")
    : row.id === "readers.checkKey" ? say("readers.checkKey")
      : row.id === "readers.checkAnswers" ? say("readers.checkAnswers")
        : row.id === "readers.checkTables" ? say("readers.checkTables")
          : row.id === "readers.checkVars" ? say("readers.checkVars", row.vars) : say("readers.checkBuilt");
  return say("readers.checkRow", { state, what });
}

// ---- old notes -----------------------------------------------------------------------------------

/** What the dry run says, in her words, one string each. */
export function retentionLines(report) {
  const lines = (report?.summary || []).map((entry) => {
    const kind = String(entry.kindLabel || entry.kind || "").toLowerCase();
    if (entry.step === "expire") return say("readers.oldExpire", { n: entry.count, kind, days: report.periods?.pendingDays ?? "" });
    if (entry.step === "scrub-identity") return say("readers.oldScrub", { n: entry.count, kind });
    return say("readers.oldPurge", { n: entry.count, kind });
  });
  const records = Object.values(report?.audit || {}).reduce((total, count) => total + (Number(count) || 0), 0);
  if (records) lines.push(say("readers.oldRecords", { n: records, days: report.periods?.auditDays ?? "" }));
  if (!lines.length) lines.push(say("readers.oldNone"));
  if (!report?.periods?.comments) lines.push(say("readers.oldCommentsKept"));
  if (report?.truncated) lines.push(say("readers.oldMore"));
  return lines;
}

/** How many notes the run would touch (what the dialog says); records of decisions are not notes. */
export const retentionCount = (report) => (report?.summary || []).reduce((total, entry) => total + (Number(entry.count) || 0), 0);

/** The body that runs exactly the dry run: its `asOf` and whether old records of decisions go too. */
export const retentionRequest = (report, audit = true) => ({ asOf: report.asOf, audit: Boolean(audit) });

/** What a run did, in words. */
export function retentionDone(result) {
  const closed = Number(result.expired) || 0;
  const deleted = (Number(result.purged) || 0) + (Number(result.scrubbed) || 0);
  const done = say("readers.oldDone", { closed, deleted });
  return result.skipped ? `${done} ${say("readers.oldSkipped", { n: result.skipped })}` : done;
}
