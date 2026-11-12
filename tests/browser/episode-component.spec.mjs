import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { removeTree } from "./teardown.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const component = readFileSync(resolve(root, "web", "components", "ob-episode.js"), "utf8");

test("native player and keyboard chapter seeking work at 400px", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.route("https://episode.test/**", (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><title>Episode</title><body>
      <main><h1>Episode</h1><ob-episode>
        <figure><audio controls preload="none" aria-label="Episode audio"></audio></figure>
        <h2>Chapters</h2><ol>
          <li><button type="button" disabled data-audio-time="15">Introduction</button></li>
          <li><button type="button" disabled data-audio-time="30">Conclusion</button></li>
        </ol>
      </ob-episode></main></body></html>`,
  }));
  await page.goto("https://episode.test/?t=7");
  const audio = page.locator("audio");
  const first = page.getByRole("button", { name: "Introduction" });
  await expect(first).toBeDisabled();
  await expect(audio).toHaveAttribute("controls", "");
  await expect(audio).toHaveAttribute("preload", "none");
  await expect(audio).not.toHaveAttribute("autoplay", "");
  await page.evaluate(() => {
    const audio = document.querySelector("audio");
    let time = 0;
    Object.defineProperties(audio, {
      duration: { get: () => 60 },
      readyState: { get: () => 1 },
      currentTime: { get: () => time, set: (value) => { time = value; } },
    });

  });
  await page.addScriptTag({ type: "module", content: component });
  await expect(first).toBeEnabled();
  await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBe(0);
  await audio.evaluate((element) => element.dispatchEvent(new Event("play")));
  await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBe(7);
  await first.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBe(15);
  await expect(first).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("a built episode passes accessibility checks and keyboard seeking", async ({ page }) => {
  const project = mkdtempSync(join(tmpdir(), "openblog-audio-browser-"));
  try {
    mkdirSync(join(project, "content", "posts"), { recursive: true });
    mkdirSync(join(project, "static", "audio"), { recursive: true });
    writeFileSync(join(project, "openblog.json"), JSON.stringify({ title: "Audio", url: "https://episode.test", podcast: { version: 1, title: "The Show", description: "A show", author: "Host", category: "Technology", explicit: false, image: "/audio/cover.jpg" } }));
    writeFileSync(join(project, "static", "audio", "one.mp3"), Buffer.from("ID3abcdefghi"));
    writeFileSync(join(project, "content", "posts", "episode.md"), "---\ntitle: Episode\ndate: 2026-01-01\naudio:\n  version: 1\n  durationSeconds: 30\n  sources:\n    - url: /audio/one.mp3\n      type: audio/mpeg\n      sizeBytes: 12\n  chapters:\n    - timeSeconds: 5\n      title: Part one\n---\n## Transcript\n\nHello.\n");
    const binary = join(root, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
    execFileSync(binary, ["build", "--root", project], { stdio: "pipe" });
    const pageHtml = readFileSync(join(project, "dist", "posts", "episode", "index.html"), "utf8");
    const script = readFileSync(join(project, "dist", "assets", "components", "ob-episode.js"), "utf8");
    const feed = readFileSync(join(project, "dist", "podcast.xml"), "utf8");
    await page.route("https://episode.test/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/posts/episode/") return route.fulfill({ contentType: "text/html", body: pageHtml });
      if (path === "/assets/components/ob-episode.js") return route.fulfill({ contentType: "text/javascript", body: script });
      return route.abort();
    });
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("https://episode.test/posts/episode/");
    const validation = await page.evaluate((xml) => {
      function validate(source) {
        const doc = new DOMParser().parseFromString(source, "application/xml");
        const channel = doc.querySelector("rss[version='2.0'] > channel");
        const issues = [];
        if (doc.querySelector("parsererror") || !channel) return ["invalid RSS"];
        for (const tag of ["title", "link", "description", "language"]) {
          if (!channel.querySelector(`:scope > ${tag}`)?.textContent.trim()) issues.push(`channel ${tag}`);
        }
        const itunes = "http://www.itunes.com/dtds/podcast-1.0.dtd";
        const podcast = "https://podcastindex.org/namespace/1.0";
        for (const tag of ["author", "category", "explicit", "image"]) {
          if (!channel.getElementsByTagNameNS(itunes, tag).length) issues.push(`itunes ${tag}`);
        }
        const urls = new Set();
        const guids = new Set();
        const items = channel.querySelectorAll(":scope > item");
        if (!items.length) issues.push("no episodes");
        for (const item of items) {
          const enclosure = item.querySelector(":scope > enclosure");
          const url = enclosure?.getAttribute("url") || "";
          const guid = item.querySelector(":scope > guid")?.textContent.trim() || "";
          if (!item.querySelector(":scope > title")?.textContent.trim()) issues.push("episode title");
          if (!/^https:\/\//.test(url) || !/^[1-9]\d*$/.test(enclosure?.getAttribute("length") || "") || !/^audio\//.test(enclosure?.getAttribute("type") || "") || urls.has(url)) issues.push("enclosure");
          if (!guid || guids.has(guid)) issues.push("guid");
          if (!Number.isFinite(Date.parse(item.querySelector(":scope > pubDate")?.textContent || ""))) issues.push("date");
          if (!item.getElementsByTagNameNS(itunes, "duration").length) issues.push("duration");
          if (!item.getElementsByTagNameNS(podcast, "transcript").length) issues.push("transcript");
          if (!item.getElementsByTagNameNS(podcast, "chapters").length) issues.push("chapters");
          urls.add(url);
          guids.add(guid);
        }
        return issues;
      }
      return { valid: validate(xml), broken: validate(xml.replace(/<enclosure[^>]*\/>/, "")) };
    }, feed);
    expect(validation.valid).toEqual([]);
    expect(validation.broken).toContain("enclosure");
    const button = page.getByRole("button", { name: "Part one" });
    await expect(button).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await page.addScriptTag({ content: axe.source });
    const results = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
    expect(results.violations).toEqual([]);
    await button.focus();
    await expect(button).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  } finally {
    removeTree(project);
  }
});
