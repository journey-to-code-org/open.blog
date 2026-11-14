// What the worker keeps (Studio R4 G35), copied from web/studio/sw.js (a classic script, which can't
// import) so it can be tested; tests/web/studio-worker-rules.test.mjs keeps the two copies the same.

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
