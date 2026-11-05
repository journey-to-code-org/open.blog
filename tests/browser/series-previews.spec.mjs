import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") test.use({ channel: "chrome" });

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(root, "web", "base.css"), "utf8");
const script = readFileSync(join(root, "web", "components", "ob-series-previews.js"), "utf8");
const thumbnail = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='orange'/%3E%3C/svg%3E";
const markup = `<button id="outside">Outside</button>
<aside class="ob-series-box">
<p class="ob-eyebrow">Part 2 of 3 in Guides</p>
<ob-series-previews><ol class="ob-series-path" aria-label="Series parts">
${[1, 2, 3].map((n) => {
  const attributes = `data-series-trigger aria-label="Part ${n}: Lesson ${n}" aria-describedby="preview-${n}" title="Part ${n}: Lesson ${n} - Summary ${n}"`;
  const trigger = n === 2
    ? `<span tabindex="0" aria-current="page" ${attributes}></span>`
    : `<a href="#lesson-${n}" ${attributes}></a>`;
  return `<li${n === 2 ? " data-current" : ""}>${trigger}
<div class="ob-series-preview" id="preview-${n}" role="tooltip" popover="manual">
${n === 1 ? `<img class="ob-series-preview-cover" src="${thumbnail}" alt="" loading="lazy">` : ""}
<p class="ob-meta">Part ${n} of 3${n === 2 ? " · Current part" : ""}</p>
<strong>Lesson ${n}</strong><p>Summary ${n}</p>
<p class="ob-meta"><time datetime="2026-01-01">Jan 1, 2026</time> · 3 min read</p>
</div></li>`;
}).join("")}
</ol></ob-series-previews>
<details><summary>All parts</summary><a href="#lesson-1">Lesson 1</a></details>
</aside>`;
const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`;

async function setup(page) {
  await page.setContent(html);
  await page.addScriptTag({ type: "module", content: script });
  await page.waitForFunction(() => customElements.get("ob-series-previews"));
}

test("hover opens a native rich tooltip; it is hoverable, dismissible, and links still navigate", async ({ page }) => {
  await setup(page);
  const node = page.locator("[data-series-trigger]").first();
  const tooltip = page.locator("#preview-1");
  await expect(tooltip).toBeHidden();
  await expect(node).not.toHaveAttribute("title");
  await node.hover();
  await expect(tooltip).toBeVisible();
  expect(await tooltip.evaluate((el) => el.matches(":popover-open"))).toBe(true);
  await expect(tooltip).toContainText("Lesson 1");
  await expect(tooltip).toContainText("Summary 1");
  await expect(tooltip).toContainText("Jan 1, 2026 · 3 min read");
  await expect(tooltip.locator("img")).toBeVisible();
  await expect(tooltip.locator("img")).toHaveJSProperty("naturalWidth", 320);
  await tooltip.hover();
  await page.waitForTimeout(400);
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await node.hover();
  await expect(tooltip).toBeVisible();
  await page.locator("#outside").hover();
  await expect(tooltip).toBeHidden();
  await node.click();
  await expect(page).toHaveURL(/#lesson-1$/);
});

test("all nodes including the current part support focus, one preview at a time, and Escape", async ({ page }) => {
  await setup(page);
  await page.locator("#outside").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#preview-1")).toBeVisible();
  await expect(page.locator("[data-series-trigger]").first()).toHaveAccessibleDescription(/Summary 1/);
  await page.keyboard.press("Tab");
  await expect(page.locator("[aria-current=page]")).toBeFocused();
  await expect(page.locator("#preview-1")).toBeHidden();
  await expect(page.locator("#preview-2")).toBeVisible();
  await expect(page.locator("#preview-2")).toContainText("Current part");
  await page.keyboard.press("Escape");
  await expect(page.locator("#preview-2")).toBeHidden();
  await expect(page.locator("[aria-current=page]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#preview-3")).toBeVisible();
  await page.locator("#outside").click();
  await expect(page.locator("#preview-3")).toBeHidden();
});

test("previews fit a narrow viewport and reposition above a node near the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await setup(page);
  await page.locator(".ob-series-box").evaluate((el) => {
    el.style.cssText = "position:fixed; bottom:0; right:0; width:100%; margin:0";
  });
  await page.locator("[data-series-trigger]").first().hover();
  const tooltip = page.locator("#preview-1");
  await expect(tooltip).toBeVisible();
  const box = await tooltip.boundingBox();
  const node = await page.locator("[data-series-trigger]").first().boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(312);
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.y + box.height).toBeLessThanOrEqual(node.y);
  await page.setViewportSize({ width: 280, height: 400 });
  const resized = await tooltip.boundingBox();
  expect(resized.x + resized.width).toBeLessThanOrEqual(272);
});

test("no script and unsupported browsers keep native titles, links, and hidden cards", async ({ browser, page }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const plain = await context.newPage();
  await plain.setContent(html);
  await expect(plain.locator("[data-series-trigger]").first()).toHaveAttribute("title", /Lesson 1/);
  await expect(plain.locator(".ob-series-preview:visible")).toHaveCount(0);
  await plain.locator("summary").click();
  await expect(plain.getByRole("link", { name: "Lesson 1", exact: true })).toBeVisible();
  await context.close();
  await page.evaluate(() => {
    Object.defineProperty(HTMLElement.prototype, "showPopover", { value: undefined, configurable: true });
  });
  await setup(page);
  await expect(page.locator("[data-series-trigger]").first()).toHaveAttribute("title", /Lesson 1/);
  await expect(page.locator(".ob-series-preview:visible")).toHaveCount(0);
});

test("disconnect closes the top-layer tooltip and restores titles for reconnection", async ({ page }) => {
  await setup(page);
  await page.locator("[data-series-trigger]").first().focus();
  await expect(page.locator("#preview-1")).toBeVisible();
  const restored = await page.locator("ob-series-previews").evaluate((el) => {
    el.remove();
    const title = el.querySelector("[data-series-trigger]").getAttribute("title");
    const open = el.querySelector(":popover-open");
    document.querySelector("aside").append(el);
    return { title, open: Boolean(open) };
  });
  expect(restored.title).toContain("Lesson 1");
  expect(restored.open).toBe(false);
  await page.locator("[data-series-trigger]").first().focus();
  await expect(page.locator("#preview-1")).toBeVisible();
});

test("an open preview does not print, because the series box does not", async ({ page }) => {
  await setup(page);
  await page.locator("[data-series-trigger]").first().focus();
  await expect(page.locator("#preview-1")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#preview-1")).toBeHidden();
});

test("touch follows a lesson link on the first tap", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await setup(page);
  await page.locator("[data-series-trigger]").first().tap();
  await expect(page).toHaveURL(/#lesson-1$/);
  await context.close();
});
