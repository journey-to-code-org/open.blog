// Owner notification for quote requests (epic #474, story #485, task #516; ADR 0383).
//
// One email to the site owner's own fixed address when a request has been stored. It is opt-in
// (OPENBLOG_QUOTE_NOTIFY_PROVIDER), never addressed to a visitor, carries no phone number, email
// address or description (those stay in the private workspace; the owner reads them in Admin), and
// can never lose a request: it runs after the row is stored, swallows every failure, and records the
// outcome on the row (`sent` or `failed` with a fixed error code and an attempt count) so the failure
// is visible and can be retried a bounded number of times. Nothing here logs.

export const MAX_ATTEMPTS = 5;
const INLINE_TRIES = 2;
const INLINE_PAUSE_MS = 300;
const RESEND_URL = "https://api.resend.com/emails";
const ADDRESS = /^[^\s@<>",;]{1,64}@[^\s@<>",;]{1,200}\.[A-Za-z]{2,24}$/;
// "Name <address>" or a bare address, for the sender.
const SENDER = /^(?:[^<>\r\n"]{1,80} <[^\s@<>",;]{1,64}@[^\s@<>",;]{1,200}\.[A-Za-z]{2,24}>|[^\s@<>",;]{1,64}@[^\s@<>",;]{1,200}\.[A-Za-z]{2,24})$/;

const text = (value) => String(value ?? "");
const oneLine = (value, max) => text(value).replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, " ").trim().slice(0, max);

// Off unless a provider is named; named but incomplete is still off, with the names (never the
// values) of what is wrong.
export function notifySettings(env = {}) {
  const provider = text(env.OPENBLOG_QUOTE_NOTIFY_PROVIDER).trim().toLowerCase();
  if (!provider || provider === "off") return { enabled: false, problems: [] };
  const problems = [];
  if (provider !== "resend") problems.push("OPENBLOG_QUOTE_NOTIFY_PROVIDER");
  const apiKey = text(env.OPENBLOG_QUOTE_NOTIFY_API_KEY);
  const to = text(env.OPENBLOG_QUOTE_NOTIFY_TO).trim();
  const from = text(env.OPENBLOG_QUOTE_NOTIFY_FROM).trim();
  const adminUrl = text(env.OPENBLOG_QUOTE_ADMIN_URL).trim();
  if (!apiKey || /\s/.test(apiKey)) problems.push("OPENBLOG_QUOTE_NOTIFY_API_KEY");
  if (!ADDRESS.test(to)) problems.push("OPENBLOG_QUOTE_NOTIFY_TO");
  if (!SENDER.test(from)) problems.push("OPENBLOG_QUOTE_NOTIFY_FROM");
  if (adminUrl && !/^https:\/\/[^\s"<>]{1,300}$/.test(adminUrl)) problems.push("OPENBLOG_QUOTE_ADMIN_URL");
  if (problems.length) return { enabled: false, problems };
  return { enabled: true, problems: [], provider, apiKey, to, from, adminUrl };
}

// The message. Only fixed words and three short owner-facing facts; header-safe by construction.
export function composeMessage(settings, { id, values, photoCount }) {
  const where = oneLine(values.town, 60);
  const service = oneLine(values.service, 60);
  const link = settings.adminUrl ? `Open it in Admin: ${settings.adminUrl}` : "Open Admin and choose Quote requests to read it.";
  return {
    from: settings.from,
    to: [settings.to],
    subject: `New quote request: ${service} in ${where}`.slice(0, 150),
    text: [
      "You have a new quote request.",
      "",
      `From: ${oneLine(values.name, 80)}`,
      `Town: ${where}`,
      `Service: ${service}`,
      `Photos: ${photoCount}`,
      "",
      link,
      "",
      "The phone number and details are not in this email; they stay in your private workspace.",
      `Reference: ${id}`,
    ].join("\n"),
  };
}

// The Resend transport (https://resend.com/docs/api-reference/emails/send-email): POST /emails with
// a bearer key and an Idempotency-Key. Resolves { ok: true } or { ok: false, code, retryable }; the
// code is fixed and never carries the provider's text.
export function resendTransport({ apiKey, fetchImpl, timeoutMs = 8000 }) {
  return async (message, idempotencyKey) => {
    let response;
    try {
      response = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { ok: false, code: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network", retryable: true };
    }
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) return { ok: false, code: "refused-key", retryable: false };
    if (response.status === 429) return { ok: false, code: "rate-limited", retryable: true };
    if (response.status >= 500) return { ok: false, code: "provider-error", retryable: true };
    return { ok: false, code: "rejected", retryable: false };
  };
}

// Builds the function the intake handler calls after a request is stored. It never throws.
export function createNotifier({ settings, transport, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  return async ({ id, values, photoCount, store }) => {
    const record = async (changes) => {
      try {
        await store.patch(id, changes);
      } catch {
        // The row is already safe; the status simply stays 'pending' and a retry will settle it.
      }
    };
    const message = composeMessage(settings, { id, values, photoCount });
    let attempts = 0;
    let last = { code: "unknown", retryable: true };
    for (let turn = 0; turn < INLINE_TRIES; turn++) {
      if (turn > 0) await sleep(INLINE_PAUSE_MS);
      attempts += 1;
      let result;
      try {
        result = await transport(message, `quote-${id}`);
      } catch {
        result = { ok: false, code: "network", retryable: true };
      }
      if (result.ok) return record({ notify_status: "sent", notify_attempts: attempts, notify_error_code: null });
      last = result;
      if (!result.retryable) break;
    }
    return record({ notify_status: "failed", notify_attempts: attempts, notify_error_code: last.code });
  };
}

// A later, bounded retry of the notifications that failed (the admin route). `rows` carry only the
// facts the message needs. Returns counts, never a row.
export async function retryFailed({ settings, transport, store, rows }) {
  const summary = { tried: 0, sent: 0, failed: 0, gaveUp: 0 };
  for (const row of rows) {
    const before = row.notify_attempts ?? 0;
    if (before >= MAX_ATTEMPTS) {
      summary.gaveUp += 1;
      continue;
    }
    summary.tried += 1;
    const message = composeMessage(settings, { id: row.id, values: row, photoCount: Array.isArray(row.photos) ? row.photos.length : 0 });
    let result;
    try {
      result = await transport(message, `quote-${row.id}`);
    } catch {
      result = { ok: false, code: "network", retryable: true };
    }
    const attempts = before + 1;
    try {
      await store.patch(row.id, result.ok
        ? { notify_status: "sent", notify_attempts: attempts, notify_error_code: null }
        : { notify_status: "failed", notify_attempts: attempts, notify_error_code: result.code });
    } catch {
      // Left as it was; the next retry settles it.
    }
    if (result.ok) summary.sent += 1;
    else summary.failed += 1;
  }
  return summary;
}
