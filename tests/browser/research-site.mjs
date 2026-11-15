// Shared by Studio's research specs (R11–R12): a signed-in fetch for arranging a site through its
// own API (never through the old Admin), and the few records the specs start from. Every value a
// test plants is plain text; nothing here is looked up online.
import { expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Sign in with fetch: `{ call(method, path, body) }` answers `{ status, json }`. */
export async function apiFor(site) {
  const login = await fetch(`${site.origin}/admin/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "sam", password: site.password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const token = (await login.json()).csrf;
  return {
    async call(method, path, body) {
      const response = await fetch(`${site.origin}/admin/api/${path}`, {
        method, headers: { Cookie: cookie, ...(method === "GET" ? {} : { "X-CSRF-Token": token, "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json().catch(() => null) };
    },
  };
}

/** Add sources in order, each on the library's latest revision. Returns the last reply. */
export async function addSources(api, records) {
  let reply = null;
  for (const record of records) {
    const library = await api.call("GET", "sources");
    reply = await api.call("POST", "sources", { revision: library.json.revision, source: record });
    expect(reply.status, JSON.stringify(reply.json)).toBe(201);
  }
  return reply;
}

/** Keep passages (and notes) in order. */
export async function addEntries(api, entries) {
  for (const entry of entries) {
    const notebook = await api.call("GET", "research/notebook");
    const kind = entry.excerpt ? "passages" : "notes";
    const reply = await api.call("POST", `research/${kind}`, { revision: notebook.json.revision, [kind === "passages" ? "passage" : "note"]: entry });
    expect(reply.status, JSON.stringify(reply.json)).toBe(201);
  }
}

/** The library most specs start with: a work, its translation with a rights statement, and a passage of it. */
export const WORK = { id: "plato-republic", kind: "work", title: "Republic", language: "grc", creators: [{ name: "Plato", role: "author" }] };
export const TRANSLATION = { id: "republic-slings", kind: "translation", of: "plato-republic", title: "Republic, tr. Slings", language: "en", issued: "2003", creators: [{ name: "S. R. Slings", role: "translator", family: "Slings", given: "S. R." }], identifiers: [{ scheme: "doi", value: "10.1000/republic" }] };
export const PASSAGE = { id: "passage-1", source: "republic-slings", excerpt: { text: "and they see only their own shadows", language: "en" }, locators: [{ kind: "page", value: "514" }] };

export function writePost(site, file, text) {
  writeFileSync(join(site.dir, "content", "posts", file), text);
}

export const readPost = (site, file) => readFileSync(join(site.dir, "content", "posts", file), "utf8");

/** Write a private research file by hand (a damaged or newer one). */
export function writePrivate(site, name, text) {
  mkdirSync(join(site.dir, ".openblog", "private", "research"), { recursive: true });
  writeFileSync(join(site.dir, ".openblog", "private", "research", name), text);
}

export const readPrivate = (site, name) => readFileSync(join(site.dir, ".openblog", "private", "research", name), "utf8");
