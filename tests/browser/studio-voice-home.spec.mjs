import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { asNotSetUp, axeClean, guardProviders, open, startSite, stopSite, turnHelperOnDirect } from "./helper-site.mjs";
import { eraseVoice, prompts, writeRough } from "./voice-site.mjs";

// Home's invitation to Your writing voice (Studio R9). Ports the old Admin's admin-voice-invitation
// card cases (it explains, Try it is a link, No thanks is a button that remembers, a dismissal
// that couldn't be saved keeps the card and says so) on the new route (G64), with Undo.

let site;
let unstubbed;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => { site = await startSite("voice-home"); await turnHelperOnDirect(site); });
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const card = (page) => page.locator(".studio-home-voice-card");

test("the invitation shows once there's a helper and no pieces; No thanks is remembered on the server, with Undo", async ({ page }) => {
  await open(page, site, "#/");
  await eraseVoice(page, site);
  await open(page, site, "#/");
  await expect(card(page).getByRole("heading", { name: "Show your writing helper how you sound" })).toBeVisible();
  await expect(card(page)).toContainText("It's just for your helper and never appears on your blog.");
  await expect(card(page).getByRole("link", { name: "Try it" })).toHaveAttribute("href", "#/voice/write");
  // Below the way to start writing, never above it.
  const order = await page.evaluate(() => {
    const primary = document.querySelector(".studio-home .studio-primary, .studio-home empty-state");
    const invite = document.querySelector(".studio-home-voice-card");
    return primary.compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : "before";
  });
  expect(order).toBe("after");
  await axeClean(page, "Home with the invitation", ".studio-page");

  // A dismissal that can't be saved keeps the card and says so.
  await page.route("**/admin/api/voice/invitation", (route) => route.fulfill({ status: 500, json: { error: "disk" } }));
  await card(page).getByRole("button", { name: "No thanks" }).click();
  await expect(page.locator(".studio-home-voice .studio-did")).toContainText("That couldn't be remembered just now. Try again later.");
  await expect(card(page)).toBeVisible();
  await page.unroute("**/admin/api/voice/invitation");

  await card(page).getByRole("button", { name: "No thanks" }).click();
  await expect(card(page)).toHaveCount(0);
  const line = page.locator(".studio-home-voice .studio-did");
  await expect(line).toContainText("Okay. It's under Writing helper whenever you want it.");
  await expect(line.getByRole("button", { name: "Undo" })).toBeFocused();
  expect((await (await page.request.get(`${site.origin}/admin/api/voice/status`)).json()).invitationDismissed).toBe(true);
  // One small file, named by a hash, holds the answer; nothing in the browser does.
  expect(readdirSync(join(site.dir, ".openblog/private/voice/invitation"))).toHaveLength(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => /invit/i.test(key)))).toEqual([]);
  await open(page, site, "#/");
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  // Undo brings it back.
  const token = (await (await page.request.get(`${site.origin}/admin/api/session`)).json()).csrf;
  await page.request.post(`${site.origin}/admin/api/voice/invitation`, { headers: { "X-CSRF-Token": token }, data: { dismissed: true } });
  await open(page, site, "#/");
  await page.request.post(`${site.origin}/admin/api/voice/invitation`, { headers: { "X-CSRF-Token": token }, data: { dismissed: false } });
  await open(page, site, "#/");
  await expect(card(page)).toBeVisible();
  await card(page).getByRole("button", { name: "No thanks" }).click();
  await page.locator(".studio-home-voice .studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(card(page).getByRole("heading", { name: "Show your writing helper how you sound" })).toBeFocused();
  expect((await (await page.request.get(`${site.origin}/admin/api/voice/status`)).json()).invitationDismissed).toBe(false);
});

test("no invitation once she has a piece, while one is in progress, or without a helper", async ({ page }) => {
  await open(page, site, "#/");
  await eraseVoice(page, site);
  const [prompt] = await prompts(page, site);
  await writeRough(page, site, prompt.id, "one piece is enough");
  await open(page, site, "#/");
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(card(page)).toHaveCount(0);
  await eraseVoice(page, site);
  await asNotSetUp(page);
  await page.route("**/admin/api/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), quizGeneration: false } });
  });
  await open(page, site, "#/");
  await page.waitForLoadState("networkidle");
  await expect(card(page)).toHaveCount(0);
});
