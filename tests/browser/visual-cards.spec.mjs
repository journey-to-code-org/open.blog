import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeTree } from "./teardown.mjs";

// The visual card preview (story #393, ADRs 0368 to 0370) is a static page written by
// `openblog card --preview`: no server, no provider, no credential, no script, no fetch.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;

// A PNG header of the given size: enough for open.blog to read its facts.
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const chunk = (kind, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, Buffer.from(kind), body, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "openblog-cards-"));
  const site = join(root, "site");
  mkdirSync(join(site, "content", "posts"), { recursive: true });
  mkdirSync(join(site, "static", "img"), { recursive: true });
  writeFileSync(join(site, "openblog.json"), JSON.stringify({ title: "Kitchen", url: "https://cook.example.org" }));
  writeFileSync(join(site, "static", "img", "slice.png"), png(1000, 1500));
  writeFileSync(join(site, "static", "img", "wide.png"), png(400, 200));
  writeFileSync(
    join(site, "content", "posts", "tart.md"),
    [
      "---",
      "title: Lemon tart",
      "slug: lemon-tart",
      "date: 2026-01-01",
      "profile: recipe",
      "description: A sharp lemon curd in a crisp shortcrust.",
      "cover: /img/wide.png",
      "coverCredit: Ana Ruiz <photos>",
      "cardTitle: Lemon tart with a crisp, never soggy crust",
      "---",
      "Intro.",
      "",
      "![A slice of lemon tart on a blue plate](/img/slice.png)",
      "",
      "## Ingredients",
      "",
      "- 3 lemons",
      "",
      "## Method",
      "",
      "1. Bake the crust.",
      "",
    ].join("\n"),
  );
});

test.afterAll(() => removeTree(root));

test("the card preview is keyboard operable, labelled, script-free and fits a phone", async ({ page }) => {
  const out = join(root, "site", "cards");
  execFileSync(binary, ["card", "lemon-tart", "--root", join(root, "site"), "--preview", out], { stdio: "pipe" });
  const plan = JSON.parse(readFileSync(join(out, "cards.json"), "utf8"));
  expect(plan.remoteRequestSent).toBe(false);
  expect(plan.cards.map((card) => card.format)).toEqual(["pinterest-pin", "facebook-link", "linkedin-link"]);

  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toContainText("Lemon tart");
  await expect(page.getByText("Preview, not sent.")).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);

  const summary = page.getByRole("table", { name: /Each destination's card/ });
  await expect(summary.getByRole("rowheader")).toHaveCount(3);

  // The Pin passed over the undescribed cover and uses the described photograph.
  const pin = page.getByRole("region", { name: "Pinterest Pin" });
  await expect(pin.getByRole("img", { name: /Pinterest Pin layout preview/ })).toBeVisible();
  const holds = pin.getByRole("table", { name: "What the Pinterest Pin card holds" });
  await expect(holds.getByRole("row", { name: /^Title/ })).toContainText("Lemon tart with a crisp, never soggy crust");
  await expect(holds.getByRole("row", { name: /^Alternative text/ })).toContainText("A slice of lemon tart on a blue plate");
  await expect(pin.getByRole("list", { name: "Images passed over" })).toContainText("alt-missing");

  // The link previews check the page's own cover, which is too small for LinkedIn.
  const linkedin = page.getByRole("region", { name: "LinkedIn link preview" });
  await expect(linkedin).toContainText("Blocked: this card cannot be used as it is");
  await expect(linkedin.getByRole("list", { name: "What to fix or check" })).toContainText("page-image-unusable");
  await expect(linkedin.getByRole("list", { name: "Images passed over" })).toContainText("image-too-small");
  // Facebook shows that cover small, with its credit as escaped text, never markup.
  const facebook = page.getByRole("region", { name: "Facebook link preview" });
  await expect(facebook.getByRole("list", { name: "What to fix or check" })).toContainText("image-shown-small");
  await expect(facebook.getByRole("table")).toContainText("Ana Ruiz <photos>");

  // The summary links move to each card from the keyboard, with a visible focus outline.
  const link = summary.getByRole("link", { name: "LinkedIn link preview" });
  await link.focus();
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#card-3$/);
  await expect(page.locator("#card-3")).toBeInViewport();

  // Nothing scrolls sideways at phone width, and nothing was fetched from anywhere but the folder.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(requests.every((url) => url.startsWith("file:"))).toBe(true);
});

test("a draft gets no card and the command says why", () => {
  const site = join(root, "site");
  const post = join(site, "content", "posts", "tart.md");
  const original = readFileSync(post, "utf8");
  writeFileSync(post, original.replace("profile: recipe", "profile: recipe\ndraft: true"));
  try {
    let error = "";
    try {
      execFileSync(binary, ["card", "lemon-tart", "--root", site], { stdio: "pipe" });
    } catch (failure) {
      error = String(failure.stderr);
    }
    expect(error).toContain("not production-visible");
  } finally {
    writeFileSync(post, original);
  }
});
