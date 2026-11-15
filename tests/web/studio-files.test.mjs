// Studio's own files: the embedded list is current, and the code places text as text and styles
// through studio.css only (docs/specs/studio/architecture.md, "Rules").
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const studio = join(repo, "web/studio");

function ownFiles(dir = studio) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "zubra" ? [] : ownFiles(path);
    return name.endsWith(".js") ? [path] : [];
  });
}

test("studio_files.rs lists every file in web/studio", () => {
  execFileSync(process.execPath, [join(repo, "scripts/studio-files.mjs"), "--check"], { cwd: repo, stdio: "pipe" });
});

test("Studio's own code never writes markup or inline styles", () => {
  const files = ownFiles();
  assert.ok(files.length > 5);
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    const name = relative(repo, file);
    assert.doesNotMatch(code, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(/, `${name} writes markup`);
    // Rules files are data and pure functions (a button's `style: "primary"` is data, not CSS):
    // they must not touch the page at all, which is the stronger promise.
    if (/-rules\.js$/.test(name)) assert.doesNotMatch(code, /\bdocument\.[a-z]|\bwindow\.[a-z]|createElement|\bh\(/, `${name} is rules, yet touches the page`);
    else assert.doesNotMatch(code, /\.style\.|style:\s*["'{]|setAttribute\(\s*["']style["']/, `${name} sets an inline style`);
    assert.doesNotMatch(code, /\beval\(|new Function\(/, `${name} evaluates code`);
  }
});

test("index.html loads only Studio's own files, and the installed app's manifest and icons", () => {
  const html = readFileSync(join(studio, "index.html"), "utf8");
  // The manifest and icons stay at the addresses installed apps already know (Studio R3, G20/G21).
  const APP = /^\/admin\/(manifest\.webmanifest|icons\/[a-z0-9-]+\.png)$/;
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(/^\/admin\/studio\//.test(url) || APP.test(url), url);
  assert.match(html, /<link rel="manifest" href="\/admin\/manifest\.webmanifest">/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "no inline script");
  assert.doesNotMatch(html, /\sstyle=|<style/, "no inline style");
});

test("Studio never hands replaceChildren a possible null (it would print \"null\")", () => {
  for (const file of ownFiles()) {
    const code = readFileSync(file, "utf8");
    assert.doesNotMatch(code, /replaceChildren\([^\n;]*\?[^\n;]*:\s*null\)/, `${relative(repo, file)}: use fill() or spread a list instead`);
  }
});
