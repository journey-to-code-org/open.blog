---
title: Code blocks that explain themselves
subtitle: File names, highlighted lines, line numbers and colour, with no plugins.
date: 2026-04-06
series: writers-toolkit
seriesOrder: 4
tags:
  - guide
  - code
description: Give code blocks a file-name title, highlight the lines that matter, number from any line, and let open.blog colour more than twenty languages in the browser.
---

A wall of code makes readers hunt for the important part. A few options after the language name
point them straight to it. Every option here works on any fenced code block, and the colouring
is built in. No library is downloaded and nothing is sent anywhere.

## Titles and highlighted lines

```rust title="src/main.rs" {3-4}
fn main() {
    let names = ["Ada", "Grace", "Linus"];
    for name in names {
        println!("Hello, {name}!");
    }
}
```

````markdown
```rust title="src/main.rs" {3-4}
fn main() {
    ...
}
```
````

`title="..."` adds a caption bar, usually a file name. `{3-4}` highlights lines 3 and 4. List
several with commas: `{1,3,5-7}`.

## Starting from any line number

When you show an excerpt from the middle of a file, number it to match the real file:

```js title="web/components/greeting.js" showLineNumbers=42 {44}
export function greet(name) {
  const trimmed = name.trim();
  if (!trimmed) return "Hello, stranger!";
  return `Hello, ${trimmed}!`;
}
```

````markdown
```js title="web/components/greeting.js" showLineNumbers=42 {44}
````

Highlighted lines are always counted from the top of the block, so `{44}` above is the third
line. Use `showLineNumbers=false` to drop the numbers from one block.

## Terminal commands and output

Shell blocks (`bash`, `sh`, `console`, `powershell`) are not numbered, because nobody pastes
line numbers into a terminal. Mark program output as `text` so it is neither coloured nor
numbered:

```sh
openblog build
```

```text
Built 33 posts, 9 series, 36 tags, 1 pages (116 generated files) -> ./dist
```

## Languages

Colouring covers Rust, JavaScript, TypeScript, HTML, XML, CSS, JSON, YAML, TOML, Bash, Python,
Ruby, Go, SQL, Markdown, and the C family (C, C++, Java, C#, Kotlin, Swift). Inside HTML, the
contents of `<script>` and `<style>` are coloured as JavaScript and CSS:

```html title="index.html"
<style>
  .card { border-radius: 8px; }
</style>
<button class="card" onclick="greet()">Say hello</button>
<script>
  function greet() { alert(`Hello at ${new Date().toLocaleTimeString()}`); }
</script>
```

A block without a language (common in posts imported from other platforms) has its language
guessed. If the guess is unsure, the block stays plain:

```
SELECT title, date FROM posts WHERE draft = false ORDER BY date DESC;
```

## Copying never includes line numbers

Use the **Copy** button on any block above and paste it somewhere: you get only the code. The
numbers are drawn by CSS, so selecting the text by hand also leaves them behind.

## Turning things off

Each level overrides the one before it:

1. **The theme** sets defaults: `"options": { "codeHighlighting": false, "codeLineNumbers": false }`.
2. **The site** overrides them under `code` in `openblog.json`. `"copyButton": false` removes
   the Copy buttons.
3. **One post** sets `highlight: false` or `lineNumbers: false` in its front matter.
4. **One block** sets `showLineNumbers=false`, or is marked `text` to stay uncoloured.

Want code readers can edit and run? That is a series of its own:
[Teaching with code](/series/teaching-with-code/).

Next: [Knowledge checks](/posts/knowledge-checks/).
