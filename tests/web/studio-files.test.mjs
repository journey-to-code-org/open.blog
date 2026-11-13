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
    assert.doesNotMatch(code, /\.style\.|style:\s*["'{]|setAttribute\(\s*["']style["']/, `${name} sets an inline style`);
    assert.doesNotMatch(code, /\beval\(|new Function\(/, `${name} evaluates code`);
  }
});

test("index.html loads only Studio's own files", () => {
  const html = readFileSync(join(studio, "index.html"), "utf8");
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.match(url, /^\/admin\/studio\//, url);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "no inline script");
  assert.doesNotMatch(html, /\sstyle=|<style/, "no inline style");
});

test("Studio never hands replaceChildren a possible null (it would print \"null\")", () => {
  for (const file of ownFiles()) {
    const code = readFileSync(file, "utf8");
    assert.doesNotMatch(code, /replaceChildren\([^\n;]*\?[^\n;]*:\s*null\)/, `${relative(repo, file)}: use fill() or spread a list instead`);
  }
});
