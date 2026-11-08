// Managing stored quote requests (epic #474, story #486; ADR 0384): list, change status, export,
// erase, and retention. Every function here is reached only through the admin-key routes of
// netlify/functions/quote.mjs (or the retention schedule). Nothing logs; errors carry fixed codes.

import { createHmac, timingSafeEqual } from "node:crypto";
import { QuoteError } from "./quote-intake.mjs";

export const STATUSES = ["new", "handled", "archived"];
export const MAX_ERASE = 100;
const ERASE_TOKEN_MS = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Retention is off (keep archived requests until the owner erases them) unless a whole number of
// days from 1 to 3650 is set. A wrong value is off, never a guess.
export function retentionDays(env = {}) {
  const raw = String(env.OPENBLOG_QUOTE_RETENTION_DAYS ?? "").trim();
  if (!/^\d{1,4}$/.test(raw)) return null;
  const days = Number(raw);
  return days >= 1 && days <= 3650 ? days : null;
}

export const isId = (value) => typeof value === "string" && UUID.test(value);

const iso = (value) => (value ? new Date(value).toISOString() : null);

export function eraseAfter(row, days) {
  if (!days || row.status !== "archived" || !row.archived_at) return null;
  return new Date(new Date(row.archived_at).getTime() + days * DAY).toISOString();
}

// `notifyEnabled` says whether the function can send (and so retry) the owner's email (ADR 0383).
export async function listRequests({ store, settings, query = {}, days, notifyEnabled = false }) {
  const status = STATUSES.includes(query.status) ? query.status : "";
  const service = String(query.service || "").slice(0, 100);
  const rows = await store.list({ status, service });
  const requests = [];
  for (const row of rows) {
    const photos = [];
    for (const photo of (Array.isArray(row.photos) ? row.photos : []).slice(0, 5)) {
      if (typeof photo?.path !== "string" || !photo.path.startsWith(`${settings.siteId}/`)) continue;
      const url = await store.signPhoto(photo.path);
      if (url) photos.push({ url, type: photo.type });
    }
    requests.push({
      id: row.id, status: row.status, name: row.name, phone: row.phone, email: row.email || null, town: row.town, service: row.service,
      description: row.description, page: row.page || null, photos, photoCount: Array.isArray(row.photos) ? row.photos.length : 0,
      createdAt: iso(row.created_at), handledAt: iso(row.handled_at), archivedAt: iso(row.archived_at), eraseAfter: eraseAfter(row, days), notify: row.notify_status,
      notifyAttempts: Number.isInteger(row.notify_attempts) ? row.notify_attempts : 0, notifyError: row.notify_error_code || null,
    });
  }
  // The service filter offers every service seen under the status filter alone.
  const all = service ? await store.list({ status }) : rows;
  return { retentionDays: days, notifyEnabled: Boolean(notifyEnabled), requests, services: [...new Set(all.map((row) => row.service))].sort() };
}

export async function setStatus({ store, id, status, now }) {
  if (!isId(id)) throw new QuoteError(400, "bad-id");
  if (!STATUSES.includes(status)) throw new QuoteError(400, "bad-status");
  const stamp = new Date(now()).toISOString();
  const changes = status === "new" ? { status, handled_at: null, archived_at: null } : status === "handled" ? { status, handled_at: stamp, archived_at: null } : { status, archived_at: stamp };
  await store.patch(id, changes);
  return { id, status };
}

// ---- CSV

// A cell that a spreadsheet would run as a formula is made text.
const cell = (value) => {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
};

export function toCsv(rows) {
  const head = ["id", "received", "status", "name", "phone", "email", "town", "service", "description", "page", "photos", "handled", "archived"];
  const lines = [head.join(",")];
  for (const row of rows) {
    lines.push([row.id, iso(row.created_at), row.status, row.name, row.phone, row.email, row.town, row.service, row.description, row.page, Array.isArray(row.photos) ? row.photos.length : 0, iso(row.handled_at), iso(row.archived_at)].map(cell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

const day = (value, end) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) ? "" : new Date(time + (end ? DAY : 0)).toISOString();
};

// `from` and `to` are whole days (both inclusive).
export async function exportCsv({ store, query = {} }) {
  const from = day(query.from, false);
  const to = day(query.to, true);
  if ((query.from && !from) || (query.to && !to)) throw new QuoteError(400, "bad-range");
  const rows = await store.range({ from, to });
  return { filename: `quote-requests-${from ? query.from : "start"}-to-${to ? query.to : "now"}.csv`, count: rows.length, csv: toCsv(rows) };
}

// ---- Erase

const sealFor = (secret, ids, expires) => createHmac("sha256", secret).update(`erase\n${expires}\n${[...ids].sort().join(",")}`).digest("base64url");

function cleanIds(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_ERASE || !ids.every(isId)) throw new QuoteError(400, "bad-ids");
  return [...new Set(ids)];
}

async function rowsFor(store, ids) {
  const rows = await store.byIds(ids);
  if (rows.length !== ids.length) throw new QuoteError(409, "changed");
  return rows;
}

const photoPaths = (settings, row) => {
  const prefix = `${settings.siteId}/${row.id}/`;
  return (Array.isArray(row.photos) ? row.photos : []).map((photo) => photo?.path).filter((path) => typeof path === "string" && path.startsWith(prefix) && !path.includes(".."));
};

// What an erase would remove, and a sealed token that allows exactly that list for ten minutes.
export async function erasePreview({ store, settings, ids, now }) {
  const list = cleanIds(ids);
  const rows = await rowsFor(store, list);
  const expires = now() + ERASE_TOKEN_MS;
  return { count: rows.length, photos: rows.reduce((n, row) => n + photoPaths(settings, row).length, 0), expiresAt: new Date(expires).toISOString(), token: `${expires}.${sealFor(settings.secret, list, expires)}` };
}

// Erases whole requests or none of their records. Photos go first and are checked gone; only then
// does one atomic statement remove the rows, and a last read confirms none remain. Any failure
// before the rows go leaves every row in place (with its photo list matching what still exists).
async function eraseRows({ store, settings, rows }) {
  const ids = rows.map((row) => row.id);
  try {
    await store.removeObjects(rows.flatMap((row) => photoPaths(settings, row)));
    for (const row of rows) {
      if ((await store.listObjects(`${settings.siteId}/${row.id}`)).length) throw new QuoteError(502, "erase-failed");
    }
  } catch {
    for (const row of rows) {
      try {
        const present = await store.listObjects(`${settings.siteId}/${row.id}`);
        await store.setPhotos(row.id, (Array.isArray(row.photos) ? row.photos : []).filter((photo) => present.includes(photo?.path)));
      } catch {
        // The failure is reported either way; the rows stay.
      }
    }
    throw new QuoteError(502, "erase-failed");
  }
  if ((await store.deleteRows(ids)) !== ids.length) throw new QuoteError(502, "erase-failed");
  if ((await store.byIds(ids)).length !== 0) throw new QuoteError(502, "erase-unverified");
  return { erased: ids.length, verified: true };
}

export async function eraseConfirmed({ store, settings, ids, token, now }) {
  const list = cleanIds(ids);
  const [stamp, seal] = String(token || "").split(".");
  const expires = Number(stamp);
  const expected = Buffer.from(sealFor(settings.secret, list, expires));
  const given = Buffer.from(String(seal || ""));
  if (!Number.isFinite(expires) || expires < now() || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new QuoteError(409, "preview-required");
  return eraseRows({ store, settings, rows: await rowsFor(store, list) });
}

// Archived requests older than the retention period. One failed batch stops the sweep and reports.
export async function retentionSweep({ store, settings, days, now }) {
  if (!days) return { enabled: false, erased: 0 };
  const before = new Date(now() - days * DAY).toISOString();
  let erased = 0;
  for (let round = 0; round < 20; round += 1) {
    const rows = await store.archivedBefore(before, MAX_ERASE);
    if (!rows.length) break;
    erased += (await eraseRows({ store, settings, rows })).erased;
  }
  return { enabled: true, erased };
}
