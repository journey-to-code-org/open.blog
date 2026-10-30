// The Supabase side of quote requests (ADR 0900): PostgREST rows and private Storage objects, both
// as service_role through `fetchImpl`, so tests run against a fake. Nothing here logs; errors carry
// a fixed code, never a row, a path with a name in it, a key or provider text.

import { QuoteError } from "./quote-intake.mjs";

export const BUCKET = "openblog-quote-photos";
const TABLE = "openblog_quote_requests";

export function createStore({ settings, fetchImpl, now = () => Date.now() }) {
  const headers = (extra = {}) => ({
    apikey: settings.key,
    ...(settings.key.split(".").length === 3 ? { authorization: `Bearer ${settings.key}` } : {}),
    ...extra,
  });
  const call = async (path, init) => {
    try {
      return await fetchImpl(`${settings.url}${path}`, { ...init, signal: AbortSignal.timeout(10000) });
    } catch {
      throw new QuoteError(503, "storage-unavailable");
    }
  };
  const site = `site_id=eq.${encodeURIComponent(settings.siteId)}`;

  return {
    // How many requests this site (or this client) stored since `sinceMs`.
    async count({ client, sinceMs }) {
      const since = new Date(now() - sinceMs).toISOString();
      const filter = `${site}${client ? `&client_hash=eq.${encodeURIComponent(client)}` : ""}&created_at=gte.${encodeURIComponent(since)}`;
      const response = await call(`/rest/v1/${TABLE}?select=id&${filter}`, { method: "GET", headers: headers({ prefer: "count=exact", range: "0-0" }) });
      if (!response.ok) throw new QuoteError(503, "storage-unavailable");
      const total = /\/(\d+)$/.exec(response.headers.get("content-range") || "");
      if (!total) throw new QuoteError(503, "storage-unavailable");
      return Number(total[1]);
    },

    async uploadPhoto(path, bytes, type) {
      const response = await call(`/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers: headers({ "content-type": type }), body: bytes });
      if (!response.ok) throw new QuoteError(503, "storage-unavailable");
    },

    async removePhotos(paths) {
      for (const path of paths) {
        try {
          await call(`/storage/v1/object/${BUCKET}/${path}`, { method: "DELETE", headers: headers() });
        } catch {
          // Best effort: an orphan in a private bucket is harmless and listed by its request id.
        }
      }
    },

    // Inserts the row; a repeated token is a replay.
    async insert(row) {
      const response = await call(`/rest/v1/${TABLE}`, {
        method: "POST",
        headers: headers({ "content-type": "application/json", prefer: "return=minimal" }),
        body: JSON.stringify({ ...row, site_id: settings.siteId }),
      });
      if (response.status === 409) throw new QuoteError(409, "replayed");
      if (!response.ok) throw new QuoteError(503, "storage-unavailable");
    },

    // Notification outcomes only: ids, states, counts, codes and times. Never a visitor value.
    async notificationOverview() {
      const response = await call(`/rest/v1/${TABLE}?select=id,notify_status,notify_attempts,notify_error_code,created_at&${site}&notify_status=in.(pending,failed)&order=created_at.desc&limit=100`, { method: "GET", headers: headers() });
      if (!response.ok) throw new QuoteError(503, "storage-unavailable");
      return response.json();
    },

    // Rows whose email failed, or stayed pending long enough to be a lost attempt, with just what
    // the message needs.
    async retryable({ staleMs }) {
      const before = new Date(now() - staleMs).toISOString();
      const filter = `or=(notify_status.eq.failed,and(notify_status.eq.pending,created_at.lt.${before}))`;
      const response = await call(`/rest/v1/${TABLE}?select=id,name,town,service,photos,notify_attempts&${site}&${filter}&order=created_at.asc&limit=25`, { method: "GET", headers: headers() });
      if (!response.ok) throw new QuoteError(503, "storage-unavailable");
      return response.json();
    },

    async patch(id, changes) {
      const response = await call(`/rest/v1/${TABLE}?${site}&id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: headers({ "content-type": "application/json", prefer: "return=minimal" }),
        body: JSON.stringify(changes),
      });
      if (!response.ok) throw new QuoteError(503, "storage-unavailable");
    },
  };
}
