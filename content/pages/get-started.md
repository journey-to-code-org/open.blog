---
title: Get started
description: Install open.blog, make a site, write a post and publish it, in five steps.
---

Five steps from nothing to a published post. [The quick start](https://journey-to-code-org.github.io/open.blog/docs/getting-started/) in
the documentation has the same steps with more detail.

## 1. Install

open.blog is one command-line program. It needs the Rust toolchain to install.

```bash
cargo install --git https://github.com/journey-to-code-org/open.blog openblog-cli
```

## 2. Make a site

```bash
openblog init my-blog --github-pages
cd my-blog
```

This writes a first post, the settings in `openblog.json`, the themes and a workflow that
publishes to GitHub Pages. Add `--starter docs` for a documentation section or
`--starter trade` for a business site.

## 3. See it

```bash
openblog serve
```

The site is at `http://localhost:8080` and rebuilds as you change files.

## 4. Write

Pick whichever suits you:

- **In the browser.** `openblog user add you`, then `openblog serve --admin`, and open `/admin`. [Studio](/studio/) writes the files for you.
- **In a text editor.** Change a file in `content/posts/` and save.
- **From the command line.** `openblog new "A post title"` starts a file with today's date.

## 5. Publish

```bash
openblog check
openblog publish "My first post"
```

`check` reads everything without writing, and `publish` commits and pushes; the workflow does
the rest. [Deploying](https://journey-to-code-org.github.io/open.blog/docs/deploy/) covers other hosts.

## Then

- [What it does](/features/), for the tour.
- [Welcome to your blog](/posts/welcome-to-your-blog/), for a map of the examples on this site.
- [Configuration](https://journey-to-code-org.github.io/open.blog/docs/configuration/), for every setting.
- [Troubleshooting](https://journey-to-code-org.github.io/open.blog/docs/troubleshooting/), when something does not work.
