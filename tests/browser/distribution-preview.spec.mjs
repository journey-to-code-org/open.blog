import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeTree } from "./teardown.mjs";

// The distribution preview (story #390, ADRs 0328 to 0330) is a static page written by
// `openblog syndicate --preview`: no server, no provider, no credential, no script.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;

function preview(site, folder) {
  const out = join(root, folder);
  const env = { ...process.env };
  for (const name of ["DEVTO_API_KEY", "HASHNODE_PAT", "GHOST_ADMIN_API_KEY", "WORDPRESS_USERNAME", "WORDPRESS_APPLICATION_PASSWORD"]) delete env[name];
  execFileSync(binary, ["syndicate", "portable-lesson", "--root", site, "--preview", out], { env, stdio: "pipe" });
  return out;
}

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "openblog-distribution-"));
  cpSync(join(repository, "examples", "portable-publishing"), join(root, "site"), { recursive: true });
  cpSync(join(repository, "examples", "portable-publishing"), join(root, "bare"), { recursive: true });
  const bare = JSON.parse(readFileSync(join(root, "bare", "openblog.json"), "utf8"));
  delete bare.syndication;
  writeFileSync(join(root, "bare", "openblog.json"), JSON.stringify(bare));
});

test.afterAll(() => removeTree(root));

test("the preview page is keyboard operable, labelled, script-free and fits a phone", async ({ page }) => {
  const out = preview(join(root, "site"), "preview");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toContainText("A lesson that travels");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Preview, not sent.")).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);

  const table = page.getByRole("table", { name: /What each chosen destination would receive/ });
  await expect(table.getByRole("rowheader")).toHaveCount(5);
  await expect(table).toContainText("By hand: open.blog sends nothing here");

  // Each destination is a labelled region, and its copy is a focusable, labelled block of text.
  for (const name of ["dev", "ghost", "hashnode", "medium", "wordpress"]) {
    await expect(page.getByRole("region", { name: new RegExp(`^${name} \\(`) })).toBeVisible();
  }
  const copy = page.getByLabel("Portable Markdown for dev");
  await expect(copy).toContainText("Canonical: <https://portable.example.org/portable-lesson/>");

  // The summary links move focus to each destination's section from the keyboard.
  const link = table.getByRole("link", { name: "medium" });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#destination-4$/);
  await expect(page.locator("#destination-4")).toBeInViewport();

  // Tabbing reaches every copy and the approve command, each with a visible focus outline.
  const reached = new Set();
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (label) reached.add(label);
  }
  expect([...reached]).toEqual(expect.arrayContaining([
    "Portable Markdown for dev", "Portable HTML for ghost", "Portable Markdown for a manual import for medium",
    "Command that approves this plan",
  ]));
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe("none");

  // Nothing scrolls sideways at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByLabel("Command that approves this plan")).toContainText("openblog syndicate portable-lesson --approve ");
});

test("with no destination the page offers the portable copy and nothing to approve", async ({ page }) => {
  const out = preview(join(root, "bare"), "fallback");
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  await expect(page.getByRole("heading", { name: "No destination is configured" })).toBeVisible();
  await expect(page.getByLabel("Portable Markdown of the post")).toContainText("# A lesson that travels");
  await expect(page.getByRole("heading", { name: "Approve this plan" })).toHaveCount(0);
  expect(readFileSync(join(out, "portable.md"), "utf8")).toContain("https://portable.example.org/portable-lesson/");
});
