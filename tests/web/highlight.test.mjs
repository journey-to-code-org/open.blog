// Tests for the built-in syntax highlighter (web/components/ob-highlight.js).
// Run with: node --test tests/web/
import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, highlight, isKnownLanguage } from "../../web/components/ob-highlight.js";

/** The class given to the first token whose text is exactly `text`. */
function clsOf(tokens, text) {
  const t = tokens.find((x) => x.text === text);
  assert.ok(t, `no token ${JSON.stringify(text)} in ${JSON.stringify(tokens)}`);
  return t.cls;
}

test("tokens always cover the whole source", () => {
  const samples = [
    ["const a = `x ${b + `y ${c}`}`; // done", "javascript"],
    ["fn main() { let s = r#\"raw \"quoted\"\"#; println!(\"{s}\"); }", "rust"],
    ["<div class=\"a\">&amp; <script>let x = 1 < 2;</script><style>a { color: red }</style></div>", "html"],
    ["$ git commit -m \"msg\" && npm run build | tee out.log", "bash"],
    ["@media (max-width: 600px) { a:hover { color: #fff !important; } }", "css"],
    ["unterminated \"string and /* comment", "javascript"],
    ["def f(x):\n    return x  # note", "python"],
  ];
  for (const [code, lang] of samples) {
    assert.equal(highlight(code, lang).map((t) => t.text).join(""), code, lang);
  }
});

test("javascript gets editor-style tokens", () => {
  const t = highlight("const total = items.reduce((sum, x) => sum + x.price, 0); // sum\nif (re.test(s)) return /a+b/gi;", "js");
  assert.equal(clsOf(t, "const"), "keyword");
  assert.equal(clsOf(t, "reduce"), "function");
  assert.equal(clsOf(t, "price"), "property");
  assert.equal(clsOf(t, "=>"), "operator");
  assert.equal(clsOf(t, "="), "operator");
  assert.equal(clsOf(t, "("), "punctuation");
  assert.equal(clsOf(t, "0"), "number");
  assert.equal(clsOf(t, "// sum"), "comment");
  assert.equal(clsOf(t, "/a+b/gi"), "regex");
});

test("division is not mistaken for a regex", () => {
  const t = highlight("const half = total / 2 / count;", "js");
  assert.ok(!t.some((x) => x.cls === "regex"));
});

test("template literals highlight their interpolations", () => {
  const t = highlight("`Hello ${user.name}!`", "js");
  assert.deepEqual(
    t.map((x) => [x.text, x.cls]),
    [["`Hello ", "string"], ["${", "keyword"], ["user", null], [".", "punctuation"], ["name", "property"], ["}", "keyword"], ["!`", "string"]],
  );
});

test("constants, types and object keys", () => {
  const t = highlight("const MAX_SIZE = new Map({ ready: true, value: null });", "javascript");
  assert.equal(clsOf(t, "MAX_SIZE"), "constant");
  assert.equal(clsOf(t, "Map"), "type");
  assert.equal(clsOf(t, "ready"), "property");
  assert.equal(clsOf(t, "true"), "constant");
  assert.equal(clsOf(t, "null"), "constant");
});

test("rust definitions, macros and lifetimes", () => {
  const t = highlight("pub fn parse<'a>(input: &'a str) -> Option<Vec<u8>> { println!(\"x\"); self.len }", "rust");
  assert.equal(clsOf(t, "parse"), "function");
  assert.equal(clsOf(t, "'a"), "meta");
  assert.equal(clsOf(t, "Option"), "type");
  assert.equal(clsOf(t, "println!"), "function");
  assert.equal(clsOf(t, "->"), "operator");
  assert.equal(clsOf(t, "len"), "property");
});

test("markup colours tags, attributes, entities and embedded code", () => {
  const t = highlight('<my-card data-id="1">&copy;<script>const a = 1;</script></my-card>', "html");
  assert.equal(clsOf(t, "my-card"), "type");
  assert.equal(clsOf(t, "data-id"), "attr");
  assert.equal(clsOf(t, '"1"'), "string");
  assert.equal(clsOf(t, "&copy;"), "constant");
  assert.equal(clsOf(t, "const"), "keyword");
  assert.equal(clsOf(t, "<"), "punctuation");
});

test("css selectors, properties and values", () => {
  const t = highlight("a:hover, .card > h2 { display: flex; margin: 0 auto; color: var(--accent); }", "css");
  assert.equal(clsOf(t, "a"), "tag");
  assert.equal(clsOf(t, ":hover"), "tag");
  assert.equal(clsOf(t, "h2"), "tag");
  assert.equal(clsOf(t, "display"), "attr");
  assert.equal(clsOf(t, "flex"), "constant");
  assert.equal(clsOf(t, "var"), "function");
  assert.equal(clsOf(t, "--accent"), "variable");
});

test("shell commands, flags and operators", () => {
  const t = highlight("git push -u origin main && sudo npm i\n  cargo build --release\nif git diff --quiet; then exit 0; fi", "bash");
  assert.equal(clsOf(t, "-u"), "attr");
  assert.equal(clsOf(t, "&&"), "operator");
  assert.equal(clsOf(t, "npm"), "function");
  assert.equal(clsOf(t, "cargo"), "function");
  const gits = t.filter((x) => x.text === "git");
  assert.equal(gits.length, 2);
  assert.ok(gits.every((x) => x.cls === "function"), "a command after `if` is a command");
  assert.ok(!t.some((x) => x.cls && x.text.includes("origin")), "arguments stay plain");
});

test("terminal sessions: prompts are commands, the rest is output", () => {
  const t = highlight("$ pwd\n/Users/me/projects\nuser@host:~$ ls -la\ntotal 8", "console");
  assert.equal(clsOf(t, "$ "), "prompt");
  assert.equal(clsOf(t, "pwd"), "function");
  assert.equal(clsOf(t, "/Users/me/projects\n"), null);
  assert.equal(clsOf(t, "user@host:~$ "), "prompt");
  assert.equal(clsOf(t, "ls"), "function");
  assert.equal(clsOf(t, "total 8"), null);
});

test("shell quoting, numbers and heredocs", () => {
  const t = highlight('git log --pretty=format:"%h %s" --graph\ngit tag -a 1.2.0\ngit cherry-pick 7300a6f\ncat > hook << \'EOF\'\nexit 0\nEOF', "bash");
  assert.equal(clsOf(t, "--pretty=format:"), "attr");
  assert.equal(clsOf(t, '"%h %s"'), "string");
  assert.equal(clsOf(t, "1.2.0"), "number");
  assert.ok(!t.some((x) => x.cls === "number" && x.text.startsWith("7300")), "a commit hash is not a number");
  assert.equal(clsOf(t, "<<"), "operator");
  assert.equal(clsOf(t, "\nexit 0\n"), "string");
});

test("parameters are not properties; object keys are", () => {
  const rs = highlight("fn click_damage(base: u32, bonus: u32) -> u32 { Point { x: 1, y: 2 } }", "rust");
  const plain = (t, w) => !t.some((x) => x.cls && x.text.includes(w));
  assert.ok(plain(rs, "base"));
  assert.ok(plain(rs, "bonus"), "parameters stay plain");
  assert.equal(clsOf(rs, "y"), "property");
  const ts = highlight("function f(name: string, age: number) {}\nconst o = { a: 1, b: 2 };", "ts");
  assert.ok(plain(ts, "age"), "parameters stay plain");
  assert.equal(clsOf(ts, "b"), "property");
});

test("functions assigned to names, and methods named get", () => {
  const t = highlight("const handle = (e) => e;\nclass View { edit = async () => {}; get(url) {} }\nthis.on = function () {};", "js");
  assert.equal(clsOf(t, "handle"), "function");
  assert.equal(clsOf(t, "edit"), "function");
  assert.equal(clsOf(t, "get"), "function");
  assert.equal(clsOf(t, "on"), "function");
});

test("nested template literals", () => {
  const code = 'const url = `${base}${q ? `?${q}` : ""}`;';
  const t = highlight(code, "js");
  assert.equal(t.map((x) => x.text).join(""), code);
  assert.equal(clsOf(t, "`?"), "string");
  assert.equal(clsOf(t, '""'), "string");
  assert.equal(t.filter((x) => x.text === "${").length, 3);
});

test("jsx, shebangs, rust attributes, enum variants, media features", () => {
  const jsx = highlight('return <my-card ref={wcRef} label="x" />;', "jsx");
  assert.equal(clsOf(jsx, "my-card"), "type");
  assert.equal(clsOf(jsx, "label"), "attr");
  assert.ok(!jsx.some((x) => x.cls && x.text.includes("wcRef")));
  assert.equal(highlight("#!/usr/bin/env node\nx()", "js")[0].cls, "comment");
  const rs = highlight("#[derive(Debug, PartialEq)]\nmatch o { Outcome::Bought => 1 }", "rust");
  assert.equal(clsOf(rs, "#["), "meta");
  assert.equal(clsOf(rs, "derive"), "meta");
  assert.equal(clsOf(rs, "PartialEq"), "type");
  assert.equal(clsOf(rs, "Bought"), "constant");
  const css = highlight("@media (min-width: 600px) { body { font-size: 18px; } }", "css");
  assert.equal(clsOf(css, "min-width"), "attr");
});

test("python decorators and definitions", () => {
  const t = highlight("@dataclass\nclass Point:\n    def norm(self) -> float:\n        return None", "python");
  assert.equal(clsOf(t, "@dataclass"), "meta");
  assert.equal(clsOf(t, "Point"), "type");
  assert.equal(clsOf(t, "norm"), "function");
  assert.equal(clsOf(t, "None"), "constant");
});

test("plain text and unknown languages stay plain", () => {
  assert.equal(isKnownLanguage("text"), false);
  assert.equal(isKnownLanguage("brainfuck"), false);
  assert.equal(isKnownLanguage("ts"), true);
  assert.deepEqual(highlight("just words", "brainfuck"), [{ text: "just words", cls: null }]);
});

test("detects the language of untagged blocks", () => {
  const cases = [
    ["const res = await fetch(url);\nconsole.log(await res.json());", "javascript"],
    ["class NetworkError extends Error {\n  constructor(message) {\n    super(message);\n    this.name = 'NetworkError';\n  }\n}", "javascript"],
    ["interface User {\n  id: number;\n  name: string;\n}\nconst u: User = { id: 1, name: 'a' };", "typescript"],
    ["<!DOCTYPE html>\n<html>\n<body>\n<script>\nconst a = 1;\nlet b = 2;\nconsole.log(a + b);\n</script>\n</body>\n</html>", "markup"],
    ["      <h1>About Our Company</h1>\n      <h2>Our Mission</h2>", "markup"],
    [".card {\n  display: grid;\n  padding: 1rem;\n}\n\n.card:hover {\n  color: var(--accent);\n}", "css"],
    ["# Create a full backup of your repository\ngit bundle create repo-backup.bundle --all\n\n# Restore from a bundle\ngit clone repo-backup.bundle -b master restored-repo", "bash"],
    ["npm install --save-dev vite", "bash"],
    ['ssh-keygen -t ed25519 -C "your_email@example.com"', "bash"],
    ["fn main() {\n    let mut v = Vec::new();\n    v.push(1);\n    println!(\"{:?}\", v);\n}", "rust"],
    ["from pathlib import Path\n\ndef read(path):\n    return Path(path).read_text()", "python"],
    ['{\n  "name": "app",\n  "version": "1.0.0"\n}', "json"],
    ["SELECT id, name FROM users WHERE active = true ORDER BY name;", "sql"],
    ["name: CI\non:\n  push:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest", "yaml"],
    ['[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"', "toml"],
    ["package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"hi\")\n}", "go"],
    ["// Change the text\nheader.textContent = 'Hi';\nheader.innerHTML = '<span>Hi <strong>you</strong></span>';\nheader.classList.add('x');", "javascript"],
    ["$('.content-paragraph').text('Updated content');", "javascript"],
    ["// distance\npanner.distanceModel = 'inverse';\npanner.refDistance = 1;", "javascript"],
    ["button.removeEventListener('click', handleClick);", "javascript"],
    ['// Babel config\n{\n  "presets": ["@babel/preset-env"]\n}', "json"],
    [".container{margin:0 auto;padding:20px;}", "css"],
    ["/* BEM */\n.button { /* Block */ }\n.button__icon { /* Element */ }", "css"],
    ["      bash$ mkdir new-project", "bash"],
    ["     ssh-agent -s", "bash"],
    ["git stash drop stash@{1}", "bash"],
  ];
  for (const [code, want] of cases) assert.equal(detectLanguage(code), want, code);
});

test("detection stays out of prose and output", () => {
  const cases = [
    "Hello, world!",
    "my-app/\n├── src/\n│   └── main.rs\n└── Cargo.toml",
    "Error: something went wrong\n    at line 3",
    "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic",
    "<type>[optional scope]: <description>\n\n[optional body]",
    "",
  ];
  for (const code of cases) assert.equal(detectLanguage(code), null, code);
});
