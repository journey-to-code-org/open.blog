---
title: Command Reference
parent: CLI Overview
nav_order: 1
---

# Command Reference

This reference covers the most-used `openblog` commands and usage patterns.

## Project setup

```bash
openblog init [dir] [--title "..."] [--github-pages]
openblog new "Title" [--series s] [--tags a,b] [--draft] [--recipe]
```

- Use `init` once per blog.
- Use `new` for each article.

## Build and preview

```bash
openblog check [--json]
openblog build [--drafts] [--out dir]
openblog serve [--admin] [--drafts] [--host 127.0.0.1] [--port 8080]
```

- `check` validates content and configuration.
- `build` writes static output (default `dist/`).
- `serve` runs local development preview.

## Publishing and deployment

```bash
openblog publish [summary]
openblog publish setup
```

- `publish` commits/pushes content changes through Git.
- `publish setup` prepares repository publishing workflow.

## Portability and syndication

```bash
openblog export <slug> [--format markdown|csl-json|bibtex] [--out path] [--write]
openblog syndicate <slug> [--target a,b] [--write] [--publish]
openblog video <slug> [--json] [--preview <new folder>]
openblog video <slug> --approve <digest> [--publish-at <time>]
openblog video <slug> --upload | --lookup | --settle uploaded:<id>|not-uploaded | --status [--json]
openblog youtube connect|disconnect|status
```

Use these for cross-platform content reuse and external publication workflows. `video` checks a video post's
YouTube release and writes its title, description, tags, transcript, thumbnail and an accessible preview page;
it uploads nothing. Once you set `OPENBLOG_YOUTUBE_CLIENT_ID`, run `youtube connect` and approve a release's digest,
`--upload` sends it to YouTube as a private video (made public by YouTube at `--publish-at`, if you gave one), resumes
an interrupted upload and records the video id; `--lookup` and `--settle` resolve an upload whose outcome was lost.

## Users and analytics

```bash
openblog user add|passwd|remove|list <name> [--password-stdin]
openblog analytics backup
openblog analytics pull <url> --secret s
```

Use these when running Admin in multi-user mode and maintaining analytics integrity.

## Working in another directory

Most commands support:

```bash
openblog <command> --root /path/to/blog
```

This is useful for scripts and centralized operations.
