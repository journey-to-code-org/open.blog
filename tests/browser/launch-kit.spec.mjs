import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { removeTree } from "./teardown.mjs";

// The Product Hunt launch kit (story #396, ADRs 0341 to 0344) is a folder written by
// `openblog submit --to product-hunt --kit`: a page with a preview, copy and open actions, and the
// screenshots beside it. open.blog never launches; the page allows no request and only its own,
// hashed copy script.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;

function openblog(args) {
  return execFileSync(binary, ["submit", "portable-lesson", "--root", join(root, "site"), ...args], { stdio: "pipe" }).toString();
}

// A real, decodable PNG of one colour, so the browser can show it.
function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "openblog-launch-"));
  const site = join(root, "site");
  cpSync(join(repository, "examples", "portable-publishing"), site, { recursive: true });
  const config = JSON.parse(readFileSync(join(site, "openblog.json"), "utf8"));
  config.community = { productHunt: { enabled: true } };
  writeFileSync(join(site, "openblog.json"), JSON.stringify(config));
  mkdirSync(join(site, "launches", "shots"), { recursive: true });
  writeFileSync(join(site, "launches", "shots", "thumb.png"), png(240, 240));
  writeFileSync(join(site, "launches", "shots", "editor.png"), png(1270, 760));
  writeFileSync(join(site, "launches", "shots", "post.png"), png(1270, 760));
  writeFileSync(
    join(site, "launches", "portable-lesson.json"),
    JSON.stringify({
      launchVersion: 1,
      name: "Portable Lessons",
      tagline: "Lessons that travel with their sources",
      description: "Write a lesson once in Markdown and publish it anywhere, with every source attached.",
      thumbnail: { file: "launches/shots/thumb.png", alt: "The Portable Lessons logo" },
      gallery: [
        { file: "launches/shots/editor.png", alt: "The editor with a lesson open" },
        { file: "launches/shots/post.png", alt: "A published lesson on a phone" },
      ],
      demo: "https://www.youtube.com/watch?v=abcdEFGH123",
      tags: ["Education", "Writing"],
      firstComment: "Hi, I am the maker. Why I built it: https://portable.example.org/portable-lesson/",
    }),
  );
});

test.afterAll(() => removeTree(root));

test("the launch kit previews the launch, copies each field and fits a phone", async ({ page, context }) => {
  const out = join(root, "kit");
  openblog(["--to", "product-hunt", "--kit", out]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const blocked = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("file:")) blocked.push(request.url());
  });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Launch kit: Portable Lessons");
  await expect(page.getByText("Prepared, not launched.")).toBeVisible();
  await expect(page.locator("script")).toHaveCount(1);
  await expect(page.getByText("Ready for you to enter by hand.")).toBeVisible();

  // The preview shows the screenshots copied beside the page, each with its description.
  const preview = page.getByRole("article", { name: "Preview of the launch" });
  const shot = preview.getByRole("img", { name: "The editor with a lesson open" });
  await expect(shot).toBeVisible();
  await expect.poll(() => shot.evaluate((img) => img.complete && img.naturalWidth)).toBe(1270);
  await expect(preview.getByRole("img", { name: "The Portable Lessons logo" })).toBeVisible();

  // The copy buttons appear only because the page's own script ran under its hash policy.
  const fields = page.getByRole("region", { name: "Text to copy into Product Hunt" });
  const tagline = fields.getByLabel("Tagline", { exact: true });
  await expect(tagline).toHaveValue("Lessons that travel with their sources");
  await expect(tagline).toHaveAttribute("readonly", "");
  await expect(fields.getByText("38 of 60 characters")).toBeVisible();
  const copy = fields.getByRole("button", { name: "Copy tagline" });
  await expect(copy).toBeVisible();
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText(/^(Tagline copied\.|Selected; copy it with your keyboard\.)$/);
  await expect(fields.getByLabel("Link to your post")).toHaveValue("https://portable.example.org/portable-lesson/");

  // Open actions: each screenshot, Product Hunt's own form, the demo.
  const images = page.getByRole("region", { name: "Images to upload" });
  await expect(images.getByRole("link", { name: /^Open gallery image 1 \(images\/gallery-01\.png\)$/ })).toHaveAttribute("href", "images/gallery-01.png");
  const open = page.getByRole("region", { name: "Open Product Hunt" });
  await expect(open.getByRole("link", { name: "Open Product Hunt's new launch form" })).toHaveAttribute("href", "https://www.producthunt.com/posts/new");
  await expect(open.getByRole("link", { name: "Open the demo video on YouTube" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdEFGH123");

  // The checklist is labelled and keyboard operable.
  const checklist = page.getByRole("group", { name: "Product Hunt's rules for this launch" });
  await expect(checklist.getByRole("checkbox")).toHaveCount(6);
  const votes = checklist.getByLabel(/I will not ask anyone to upvote it/);
  await votes.focus();
  await page.keyboard.press("Space");
  await expect(votes).toBeChecked();

  // No sideways scroll at phone width, measured on the kit itself.
  const overflow = await page.locator("main").evaluate((main) => main.scrollWidth - main.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(blocked).toEqual([]);
});

test("without script every field is still a labelled text box and no copy button shows", async ({ browser }) => {
  const out = join(root, "kit-no-script");
  openblog(["--to", "product-hunt", "--kit", out]);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  const fields = page.getByRole("region", { name: "Text to copy into Product Hunt" });
  await expect(fields.getByLabel("Description", { exact: true })).toHaveValue(/^Write a lesson once in Markdown/);
  await expect(fields.getByRole("button")).toHaveCount(0);
  await context.close();
});

test("a recorded launch is blocked and offers no form until it is a relaunch", async ({ page }) => {
  openblog(["--confirm", "product-hunt", "--permalink", "https://www.producthunt.com/posts/portable-lessons"]);
  const out = join(root, "kit-after");
  openblog(["--to", "product-hunt", "--kit", out]);
  await page.goto(pathToFileURL(join(out, "index.html")).href);
  await expect(page.getByText("Blocked: there is no link to Product Hunt's form until this is fixed.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Why it is blocked" })).toContainText("already-launched");
  await expect(page.getByRole("link", { name: "Open Product Hunt's new launch form" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "You confirmed launching it before" })).toContainText("https://www.producthunt.com/posts/portable-lessons");

  const again = join(root, "kit-relaunch");
  openblog(["--to", "product-hunt", "--kit", again, "--again"]);
  await page.goto(pathToFileURL(join(again, "index.html")).href);
  await expect(page.getByRole("list", { name: "Worth a second look" })).toContainText("relaunch");
  await expect(page.getByRole("link", { name: "Open Product Hunt's new launch form" })).toBeVisible();
});
