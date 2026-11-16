---
title: Getting started
description: Install open.blog and make your first site.
order: 1
---

## Install

Download a release for your system from the project's
[releases page](https://github.com/journey-to-code-org/open.blog/releases), or build it with
Rust: `cargo install --path crates/openblog-cli` in a copy of the repository.

## Make a site

```sh
openblog init my-blog
cd my-blog
openblog serve
```

Open <http://localhost:8080>. Add `--starter docs` to `init` for a site with a handbook like
this one.

## Next

Read [Writing a docs page](guides/writing-a-docs-page.md) to add your own pages.
