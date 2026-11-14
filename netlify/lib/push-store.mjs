// Push notifications to the owner (ADR 0412): the settings, the devices she turned them on for,
// and `tellOwner`, which the other functions call after they have stored something she should
// hear about.
//
// The devices live only in the site's private Supabase project, reached as service_role. A device
// is a browser's push subscription: its endpoint is a capability URL, so it is never sent back to
// Admin or anywhere else; Admin sees a hash of it. Errors are fixed codes. Nothing here logs.

import { createHash } from "node:crypto";
import { checkSubscription, vapidKeys, webPushTransport } from "./web-push.mjs";

const DEVICES = "openblog_push_devices";
const text = (value) => String(value ?? "");

/** What a device can be told about, in the order Admin lists them. */
export const KINDS = {
  comment: "New comments",
  feedback: "Reader feedback",
  quote: "Quote requests",
  app: "Your other apps (gifts, games and the like)",
};
export const LIMITS = { devices: 20, label: 60, title: 80, body: 180 };

export class PushError extends Error {
  constructor(status, code, field = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** Off unless switched on; switched on but incomplete is still off, naming (never showing) what is wrong. */
export function pushSettings(env = {}) {
  if (text(env.OPENBLOG_PUSH_ENABLED).trim().toLowerCase() !== "true") return { enabled: false, problems: [] };
  const problems = [];
  const url = text(env.SUPABASE_URL).trim().replace(/\/+$/, "");
  const key = text(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY).trim();
  const siteId = text(env.OPENBLOG_SITE_ID).trim();
  const adminKey = text(env.OPENBLOG_PUSH_ADMIN_KEY);
  const notifyKey = text(env.OPENBLOG_PUSH_NOTIFY_KEY);
  const vapid = vapidKeys(text(env.OPENBLOG_PUSH_PUBLIC_KEY).trim(), text(env.OPENBLOG_PUSH_PRIVATE_KEY).trim());
  const subject = text(env.OPENBLOG_PUSH_SUBJECT).trim();
  if (!/^https:\/\/[^\s/]+$/.test(url)) problems.push("SUPABASE_URL");
  if (!key || /\s/.test(key)) problems.push("SUPABASE_SECRET_KEY");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(siteId)) problems.push("OPENBLOG_SITE_ID");
  if (adminKey.length < 32 || /\s/.test(adminKey)) problems.push("OPENBLOG_PUSH_ADMIN_KEY");
  if (notifyKey && (notifyKey.length < 32 || /\s/.test(notifyKey) || notifyKey === adminKey)) problems.push("OPENBLOG_PUSH_NOTIFY_KEY");
  if (!vapid) problems.push("OPENBLOG_PUSH_PUBLIC_KEY", "OPENBLOG_PUSH_PRIVATE_KEY");
  // Apple's push service turns a request down without a contact it can parse.
  if (!/^mailto:[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,24}$/.test(subject) && !/^https:\/\/[^\s"<>]+$/.test(subject)) problems.push("OPENBLOG_PUSH_SUBJECT");
  if (problems.length) return { enabled: false, problems };
  return { enabled: true, problems: [], url, key, siteId, adminKey, notifyKey: notifyKey || null, vapid, subject };
}

/** The id Admin knows a device by: a hash of its endpoint, so the endpoint itself never leaves. */
export const deviceHash = (endpoint) => createHash("sha256").update(text(endpoint)).digest("hex").slice(0, 32);

export function createPushStore({ settings, fetchImpl, now = () => Date.now() }) {
  const headers = (extra = {}) => ({
    apikey: settings.key,
    ...(settings.key.split(".").length === 3 ? { authorization: `Bearer ${settings.key}` } : {}),
    ...extra,
  });
  const call = async (path, init = {}) => {
    let response;
    try {
      response = await fetchImpl(`${settings.url}/rest/v1/${path}`, { ...init, signal: AbortSignal.timeout(8000) });
    } catch {
      throw new PushError(503, "storage-unavailable");
    }
    if (!response.ok) throw new PushError(503, "storage-unavailable");
    return response.status === 204 ? null : response.json();
  };
  const site = `site_id=eq.${encodeURIComponent(settings.siteId)}`;
  const jsonHeaders = (prefer = "return=representation") => headers({ "content-type": "application/json", prefer });
  const stamp = () => new Date(now()).toISOString();
  const COLUMNS = "id,label,kinds,endpoint,p256dh,auth,created_at,last_sent_at";

  return {
    devices: () => call(`${DEVICES}?select=${COLUMNS}&${site}&order=created_at.asc&limit=${LIMITS.devices}`, { headers: headers() }),
    device: async (id) => (await call(`${DEVICES}?select=${COLUMNS}&${site}&id=eq.${id}`, { headers: headers() }))[0] || null,
    // One row per browser: turning it on again on the same phone updates that row.
    save: async ({ subscription, label, kinds }) => (await call(`${DEVICES}?on_conflict=site_id,endpoint`, {
      method: "POST",
      headers: jsonHeaders("return=representation,resolution=merge-duplicates"),
      body: JSON.stringify({ site_id: settings.siteId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, label, kinds, updated_at: stamp() }),
    }))[0],
    update: async (id, row) => (await call(`${DEVICES}?${site}&id=eq.${id}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ ...row, updated_at: stamp() }) }))[0] || null,
    remove: (id) => call(`${DEVICES}?${site}&id=eq.${id}`, { method: "DELETE", headers: headers({ prefer: "return=minimal" }) }),
    // Devices that asked for this kind of news.
    listening: (kind) => call(`${DEVICES}?select=${COLUMNS}&${site}&kinds=cs.%7B${kind}%7D&limit=${LIMITS.devices}`, { headers: headers() }),
    sent: (ids) => ids.length ? call(`${DEVICES}?${site}&id=in.(${ids.join(",")})`, { method: "PATCH", headers: jsonHeaders("return=minimal"), body: JSON.stringify({ last_sent_at: stamp() }) }) : null,
  };
}

export const subscriptionOf = (row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } });

/** Where a notice opens when it names nowhere: Studio's Home. */
export const STUDIO_HOME = "/admin/studio/";

/** A notice, bounded and plain: a title, a line of text, and where tapping it goes. */
export function notice({ title, body = "", url = STUDIO_HOME, tag = null }) {
  const clean = (value, max) => text(value).replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return { title: clean(title, LIMITS.title) || "Something new on your blog", body: clean(body, LIMITS.body), url: text(url).slice(0, 500), ...(tag ? { tag: clean(tag, 64) } : {}) };
}

/**
 * A post named the way she would say it, from its address (Studio R3, G23): "/posts/pumpkin-pie/" is
 * “Pumpkin pie”, "/" is your front page. Never the raw path.
 */
export function pageWords(path) {
  const parts = text(path).split(/[?#]/)[0].split("/").filter(Boolean);
  let last = parts.at(-1) || "";
  if (/^index\.html?$/i.test(last)) last = parts.at(-2) || "";
  last = last.replace(/\.(html?|md)$/i, "");
  try {
    last = decodeURIComponent(last);
  } catch {
    // as written
  }
  const words = last.replace(/[-_\s]+/g, " ").replace(/[\u0000-\u001F\u007F]+/g, "").trim();
  if (!words) return "your front page";
  return `“${words[0].toUpperCase()}${words.slice(1)}”`;
}

/**
 * Sends a notice to every device that wants this kind of news. Devices the push service says are
 * gone are forgotten. Resolves to counts; never throws.
 */
export async function sendToOwner({ settings, store, transport, kind, notice: message }) {
  const counts = { sent: 0, gone: 0, failed: 0 };
  let devices;
  try {
    devices = await store.listening(kind);
  } catch {
    return { ...counts, failed: -1 };
  }
  const results = await Promise.all(devices.map(async (row) => ({ row, result: await transport(subscriptionOf(row), message) })));
  const sent = [];
  for (const { row, result } of results) {
    if (result.ok) {
      counts.sent += 1;
      sent.push(row.id);
    } else if (result.gone) {
      counts.gone += 1;
      await store.remove(row.id).catch(() => {});
    } else {
      counts.failed += 1;
    }
  }
  await store.sent(sent).catch(() => {});
  return counts;
}

/**
 * For the other functions: tell the owner, if push is on, within a time budget, after their own work
 * is stored. A failure here never changes what they answer.
 */
export async function tellOwner({ env, fetchImpl, kind, notice: fields, budgetMs = 4000, transport = null, now = () => Date.now() }) {
  try {
    const settings = pushSettings(env);
    if (!settings.enabled || !Object.hasOwn(KINDS, kind)) return null;
    const store = createPushStore({ settings, fetchImpl, now });
    const send = transport || webPushTransport({ vapid: settings.vapid, subject: settings.subject, fetchImpl, now, timeoutMs: Math.min(5000, budgetMs) });
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), budgetMs); });
    const outcome = await Promise.race([sendToOwner({ settings, store, transport: send, kind, notice: notice(fields) }), late]);
    clearTimeout(timer);
    return outcome;
  } catch {
    return null;
  }
}

export { checkSubscription };
