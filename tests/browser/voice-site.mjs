// Shared by Your writing voice's browser specs (Studio R9): pieces made the way the screen makes
// them (a session started and locked through the site's own routes), never by writing files.
import { expect } from "@playwright/test";
import { csrf } from "./helper-site.mjs";

async function call(page, site, method, path, data) {
  const token = await csrf(page, site);
  const response = await page.request.fetch(`${site.origin}/admin/api/${path}`, { method, headers: { "X-CSRF-Token": token }, data });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

/** Every prompt the site offers: `[{ id, pack, title }]`. */
export async function prompts(page, site) {
  const listing = await (await page.request.get(`${site.origin}/admin/api/voice/samples`)).json();
  return listing.coverage.flatMap((pack) => pack.prompts.map((prompt) => ({ id: prompt.id, title: prompt.title, pack: pack.id, packTitle: pack.title })));
}

/** Write a rough draft for `promptId`; returns the sample as the server describes it. */
export async function writeRough(page, site, promptId, text) {
  const started = await call(page, site, "POST", "voice/session/start", { promptId });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const locked = await call(page, site, "POST", "voice/session/lock", { sessionId: started.body.sessionId, text });
  expect(locked.status, JSON.stringify(locked.body)).toBe(200);
  return locked.body.sample;
}

/** Save a polished copy of a rough draft. */
export async function polish(page, site, rough, title, body) {
  const saved = await call(page, site, "POST", "voice/samples", { roughOf: rough.file, title, body });
  expect(saved.status, JSON.stringify(saved.body)).toBe(201);
  return saved.body;
}

/** Throw away whatever piece is in progress. */
export async function scrapSession(page, site) {
  const status = await (await page.request.get(`${site.origin}/admin/api/voice/status`)).json();
  if (status.session?.open) await call(page, site, "DELETE", "voice/session", { sessionId: status.session.sessionId ?? null });
}

/** Erase everything voice, so a test starts from nothing. */
export async function eraseVoice(page, site) {
  await scrapSession(page, site);
  const erased = await call(page, site, "POST", "voice/erase", { confirm: "erase" });
  expect(erased.status).toBe(200);
}

export const api = call;
