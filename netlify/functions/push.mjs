// Push notifications, the owner's side (ADR 0412): the devices she turned them on for.
//
// Routes under /api/push/, all but `notify` with the push admin key (Admin only, from its server):
//   GET status | POST devices | POST devices/<id> | POST devices/<id>/remove | POST test
// and one with the separate notify key, for the owner's other apps (a gift service, a card room):
//   POST notify  { title, body, url }
// Replies are rebuilt from known fields; a device's endpoint is never sent back. Errors are fixed codes.

import { timingSafeEqual } from "node:crypto";
import { KINDS, LIMITS, PushError, checkSubscription, createPushStore, deviceHash, notice, pushSettings, sendToOwner, subscriptionOf } from "../lib/push-store.mjs";
import { webPushTransport } from "../lib/web-push.mjs";

const SECURITY = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (statusCode, value) => ({ statusCode, headers: { ...SECURITY, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(value) });
const lower = (headers) => Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
const sameKey = (given, wanted) => {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(wanted || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};
const MAX_BODY = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const deviceOut = (row) => ({
  id: row.id,
  device: deviceHash(row.endpoint),
  label: row.label,
  kinds: (row.kinds || []).filter((k) => Object.hasOwn(KINDS, k)),
  createdAt: row.created_at,
  lastSentAt: row.last_sent_at || null,
});

const checkKinds = (value) => {
  if (!Array.isArray(value) || value.some((k) => !Object.hasOwn(KINDS, k))) throw new PushError(400, "invalid-kinds", "kinds");
  return [...new Set(value)];
};
const checkLabel = (value) => {
  const label = String(value ?? "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (!label || label.length > LIMITS.label) throw new PushError(400, "label-required", "label");
  return label;
};
// Where tapping a notice from another app goes: a page in Admin, or that app's own https page.
const checkUrl = (value) => {
  const url = String(value ?? "/admin/");
  if (url.length <= 500 && /^\/admin\/[^\s\\]*$/.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password && url.length <= 500) return parsed.href;
  } catch {
    // falls through
  }
  throw new PushError(400, "invalid-url", "url");
};

export function createHandler({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), transport = null } = {}) {
  return async (event) => {
    const settings = pushSettings(env);
    if (!settings.enabled) return json(404, { error: "not-enabled" });
    const headers = lower(event.headers);
    const bearer = String(headers.authorization || "").replace(/^Bearer /i, "");
    const method = String(event.httpMethod || "GET").toUpperCase();
    const segments = String(event.path || "").split("/").filter(Boolean);
    const parts = segments.slice(segments.lastIndexOf("push") + 1);
    const asOwner = sameKey(bearer, settings.adminKey);
    const asApp = parts.length === 1 && parts[0] === "notify" && settings.notifyKey && sameKey(bearer, settings.notifyKey);
    if (!asOwner && !asApp) return json(401, { error: "unauthorized" });
    const store = createPushStore({ settings, fetchImpl, now });
    const send = transport || webPushTransport({ vapid: settings.vapid, subject: settings.subject, fetchImpl, now });
    const input = () => {
      if (String(event.body || "").length > MAX_BODY) throw new PushError(413, "too-large");
      try {
        const value = JSON.parse(event.body || "{}");
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch {
        // falls through
      }
      throw new PushError(400, "malformed");
    };
    const known = (id) => {
      if (!UUID.test(String(id))) throw new PushError(404, "not-found");
      return id;
    };

    try {
      const [first, second, third] = parts;
      if (method === "POST" && first === "notify" && parts.length === 1) {
        const value = input();
        if (!String(value.title ?? "").trim()) throw new PushError(400, "title-required", "title");
        const message = notice({ title: value.title, body: value.body, url: checkUrl(value.url), tag: value.tag });
        const counts = await sendToOwner({ settings, store, transport: send, kind: "app", notice: message });
        return json(200, { sent: Math.max(0, counts.sent) });
      }
      if (!asOwner) return json(401, { error: "unauthorized" });
      if (method === "GET" && first === "status" && parts.length === 1) {
        return json(200, {
          enabled: true,
          publicKey: settings.vapid.publicKey,
          kinds: Object.entries(KINDS).map(([id, label]) => ({ id, label })),
          otherApps: Boolean(settings.notifyKey),
          devices: (await store.devices()).map(deviceOut),
          limits: LIMITS,
        });
      }
      if (first === "devices") {
        if (method === "POST" && parts.length === 1) {
          const value = input();
          const subscription = checkSubscription(value.subscription);
          if (!subscription) throw new PushError(400, "invalid-subscription", "subscription");
          const device = { subscription, label: checkLabel(value.label), kinds: checkKinds(value.kinds ?? Object.keys(KINDS)) };
          const devices = await store.devices();
          if (devices.length >= LIMITS.devices && !devices.some((d) => d.endpoint === subscription.endpoint)) throw new PushError(409, "too-many");
          return json(200, { device: deviceOut(await store.save(device)) });
        }
        if (method === "POST" && parts.length === 2) {
          const value = input();
          const change = {};
          if (value.label !== undefined) change.label = checkLabel(value.label);
          if (value.kinds !== undefined) change.kinds = checkKinds(value.kinds);
          const row = await store.update(known(second), change);
          if (!row) throw new PushError(404, "not-found");
          return json(200, { device: deviceOut(row) });
        }
        if (method === "POST" && parts.length === 3 && third === "remove") {
          await store.remove(known(second));
          return json(200, { removed: true });
        }
      }
      if (method === "POST" && first === "test" && parts.length === 1) {
        const row = await store.device(known(input().id));
        if (!row) throw new PushError(404, "not-found");
        const result = await send(subscriptionOf(row), notice({ title: "Notifications are on", body: `${row.label} will hear about what you picked.`, url: "/admin/#/notifications", tag: "test" }));
        if (result.gone) {
          await store.remove(row.id);
          return json(410, { error: "gone" });
        }
        return result.ok ? json(200, { sent: true }) : json(502, { error: "send-failed", code: result.code });
      }
      return json(404, { error: "not-found" });
    } catch (error) {
      if (error instanceof PushError) return json(error.status, { error: error.code, field: error.field });
      return json(500, { error: "failed" });
    }
  };
}

export const handler = createHandler();
