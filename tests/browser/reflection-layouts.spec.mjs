import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Sequential and side-by-side presentation of one approved reflection (ADR 0032). The markup is
// what the publish gate writes (crates/openblog-core/src/reflection.rs, `compose`); the styles are
// the real public stylesheet. The DOM order is the reading order and CSS only places it.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const styles = readFileSync(join(repository, "web", "base.css"), "utf8");

const LONG = "A long section that runs on and on so the other lane stays short. ".repeat(40);
const UNBROKEN = "x".repeat(200);

const turn = (lane, name, body) =>
  `<section class="ob-turn ob-lane-${lane}">\n<h2 class="ob-turn-author">${name}</h2>\n\n<p>${body}</p>\n\n</section>\n`;

function page({ layout, lanes, css = true }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${css ? `<style>${styles}</style>` : ""}</head><body><main><article>
<div class="ob-reflection ob-reflection-${layout} ob-lanes-${lanes}">
<div class="ob-round">
<p class="ob-round-prompt">What stood out?</p>
${turn(0, "Ann", `ANN-ONE ${LONG}`)}${turn(lanes > 1 ? 1 : 0, "Bo", "BO-ONE short")}${turn(0, "Ann", "ANN-TWO")}${turn(lanes > 1 ? 1 : 0, "Bo", `BO-TWO ${UNBROKEN}`)}
</div>
</div>
</article></main></body></html>`;
}

const boxes = (target) =>
  target.evaluate(() =>
    [...document.querySelectorAll(".ob-turn")].map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height, text: node.querySelector("h2").textContent + ":" + node.textContent.slice(0, 20) };
    }),
  );

test("side by side puts lanes in columns on a wide screen and keeps the reading order in the DOM", async ({ page: tab }) => {
  await tab.setViewportSize({ width: 1280, height: 900 });
  await tab.setContent(page({ layout: "side-by-side", lanes: 2 }));
  const [a1, b1, a2, b2] = await boxes(tab);
  expect(b1.x).toBeGreaterThan(a1.x + a1.width - 1);
  expect(Math.abs(b1.y - a1.y)).toBeLessThan(2);
  // Unequal lengths: the next row starts below the longer section, never overlapping it.
  expect(a2.y).toBeGreaterThanOrEqual(a1.y + a1.height - 1);
  expect(b2.y).toBeGreaterThanOrEqual(a2.y - 1);
  const order = await tab.evaluate(() => [...document.querySelectorAll(".ob-turn")].map((n) => n.textContent.match(/(ANN|BO)-(ONE|TWO)/)[0]));
  expect(order).toEqual(["ANN-ONE", "BO-ONE", "ANN-TWO", "BO-TWO"]);
});

test("it collapses to one column at a narrow width or 400% zoom, without sideways scrolling", async ({ page: tab }) => {
  await tab.setViewportSize({ width: 320, height: 800 });
  await tab.setContent(page({ layout: "side-by-side", lanes: 2 }));
  const list = await boxes(tab);
  for (const [index, box] of list.entries()) {
    expect(Math.abs(box.x - list[0].x)).toBeLessThan(2);
    if (index > 0) expect(box.y).toBeGreaterThanOrEqual(list[index - 1].y + list[index - 1].height - 1);
  }
  const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("print and a wide screen with more lanes than the styles lay out both read top to bottom", async ({ page: tab }) => {
  await tab.setViewportSize({ width: 1280, height: 900 });
  await tab.setContent(page({ layout: "side-by-side", lanes: 2 }));
  await tab.emulateMedia({ media: "print" });
  const printed = await boxes(tab);
  for (const [index, box] of printed.entries()) {
    expect(Math.abs(box.x - printed[0].x)).toBeLessThan(2);
    if (index > 0) expect(box.y).toBeGreaterThanOrEqual(printed[index - 1].y + printed[index - 1].height - 1);
  }
  await tab.emulateMedia({ media: "screen" });
  await tab.setContent(page({ layout: "side-by-side", lanes: 4 }));
  const many = await boxes(tab);
  expect(new Set(many.map((box) => Math.round(box.x))).size).toBe(1);
});

test("without styles or scripts every turn keeps its own heading, in reading order", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const tab = await context.newPage();
  await tab.setContent(page({ layout: "side-by-side", lanes: 2, css: false }));
  const names = await tab.locator("h2.ob-turn-author").allTextContents();
  expect(names).toEqual(["Ann", "Bo", "Ann", "Bo"]);
  const text = await tab.locator("article").innerText();
  expect(text.indexOf("What stood out?")).toBeLessThan(text.indexOf("ANN-ONE"));
  expect(text.indexOf("ANN-ONE")).toBeLessThan(text.indexOf("BO-ONE"));
  expect(text.indexOf("BO-ONE")).toBeLessThan(text.indexOf("ANN-TWO"));
  expect(text.indexOf("ANN-TWO")).toBeLessThan(text.indexOf("BO-TWO"));
  await context.close();
});

test("the sequential layout is one column at every width and keyboard focus follows the DOM", async ({ page: tab }) => {
  await tab.setViewportSize({ width: 1280, height: 900 });
  await tab.setContent(page({ layout: "sequential", lanes: 1 }).replace("<p>ANN-TWO</p>", '<p><a href="#a">ANN-TWO link</a> <a href="#b">second link</a></p>'));
  const list = await boxes(tab);
  for (const box of list) expect(Math.abs(box.x - list[0].x)).toBeLessThan(2);
  await tab.keyboard.press("Tab");
  await expect(tab.locator("a").first()).toBeFocused();
  await tab.keyboard.press("Tab");
  await expect(tab.locator("a").nth(1)).toBeFocused();
});
