// open.blog's hosted functions as one long-running service, for Railway or any Docker host.
//
// It runs the very same code Netlify runs (netlify/functions/*.mjs): notes, views and moderation
// (engagement), greeting cards, gifts under the tree, push notices, quote requests, received
// Webmentions and social publishing. Each request becomes the event a Netlify function takes, and its
// answer goes back as HTTP. The jobs Netlify (or pg_cron) runs on a schedule run here on timers:
// due greeting cards hourly, the quote retention sweep daily, the social delivery worker each minute.
//
// Quote request photos, which Netlify keeps in Supabase Storage, are kept in a folder
// (OPENBLOG_STORAGE_DIR, a Railway volume) by service/storage.mjs. With OPENBLOG_SITE_DIR the
// service also serves a built site (service/site.mjs), so a site can leave Netlify altogether.
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
import { existsSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";
import { NO_STORAGE, createStorage } from "./storage.mjs";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const MAX_BODY_BYTES = 256 * 1024;
// A quote request carries up to five photos of up to 900 KB (netlify/lib/quote-intake.mjs).
export const BODY_LIMITS = { quote: 6 * 1024 * 1024 };
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

/** Which function answers a path: each by its name under /api/, everything else under /api/ is engagement. */
export function routeFor(pathname) {
  if (pathname === "/health") return "health";
  if (pathname.startsWith("/storage/v1/object/sign/")) return "storage";
  for (const name of ["greetings", "gifts", "push", "quote", "social-worker", "social", "webmention"]) {
    if (pathname === `/api/${name}` || pathname.startsWith(`/api/${name}/`)) return name;
  }
  if (pathname.startsWith("/.netlify/functions/engagement/") || pathname.startsWith("/api/")) return "engagement";
  return null;
}

// Bodies a function reads as text arrive as text; anything else (a form with photos) as base64,
// the way Netlify hands it over, so no byte is changed.
const TEXTUAL = /^(?:text\/|application\/(?:json|x-www-form-urlencoded|[a-z.+-]*\+json)\b)/i;
export function eventBody(bytes, contentType) {
  if (!bytes.length) return { body: "", isBase64Encoded: false };
  if (!contentType || TEXTUAL.test(String(contentType))) return { body: bytes.toString("utf8"), isBase64Encoded: false };
  return { body: bytes.toString("base64"), isBase64Encoded: true };
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
    request.on("end", () => { if (!over) resolve(Buffer.concat(chunks)); });
    request.on("error", reject);
  });
}

const send = (response, answer) => {
  response.writeHead(answer.status, answer.headers);
  response.end(answer.body);
};

/** The public service: one HTTP server in front of the function handlers (and, optionally, a site). */
export function createService({ handlers, trustRealIp = false, maxBytes = MAX_BODY_BYTES, limits = BODY_LIMITS, storage = NO_STORAGE, site = null, log = () => {} }) {
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://service.invalid");
    const name = routeFor(url.pathname);
    if (name === "health") return json(response, 200, { ok: true });
    if (name === "storage") {
      try {
        return send(response, await storage.servePublic({ method: request.method, pathname: url.pathname, searchParams: url.searchParams }));
      } catch {
        return json(response, 404, { error: "not-found" });
      }
    }
    if (name === "engagement" && site?.serves && (await site.serves(url.pathname))) return site(request, response, url);
    const handler = name && handlers[name];
    if (!handler) {
      if (!name && site) return site(request, response, url);
      return json(response, 404, { error: "not-found" });
    }
    let bytes;
    try {
      bytes = await readBody(request, limits[name] || maxBytes);
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
        rawQuery: url.search.slice(1),
        headers,
        queryStringParameters: Object.fromEntries(url.searchParams),
        ...eventBody(bytes, request.headers["content-type"]),
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

/**
 * The loopback bridge: `/rest/v1/<x>` (the address shape the functions use) to PostgREST's `/<x>`,
 * and `/storage/v1/...` to the folder storage.
 */
export function createRestBridge({ target, storage = NO_STORAGE, maxBytes = 2 * 1024 * 1024 }) {
  const upstream = new URL(target);
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://bridge.invalid");
    if (url.pathname.startsWith("/storage/v1/object")) {
      let body;
      try {
        body = await readBody(request, maxBytes);
      } catch (error) {
        return json(response, error.status || 400, { error: "too-large" });
      }
      try {
        return send(response, await storage.serveInternal({ method: request.method, pathname: url.pathname, headers: request.headers, body }));
      } catch {
        return json(response, 503, { error: "storage-unavailable" });
      }
    }
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

/** Runs `job` every `every` ms, never two at once, and once `first` ms after start. */
export function repeat(job, { every = HOUR, first = 15000, log = () => {}, label = "job" } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (error) {
      log(`${label} failed: ${error?.message || error}`);
    } finally {
      running = false;
    }
  };
  const start = setTimeout(tick, first);
  const timer = setInterval(tick, every);
  return () => { clearTimeout(start); clearInterval(timer); };
}

/** Runs `job` every hour, never two at once, and once a few seconds after start. */
export const everyHour = (job, options = {}) => repeat(job, { label: "hourly job", ...options, every: HOUR });

/** The public https address of this service, if the host says it (Railway does). */
export function publicAddress(env) {
  const given = String(env.OPENBLOG_SERVICE_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[^\s"<>/]+$/.test(given)) return given;
  const domain = String(env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  return /^[a-z0-9.-]+$/i.test(domain) ? `https://${domain}` : "";
}

async function main() {
  const log = (line) => console.log(`[service] ${line}`);
  const port = Number(process.env.PORT || 8080);
  const bridgePort = Number(process.env.OPENBLOG_REST_BRIDGE_PORT || 54321);
  const postgrest = process.env.OPENBLOG_POSTGREST_URL || "http://127.0.0.1:3000";
  const serviceKey = mintServiceKey(process.env.PGRST_JWT_SECRET);
  const publicUrl = publicAddress(process.env);
  // The functions read the Supabase settings; here they point at the bridge and the minted key.
  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${bridgePort}`,
    SUPABASE_SECRET_KEY: serviceKey,
    ...(publicUrl && !process.env.OPENBLOG_STORAGE_PUBLIC_URL ? { OPENBLOG_STORAGE_PUBLIC_URL: publicUrl } : {}),
  };
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const on = (name) => String(env[name] || "").trim().toLowerCase() === "true";

  const handlers = {};
  const load = async (file, factory = "createHandler") => {
    const path = new URL(`../netlify/functions/${file}`, import.meta.url);
    if (!existsSync(path)) return null; // a function this engine version doesn't have
    const module = await import(pathToFileURL(path.pathname).href);
    return module[factory]({ env });
  };
  handlers.engagement = await load("engagement.mjs");
  handlers.greetings = await load("greetings.mjs");
  handlers.gifts = await load("gifts.mjs");
  handlers.push = await load("push.mjs");
  handlers.quote = await load("quote.mjs");
  handlers.webmention = await load("webmention.mjs");
  // Social publishing resizes covers with sharp, a native module: needed only when it is on.
  try {
    handlers.social = await load("social.mjs");
    handlers["social-worker"] = await load("social-worker.mjs");
  } catch (error) {
    if (on("OPENBLOG_SOCIAL_ENABLED")) throw error;
    log("social publishing isn't available here (it is off)");
  }
  for (const key of Object.keys(handlers)) if (!handlers[key]) delete handlers[key];

  const storage = process.env.OPENBLOG_STORAGE_DIR
    ? createStorage({ root: process.env.OPENBLOG_STORAGE_DIR, secret: process.env.PGRST_JWT_SECRET, serviceKey })
    : NO_STORAGE;
  if (on("OPENBLOG_QUOTE_ENABLED") && storage === NO_STORAGE) log("quote requests are on but OPENBLOG_STORAGE_DIR isn't set: photos can't be kept");

  let site = null;
  if (process.env.OPENBLOG_SITE_DIR) {
    const { createSite } = await import("./site.mjs");
    site = await createSite({ root: process.env.OPENBLOG_SITE_DIR, adminUrl: process.env.OPENBLOG_ADMIN_URL || "", log });
    log(`serving the site from ${process.env.OPENBLOG_SITE_DIR}`);
  }

  createRestBridge({ target: postgrest, storage }).listen(bridgePort, "127.0.0.1");
  createService({ handlers, storage, site, trustRealIp: process.env.OPENBLOG_TRUST_X_REAL_IP === "true", log })
    .listen(port, "0.0.0.0", () => log(`listening on ${port}: ${Object.keys(handlers).join(", ")}`));

  // What Netlify's schedules and pg_cron did.
  const sendCards = await load("greetings-send.mjs", "createRun");
  if (sendCards) everyHour(sendCards, { log });
  const sweep = await load("quote-retention.mjs", "createSweep");
  if (sweep) repeat(sweep, { every: DAY, first: 5 * MINUTE, log, label: "quote retention sweep" });
  const workerKey = String(env.OPENBLOG_SOCIAL_WORKER_KEY || "");
  if (handlers["social-worker"] && on("OPENBLOG_SOCIAL_ENABLED") && workerKey) {
    const worker = handlers["social-worker"];
    repeat(() => worker({ httpMethod: "POST", path: "/api/social-worker", headers: { authorization: `Bearer ${workerKey}` }, body: "", isBase64Encoded: false, queryStringParameters: {}, rawQuery: "" }),
      { every: MINUTE, first: 30000, log, label: "social worker" });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(`[service] could not start: ${error?.message || error}`);
    process.exit(1);
  });
}
