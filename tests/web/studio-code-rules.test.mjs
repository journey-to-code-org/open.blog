// Code in a post (Studio R6): a code block written exactly as POST pieces writes it (G45) and read
// back only when it would be written the same; runnable code as the old Admin wrote it, ported from
// admin-assistant-interactions' code-interaction cases; the language rule in step with the runner's.
import assert from "node:assert/strict";
import test from "node:test";
import { codeFenceMarkdown, codeFenceProblems, codeInteractionMarkdown, codeInteractionProblems, normalizeCodeRunnerLanguage, parseCodeFence, runnableLanguages } from "../../web/studio/parts/code-rules.js";
import { normalizeCodeRunnerLanguage as runner } from "../../web/components/ob-code-runner-language.js";

test("a code block is the bytes POST pieces writes (crates/openblog-cli/src/admin/pieces.rs tests)", () => {
  assert.equal(`${codeFenceMarkdown({ language: "Rust", title: "src/main.rs", highlight: "2, 4-6", lineNumbers: "10", body: "fn main() {\n    // ```\n}\n" })}\n`,
    "````rust title=\"src/main.rs\" {2,4-6} showLineNumbers=10\nfn main() {\n    // ```\n}\n````\n");
  assert.equal(`${codeFenceMarkdown({ body: "plain" })}\n`, "```\nplain\n```\n");
  assert.equal(`${codeFenceMarkdown({ runnable: true, lineNumbers: "off", body: "x" })}\n`, "```text runnable showLineNumbers=false\nx\n```\n");
  assert.equal(`${codeFenceMarkdown({ language: "js", title: "app.js", highlight: "1", body: "let a = 1;" })}\n`, "```js title=\"app.js\" {1}\nlet a = 1;\n```\n");
});

test("a code block reads back for its form only when the form writes it the same", () => {
  const source = "```rust title=\"main.rs\" {2} showLineNumbers\nfn main() {}\n```";
  assert.deepEqual(parseCodeFence(source), { language: "rust", title: "main.rs", highlight: "2", lineNumbers: "on", runnable: false, body: "fn main() {}" });
  assert.equal(codeFenceMarkdown(parseCodeFence(source)), source);
  assert.notEqual(parseCodeFence("```text runnable\nx\n```"), null);
  for (const kept of ["```rust   title=\"a\"\nx\n```", "```rust libs=react\nx\n```", "~~~rust\nx\n~~~", "  ```rust\n  x\n  ```", "```rust\nx\n````"]) assert.equal(parseCodeFence(kept), null, kept);
});

test("a code block's checks match the server's codes", () => {
  assert.deepEqual(codeFenceProblems({ highlight: "2,x", title: "a\"b", lineNumbers: "lots", body: " " }).map((p) => `${p.field}:${p.code}`),
    ["title:bad-choice", "highlight:bad-lines", "lineNumbers:bad-choice", "body:required"]);
  assert.deepEqual(codeFenceProblems({ language: "rust", body: "x", highlight: "1-3,5" }), []);
});

test("code interaction Markdown escapes authored prose but preserves runnable Rust", () => {
  const markdown = codeInteractionMarkdown({ kind: "example", title: "Borrow *safely*", instructions: "Try [this] first.", code: "fn main() { println!(\"ok\"); }", explanation: "Notice _why_ it works." });
  assert.match(markdown, /Runnable example: Borrow \\\*safely\\\*/);
  assert.match(markdown, /Try \\\[this\\\] first\\\./);
  assert.match(markdown, /```rust runnable/);
  assert.match(markdown, /println!/);
});

test("code interaction Markdown emits native web and configured-runner fences", () => {
  const web = codeInteractionMarkdown({ kind: "challenge", language: "web", title: "Reveal", instructions: "Complete the handler.", code: "---html\n<button>Reveal</button>\n---js\n// TODO: handle click", expectedOutput: "The text appears." });
  assert.match(web, /```web runnable title="Reveal"/);
  assert.match(web, /---html/);
  assert.match(codeInteractionMarkdown({ kind: "example", language: " Python ", title: "Echo", instructions: "Enter text.", code: "print(input())" }), /```python runnable title="Echo"/);
});

test("runnable code's checks: required parts, a challenge's result and TODO, web parts, no fence inside", () => {
  const codes = (values) => codeInteractionProblems(values).map((p) => p.code);
  assert.deepEqual(codes({ kind: "example", language: "rust", title: "", instructions: "x", code: "y" }), ["required"]);
  assert.deepEqual(codes({ kind: "challenge", language: "rust", title: "t", instructions: "i", code: "fn main() {}" }), ["expected", "todo"]);
  assert.deepEqual(codes({ kind: "example", language: "web", title: "t", instructions: "i", code: "<b>x</b>" }), ["web-parts"]);
  assert.deepEqual(codes({ kind: "example", language: "rust", title: "t", instructions: "```", code: "x" }), ["backticks"]);
  assert.deepEqual(codes({ kind: "challenge", language: "rust", title: "t", instructions: "i", code: "// TODO: fix", expectedOutput: "ok" }), []);
});

test("the language rule is the runner's, and the choices are rust, web, then the site's", () => {
  for (const value of ["Rust", " python ", "c++", "x".repeat(33), "9lives", "", "c#", "a b"]) assert.equal(normalizeCodeRunnerLanguage(value), runner(value), value);
  assert.deepEqual(runnableLanguages({ codeRunnerLanguages: ["Python", "rust", "bad lang"] }), ["rust", "web", "python"]);
});
