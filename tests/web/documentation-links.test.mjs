import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkMarkdownFiles, markdownHeadingIds } from "../../scripts/check-doc-links.mjs";

test("Markdown heading ids match GitHub-style duplicate anchors", () => {
  assert.deepEqual(
    markdownHeadingIds("# Hello, World!\n## Hello World\n## Use `openblog serve`\n## Hello-World-2\n## Hello World\n"),
    new Set(["hello-world", "hello-world-1", "use-openblog-serve", "hello-world-2", "hello-world-3"]),
  );
});

test("headings and links inside a shorter nested fence remain examples", () => {
  const source = [
    "````markdown",
    "```",
    "# Example heading",
    "[Example link](missing.md)",
    "```",
    "````",
    "# Real heading",
  ].join("\n");
  assert.deepEqual(markdownHeadingIds(source), new Set(["real-heading"]));
});

test("documentation links validate relative files and anchors while ignoring examples", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "openblog-doc-links-"));
  const docs = path.join(root, "docs");
  await mkdir(docs);
  await writeFile(path.join(docs, "guide.md"), "# Available models\n");
  const index = path.join(docs, "index.md");
  await writeFile(
    index,
    [
      "# Documentation links validate relative files and anchors while ignoring examples",
      "[Guide](guide.md#available-models)",
      "[This page](#documentation-links-validate-relative-files-and-anchors-while-ignoring-examples)",
      "[Missing here](#missing-here)",
      "[Missing section](guide.md#missing-section)",
      "[Missing file](missing.md)",
      "[Website](https://example.com)",
      "```markdown",
      "[Example only](not-a-real-file.md)",
      "```",
    ].join("\n"),
  );

  const problems = checkMarkdownFiles([index, path.join(docs, "guide.md")], root);
  assert.deepEqual(
    problems.map(({ message }) => message),
    ["missing anchor #missing-here in docs/index.md", "missing anchor #missing-section in docs/guide.md", "missing file docs/missing.md"],
  );
});

test("documentation links keep repository issue labels aligned with their targets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "openblog-doc-issues-"));
  const index = path.join(root, "README.md");
  await writeFile(
    index,
    [
      "[#107](https://github.com/journey-to-code-org/open.blog/issues/107)",
      "[#108](https://github.com/journey-to-code-org/open.blog/issues/109)",
    ].join("\n"),
  );

  const problems = checkMarkdownFiles([index], root);
  assert.deepEqual(problems.map(({ message }) => message), ["issue label #108 points to repository issue #109"]);
});

test("the portability matrix covers every required capability with valid citations", async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const matrix = path.join(root, "docs", "content-portability.md");
  const source = await readFile(matrix, "utf8");
  const capabilities = [
    "Articles",
    "Research and citations",
    "Credits and bylines",
    "Recipes",
    "Callouts",
    "Quizzes",
    "Runnable code",
    "Video and audio",
    "Timestamps",
    "Shared Perspectives",
    "Questions and discussions",
    "Reflections",
    "Source previews",
    "Guided explanations",
    "Knowledge relationships",
    "Translation comparisons",
    "Timelines",
    "Diagrams",
  ];

  for (const capability of capabilities) {
    assert.match(source, new RegExp(`^\\| ${capability.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")} \\|`, "m"));
  }
  assert.deepEqual(checkMarkdownFiles([matrix], root), []);
});
