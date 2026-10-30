import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeTree } from "./teardown.mjs";

// A recipe directory package (story #398, ADRs 0822 and 0823) is a folder written by
// `openblog export <slug> --format recipe-package`: no server, no directory, no credential, and a
// static guide page with no script.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const targetDir = process.env.CARGO_TARGET_DIR || join(repository, "target");
const binary = join(targetDir, "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;

// A 1200 x 900 PNG header: enough for the size check, not a viewable image.
function png() {
  const bytes = Buffer.alloc(33);
  Buffer.from("\x89PNG\r\n\x1a\n\0\0\0\rIHDR", "latin1").copy(bytes);
  bytes.writeUInt32BE(1200, 16);
  bytes.writeUInt32BE(900, 20);
  return bytes;
}

function packageFor(directories, folder) {
  const out = join(root, folder);
  const args = ["export", "soup", "--root", join(root, "site"), "--format", "recipe-package", "--out", out, "--write"];
  if (directories) args.push("--directory", directories);
  execFileSync(binary, args, { stdio: "pipe" });
  return out;
}

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "openblog-recipe-package-"));
  const site = join(root, "site");
  mkdirSync(join(site, "content", "posts"), { recursive: true });
  mkdirSync(join(site, "static", "images"), { recursive: true });
  writeFileSync(join(site, "openblog.json"), JSON.stringify({ title: "Kitchen", url: "https://kitchen.example", postPath: "/{slug}/", author: { name: "The Cook" } }));
  writeFileSync(join(site, "static", "images", "soup.png"), png());
  writeFileSync(
    join(site, "content", "posts", "soup.md"),
    [
      "---",
      "title: \"Leek & potato soup with a very long name that has to wrap on a narrow phone screen\"",
      "slug: soup",
      "date: 2026-02-02",
      "description: Warm, quick, and good the next day.",
      "profile: recipe",
      "servings: 4",
      "cover: /images/soup.png",
      "adaptedFrom: https://example.org/a-very-long-address/of-the-original-recipe-that-should-wrap-rather-than-scroll",
      "---",
      "## Ingredients",
      "",
      "- 2 leeks",
      "- 3 potatoes",
      "",
      "## Steps",
      "",
      "1. Chop everything.",
      "2. Simmer for 20 minutes.",
      "",
    ].join("\n"),
  );
});

test.afterAll(() => removeTree(root));

test("the package guide is labelled, script-free, keyboard operable and fits a phone", async ({ page }) => {
  const out = packageFor("google-search,pinterest,foodgawker", "all");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("script")).toHaveCount(0);
  await expect(page.getByText("Prepared, not sent.")).toBeVisible();

  for (const name of ["Google Search recipe results", "Pinterest", "Foodgawker"]) {
    const region = page.getByRole("region", { name });
    await expect(region).toBeVisible();
    await expect(region.getByRole("list", { name: "Your steps" })).toBeVisible();
  }
  const foodgawker = page.getByRole("region", { name: "Foodgawker" });
  await expect(foodgawker.getByRole("list", { name: "Findings" })).toContainText("could not be verified");
  await expect(foodgawker).toContainText("(not verified: check it there)");

  // Each text to paste is a focusable block labelled by its file name, reached by Tab.
  const reached = new Set();
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => document.activeElement?.getAttribute("aria-labelledby"));
    if (id) reached.add(id);
  }
  expect([...reached]).toEqual(expect.arrayContaining(["ingredients-txt", "steps-txt", "link-txt", "credit-txt"]));
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe("none");
  await expect(page.getByLabel("credit.txt")).toContainText("by The Cook, first published at https://kitchen.example/soup/");

  // Nothing scrolls sideways at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const plan = JSON.parse(readFileSync(join(out, "package.json"), "utf8"));
  expect(plan.sent).toBe(false);
  expect(plan.directories.map((d) => d.status)).toEqual(["ready", "ready", "ready"]);
});

test("with no directory chosen the guide says the recipe stays on the site", async ({ page }) => {
  const out = packageFor(null, "none");
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  await expect(page.getByRole("heading", { name: "No directory chosen" })).toBeVisible();
  await expect(page.getByRole("link", { name: "recipe.json" }).first()).toBeVisible();
});
