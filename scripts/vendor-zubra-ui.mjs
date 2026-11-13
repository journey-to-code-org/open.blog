#!/usr/bin/env node
// Copy the Zubra UI elements Studio uses into web/studio/zubra/ (see .claude/skills/studio-architecture).
//
//   node scripts/vendor-zubra-ui.mjs <path to a zubra-ui checkout>
//
// It builds zubra-ui (its dependencies must be installed), then copies each element listed in
// web/studio/zubra/components.json from dist/cdn/, every element or runtime piece those import,
// and the default theme; and records the checkout's commit. Only listed elements (and what they
// need) are copied, so Studio ships no more than it uses. Never edit the copies: fix zubra-ui.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const source = resolve(process.argv[2] || "");
if (!process.argv[2] || !existsSync(join(source, "components/index.json"))) {
  console.error("usage: node scripts/vendor-zubra-ui.mjs <path to a zubra-ui checkout>");
  process.exit(2);
}
const here = resolve(dirname(new URL(import.meta.url).pathname), "..");
const target = join(here, "web/studio/zubra");
const manifestPath = join(target, "components.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

execFileSync("node", ["scripts/build.mjs"], { cwd: source, stdio: "inherit" });
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
const dist = join(source, "dist");

rmSync(join(target, "cdn"), { recursive: true, force: true });
rmSync(join(target, "runtime"), { recursive: true, force: true });
const copied = new Set();
const copy = (rel) => {
  if (copied.has(rel)) return;
  copied.add(rel);
  const from = rel.startsWith("runtime/") ? join(source, "node_modules/@zubra/runtime/dist/production", rel.slice("runtime/".length)) : join(dist, rel);
  if (!existsSync(from)) throw new Error(`zubra-ui has no ${rel}`);
  mkdirSync(dirname(join(target, rel)), { recursive: true });
  copyFileSync(from, join(target, rel));
  // Follow the file's own relative imports (a block's parts, the runtime's primitives).
  const text = readFileSync(from, "utf8");
  for (const [, spec] of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;'"]*?['"](\.{1,2}\/[^'"]+)['"]/g)) {
    copy(join(dirname(rel), spec).replace(/\\/g, "/"));
  }
  for (const [, spec] of text.matchAll(/(?:^|\n)\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    copy(join(dirname(rel), spec).replace(/\\/g, "/"));
  }
};
for (const name of manifest.components) copy(`cdn/${name}.js`);
copyFileSync(join(dist, "themes/default.css"), join(target, "theme.css"));
copyFileSync(join(source, "LICENSE"), join(target, "LICENSE"));

manifest.source = { repository: "https://github.com/journey-to-code-org/zubra-ui", commit };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`vendored ${copied.size} files from zubra-ui ${commit.slice(0, 7)} into web/studio/zubra/`);
