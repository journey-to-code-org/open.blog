// Pure model behind <ob-fetch-lab>: a pretend server, a fetch() trace, and a small pretend
// Web Storage with a quota. No DOM, no network. Everything is deterministic so lessons and
// tests can rely on it.

const JSON_TYPE = "application/json";
const POSTS = [
  { id: 1, title: "Hello, fetch" },
  { id: 2, title: "Storage basics" },
];

export const presets = [
  { label: "List posts", method: "GET", path: "/api/posts" },
  { label: "One post", method: "GET", path: "/api/posts/1" },
  { label: "Missing post (404)", method: "GET", path: "/api/posts/99" },
  { label: "Server error (500)", method: "GET", path: "/api/error" },
  { label: "Broken JSON", method: "GET", path: "/api/broken" },
  { label: "Not JSON at all", method: "GET", path: "/api/text" },
  { label: "Network down", method: "GET", path: "/api/offline" },
  {
    label: "Create post", method: "POST", path: "/api/posts",
    headers: "Content-Type: application/json", body: '{"title": "My first post"}',
  },
];

export function parseHeaders(text = "") {
  const headers = {};
  const ignored = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const at = line.indexOf(":");
    if (at < 1) ignored.push(line.trim());
    else headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { headers, ignored };
}

function respond(status, statusText, body, type = JSON_TYPE, extra = {}) {
  return {
    status, statusText, body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": type, ...extra },
  };
}

// The pretend server. Returns null for a network failure (fetch() rejects with TypeError).
export function handle({ method = "GET", path = "/", headers = {}, body = "" }) {
  const url = path.split("?")[0].replace(/^https?:\/\/[^/]+/, "").replace(/(.)\/$/, "$1");
  method = method.toUpperCase();
  if (url === "/api/offline") return null;
  let match;
  if (url === "/api/posts") {
    if (!["GET", "POST"].includes(method)) return respond(405, "Method Not Allowed", { error: "Use GET or POST here." }, JSON_TYPE, { allow: "GET, POST" });
    if (method === "GET") return respond(200, "OK", POSTS);
    if (!(headers["content-type"] || "").startsWith(JSON_TYPE)) {
      return respond(415, "Unsupported Media Type", { error: "Send Content-Type: application/json." });
    }
    let data;
    try { data = JSON.parse(body); } catch { return respond(400, "Bad Request", { error: "The body is not valid JSON." }); }
    if (typeof data?.title !== "string" || !data.title.trim()) return respond(422, "Unprocessable Content", { error: "A post needs a title." });
    return respond(201, "Created", { id: POSTS.length + 1, title: data.title }, JSON_TYPE, { location: `/api/posts/${POSTS.length + 1}` });
  }
  if ((match = url.match(/^\/api\/posts\/(\d+)$/))) {
    if (method !== "GET") return respond(405, "Method Not Allowed", { error: "Use GET here." }, JSON_TYPE, { allow: "GET" });
    const post = POSTS.find((item) => item.id === Number(match[1]));
    return post ? respond(200, "OK", post) : respond(404, "Not Found", { error: "Post not found." });
  }
  if (url === "/api/broken") return respond(200, "OK", '{"id": 1, "title": "Oops",}');
  if (url === "/api/text") return respond(200, "OK", "Plain words, not JSON.", "text/plain");
  if (url === "/api/error") return respond(500, "Internal Server Error", "Something broke on the server.", "text/plain");
  return respond(404, "Not Found", "<h1>Not Found</h1>", "text/html");
}

// What the reader's code would observe, step by step, and what to learn from it.
export function trace(request) {
  const response = handle(request);
  if (!response) {
    return {
      response: null, ok: false, json: { ok: false, error: "never read" },
      lessons: ["The network failed, so fetch() rejected with a TypeError. This is the only case where fetch() rejects. Handle it with try/catch."],
    };
  }
  const ok = response.status >= 200 && response.status < 300;
  let json;
  try { json = { ok: true, value: JSON.parse(response.body) }; } catch (error) { json = { ok: false, error: error.message }; }
  const lessons = [];
  if (!ok) lessons.push(`fetch() resolved even though the status is ${response.status}. HTTP errors are not rejections: check response.ok before reading the body.`);
  if (ok && !json.ok) lessons.push(`The request succeeded but response.json() would throw a SyntaxError: ${json.error}. A good status does not guarantee a valid body.`);
  if (ok && !json.ok && !response.headers["content-type"].startsWith(JSON_TYPE)) lessons.push(`The server said ${response.headers["content-type"]}. Check the Content-Type, or read response.text() instead.`);
  if (response.status === 415) lessons.push("A POST with a JSON body needs a Content-Type: application/json header, or the server cannot tell what it received.");
  if (response.status === 201) lessons.push("201 Created, and the Location header says where the new post lives.");
  if (ok && json.ok && !lessons.length) lessons.push("Success: status 2xx, valid JSON. Now you can use the data or store it.");
  return { response, ok, json, lessons };
}

export function snippet({ method = "GET", path = "/", headers = "", body = "" }) {
  const { headers: parsed } = parseHeaders(headers);
  const options = [];
  if (method !== "GET") options.push(`  method: ${JSON.stringify(method)},`);
  if (Object.keys(parsed).length) {
    options.push("  headers: {", ...Object.entries(parsed).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`), "  },");
  }
  if (method !== "GET" && method !== "HEAD" && body) options.push(`  body: ${JSON.stringify(body)},`);
  return [
    `const response = await fetch(${JSON.stringify(path)}${options.length ? ", {" : ");"}`,
    ...(options.length ? [...options, "});"] : []),
    "if (!response.ok) throw new Error(`HTTP ${response.status}`);",
    "const data = await response.json();",
  ].join("\n");
}

// ---- Pretend Web Storage ---------------------------------------------------------------

export const QUOTA = 256;

export function createStorage(quota = QUOTA) {
  return { quota, items: {} };
}

export function usage(storage) {
  return Object.entries(storage.items).reduce((sum, [key, value]) => sum + key.length + value.length, 0);
}

// Web Storage stores strings only: anything else goes through String(), so an object
// becomes "[object Object]". That is the lesson, so the model does it faithfully.
export function setItem(storage, key, value) {
  if (!key) return { storage, error: "Give the item a key." };
  const text = String(value);
  const items = { ...storage.items, [key]: text };
  const next = { ...storage, items };
  if (usage(next) > storage.quota) {
    return { storage, error: `QuotaExceededError: storing "${key}" would use ${usage(next)} of ${storage.quota} characters.` };
  }
  return { storage: next, stored: text };
}

export function getItem(storage, key) {
  return key in storage.items ? storage.items[key] : null;
}

export function removeItem(storage, key) {
  const { [key]: _gone, ...items } = storage.items;
  return { ...storage, items };
}

export function clear(storage) {
  return { ...storage, items: {} };
}
