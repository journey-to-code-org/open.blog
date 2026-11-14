// What the worker keeps (Studio R4 G35), copied from web/studio/sw.js (a classic script, which can't
// import) so it can be tested; tests/web/studio-sw.test.mjs keeps the two copies the same. Also the
// plain half of Details' release line (parts/releases.js reads the three versions).

/** Whether a request is one of Studio's own files the worker keeps: a GET under /admin/studio/ on this origin. */
export function keeps(url, method, origin) {
  if (method !== "GET") return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.origin === origin && parsed.pathname.startsWith("/admin/studio/") && !parsed.pathname.includes("/api/") && !parsed.search;
}

/** The release named on the served worker's first line, or "" when it can't be read. */
export function scriptRelease(text) {
  const match = /^self\.STUDIO_RELEASE = (\{.*\});/m.exec(String(text || ""));
  if (!match) return "";
  try {
    const version = JSON.parse(match[1])?.version;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}

/**
 * Details' line about releases: the worker's copy, the page running now and the server's, side by
 * side, and a second line when the ones known differ. `{ lines, mismatch }`.
 */
export function releaseLines({ worker = "", page = "", server = "" } = {}) {
  const known = [worker, page, server].filter(Boolean);
  const mismatch = new Set(known).size > 1;
  const lines = [`releases: worker ${worker || "none"} · page ${page || "unknown"} · server ${server || "unknown (no signal)"}`];
  if (mismatch) lines.push("These differ: reload to pick up the server's release, or use Clear saved pages if a reload doesn't.");
  return { lines, mismatch };
}
