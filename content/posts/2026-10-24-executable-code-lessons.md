---
title: Executable code lessons, with a safe fallback
date: 2026-10-24
series: teaching-with-code
seriesOrder: 1
tags: [tutorial, rust, web, teaching]
description: Rust and browser lessons work out of the box; configured languages fail closed until a separate runner is enabled.
---

open.blog keeps authored source readable before it adds any execution. Try changing this greeting;
without JavaScript, it is still an ordinary code block.

## Rust works by default

```rust runnable title="Rust · edit and run"
fn main() {
    let traveler = "Mira";
    println!("Welcome to the lantern gate, {traveler}!");
}
```

## Web lessons stay local

Web lessons stay in a dependency-free, opaque-origin preview:

```web runnable title="Web · reveal the gate"
---html
<button id="gate">Reveal the gate</button>
---css
button { padding: 0.75rem 1rem; color: rebeccapurple; }
---js
document.querySelector("#gate").onclick = (event) => { event.currentTarget.textContent = "The gate opens"; };
```

## Configured languages fail closed

The repository example intentionally does not configure an external runner. This Python fence
therefore stays static even though it opts into `runnable`; a site owner must explicitly allow
Python and deploy an isolated gateway first.

```python runnable title="Python · static until enabled"
name = input().strip() or "traveler"
print(f"Welcome, {name}!")
```

That fail-closed behavior lets an author keep portable lesson source without silently turning the
blog or Admin server into a code-execution service.

## Turning on more languages

To let readers run Python, Go or another language, the site owner deploys a separate execution
gateway, an isolated, network-disabled sandbox, and lists the languages under `codeRunner` in
`openblog.json`. The blog only forwards the source and shows the text that comes back. The
[deployment guide](https://github.com/journey-to-code-org/open.blog/blob/main/docs/deploy.md#execution-gateway)
explains what that gateway must guarantee before you enable it.

Next: [Rust challenges with hidden checks](/posts/rust-challenges-with-hidden-checks/).
