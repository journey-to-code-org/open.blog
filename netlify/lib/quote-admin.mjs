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

// The retention days in force (ADR 0387): the host setting when it is valid (Admin then shows it and
// cannot change it), else the owner's choice made in Admin, else off.
export async function retentionSetting({ store, env = {} }) {
  const host = retentionDays(env);
  if (host) return { days: host, source: "host" };
  const chosen = await store.readRetention();
  return chosen ? { days: chosen, source: "admin" } : { days: null, source: null };
}

// The owner sets or clears the days from Admin. A host setting wins, so it is refused then.
export async function setRetention({ store, env = {}, days }) {
  if (retentionDays(env)) throw new QuoteError(409, "retention-set-by-host");
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 3650)) throw new QuoteError(400, "bad-days");
  await store.writeRetention(days);
  return { retentionDays: days, retentionSource: days ? "admin" : null };
}

export const isId = (value) => typeof value === "string" && UUID.test(value);

const iso = (value) => (value ? new Date(value).toISOString() : null);

export function eraseAfter(row, days) {
  if (!days || row.status !== "archived" || !row.archived_at) return null;
  return new Date(new Date(row.archived_at).getTime() + days * DAY).toISOString();
}

// `notifyEnabled` says whether the function can send (and so retry) the owner's email (ADR 0383).
export async function listRequests({ store, settings, query = {}, days, source = days ? "host" : null, notifyEnabled = false }) {
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
  return { retentionDays: days, retentionSource: days ? source : null, notifyEnabled: Boolean(notifyEnabled), requests, services: [...new Set(all.map((row) => row.service))].sort() };
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

// Where an erase holds a request's photos until its record is gone (ADR 0386): one flat, private
// folder per site, each photo named after its request, so a photo left behind can be found and
// removed by the next erase or sweep once its request no longer exists.
const holdFolder = (settings) => `${settings.siteId}/erasing`;
const heldPath = (settings, row, path) => `${holdFolder(settings)}/${row.id}-${path.split("/").pop()}`;

const photoPaths = (settings, row) => {
  const prefixes = [`${settings.siteId}/${row.id}/`, `${holdFolder(settings)}/${row.id}-`];
  return (Array.isArray(row.photos) ? row.photos : []).map((photo) => photo?.path).filter((path) => typeof path === "string" && prefixes.some((prefix) => path.startsWith(prefix)) && !path.includes(".."));
};

// Removes held photos whose request no longer exists. Best effort: a failure leaves them for next time.
async function purgeHeld({ store, settings }) {
  try {
    const folder = holdFolder(settings);
    const held = await store.listObjects(folder);
    const owner = (path) => path.slice(folder.length + 1, folder.length + 37);
    const owners = [...new Set(held.map(owner).filter(isId))];
    if (!owners.length) return;
    const alive = new Set((await store.byIds(owners)).map((row) => row.id));
    await store.removeObjects(held.filter((path) => isId(owner(path)) && !alive.has(owner(path))));
  } catch {
    // Left for the next erase or sweep.
  }
}

// What an erase would remove, and a sealed token that allows exactly that list for ten minutes.
export async function erasePreview({ store, settings, ids, now }) {
  const list = cleanIds(ids);
  const rows = await rowsFor(store, list);
  const expires = now() + ERASE_TOKEN_MS;
  return { count: rows.length, photos: rows.reduce((n, row) => n + photoPaths(settings, row).length, 0), expiresAt: new Date(expires).toISOString(), token: `${expires}.${sealFor(settings.secret, list, expires)}` };
}

// Erases whole requests or nothing (ADR 0386, replacing the photo order of ADR 0384). Each photo is
// first moved, which can be undone, into the hold folder; a failed move puts back every photo already
// moved, so the requests and all their photos stay as they were. Then one atomic statement removes
// the rows (a failure there puts the photos back too), a read confirms none remain, and only then
// are the held photos removed. A removal that fails at that point leaves photos no request points
// to; they are reported, and the next erase or sweep removes them.
async function eraseRows({ store, settings, rows }) {
  await purgeHeld({ store, settings });
  const ids = rows.map((row) => row.id);
  const moves = rows.flatMap((row) => photoPaths(settings, row).map((from) => ({ row, from, to: from.startsWith(`${holdFolder(settings)}/`) ? from : heldPath(settings, row, from) })));
  const held = [];
  // A move that fails may still have happened (its reply was lost), or the photo may already be gone
  // (an earlier erase moved it and could not put it back or record where it went). So before giving
  // up, look where the photo really is.
  const present = async (path) => (await store.listObjects(path.slice(0, path.lastIndexOf("/")))).includes(path);
  const restore = async () => {
    const stuck = [];
    for (const move of [...held].reverse()) {
      if (move.from === move.to) continue;
      try {
        await store.moveObject(move.to, move.from);
      } catch {
        // Only a photo seen in the hold folder is recorded there. One that was put back but whose
        // reply was lost is where its request says. If it cannot be told, the request keeps its own
        // path: the next erase looks in both places (ADR 0388).
        try {
          if (await present(move.to)) stuck.push(move);
        } catch {
          // Left as the request says.
        }
      }
    }
    // A photo that could not be put back is still kept, where it is now, and its request points there.
    for (const row of rows) {
      const mine = stuck.filter((move) => move.row === row);
      if (!mine.length) continue;
      try {
        await store.setPhotos(row.id, row.photos.map((photo) => ({ ...photo, path: mine.find((move) => move.from === photo?.path)?.to ?? photo.path })));
      } catch {
        // The failure is reported either way; the rows and photos stay.
      }
    }
  };
  // Only a photo still where its request says it is counts as a failed move.
  try {
    for (const move of moves) {
      if (move.from !== move.to) {
        try {
          await store.moveObject(move.from, move.to);
        } catch (error) {
          if (await present(move.from)) throw error;
          // Gone from its place: held already if it is in the hold folder, else there is nothing to keep.
          if (!(await present(move.to))) continue;
        }
      }
      held.push(move);
    }
  } catch {
    await restore();
    throw new QuoteError(502, "erase-failed");
  }
  let deleted;
  try {
    deleted = await store.deleteRows(ids);
  } catch (error) {
    await restore();
    throw error;
  }
  if (deleted !== ids.length) {
    await restore();
    throw new QuoteError(502, "erase-failed");
  }
  if ((await store.byIds(ids)).length !== 0) throw new QuoteError(502, "erase-unverified");
  const left = held.map((move) => move.to);
  for (let turn = 0; turn < 2 && left.length; turn += 1) {
    try {
      await store.removeObjects(left);
      return { erased: ids.length, verified: true };
    } catch {
      // Tried once more, then reported.
    }
  }
  return left.length ? { erased: ids.length, verified: true, photosPending: left.length } : { erased: ids.length, verified: true };
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

// What this function can do with retention, for Admin to read before it sends anything that could
// erase: an older function has no `GET retention` and ignores both, so it would erase on a count.
export const RETENTION_CAN = Object.freeze({ dryRun: true, eraseBefore: true });

const cutoffFor = (days, now) => new Date(now() - days * DAY).toISOString();

// What the sweep would erase now, counted and changed nothing (G12): Admin asks before erasing.
// `before` is the cutoff it counted with; the erase that follows passes it back.
export async function retentionPreview({ store, settings, days, now }) {
  if (!days) return { enabled: false, wouldErase: 0, photos: 0, before: null };
  const before = cutoffFor(days, now);
  const rows = await store.archivedBefore(before, MAX_ERASE * 20);
  return { enabled: true, wouldErase: rows.length, photos: rows.reduce((n, row) => n + photoPaths(settings, row).length, 0), before };
}

// The earlier of a cutoff given by Admin (from its count) and the one the retention period gives
// now, so an erase never takes more than was counted, nor anything the period still keeps.
function sweepCutoff(days, now, given) {
  const own = cutoffFor(days, now);
  if (given === undefined || given === null) return own;
  const time = typeof given === "string" && given.length <= 40 ? Date.parse(given) : NaN;
  if (Number.isNaN(time)) throw new QuoteError(400, "bad-before");
  return new Date(Math.min(time, Date.parse(own))).toISOString();
}

// Archived requests older than the retention period (or than `before`, when given). One failed
// batch stops the sweep and reports.
export async function retentionSweep({ store, settings, days, now, before: given }) {
  if (!days) return { enabled: false, erased: 0 };
  const before = sweepCutoff(days, now, given);
  let erased = 0;
  let photosPending = 0;
  for (let round = 0; round < 20; round += 1) {
    const rows = await store.archivedBefore(before, MAX_ERASE);
    if (!rows.length) break;
    const result = await eraseRows({ store, settings, rows });
    erased += result.erased;
    photosPending += result.photosPending ?? 0;
  }
  if (!erased) await purgeHeld({ store, settings });
  return photosPending ? { enabled: true, erased, photosPending } : { enabled: true, erased };
}
