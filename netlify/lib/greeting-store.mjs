// Greeting cards (ADR 0411): the settings, the Supabase tables, and the Brevo transport.
//
// The address book and the cards live only in the site's private Supabase project, reached as
// service_role from the function; never in the repository, the site or a page. Errors carry a fixed
// code, never a name, an address or a message. Nothing here logs.

import { CardError, isTimeZone } from "./greeting-card.mjs";

const CONTACTS = "openblog_greeting_contacts";
const CARDS = "openblog_greeting_cards";
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const SENDER = /^(?:([^<>\r\n"]{1,80}) <([^\s@<>",;]{1,64}@[^\s@<>",;]{1,200}\.[A-Za-z]{2,24})>|([^\s@<>",;]{1,64}@[^\s@<>",;]{1,200}\.[A-Za-z]{2,24}))$/;
const text = (value) => String(value ?? "");

/** Off unless switched on; switched on but incomplete is still off, naming (never showing) what is wrong. */
export function greetingSettings(env = {}) {
  if (text(env.OPENBLOG_GREETINGS_ENABLED).trim().toLowerCase() !== "true") return { enabled: false, problems: [] };
  const problems = [];
  const url = text(env.SUPABASE_URL).trim().replace(/\/+$/, "");
  const key = text(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY).trim();
  const siteId = text(env.OPENBLOG_SITE_ID).trim();
  const adminKey = text(env.OPENBLOG_GREETINGS_ADMIN_KEY);
  const apiKey = text(env.BREVO_API_KEY).trim();
  const sender = SENDER.exec(text(env.OPENBLOG_GREETINGS_FROM).trim());
  const zone = text(env.OPENBLOG_GREETINGS_TIME_ZONE || "America/New_York").trim();
  const origin = text(env.OPENBLOG_SITE_ORIGIN).trim().replace(/\/+$/, "");
  const base = text(env.OPENBLOG_SITE_BASE_PATH || "/").trim();
  if (!/^https:\/\/[^\s/]+$/.test(url)) problems.push("SUPABASE_URL");
  if (!key || /\s/.test(key)) problems.push("SUPABASE_SECRET_KEY");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(siteId)) problems.push("OPENBLOG_SITE_ID");
  if (adminKey.length < 32 || /\s/.test(adminKey)) problems.push("OPENBLOG_GREETINGS_ADMIN_KEY");
  if (!apiKey || /\s/.test(apiKey)) problems.push("BREVO_API_KEY");
  if (!sender) problems.push("OPENBLOG_GREETINGS_FROM");
  if (!isTimeZone(zone)) problems.push("OPENBLOG_GREETINGS_TIME_ZONE");
  if (origin && !/^https:\/\/[^\s"<>/]+$/.test(origin)) problems.push("OPENBLOG_SITE_ORIGIN");
  if (problems.length) return { enabled: false, problems };
  const from = sender[3] ? { email: sender[3] } : { name: sender[1].trim(), email: sender[2] };
  const siteUrl = origin ? `${origin}${base.startsWith("/") ? base : `/${base}`}` : "";
  return { enabled: true, problems: [], url, key, siteId, adminKey, apiKey, from, zone, siteUrl, siteName: text(env.OPENBLOG_SITE_NAME).trim().slice(0, 80) };
}

export function createGreetingStore({ settings, fetchImpl, now = () => Date.now() }) {
  const headers = (extra = {}) => ({
    apikey: settings.key,
    ...(settings.key.split(".").length === 3 ? { authorization: `Bearer ${settings.key}` } : {}),
    ...extra,
  });
  const call = async (path, init = {}) => {
    let response;
    try {
      response = await fetchImpl(`${settings.url}/rest/v1/${path}`, { ...init, signal: AbortSignal.timeout(10000) });
    } catch {
      throw new CardError(503, "storage-unavailable");
    }
    if (!response.ok) throw new CardError(response.status === 409 ? 409 : 503, response.status === 409 ? "conflict" : "storage-unavailable");
    return response.status === 204 ? null : response.json();
  };
  const site = `site_id=eq.${encodeURIComponent(settings.siteId)}`;
  const jsonHeaders = (prefer = "return=representation") => headers({ "content-type": "application/json", prefer });
  const stamp = () => new Date(now()).toISOString();

  return {
    contacts: () => call(`${CONTACTS}?select=id,name,email,birthday,created_at&${site}&order=name.asc&limit=500`, { headers: headers() }),
    contact: async (id) => (await call(`${CONTACTS}?select=id,name,email,birthday&${site}&id=eq.${id}`, { headers: headers() }))[0] || null,
    addContact: async (row) => (await call(CONTACTS, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ ...row, site_id: settings.siteId }) }))[0],
    updateContact: async (id, row) => (await call(`${CONTACTS}?${site}&id=eq.${id}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ ...row, updated_at: stamp() }) }))[0] || null,
    // Removing a person removes their cards with them (ON DELETE CASCADE).
    removeContact: (id) => call(`${CONTACTS}?${site}&id=eq.${id}`, { method: "DELETE", headers: headers({ prefer: "return=minimal" }) }),

    cards: () => call(`${CARDS}?select=*&${site}&status=neq.cancelled&order=next_send_at.asc&limit=1000`, { headers: headers() }),
    card: async (id) => (await call(`${CARDS}?select=*&${site}&id=eq.${id}`, { headers: headers() }))[0] || null,
    addCard: async (row) => (await call(CARDS, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ ...row, site_id: settings.siteId }) }))[0],
    updateCard: async (id, row, { onlyStatus = null } = {}) => {
      const guard = onlyStatus ? `&status=in.(${onlyStatus.join(",")})` : "";
      return (await call(`${CARDS}?${site}&id=eq.${id}${guard}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ ...row, updated_at: stamp() }) }))[0] || null;
    },

    // Cards whose time has come, and cards stuck "sending" for an hour (a sender that stopped).
    due: () => {
      const at = stamp();
      const stale = new Date(now() - 60 * 60 * 1000).toISOString();
      return call(`${CARDS}?select=*&${site}&next_send_at=lte.${encodeURIComponent(at)}&or=(status.eq.scheduled,and(status.eq.sending,updated_at.lt.${encodeURIComponent(stale)}))&order=next_send_at.asc&limit=50`, { headers: headers() });
    },
    // Takes a card for sending; null when another run already took it.
    claim: async (card) => (await call(`${CARDS}?${site}&id=eq.${card.id}&status=eq.${card.status}&updated_at=eq.${encodeURIComponent(card.updated_at)}`, {
      method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ status: "sending", updated_at: stamp() }),
    }))[0] || null,
  };
}

/**
 * Brevo's transactional email API (https://developers.brevo.com/reference/sendtransacemail):
 * POST /v3/smtp/email with the `api-key` header. Resolves to `{ ok: true, id }` or
 * `{ ok: false, code }` with a fixed code; never throws, never returns provider text.
 */
export function brevoTransport({ apiKey, fetchImpl, timeoutMs = 15000 }) {
  return async (mail) => {
    let response;
    try {
      response = await fetchImpl(BREVO_URL, {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: mail.from,
          to: [mail.to],
          ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
          subject: mail.subject,
          htmlContent: mail.html,
          textContent: mail.text,
          tags: ["greeting-card"],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { ok: false, code: error?.name === "TimeoutError" ? "timeout" : "network" };
    }
    if (response.ok) {
      const body = await response.json().catch(() => ({}));
      return { ok: true, id: typeof body.messageId === "string" ? body.messageId.slice(0, 200) : null };
    }
    const code = response.status === 401 || response.status === 403 ? "refused-key"
      : response.status === 429 ? "rate-limited"
      : response.status >= 500 ? "provider-error"
      : "rejected";
    return { ok: false, code };
  };
}
