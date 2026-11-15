import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guardProviders, open, restartSite, startSite, stopSite, turnHelperOnDirect, repository } from "./helper-site.mjs";
import { api, writeRough, prompts } from "./voice-site.mjs";
import { tree, diff, login, audit, herWords, SHOTS } from "./qa-b1-lib.mjs";

let site; const notes = [];
const note = (s) => { notes.push(s); console.log("QA> " + s); };
test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.afterAll(async () => { await stopSite(site); console.log("\nQA-SUMMARY\n" + notes.join("\n")); });
const screen = (page) => page.locator(".studio-start");
const MARK = "QA-STORY-MARK-90210 we walked to the creek";

test("flag values over HTTP", async () => {
  site = await startSite("qa-b1-flag", { env: { OPENBLOG_STUDIO_ONBOARDING: null }, users: ["pat"] });
  const cfgPath = join(site.dir, "openblog.json");
  const cfg0 = readFileSync(cfgPath, "utf8");
  note(`init writes studio.onboarding=${JSON.parse(cfg0).studio?.onboarding}`);
  const cases = [[null, "on"], ["off", "on"], ["on", "off"], ["on:r-2", "off"], ["rehearse", "off"], ["ON", "on"], ["on:", "on"], ["on:x y", "on"], ["on:" + "a".repeat(33), "on"], ["", "on"], [" on ", "off"], ["true", "on"], ["1", "on"], [null, "rehearse"], [null, "on:2"], [null, true]];
  for (const [env, file] of cases) {
    const cfg = JSON.parse(cfg0); cfg.studio = { ...(cfg.studio || {}), onboarding: file }; writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    try { await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: env }); } catch (e) { note(`env=${JSON.stringify(env)} file=${JSON.stringify(file)}: SERVER DID NOT START: ${String(e).slice(0, 200)}`); continue; }
    const s = await login(site);
    const meta = (await s.call("GET", "meta")).json.onboarding;
    const acc = (await s.call("GET", "onboarding/accounts")).json;
    note(`env=${JSON.stringify(env)} file=${JSON.stringify(file)} -> mode=${meta.mode} due=${meta.due} keys=${Object.keys(meta).join(",")} source=${acc.source} round=${acc.round} problems=${JSON.stringify(acc.problems)}`);
  }
  writeFileSync(cfgPath, cfg0);
  // reset: any account, unknown user, no csrf, signed out
  await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: "on" });
  const sam = await login(site, "sam"); const pat = await login(site, "pat");
  const made = await sam.call("PUT", "onboarding", { etag: "", total: 2 });
  await sam.call("PUT", "onboarding", { etag: made.json.etag, status: "done" });
  const r1 = await pat.call("POST", "onboarding/reset", { user: "sam" });
  note(`pat resets sam: ${r1.status} returns record status=${r1.json?.record?.status}; log has line: ${/onboarding: pat reset sam/.test(site.output)}`);
  note(`reset unknown: ${(await pat.call("POST", "onboarding/reset", { user: "nobody" })).status}; reset path-ish user: ${(await pat.call("POST", "onboarding/reset", { user: "../sam" })).status}`);
  const noCsrf = await fetch(`${site.origin}/admin/api/onboarding/reset`, { method: "POST", headers: { Cookie: pat.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ user: "sam" }) });
  const anon = await fetch(`${site.origin}/admin/api/onboarding/accounts`);
  note(`reset without csrf: ${noCsrf.status}; accounts signed out: ${anon.status}`);
  // restore with a hostile record
  const bad = await pat.call("PUT", "onboarding/restore", { user: "sam", record: { v: 1, round: "1", status: "done", step: "done", stories: ["../../etc"], total: 2, startedAt: "<img src=x onerror=alert(1)>" } });
  note(`restore with bad story id: ${bad.status} ${bad.text.slice(0, 120)}`);
  const odd = await pat.call("PUT", "onboarding/restore", { user: "sam", record: { v: 1, round: "1", status: "done", step: "done", stories: [], total: 2, startedAt: "<img src=x onerror=alert(1)>" } });
  note(`restore with markup startedAt: ${odd.status}`);
  // #/start/done direct by API: PUT status done from nothing
  await pat.call("POST", "onboarding/reset", { user: "sam" });
  // practice flag refused when not rehearse
  note(`practice:true in on mode: ${(await sam.call("PUT", "onboarding", { etag: "", practice: true })).status}; voice/samples?practice=1 in on mode: ${(await sam.call("GET", "voice/samples?practice=1")).status}; session start practice: ${JSON.stringify((await sam.call("POST", "voice/session/start", { promptId: "a-meal-you-love", practice: true })).json).slice(0, 140)}`);
  await stopSite(site); site = null;
});

test("rehearse touches nothing real, incl. the nudge's Don't ask again", async ({ page }) => {
  test.setTimeout(240000);
  const unstubbed = await guardProviders(page);
  site = await startSite("qa-b1-reh", { env: { OPENBLOG_STUDIO_ONBOARDING: "on" }, users: ["pat"] });
  await turnHelperOnDirect(site);
  // her real state: record done, one real piece
  await open(page, site, "#/posts");
  const list = await prompts(page, site);
  await writeRough(page, site, list[0].id, "a real piece REAL-PIECE-MARK that must stay");
  const s = await login(site);
  const made = await s.call("PUT", "onboarding", { etag: "", total: 2 });
  const fin = await s.call("PUT", "onboarding", { etag: made.json.etag, steps: { stories: "skipped" }, status: "done" });
  expect(fin.status).toBe(200);
  const skip = (rel) => rel.startsWith(".openblog/private/onboarding/practice") || rel.startsWith("dist") || rel.startsWith(".git/");
  const before = tree(site.dir, skip);
  await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: "rehearse" });
  await open(page, site, "#/");
  await expect(page).toHaveURL(/#\/start\/stories/);
  const words = await herWords(page);
  if (words.length) note(`rehearse stories step her-layer banned words: ${words.join(", ")} (practice strip is details-layer by spec but shown on her layer)`);
  // run 1: skip stories -> done, then new post -> nudge -> Don't ask again
  await screen(page).getByRole("button", { name: "Skip stories for now" }).click();
  await expect(screen(page).getByRole("heading", { name: "You're ready" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/rehearse-done.png` });
  note(`rehearse done text: ${(await screen(page).innerText()).replace(/\n+/g, " | ").slice(0, 400)}`);
  await page.evaluate(() => { location.hash = "#/write/new/story"; });
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  const card = page.locator(".studio-story-nudge-card");
  const shown = await card.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  note(`rehearse: nudge shows in Write after skipping stories: ${shown}`);
  if (shown) {
    await card.getByRole("button", { name: "Don't ask again" }).click();
    await page.waitForTimeout(800);
  }
  note(`rehearse after nudge stop: real files ${JSON.stringify(diff(before, tree(site.dir, skip)))}`);
  // run 2: type a story, throw it away, type another
  await page.goto("about:blank"); await page.goto(`${site.origin}/admin/studio/#/`);
  await expect(page).toHaveURL(/#\/start\/stories/);
  await screen(page).locator("choice-cards [role=radio]").first().click();
  await screen(page).getByRole("button", { name: "Type it", exact: true }).click();
  const box = screen(page).locator("textarea.studio-voice-rough");
  await box.pressSequentially(MARK, { delay: 1 });
  await screen(page).getByRole("button", { name: "I'm done" }).click();
  await expect(screen(page)).toContainText("Kept. That's 1 of 3.");
  const ls = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  note(`after practice story localStorage keys: ${Object.keys(ls).join(", ")}; contains story: ${JSON.stringify(ls).includes("QA-STORY-MARK")}; sessionStorage keys: ${await page.evaluate(() => Object.keys(sessionStorage).join(","))}`);
  // Read it & throw away
  await screen(page).getByRole("button", { name: /Throw this one away/ }).first().click();
  await page.getByRole("button", { name: "Throw it away", exact: true }).click();
  await page.waitForTimeout(600);
  note(`rehearse after story+throw: real files ${JSON.stringify(diff(before, tree(site.dir, skip)))}; practice files: ${Object.keys(tree(join(site.dir, ".openblog/private/onboarding/practice"))).join(", ")}`);
  // reset another's from rehearse (documented deliberate action) - just record
  note(`log contains practice story text: ${site.output.includes("QA-STORY-MARK")}; real mark: ${site.output.includes("REAL-PIECE-MARK")}`);
  await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: "on" });
  note(`back to on: practice dir exists=${existsSync(join(site.dir, ".openblog/private/onboarding/practice"))}; sweep log=${(site.output.match(/onboarding: cleared practice[^\n]*/) || [""])[0]}; real files ${JSON.stringify(diff(before, tree(site.dir, skip)))}`);
  const s2 = await login(site);
  note(`sam meta after on: ${JSON.stringify((await s2.call("GET", "meta")).json.onboarding)}; prefs: ${JSON.stringify((await s2.call("GET", "voice/status")).json?.invitation ?? (await s2.call("GET", "voice/status")).json).slice(0, 200)}`);
  expect(unstubbed).toEqual([]);
  await stopSite(site); site = null;
});

test("on: story privacy, edges, a11y at each step", async ({ page }) => {
  test.setTimeout(300000);
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
  const unstubbed = await guardProviders(page);
  site = await startSite("qa-b1-on", { env: { OPENBLOG_STUDIO_ONBOARDING: "on" }, users: ["pat"] });
  // No key: key step shows.
  await open(page, site, "#/");
  await expect(page).toHaveURL(/#\/start\/helper/);
  const problems = [];
  for (const [label, opts] of [["start-key-320", { w: 320 }], ["start-key-320-dark", { w: 320, dark: true }]]) {
    await page.emulateMedia({ colorScheme: opts.dark ? "dark" : "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: opts.w, height: 700 });
    await page.waitForTimeout(300);
    problems.push(...await audit(page, label));
  }
  note(`key step her-layer banned: ${(await herWords(page)).join(", ") || "none"}`);
  // key step: custom-https default? what does it show
  note(`key step text: ${(await screen(page).innerText()).replace(/\n+/g, " | ").slice(0, 500)}`);
  const key = screen(page).getByRole("textbox", { name: "Paste the key", exact: true });
  const hasField = await key.count();
  note(`key field present: ${hasField}`);
  if (hasField) {
    const attrs = await key.evaluate((n) => ({ type: n.type, ac: n.autocomplete, name: n.name, sc: n.spellcheck, cap: n.getAttribute("autocapitalize") }));
    note(`key field attrs ${JSON.stringify(attrs)}`);
    // leave mid-edit
    await key.fill("sk-ant-QA-LEAVE-KEY-000111");
    await screen(page).getByRole("button", { name: "Finish later" }).click();
    const ask = page.getByRole("dialog").filter({ hasText: "Leave without saving the key?" });
    note(`leave with key typed asks: ${await ask.isVisible().catch(() => false)}`);
    if (await ask.isVisible().catch(() => false)) await page.getByRole("button", { name: "Stay", exact: true }).click();
    // reload with key typed -> beforeunload? then field empty
    await page.reload();
    await expect(screen(page).getByRole("heading", { level: 2 })).toBeVisible();
    note(`after reload key field value: "${await screen(page).getByRole("textbox", { name: "Paste the key", exact: true }).inputValue().catch(() => "n/a")}"`);
    // failing server on save
    await page.route("**/admin/api/assistant/settings", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 500, json: { error: "boom /srv/site/.openblog sk-ant-QA-ECHO" } }) : r.fallback());
    const k2 = screen(page).getByRole("textbox", { name: "Paste the key", exact: true });
    await k2.fill("sk-ant-QA-FAIL-KEY-000222");
    const save = screen(page).getByRole("button", { name: "Save the key" });
    await save.dblclick();
    await page.waitForTimeout(800);
    note(`save 500: text=${(await screen(page).locator("[role=alert],[role=status],.studio-help").allInnerTexts()).join(" / ").slice(0, 300)}; field after="${await k2.inputValue()}"`);
    await page.unroute("**/admin/api/assistant/settings");
  }
  // skip key
  await screen(page).getByRole("button", { name: /^Skip/ }).first().click();
  await expect(page).toHaveURL(/#\/start\/stories/);
  await page.setViewportSize({ width: 320, height: 700 });
  problems.push(...await audit(page, "start-stories-320-dark"));
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  problems.push(...await audit(page, "start-stories-320"));
  note(`stories her-layer banned: ${(await herWords(page)).join(", ") || "none"}`);
  // type story with markup, double click I'm done
  await screen(page).locator("choice-cards [role=radio]").first().click();
  await screen(page).getByRole("button", { name: "Type it", exact: true }).click();
  const box = screen(page).locator("textarea.studio-voice-rough");
  const story = `${MARK} <img src=x onerror="window.__qa=1"> [link](javascript:alert(1)) ‮reversed ${"W".repeat(400)}`;
  await box.fill(story);
  let puts = 0; page.on("request", (r) => { if (/voice\/session\/lock/.test(r.url())) puts += 1; });
  await problemsPush(problems, page, "start-typing-320");
  // expired session mid-story
  const cookies = await page.context().cookies();
  await page.context().clearCookies();
  await screen(page).getByRole("button", { name: "I'm done" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/start-expired.png` });
  note(`expired session on I'm done: url=${page.url().replace(site.origin, "")} sign-in shown=${await page.getByRole("textbox", { name: "Password", exact: true }).isVisible().catch(() => false)}; draft kept in localStorage=${await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k.startsWith("ob-voice")).map(([k, v]) => [k, v.length])))}`);
  if (await page.getByRole("textbox", { name: "Password", exact: true }).isVisible().catch(() => false)) {
    await page.getByRole("textbox", { name: "Your name", exact: true }).fill("sam");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(site.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForTimeout(2000);
    note(`after signing in again: url=${page.url().replace(site.origin, "")}; box value starts=${JSON.stringify((await screen(page).locator("textarea.studio-voice-rough").inputValue().catch(() => "NO BOX")).slice(0, 40))}`);
    await page.screenshot({ path: `${SHOTS}/start-after-signin.png` });
  } else { await page.context().addCookies(cookies); }
  const done = screen(page).getByRole("button", { name: "I'm done" });
  if (await done.isVisible().catch(() => false)) { await done.dblclick(); await page.waitForTimeout(1200); }
  note(`lock requests after dblclick: ${puts}; status: ${(await screen(page).locator(".studio-start-progress, [role=status]").allInnerTexts()).join(" / ").slice(0, 200)}`);
  note(`markup executed: ${await page.evaluate(() => window.__qa === 1)}; imgs in start: ${await screen(page).locator("img").count()}; links: ${await screen(page).locator("a[href^='javascript']").count()}`);
  const read = screen(page).getByRole("button", { name: /^Read it/ }).first();
  if (await read.isVisible().catch(() => false)) {
    await read.click(); await page.waitForTimeout(500);
    problems.push(...await audit(page, "start-readit-sheet-320"));
    await page.screenshot({ path: `${SHOTS}/start-readit.png` });
    await page.keyboard.press("Escape");
  }
  problems.push(...await audit(page, "start-story-kept-320"));
  // privacy on disk and in build + logs + storage
  const voiceDir = join(site.dir, ".openblog/private/context/voice");
  note(`voice files: ${existsSync(voiceDir) ? readdirSync(voiceDir).join(", ") : "none"}`);
  note(`log has story: ${site.output.includes("QA-STORY-MARK")}; storage has story: ${await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]).includes("QA-STORY-MARK"))}`);
  try { execFileSync(join(repository, "target/debug/openblog"), ["build", "--root", site.dir], { stdio: "pipe" }); const out = execFileSync("grep", ["-rl", "QA-STORY-MARK", join(site.dir, "dist")], { stdio: "pipe" }).toString(); note(`BUILD CONTAINS STORY: ${out}`); } catch (e) { note(`build grep for story: none (exit ${e.status})`); }
  // reload resumes
  await page.reload();
  await expect(screen(page).getByRole("heading", { level: 2 })).toBeVisible();
  await page.waitForTimeout(800);
  note(`reload resumes at ${page.url().replace(site.origin, "")}: ${(await screen(page).innerText()).replace(/\n+/g, " | ").slice(0, 260)}`);
  // direct #/start/done marks done?
  const pat = await login(site, "pat");
  await pat.call("PUT", "onboarding", { etag: "", total: 3 });
  // failing onboarding PUT
  await page.route("**/admin/api/onboarding", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 500, json: { error: "boom" } }) : r.fallback());
  const enough = screen(page).getByRole("button", { name: "That's enough for now" });
  if (await enough.isVisible().catch(() => false)) { await enough.click(); await page.waitForTimeout(800); note(`PUT onboarding 500 on That's enough: url=${page.url().replace(site.origin, "")}; toast=${(await page.locator("toast-region").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 200)}`); }
  await page.unroute("**/admin/api/onboarding");
  if (await enough.isVisible().catch(() => false)) await enough.click();
  await page.waitForTimeout(1200);
  note(`after stories: url=${page.url().replace(site.origin, "")} ${(await screen(page).innerText()).replace(/\n+/g, " | ").slice(0, 300)}`);
  problems.push(...await audit(page, "start-done-320"));
  note(`done her-layer banned: ${(await herWords(page)).join(", ") || "none"}`);
  // Home details + card for another account, dark
  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForTimeout(1200);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  problems.push(...await audit(page, "home-320-dark"));
  note(`home her-layer banned: ${(await herWords(page)).join(", ") || "none"}`);
  note(`a11y/layout problems:\n  ${problems.join("\n  ") || "none"}`);
  note(`page errors: ${errors.join(" || ").slice(0, 600) || "none"}`);
  expect(unstubbed).toEqual([]);
  await stopSite(site); site = null;
});
async function problemsPush(list, page, label) { list.push(...await audit(page, label)); }
