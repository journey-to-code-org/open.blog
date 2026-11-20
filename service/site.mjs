// A built open.blog site served by the family service, so a site can leave Netlify altogether.
// It does what netlify.toml did for the pages:
//
//   - files from the build folder, `/a/` as `/a/index.html` and `/a` as `/a/` when that folder exists;
//   - `_redirects` lines with an exact path and a 301 or 302 (what `openblog build` writes for
//     old addresses); anything fancier in that file is left alone and said once in the log;
//   - `/admin` and `/admin/*` forwarded (302) to the editor's address, OPENBLOG_ADMIN_URL;
//   - the public JSON and feeds readable by scripts on other sites (CORS `*`);
//   - `404.html` for anything missing;
//   - a file the build wrote under /api/ (the latest-posts JSON) before the catch-all function;
//   - an ETag so a browser revalidates instead of downloading again (Netlify's default, kept on
//     purpose: modules imported by other scripts aren't versioned in their address).
//
// Only GET and HEAD. A path never leaves the folder.

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".rss": "application/rss+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".gpx": "application/gpx+xml",
};
export const OPEN_TO_ALL = new Set(["/api/blog.json", "/api/views.json", "/feed.json", "/rss.xml"]);

/** The exact-path redirects of a `_redirects` file: Map(from → { to, status }), and the lines skipped. */
export function parseRedirects(text) {
  const rules = new Map();
  let skipped = 0;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [from, to, status = "301", ...rest] = line.split(/\s+/);
    const code = Number(status.replace(/!$/, ""));
    if (rest.length || !from?.startsWith("/") || /[*:]/.test(from) || !to || ![301, 302, 307, 308].includes(code)) {
      skipped += 1;
      continue;
    }
    rules.set(from, { to, status: code });
  }
  return { rules, skipped };
}

/** The editor's address for an /admin request, or null when the path isn't one. */
export function adminTarget(adminUrl, pathname, search = "") {
  if (!adminUrl || (pathname !== "/admin" && !pathname.startsWith("/admin/"))) return null;
  const base = adminUrl.replace(/\/+$/, "");
  const rest = pathname === "/admin" ? "/" : pathname.slice("/admin".length);
  return `${base}${rest}${search}`;
}

/** A request handler for the site in `root`. */
export async function createSite({ root, adminUrl = "", log = () => {} }) {
  const base = normalize(root);
  const admin = /^https:\/\/[^\s"<>]+\/admin\/?$/.test(adminUrl) ? adminUrl : "";
  if (adminUrl && !admin) log("OPENBLOG_ADMIN_URL must be an https address ending in /admin/; /admin isn't forwarded");
  const { rules, skipped } = parseRedirects(await readFile(join(base, "_redirects"), "utf8").catch(() => ""));
  if (skipped) log(`${skipped} line(s) of _redirects aren't exact redirects and were left out`);

  const inside = (pathname) => {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes("\0")) return null;
    const path = normalize(join(base, decoded));
    return path === base || path.startsWith(base + sep) ? path : null;
  };
  const fileAt = async (path) => (await stat(path).catch(() => null))?.isFile() ? path : null;
  const dirAt = async (path) => Boolean((await stat(path).catch(() => null))?.isDirectory());

  async function site(request, response, url) {
    const method = request.method || "GET";
    const pathname = url.pathname;
    const go = (status, location) => {
      response.writeHead(status, { location, "cache-control": "no-store" });
      response.end();
    };
    const forward = adminTarget(admin, pathname, url.search);
    if (forward) return go(302, forward);
    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
      return response.end("Method not allowed\n");
    }
    const rule = rules.get(pathname);
    if (rule) return go(rule.status, rule.to);

    const path = inside(pathname);
    let file = null;
    let status = 200;
    if (path) {
      if (pathname.endsWith("/")) file = await fileAt(join(path, "index.html"));
      else {
        file = await fileAt(path);
        if (!file && (await dirAt(path)) && (await fileAt(join(path, "index.html")))) return go(301, `${pathname}/${url.search}`);
        if (!file) file = await fileAt(`${path}.html`);
      }
    }
    if (!file || file.endsWith(`${sep}_redirects`)) {
      file = await fileAt(join(base, "404.html"));
      status = 404;
    }
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return response.end("Not found\n");
    }
    const bytes = await readFile(file);
    const tag = `"${createHash("sha256").update(bytes).digest("base64url").slice(0, 27)}"`;
    const headers = {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "public, max-age=0, must-revalidate",
      "x-content-type-options": "nosniff",
      etag: tag,
    };
    if (OPEN_TO_ALL.has(pathname)) headers["access-control-allow-origin"] = "*";
    if (status === 200 && request.headers["if-none-match"] === tag) {
      response.writeHead(304, headers);
      return response.end();
    }
    headers["content-length"] = bytes.length;
    response.writeHead(status, headers);
    response.end(method === "HEAD" ? undefined : bytes);
  }
  // A file the build wrote wins over the functions' catch-all under /api/ (as on Netlify, where a
  // file is served before a redirect that isn't forced): /api/blog.json, /api/views.json.
  site.serves = async (pathname) => {
    const path = inside(pathname);
    return Boolean(path && !pathname.endsWith("/") && (await fileAt(path)));
  };
  return site;
}
