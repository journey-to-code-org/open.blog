---
title: Rust challenges with hidden checks
subtitle: Give readers a task, and let your own tests tell them what to fix.
date: 2026-05-04
series: teaching-with-code
seriesOrder: 2
tags:
  - tutorial
  - rust
  - teaching
description: Write a Rust starter with a TODO, add hidden tests after a ---checks line, and readers get a Check my code button that shows your own feedback for each failing test.
---

Reading code teaches a little. Writing it teaches a lot more, as long as the reader finds out
whether they got it right. A `rust runnable check` block gives readers starter code to finish,
and a **Check my code** button that runs your hidden tests against their answer.

## Try it: a game's damage rule

In a small clicker game, every click deals its base damage plus a bonus. Damage must never wrap
around to a tiny number when it gets huge, and a stunned enemy takes double damage.

**Your task:** finish `click_damage` so all three checks pass. Run it first to see what fails.

```rust runnable check title="Finish the damage rule"
fn click_damage(base: u32, bonus: u32, stunned: bool) -> u32 {
    // TODO: add the bonus, double it when stunned,
    // and never wrap around past u32::MAX.
    base
}

fn main() {
    println!("{}", click_damage(5, 3, false));
}
---checks
/// Add the base and the bonus together: 5 + 3 should be 8.
#[test]
fn adds_bonus() {
    assert_eq!(click_damage(5, 3, false), 8);
}

/// A stunned enemy takes double damage: (5 + 3) * 2 should be 16.
#[test]
fn doubles_when_stunned() {
    assert_eq!(click_damage(5, 3, true), 16);
}

/// Stop at the ceiling instead of wrapping around. Try saturating_add and saturating_mul.
#[test]
fn never_wraps() {
    assert_eq!(click_damage(u32::MAX, 1, true), u32::MAX);
}
```

> [!TIP]
> Stuck? `u32` has `saturating_add` and `saturating_mul`, which stop at the maximum instead of
> overflowing.

## How it is written

````markdown
```rust runnable check title="Finish the damage rule"
fn click_damage(base: u32, bonus: u32, stunned: bool) -> u32 {
    // TODO: add the bonus, double it when stunned...
    base
}
---checks
/// Add the base and the bonus together: 5 + 3 should be 8.
#[test]
fn adds_bonus() {
    assert_eq!(click_damage(5, 3, false), 8);
}
```
````

- Everything **above** `---checks` is the starter readers see and edit.
- Everything **below** is ordinary Rust `#[test]` functions. They run in a module with
  `use super::*`, so they can call the reader's functions, private ones included.
- The `///` comment on each test is the feedback readers see when that test fails. Without one,
  they see the test's name. The raw assertion is never shown, so a check does not give its own
  answer away.
- If the code does not compile, readers see the compiler's message instead.

## Writing good checks

**Say what is fixed.** Tests that call `click_damage(5, 3, false)` fix the function's name and
signature, so the task must tell readers not to rename it.

**Prefer several small checks.** Three checks with specific feedback teach more than one big
check that says "wrong".

**Hidden is not secret.** The checks are in the page, so a curious reader can find them. This is
a teaching aid, not an exam.

**Mind the size.** The starter must be under 20,000 bytes, and the starter plus checks under
40,000.

## Where it cannot run

In feed readers and copies on other platforms, the starter appears as code, followed by the
checks in a collapsed "Spoiler: the checks for this challenge" section and a link back to the
live version. Readers elsewhere can see how the challenge is checked without having the answer
in front of them.

## A lighter challenge without checks

For a quick exercise, a plain `rust runnable` block with a `TODO` and an expected result is
enough. The reader compares the output themselves.

**Coding challenge: say hello properly.** Print `Hello, Mira!` using the `name` variable.

```rust runnable title="Finish the greeting"
fn main() {
    let name = "Mira";
    // TODO: print "Hello, Mira!" using name
}
```

The Admin's **Assistant → Interactions → Create runnable-code proposal** can draft either kind
from a section of your post, and it works without an AI provider too.

Next: [HTML, CSS and JavaScript sandboxes](/posts/html-css-and-javascript-sandboxes/).
