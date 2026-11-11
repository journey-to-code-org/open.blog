// The quote function as a small local service, for a site run by `openblog serve` (Render; ADR 0387).
//
// It runs the very same code as the Netlify function (netlify/functions/quote.mjs) and the daily
// retention sweep (netlify/functions/quote-retention.mjs). It listens only on 127.0.0.1, so only the
// open.blog server on the same machine reaches it; that server passes the site's /api/quote/...
// addresses here, with the visitor's address it worked out in X-Forwarded-For. Off unless
// OPENBLOG_QUOTE_ENABLED is exactly "true". Nothing is logged but a start line and a failed start.
//
//   node scripts/quote-service.mjs        (the container entrypoint starts it when quote requests are on)

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { createHandler } from "../netlify/functions/quote.mjs";
import { createSweep } from "../netlify/functions/quote-retention.mjs";
import { MAX_RELAYED_BODY_BYTES } from "../netlify/lib/quote-intake.mjs";

export const DEFAULT_PORT = 8788;
const DAY = 24 * 60 * 60 * 1000;

const reply = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
};

// Turns one HTTP request into the event the function takes, and its answer back into HTTP.
export function createQuoteService({ handler, maxBytes = MAX_RELAYED_BODY_BYTES }) {
  return createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/quote/")) return reply(response, 404, { error: "not-found" });
    const chunks = [];
    let size = 0;
    let refused = false;
    request.on("data", (chunk) => {
      if (refused) return;
      size += chunk.length;
      if (size > maxBytes) {
        refused = true;
        reply(response, 413, { error: "too-large" });
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", async () => {
      if (refused) return;
      const headers = { ...request.headers };
      // Only the open.blog server sets the visitor's address; a Netlify header is never trusted here.
      delete headers["x-nf-client-connection-ip"];
      try {
        const result = await handler({
          httpMethod: request.method,
          path: url.pathname,
          headers,
          queryStringParameters: Object.fromEntries(url.searchParams),
          body: Buffer.concat(chunks),
          isBase64Encoded: false,
        });
        response.writeHead(result.statusCode, result.headers || {});
        response.end(result.body ?? "");
      } catch {
        if (!response.headersSent) reply(response, 500, { error: "failed" });
      }
    });
  });
}

// The retention sweep, once soon after start and then every day. A failure waits for the next turn.
export function scheduleSweep({ sweep, firstMs = 5 * 60 * 1000, everyMs = DAY, timers = globalThis }) {
  const run = async () => {
    try {
      await sweep();
    } catch {
      // Tried again tomorrow.
    }
  };
  const first = timers.setTimeout(run, firstMs);
  const daily = timers.setInterval(run, everyMs);
  first.unref?.();
  daily.unref?.();
  return { first, daily };
}

export function servicePort(env = process.env) {
  const raw = String(env.OPENBLOG_QUOTE_SERVICE_PORT ?? "").trim();
  if (!raw) return DEFAULT_PORT;
  const port = /^\d{4,5}$/.test(raw) ? Number(raw) : NaN;
  return port >= 1024 && port <= 65535 ? port : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const port = servicePort();
  if (String(process.env.OPENBLOG_QUOTE_ENABLED ?? "") !== "true") {
    console.log("quote service: off (OPENBLOG_QUOTE_ENABLED is not true)");
  } else if (port === null) {
    console.error("quote service: OPENBLOG_QUOTE_SERVICE_PORT must be a port from 1024 to 65535");
    process.exitCode = 1;
  } else {
    const server = createQuoteService({ handler: createHandler() });
    server.listen(port, "127.0.0.1", () => console.log(`quote service: listening on 127.0.0.1:${port}`));
    const timers = scheduleSweep({ sweep: createSweep() });
    // Keep the process alive through the server; the sweep timers ride along.
    server.on("close", () => {
      clearTimeout(timers.first);
      clearInterval(timers.daily);
    });
  }
}
