// open.blog's hosted functions as one long-running service, for Railway or any Docker host.
//
// It runs the very same code Netlify runs (netlify/functions/*.mjs): notes, views and moderation
// (engagement), greeting cards (greetings), and gifts under the tree (gifts). Each request becomes
// the event a Netlify function takes, and its answer goes back as HTTP. The hourly jobs Netlify
// schedules (sending the greeting cards that are due) run here on a timer.
//
// The database is Postgres with PostgREST in front, the same pair Supabase is made of, so the
// functions' storage calls are unchanged. A second listener on 127.0.0.1 only gives them the
// Supabase address shape (`/rest/v1/...`) and passes it to PostgREST; nothing outside this
// container reaches it. The service key is minted here at start from PGRST_JWT_SECRET and never
// leaves the process.
//
// The visitor's address comes from the proxy in front (Railway sets X-Real-IP on every request and
// overwrites any copy the visitor sent). It is handed to the functions in the one header they read,
// and a copy of that header from outside is always dropped.
//
//   node service/server.mjs        (service/entrypoint.sh starts it after PostgREST)

import { createHmac } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";

const HOUR = 60 * 60 * 1000;
export const MAX_BODY_BYTES = 256 * 1024;
const CLIENT_HEADER = "x-nf-client-connection-ip";

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
};

const b64url = (value) => Buffer.from(value).toString("base64url");

/** A long-lived HS256 token PostgREST accepts as the service role (what Supabase's secret key is). */
export function mintServiceKey(secret, { role = "service_role", now = Date.now() } = {}) {
  if (!secret || String(secret).length < 32) throw new Error("PGRST_JWT_SECRET must be at least 32 characters");
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ role, iss: "openblog-service", iat: Math.floor(now / 1000) }));
  const signature = createHmac("sha256", String(secret)).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${signature}`;
}

/** Which function answers a path: greetings and gifts by name, everything else under /api/ is engagement. */
export function routeFor(pathname) {
  if (pathname === "/health") return "health";
  if (pathname.startsWith("/api/greetings/") || pathname === "/api/greetings") return "greetings";
  if (pathname.startsWith("/api/gifts/") || pathname === "/api/gifts") return "gifts";
  if (pathname.startsWith("/.netlify/functions/engagement/") || pathname.startsWith("/api/")) return "engagement";
  return null;
}

/** The visitor's address: the one the proxy set, never one the visitor wrote. */
export function clientAddress(headers, { trustRealIp }) {
  if (!trustRealIp) return "";
  const value = String(headers["x-real-ip"] || "").trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(value) ? value : "";
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    request.on("data", (chunk) => {
      if (over) return; // read and dropped, so the 413 reaches the sender
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(Object.assign(new Error("too-large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => { if (!over) resolve(Buffer.concat(chunks).toString("utf8")); });
    request.on("error", reject);
  });
}

/** The public service: one HTTP server in front of the function handlers. */
export function createService({ handlers, trustRealIp = false, maxBytes = MAX_BODY_BYTES, log = () => {} }) {
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://service.invalid");
    const name = routeFor(url.pathname);
    if (name === "health") return json(response, 200, { ok: true });
    const handler = name && handlers[name];
    if (!handler) return json(response, 404, { error: "not-found" });
    let body = "";
    try {
      body = await readBody(request, maxBytes);
    } catch (error) {
      return json(response, error.status || 400, { error: error.status === 413 ? "too-large" : "bad-request" });
    }
    const headers = { ...request.headers };
    delete headers[CLIENT_HEADER];
    const client = clientAddress(request.headers, { trustRealIp });
    if (client) headers[CLIENT_HEADER] = client;
    try {
      const result = await handler({
        httpMethod: request.method,
        path: url.pathname,
        rawUrl: url.toString(),
        headers,
        queryStringParameters: Object.fromEntries(url.searchParams),
        body,
        isBase64Encoded: false,
      });
      const out = result?.isBase64Encoded ? Buffer.from(result.body || "", "base64") : result?.body ?? "";
      response.writeHead(result?.statusCode || 200, result?.headers || {});
      response.end(out);
    } catch (error) {
      log(`function ${name} failed: ${error?.message || error}`);
      if (!response.headersSent) json(response, 500, { error: "failed" });
      else response.end();
    }
  });
}

/** The loopback bridge: `/rest/v1/<x>` (the address shape the functions use) to PostgREST's `/<x>`. */
export function createRestBridge({ target }) {
  const upstream = new URL(target);
  return createServer((request, response) => {
    const url = new URL(request.url || "/", "http://bridge.invalid");
    if (!url.pathname.startsWith("/rest/v1/")) return json(response, 404, { error: "not-found" });
    const headers = { ...request.headers, host: upstream.host };
    delete headers.apikey;
    const forward = httpRequest(
      { hostname: upstream.hostname, port: upstream.port, method: request.method, path: url.pathname.slice("/rest/v1".length) + url.search, headers },
      (answer) => {
        response.writeHead(answer.statusCode || 502, answer.headers);
        answer.pipe(response);
      },
    );
    forward.on("error", () => json(response, 502, { error: "database-unavailable" }));
    request.pipe(forward);
  });
}

/** Runs `job` every hour, never two at once, and once a few seconds after start. */
export function everyHour(job, { log = () => {}, first = 15000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (error) {
      log(`hourly job failed: ${error?.message || error}`);
    } finally {
      running = false;
    }
  };
  const start = setTimeout(tick, first);
  const timer = setInterval(tick, HOUR);
  return () => { clearTimeout(start); clearInterval(timer); };
}

async function main() {
  const log = (line) => console.log(`[service] ${line}`);
  const port = Number(process.env.PORT || 8080);
  const bridgePort = Number(process.env.OPENBLOG_REST_BRIDGE_PORT || 54321);
  const postgrest = process.env.OPENBLOG_POSTGREST_URL || "http://127.0.0.1:3000";
  // The functions read the Supabase settings; here they point at the bridge and the minted key.
  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${bridgePort}`,
    SUPABASE_SECRET_KEY: mintServiceKey(process.env.PGRST_JWT_SECRET),
  };
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const handlers = {};
  const load = async (name, file, factory = "createHandler") => {
    const module = await import(pathToFileURL(new URL(`../netlify/functions/${file}`, import.meta.url).pathname).href);
    return module[factory]({ env });
  };
  handlers.engagement = await load("engagement", "engagement.mjs");
  handlers.greetings = await load("greetings", "greetings.mjs");
  try {
    handlers.gifts = await load("gifts", "gifts.mjs");
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
  const sendCards = await load("greetings-send", "greetings-send.mjs", "createRun");

  createRestBridge({ target: postgrest }).listen(bridgePort, "127.0.0.1");
  createService({ handlers, trustRealIp: process.env.OPENBLOG_TRUST_X_REAL_IP === "true", log })
    .listen(port, "0.0.0.0", () => log(`listening on ${port}`));
  everyHour(sendCards, { log });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(`[service] could not start: ${error?.message || error}`);
    process.exit(1);
  });
}
