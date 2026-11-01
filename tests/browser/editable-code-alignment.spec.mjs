import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeTree } from "./teardown.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-editable-code-"));
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  mkdirSync(join(root, "themes"));
  for (const theme of ["base", "demo", "paper"]) {
    cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  }
  writeFileSync(
    join(root, "openblog.json"),
    JSON.stringify({ title: "Code editor", url: "https://code.example.org", theme: "paper", postPath: "/{slug}/" }),
  );
  writeFileSync(
    join(root, "content", "posts", "rust.md"),
    `---
title: Rust editor
date: 2026-10-31
---

\`\`\`rust runnable showLineNumbers
fn main() {
    println!("aligned");
}
\`\`\`
`,
  );

  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/rust/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  removeTree(root);
});

test("the caret and highlighted Rust text use the same metrics", async ({ page }) => {
  await page.goto(`${origin}/rust/`);
  const metrics = await page.locator("ob-rust-playground").evaluate((host) => {
    const editor = host.querySelector("textarea.ob-rust-editor");
    const decoration = host.querySelector(".ob-rust-editor-decoration");
    const firstToken = decoration.querySelector(".ob-line > span");
    const editorStyle = getComputedStyle(editor);
    const decorationStyle = getComputedStyle(decoration);
    const editorBox = editor.getBoundingClientRect();
    const decorationBox = decoration.getBoundingClientRect();
    return {
      originDrift:
        editorBox.left + parseFloat(editorStyle.paddingLeft) - firstToken.getBoundingClientRect().left,
      verticalOriginDrift:
        editorBox.top + parseFloat(editorStyle.paddingTop) - decorationBox.top - parseFloat(decorationStyle.paddingTop),
      editorFontSize: editorStyle.fontSize,
      decorationFontSize: decorationStyle.fontSize,
      editorFontFamily: editorStyle.fontFamily,
      decorationFontFamily: decorationStyle.fontFamily,
      editorLineHeight: editorStyle.lineHeight,
      decorationLineHeight: decorationStyle.lineHeight,
      editorLetterSpacing: editorStyle.letterSpacing,
      decorationLetterSpacing: decorationStyle.letterSpacing,
      editorTabSize: editorStyle.tabSize,
      decorationTabSize: decorationStyle.tabSize,
    };
  });

  expect(metrics.editorFontSize).toBe(metrics.decorationFontSize);
  expect(metrics.editorFontFamily).toBe(metrics.decorationFontFamily);
  expect(metrics.editorLineHeight).toBe(metrics.decorationLineHeight);
  expect(metrics.editorLetterSpacing).toBe(metrics.decorationLetterSpacing);
  expect(metrics.editorTabSize).toBe(metrics.decorationTabSize);
  expect(Math.abs(metrics.originDrift)).toBeLessThan(0.5);
  expect(Math.abs(metrics.verticalOriginDrift)).toBeLessThan(0.5);
});
