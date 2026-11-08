import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeTree } from "./teardown.mjs";

// The YouTube preview (story #399, ADRs 0374 to 0377) is a static page written by
// `openblog video --preview`: no server, no provider, no account, no script.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;

function png(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(bytes, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.set([8, 2, 0, 0, 0], 24);
  return bytes;
}

function site(name, release) {
  const dir = join(root, name);
  for (const folder of ["content/posts", "static/images", "media"]) mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, "openblog.json"), JSON.stringify({ title: "Studio", url: "https://studio.example.org" }));
  writeFileSync(join(dir, "static/images/episode.png"), png(1280, 720));
  writeFileSync(join(dir, "media/episode.mp4"), Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]));
  writeFileSync(join(dir, "media/episode.en.vtt"), "WEBVTT\n\n00:00.000 --> 00:02.000\nThe gate opens.\n");
  const chapters = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, "0")}:00 A chapter with a rather long name that must wrap on a phone ${i}`).join("\n");
  writeFileSync(
    join(dir, "content/posts/2026-10-01-episode.md"),
    `---\ntitle: The Gate of Embers\ndate: 2026-10-01\ndescription: A walk to the gate, with a very-long-unbroken-word-${"x".repeat(80)}.\nprofile: video\ntags:\n  - animation\n  - behind the scenes\nduration: 15 min\nthumbnail: /images/episode.png\naiDisclosure: Concept art was AI-assisted.\n${release}---\nIntro.\n\n## Chapters\n\n${chapters}\n\n## Transcript\n\n**Narrator:** The <script>alert(1)</script> gate opens.\n`,
  );
  const out = join(root, `${name}-preview`);
  execFileSync(binary, ["video", "episode", "--root", dir, "--preview", out], { stdio: "pipe" });
  return out;
}

const COMPLETE = "videoFile: media/episode.mp4\ncaptions: media/episode.en.vtt\nvideoRights: owned\nvideoPeople: none\nmadeForKids: no\nsyntheticMedia: no\n";

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "openblog-video-"));
});

test.afterAll(() => removeTree(root));

test("the YouTube preview is keyboard operable, labelled, script-free and fits a phone", async ({ page }) => {
  const out = site("complete", COMPLETE);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toContainText("The Gate of Embers");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Preview, not sent.")).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);

  for (const name of ["Status", "Title and description", "Thumbnail", "Chapters", "Captions and transcript", "Audience and disclosures", "By hand in YouTube Studio"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Status" })).toContainText("Ready: approve this digest to upload it privately with open.blog");
  await expect(page.getByRole("link", { name: "https://studio.example.org/posts/episode/" })).toBeVisible();
  await expect(page.getByLabel("Video description", { exact: true })).toContainText("Read the article: https://studio.example.org/posts/episode/");
  await expect(page.getByRole("img", { name: "The thumbnail chosen for The Gate of Embers" })).toBeVisible();
  // The page shows the copy beside it, never the author's file name or path.
  await expect(page.getByRole("img")).toHaveAttribute("src", "thumbnail.png");
  await expect(page.getByRole("table", { name: "Chapters as they appear in the description" }).getByRole("rowheader")).toHaveCount(12);
  // The transcript is shown as text: the post's markup never runs in the preview.
  await expect(page.getByLabel("Transcript", { exact: true })).toContainText("<script>alert(1)</script>");
  await expect(page.getByRole("region", { name: "By hand in YouTube Studio" }).getByRole("listitem").first()).toContainText("media/episode.mp4");

  // Tabbing reaches every copy, each with a visible focus outline.
  const reached = new Set();
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (label) {
      reached.add(label);
      const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      expect(outline).not.toBe("none");
    }
  }
  expect([...reached]).toEqual(expect.arrayContaining(["Video title", "Video description", "Transcript"]));

  // Nothing scrolls sideways at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a blocked release lists every problem in words with its code", async ({ page }) => {
  const out = site("blocked", "videoFile: static/master.mp4\n");
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  const status = page.getByRole("region", { name: "Status" });
  await expect(status).toContainText("Blocked: fix the problems below before uploading");
  const problems = status.getByRole("list", { name: "What keeps it from going" });
  for (const code of ["source-public", "consent-rights-missing", "consent-people-missing", "consent-audience-missing", "consent-synthetic-missing"]) {
    await expect(problems).toContainText(`(${code})`);
  }
  await expect(page.getByRole("region", { name: "Audience and disclosures" })).toContainText("Not declared");
});
