// Gifts under the tree (Studio slice 3b). The family leaves a note or a card under the owner's
// tree; it stays wrapped until Christmas morning, when she opens it in Studio.
//
// Public routes under /api/gifts/ (the site's own origin only, for CORS):
//   GET  tree     the wrapped boxes: id, wrap, and who it's from only where the giver said yes
//                 AND the owner shows names. Never what's inside.
//   GET  token    a form token (the form must be open a few seconds before it's sent)
//   POST submit   { code, token, website, from, showName, kind, note | card, wrap }
//                 code is the family password; website is a field people never see (robots fill it)
// Owner routes (Bearer OPENBLOG_GIFTS_ADMIN_KEY), for Admin's proxy:
//   GET  admin/list            every gift: who, wrapped or opened; contents only once opened
//   POST admin/<id>/open       423 until the gift's opening time; then its contents
//   POST admin/<id>/hide       take it off the tree (kept, never deleted)
//   GET  admin/settings, POST admin/settings { showNames }
//
// Settings: OPENBLOG_GIFTS_ENABLED=true, OPENBLOG_GIFTS_ADMIN_KEY (32+), OPENBLOG_GIFTS_FAMILY_CODE,
// SUPABASE_URL / SUPABASE_SECRET_KEY, OPENBLOG_SITE_ID, OPENBLOG_SITE_ORIGIN, OPENBLOG_ANALYTICS_SALT,
// OPENBLOG_GREETINGS_TIME_ZONE (default America/New_York), and OPENBLOG_GIFTS_OPENS_ON (MM-DD, default
// 12-25; set another day only to rehearse). Replies are rebuilt from known fields; errors are codes.

import { createHash, timingSafeEqual } from "node:crypto";
import { CardError, LIMITS, WRAPS, checkFormToken, checkGift, makeFormToken, opensAt, sameCode } from "../lib/gift-card.mjs";
import { isTimeZone, isUuid } from "../lib/greeting-card.mjs";
import { LOOPBACK } from "../lib/greeting-store.mjs";

const SECURITY = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const MAX_BODY = 16 * 1024;
const TABLE = "openblog_gifts";
const SETTINGS = "openblog_gift_settings";
const text = (value) => String(value ?? "");
const lower = (headers) => Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
const sameKey = (given, wanted) => {
  const a = Buffer.from(text(given));
  const b = Buffer.from(text(wanted));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

export function giftSettings(env = {}) {
  if (text(env.OPENBLOG_GIFTS_ENABLED).trim().toLowerCase() !== "true") return { enabled: false, problems: [] };
  const problems = [];
  const url = text(env.SUPABASE_URL).trim().replace(/\/+$/, "");
  const key = text(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY).trim();
  const siteId = text(env.OPENBLOG_SITE_ID).trim();
  const adminKey = text(env.OPENBLOG_GIFTS_ADMIN_KEY);
  const code = text(env.OPENBLOG_GIFTS_FAMILY_CODE);
  const origin = text(env.OPENBLOG_SITE_ORIGIN).trim().replace(/\/+$/, "");
  const salt = text(env.OPENBLOG_ANALYTICS_SALT);
  const zone = text(env.OPENBLOG_GREETINGS_TIME_ZONE || "America/New_York").trim();
  const opensOn = text(env.OPENBLOG_GIFTS_OPENS_ON || "12-25").trim();
  if (!/^https:\/\/[^\s/]+$/.test(url) && !LOOPBACK.test(url)) problems.push("SUPABASE_URL");
  if (!key || /\s/.test(key)) problems.push("SUPABASE_SECRET_KEY");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(siteId)) problems.push("OPENBLOG_SITE_ID");
  if (adminKey.length < 32 || /\s/.test(adminKey)) problems.push("OPENBLOG_GIFTS_ADMIN_KEY");
  if (code.replace(/[^\p{L}\p{N}]+/gu, "").length < 6) problems.push("OPENBLOG_GIFTS_FAMILY_CODE");
  if (!/^https:\/\/[^\s"<>/]+$/.test(origin)) problems.push("OPENBLOG_SITE_ORIGIN");
  if (salt.length < 16) problems.push("OPENBLOG_ANALYTICS_SALT");
  if (!isTimeZone(zone)) problems.push("OPENBLOG_GREETINGS_TIME_ZONE");
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(opensOn)) problems.push("OPENBLOG_GIFTS_OPENS_ON");
  if (problems.length) return { enabled: false, problems };
  return { enabled: true, problems: [], url, key, siteId, adminKey, code, origin, salt, zone, opensOn };
}

function createGiftStore({ settings, fetchImpl }) {
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
    if (!response.ok) throw new CardError(503, "storage-unavailable");
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  };
  const site = `site_id=eq.${encodeURIComponent(settings.siteId)}`;
  const write = (prefer = "return=representation") => headers({ "content-type": "application/json", prefer });
  const count = async (filter) => {
    const rows = await call(`${TABLE}?select=id&${site}&${filter}&limit=${LIMITS.perSeason + 1}`, { headers: headers() });
    return rows.length;
  };
  return {
    onTree: () => call(`${TABLE}?select=id,wrap,from_name,show_name,opens_at,created_at&${site}&hidden_at=is.null&order=created_at.asc&limit=${LIMITS.perSeason}`, { headers: headers() }),
    all: () => call(`${TABLE}?select=*&${site}&order=created_at.asc&limit=1000`, { headers: headers() }),
    one: async (id) => (await call(`${TABLE}?select=*&${site}&id=eq.${id}`, { headers: headers() }))[0] || null,
    add: async (row) => (await call(TABLE, { method: "POST", headers: write(), body: JSON.stringify({ ...row, site_id: settings.siteId }) }))[0],
    update: async (id, row, guard = "") => (await call(`${TABLE}?${site}&id=eq.${id}${guard}`, { method: "PATCH", headers: write(), body: JSON.stringify(row) }))[0] || null,
    fromSender: (digest, since) => count(`sender_digest=eq.${digest}&created_at=gte.${encodeURIComponent(since)}`),
    forSeason: (opens) => count(`opens_at=eq.${encodeURIComponent(opens)}`),
    showNames: async () => {
      const row = (await call(`${SETTINGS}?select=show_names&${site}`, { headers: headers() }))[0];
      return row ? row.show_names === true : true;
    },
    setShowNames: async (value) => {
      await call(`${SETTINGS}?on_conflict=site_id`, {
        method: "POST",
        headers: write("resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify({ site_id: settings.siteId, show_names: value, updated_at: new Date().toISOString() }),
      });
      return value;
    },
  };
}

/** A gift as the owner sees it in Studio: contents only once it's open. */
const giftOut = (row, now) => ({
  id: row.id,
  from: row.from_name,
  showName: row.show_name === true,
  kind: row.kind,
  wrap: row.wrap,
  createdAt: row.created_at,
  opensAt: row.opens_at,
  canOpen: now >= Date.parse(row.opens_at),
  opened: Boolean(row.opened_at),
  openedAt: row.opened_at || null,
  onTree: !row.hidden_at,
  ...(row.opened_at ? { note: row.kind === "note" ? row.note : null, card: row.kind === "card" ? row.card : null } : {}),
});

export function createHandler({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  return async (event) => {
    const settings = giftSettings(env);
    const headers = lower(event.headers);
    const requestOrigin = text(headers.origin).replace(/\/$/, "");
    const cors = settings.enabled && requestOrigin === settings.origin
      ? { "access-control-allow-origin": requestOrigin, vary: "Origin" } : {};
    const json = (statusCode, value, extra = {}) => ({
      statusCode,
      headers: { ...SECURITY, ...cors, "content-type": "application/json; charset=utf-8", ...extra },
      body: JSON.stringify(value),
    });
    if (!settings.enabled) return json(404, { error: "not-enabled" });
    const method = text(event.httpMethod || "GET").toUpperCase();
    const segments = text(event.path).split("/").filter(Boolean);
    const parts = segments.slice(segments.lastIndexOf("gifts") + 1);
    const store = createGiftStore({ settings, fetchImpl });
    const input = () => {
      if (text(event.body).length > MAX_BODY) throw new CardError(413, "too-large");
      try {
        const value = JSON.parse(event.body || "{}");
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch {
        // falls through
      }
      throw new CardError(400, "malformed");
    };

    try {
      if (method === "OPTIONS") {
        if (!cors["access-control-allow-origin"]) return json(403, { error: "origin" });
        return { statusCode: 204, headers: { ...cors, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type", "access-control-max-age": "600" }, body: "" };
      }

      // ---- the owner's side
      if (parts[0] === "admin") {
        if (!sameKey(text(headers.authorization).replace(/^Bearer /i, ""), settings.adminKey)) return json(401, { error: "unauthorized" });
        const [, second, third] = parts;
        if (method === "GET" && second === "list" && parts.length === 2) {
          const at = now();
          return json(200, {
            gifts: (await store.all()).map((row) => giftOut(row, at)),
            showNames: await store.showNames(),
            opensAt: opensAt(at, settings.zone, settings.opensOn).toISOString(),
            limits: LIMITS,
          });
        }
        if (second === "settings" && parts.length === 2) {
          if (method === "GET") return json(200, { showNames: await store.showNames() });
          if (method === "POST") {
            const value = input().showNames;
            if (typeof value !== "boolean") throw new CardError(422, "show-names", "showNames");
            return json(200, { showNames: await store.setShowNames(value) });
          }
        }
        if (method === "POST" && parts.length === 3 && isUuid(second)) {
          const row = await store.one(second);
          if (!row) throw new CardError(404, "not-found");
          const at = now();
          if (third === "open") {
            if (at < Date.parse(row.opens_at)) return json(423, { error: "not-yet", opensAt: row.opens_at });
            const opened = row.opened_at ? row : await store.update(second, { opened_at: new Date(at).toISOString() }, "&opened_at=is.null") || await store.one(second);
            return json(200, { gift: giftOut(opened, at) });
          }
          if (third === "hide") {
            const hidden = await store.update(second, { hidden_at: new Date(at).toISOString() });
            return json(200, { gift: giftOut(hidden || row, at) });
          }
        }
        return json(404, { error: "not-found" });
      }

      // ---- the public side
      if (method === "GET" && parts[0] === "tree" && parts.length === 1) {
        const showNames = await store.showNames();
        const at = now();
        const opens = opensAt(at, settings.zone, settings.opensOn);
        const gifts = (await store.onTree())
          .filter((row) => Date.parse(row.opens_at) >= opens.getTime() || at < Date.parse(row.opens_at) + 13 * 24 * 60 * 60 * 1000)
          .map((row) => ({ id: row.id, wrap: WRAPS.includes(row.wrap) ? row.wrap : "red", from: showNames && row.show_name ? row.from_name : null }));
        return json(200, { gifts, opensAt: opens.toISOString(), showNames }, { "cache-control": "public, max-age=60" });
      }
      if (method === "GET" && parts[0] === "token" && parts.length === 1) {
        return json(200, { token: makeFormToken(settings.adminKey, now()) });
      }
      if (method === "POST" && parts[0] === "submit" && parts.length === 1) {
        if (!cors["access-control-allow-origin"]) return json(403, { error: "origin" });
        const body = input();
        // A robot fills every field it finds; a person never sees this one.
        if (text(body.website).trim()) return json(200, { ok: true });
        if (!checkFormToken(body.token, settings.adminKey, now())) throw new CardError(400, "token", "token");
        if (!sameCode(body.code, settings.code)) throw new CardError(403, "family-code", "code");
        const gift = checkGift(body);
        const at = now();
        const client = text(headers["x-nf-client-connection-ip"]) || "unknown";
        const day = new Date(at).toISOString().slice(0, 10);
        const digest = createHash("sha256").update(`${settings.salt}\0gifts\0${day}\0${client}`).digest("hex");
        if (await store.fromSender(digest, new Date(at - 60 * 60 * 1000).toISOString()) >= LIMITS.perVisitorPerHour) {
          return json(429, { error: "slow-down" }, { "retry-after": "3600" });
        }
        const opens = opensAt(at, settings.zone, settings.opensOn);
        if (await store.forSeason(opens.toISOString()) >= LIMITS.perSeason) throw new CardError(409, "tree-full");
        const row = await store.add({
          from_name: gift.from, show_name: gift.showName, kind: gift.kind, note: gift.note, card: gift.card,
          wrap: gift.wrap, opens_at: opens.toISOString(), sender_digest: digest,
        });
        return json(200, { ok: true, gift: { id: row.id, wrap: row.wrap, from: gift.showName ? gift.from : null }, opensAt: opens.toISOString() });
      }
      return json(404, { error: "not-found" });
    } catch (error) {
      if (error instanceof CardError) return json(error.status, { error: error.code, field: error.field });
      return json(500, { error: "failed" });
    }
  };
}

export const handler = createHandler();
