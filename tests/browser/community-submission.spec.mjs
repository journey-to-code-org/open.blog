import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeTree } from "./teardown.mjs";

// The community submission kit (story #395, ADRs 0800 to 0803) is a static page written by
// `openblog submit --kit`: no server, no provider, no credential, no script. open.blog never
// submits; the page hands the author to each community's own form.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;

function openblog(site, args) {
  return execFileSync(binary, ["submit", "portable-lesson", "--root", site, ...args], { stdio: "pipe" }).toString();
}

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "openblog-submit-"));
  cpSync(join(repository, "examples", "portable-publishing"), join(root, "site"), { recursive: true });
  const config = JSON.parse(readFileSync(join(root, "site", "openblog.json"), "utf8"));
  config.community = {
    hackerNews: { enabled: true },
    reddit: {
      enabled: true,
      communities: { rust: { rules: ["Posts must be about Rust", "Self-promotion at most once a week"], reviewed: "2026-10-01", flair: "blog" } },
    },
  };
  writeFileSync(join(root, "site", "openblog.json"), JSON.stringify(config));
});

test.afterAll(() => removeTree(root));

test("the kit page is keyboard operable, labelled, script-free and fits a phone", async ({ page }) => {
  const out = join(root, "kit");
  openblog(join(root, "site"), ["--to", "hacker-news,reddit:rust,reddit:golang", "--kit", out]);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toContainText("A lesson that travels");
  await expect(page.getByText("Prepared, not submitted.")).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);

  const hn = page.getByRole("region", { name: "Hacker News" });
  const rust = page.getByRole("region", { name: "r/rust on Reddit" });
  const golang = page.getByRole("region", { name: "r/golang on Reddit" });
  await expect(hn.getByLabel("Link for Hacker News")).toHaveText("https://portable.example.org/portable-lesson/");
  await expect(hn.getByLabel("Title for Hacker News")).toHaveText("A lesson that travels");

  // Each ready destination hands off to the provider's own form; a blocked one offers no link.
  await expect(hn.getByRole("link", { name: "Open the submit form for Hacker News" })).toHaveAttribute(
    "href",
    /^https:\/\/news\.ycombinator\.com\/submitlink\?u=https%3A%2F%2Fportable\.example\.org%2Fportable-lesson%2F&t=/,
  );
  await expect(rust.getByRole("link", { name: "Open the submit form for r/rust on Reddit" })).toHaveAttribute(
    "href",
    /^https:\/\/www\.reddit\.com\/r\/rust\/submit\?url=/,
  );
  await expect(golang.getByRole("link", { name: /Open the submit form/ })).toHaveCount(0);
  await expect(golang).toContainText("community-rules-missing");

  // The rules are a labelled checklist the keyboard can tick, and the author's own rules are there.
  const checklist = rust.getByRole("group", { name: "Before you submit to r/rust on Reddit" });
  await expect(checklist.getByRole("checkbox")).toHaveCount(6);
  const own = checklist.getByLabel("Posts must be about Rust");
  await own.focus();
  await page.keyboard.press("Space");
  await expect(own).toBeChecked();
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe("none");

  // Tabbing reaches the title, the link and the command that records a submission.
  const reached = new Set();
  for (let i = 0; i < 90; i += 1) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (label) reached.add(label);
  }
  expect([...reached]).toEqual(expect.arrayContaining(["Title for r/golang on Reddit", "Link for r/golang on Reddit"]));
  await expect(hn.getByLabel("Command that records your submission to Hacker News")).toContainText(
    "openblog submit portable-lesson --confirm hacker-news --permalink",
  );

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a confirmed submission is the author's word and is not prepared again", async ({ page }) => {
  const site = join(root, "site");
  const said = openblog(site, ["--confirm", "hacker-news", "--permalink", "https://news.ycombinator.com/item?id=42"]);
  expect(said).toContain("open.blog did not check this with the provider");
  const out = join(root, "again");
  openblog(site, ["--to", "hacker-news", "--kit", out]);
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  const hn = page.getByRole("region", { name: "Hacker News" });
  await expect(hn).toContainText("already-submitted");
  await expect(hn.getByRole("link", { name: /Open the submit form/ })).toHaveCount(0);
  await expect(hn).toContainText("your word; open.blog did not check");
  expect(openblog(site, ["--list"])).toContain("hacker-news: author-confirmed on ");
});
