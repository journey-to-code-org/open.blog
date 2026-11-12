// Builds the generated part of the documentation site from docs/, so the site and the
// repository share one source. Every Markdown file under docs/ is copied into
// docs-site/guides/ (same layout) with just-the-docs front matter added and its links made to
// work on the site: links between docs pages point at the built .html pages, and links to the
// rest of the repository (crates/, CHANGELOG.md, ...) point at the file on GitHub.
//
// Usage: node scripts/build-docs-site.mjs [--out <dir>]   (default: docs-site/guides)
//
// The output is not committed (see .gitignore); the docs-pages workflow runs this before
// Jekyll. CI runs it too, so a docs/ change that breaks the site fails before it is merged.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.join(repoRoot, "docs");
const githubBlob = "https://github.com/journey-to-code-org/open.blog/blob/main/";
const githubTree = "https://github.com/journey-to-code-org/open.blog/tree/main/";

const GUIDES = "Guides";
const SPECS = "Specifications";
const ADRS = "Decision records";

// Pages that sit somewhere other than "a guide under Guides" in the site's navigation.
const PLACEMENT = {
  "README.md": { title: GUIDES, nav_order: 3, has_children: true, out: "index.md" },
  "cli-reference.md": { title: "Command Reference", parent: "CLI Overview", nav_order: 1 },
  "configuration.md": { title: "Configuration Reference", nav_order: 4 },
};

function parseArgs(argv) {
  const out = { out: path.join(repoRoot, "docs-site", "guides") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") out.out = path.resolve(argv[(i += 1)]);
  }
  return out;
}

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    })
    .sort();
}

function firstHeading(source) {
  const match = source.match(/^#\s+(.+?)\s*#*\s*$/m);
  return match ? match[1].replace(/`/g, "").trim() : null;
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function frontMatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? yamlString(value) : value}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/** The site path (relative to docs/) a docs/ file is published at, as .md. */
function outputName(relative) {
  return PLACEMENT[relative]?.out ?? (path.basename(relative) === "README.md" ? path.join(path.dirname(relative), "index.md") : relative);
}

function siteHref(relativeMd) {
  return outputName(relativeMd).replace(/\.md$/, ".html");
}

/**
 * Rewrites one link target found in docs/<fromRelative>. Returns the new target, or the
 * original when it is external, an anchor, or otherwise left alone.
 */
function rewriteTarget(target, fromRelative, known) {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("/")) {
    return target;
  }
  const [pathPart, ...rest] = target.split("#");
  const anchor = rest.length ? `#${rest.join("#")}` : "";
  const fromDir = path.posix.dirname(fromRelative);
  const resolved = path.posix.normalize(path.posix.join("docs", fromDir, decodeURI(pathPart)));
  const absolute = path.join(repoRoot, resolved);
  const fromOut = path.posix.dirname(outputName(fromRelative));

  if (resolved.startsWith("docs/") || resolved === "docs") {
    const insideDocs = resolved === "docs" ? "" : resolved.slice("docs/".length);
    if (insideDocs.endsWith(".md") && known.has(insideDocs)) {
      return path.posix.relative(fromOut, siteHref(insideDocs)) + anchor;
    }
    const indexMd = insideDocs ? `${insideDocs.replace(/\/$/, "")}/README.md` : "README.md";
    const generatedIndex = insideDocs ? `${insideDocs.replace(/\/$/, "")}/index.md` : "index.md";
    if (known.has(indexMd) || known.has(generatedIndex)) {
      const target = known.has(indexMd) ? siteHref(indexMd) : generatedIndex.replace(/\.md$/, ".html");
      return (path.posix.relative(fromOut, target) || "index.html") + anchor;
    }
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile() && !insideDocs.endsWith(".md")) {
      // A non-Markdown file under docs/ (JSON contracts, images) is copied beside the pages.
      return path.posix.relative(fromOut, insideDocs) + anchor;
    }
  }
  if (fs.existsSync(absolute)) {
    const base = fs.statSync(absolute).isDirectory() ? githubTree : githubBlob;
    return base + resolved.replace(/\/$/, "") + anchor;
  }
  return null; // broken: reported by the caller
}

function rewriteLinks(source, fromRelative, known, problems) {
  let fence = null;
  return source
    .split("\n")
    .map((line) => {
      const opener = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        const closer = line.match(/^\s{0,3}(`+|~+)\s*$/);
        if (closer && closer[1][0] === fence[0] && closer[1].length >= fence.length) fence = null;
        return line;
      }
      if (opener) {
        fence = opener[1];
        return line;
      }
      const fix = (target) => {
        const next = rewriteTarget(target, fromRelative, known);
        if (next === null) {
          problems.push(`${fromRelative}: link to ${target} does not resolve`);
          return target;
        }
        return next;
      };
      // Inline code is left untouched; links are rewritten in the text between code spans.
      return line
        .split(/(`[^`]*`)/)
        .map((part, index) => {
          if (index % 2 === 1) return part;
          return part
            .replace(/(\]\()(<[^>]*>|[^)\s]+)(\s+"[^"]*")?\)/g, (_, open, target, title = "") => {
              const bare = target.startsWith("<") ? target.slice(1, -1) : target;
              return `${open}${fix(bare)}${title})`;
            })
            .replace(/^(\s{0,3}\[[^\]]+\]:\s+)(\S+)/, (_, open, target) => `${open}${fix(target)}`);
        })
        .join("");
    })
    .join("\n");
}

function adrIndex(adrs) {
  const rows = adrs.map(({ relative, title }) => {
    const number = path.basename(relative).match(/^(\d+)/)?.[1] ?? "";
    const label = title.replace(/^ADR\s*\d+\s*[:.-]?\s*/i, "").replace(/^\d+\.?\s*/, "");
    return `| ${number} | [${label.replace(/\|/g, "\\|")}](${path.basename(siteHref(relative))}) |`;
  });
  return (
    frontMatter({ title: ADRS, nav_order: 12, has_children: false }) +
    `# ${ADRS}\n\n` +
    "Architecture decision records: one page per decision, numbered in the order they were made. " +
    "Each records the context, the decision and its consequences. A later record that replaces " +
    "an earlier one says so at the top.\n\n" +
    `There are ${adrs.length} records.\n\n| # | Decision |\n| --- | --- |\n${rows.join("\n")}\n`
  );
}

function specsIndex(specs) {
  const rows = specs.map(({ relative, title }) => `- [${title}](${path.basename(siteHref(relative))})`);
  return (
    frontMatter({ title: SPECS, nav_order: 11, has_children: true }) +
    `# ${SPECS}\n\n` +
    "Feature specifications: the exact behaviour, fields and limits of the larger features, " +
    "written before they were built and kept current with them.\n\n" +
    `${rows.join("\n")}\n`
  );
}

export function buildDocsSite({ out }) {
  const files = walk(docsRoot).map((full) => path.relative(docsRoot, full).split(path.sep).join("/"));
  const markdown = files.filter((file) => file.endsWith(".md"));
  const known = new Set(markdown);
  if (!known.has("adr/README.md")) known.add("adr/index.md");
  if (!known.has("specs/README.md")) known.add("specs/index.md");
  const problems = [];
  const pages = [];

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const relative of files.filter((file) => !file.endsWith(".md"))) {
    const target = path.join(out, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(docsRoot, relative), target);
  }

  // Titles the hand-written pages in docs-site/ already use: a parent is found by title, so a
  // generated page must not take one of them.
  const titles = new Map();
  const siteRoot = path.join(repoRoot, "docs-site");
  for (const full of walk(siteRoot).filter((file) => file.endsWith(".md") && !file.startsWith(out + path.sep))) {
    const title = fs.readFileSync(full, "utf8").match(/^---\n[\s\S]*?^title:\s*(.+)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
    if (title) titles.set(title, path.relative(repoRoot, full));
  }
  for (const relative of markdown) {
    const source = fs.readFileSync(path.join(docsRoot, relative), "utf8");
    const heading = firstHeading(source) ?? path.basename(relative, ".md");
    const placement = PLACEMENT[relative] ?? {};
    let fields;
    if (relative.startsWith("adr/")) {
      fields = { title: heading, nav_exclude: true };
    } else if (relative.startsWith("specs/")) {
      fields = { title: `Spec: ${heading}`, parent: SPECS };
    } else if (PLACEMENT[relative]) {
      fields = { title: placement.title, parent: placement.parent, nav_order: placement.nav_order, has_children: placement.has_children };
    } else {
      fields = { title: heading, parent: GUIDES };
    }
    if (!fields.nav_exclude) {
      if (titles.has(fields.title)) problems.push(`${relative}: title "${fields.title}" is also used by ${titles.get(fields.title)}`);
      titles.set(fields.title, relative);
    }
    const body = rewriteLinks(source, relative, known, problems);
    if (/\{%-?\s*endraw/.test(body)) problems.push(`${relative}: contains an endraw tag, which the site cannot show`);
    const header = relative === "cli-reference.md" || relative === "configuration.md"
      ? "" : `<p class="fs-2 text-grey-dk-000">Source: <a href="${githubBlob}docs/${relative}">docs/${relative}</a></p>\n\n`;
    const page = frontMatter(fields) + "{% raw %}\n" + header + body + "\n{% endraw %}\n";
    const target = path.join(out, outputName(relative));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, page);
    pages.push({ relative, title: heading });
  }

  const adrs = pages.filter((page) => page.relative.startsWith("adr/"));
  if (adrs.length && !fs.existsSync(path.join(docsRoot, "adr", "README.md"))) {
    fs.writeFileSync(path.join(out, "adr", "index.md"), adrIndex(adrs));
  }
  const specs = pages.filter((page) => page.relative.startsWith("specs/"));
  if (specs.length && !fs.existsSync(path.join(docsRoot, "specs", "README.md"))) {
    fs.writeFileSync(path.join(out, "specs", "index.md"), specsIndex(specs));
  }
  return { pages: pages.length, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pages, problems } = buildDocsSite(parseArgs(process.argv.slice(2)));
  const duplicates = problems.filter((problem) => problem.includes("is also used by") || problem.includes("endraw"));
  for (const problem of problems) console.warn(`warning: ${problem}`);
  console.log(`docs site: ${pages} pages from docs/, ${problems.length} warnings`);
  // Two pages with one title break the site's navigation, so that is an error. A link that
  // does not resolve is reported (check-doc-links.mjs is the gate for those).
  if (duplicates.length) process.exit(1);
}
