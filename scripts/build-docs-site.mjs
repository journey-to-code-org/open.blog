// Fills docs-site/content/docs/ from docs/, so the documentation site (an open.blog project in
// docs-site/) publishes the repository's docs folder as it is: one source, read on GitHub or on
// the site. The copy is not committed (see .gitignore).
//
// Usage: node scripts/build-docs-site.mjs, then: openblog build --root docs-site

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(repoRoot, "docs");
const to = path.join(repoRoot, "docs-site", "content", "docs");

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
const count = fs.readdirSync(to, { recursive: true }).filter((name) => String(name).endsWith(".md")).length;
console.log(`docs-site/content/docs: ${count} Markdown files from docs/`);
