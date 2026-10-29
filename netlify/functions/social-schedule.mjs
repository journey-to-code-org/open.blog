// The hosted scheduling routes of optional social publishing (epic #353, ADR 0471). Reached only by
// the Rust Admin, server to server, at `<site>/.netlify/functions/social-schedule/<route>`; there is
// no redirect and nothing public links here. Off (404 for everything) unless OPENBLOG_SOCIAL_ENABLED
// is exactly "true" and every social setting is valid, so a deployment that never opts in answers
// as if the function did not exist.
import { createAnnouncements } from "../lib/social-announcements.mjs";
import { socialSettings } from "../lib/social-scope.mjs";

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

const routeOf = (path) => String(path || "").replace(/^.*\/social-schedule(?:\/|$)/, "");

export function createHandler({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  let warned = false;
  return async (event) => {
    const settings = socialSettings(env);
    if (!settings.enabled) {
      // Name the settings at fault, never their values, once per process.
      if (settings.problems.length && !warned) {
        warned = true;
        console.warn(`Social publishing is enabled but not configured: ${settings.problems.join(", ")}`);
      }
      return json(404, { error: "Not found." });
    }
    const body = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    const handle = createAnnouncements({ settings, fetchImpl, now });
    const result = await handle({
      method: String(event.httpMethod || "GET").toUpperCase(),
      route: routeOf(event.path),
      query: new URLSearchParams(event.queryStringParameters || {}),
      headers: event.headers || {},
      body,
    });
    return json(result.status, result.body);
  };
}

export const handler = createHandler();
