# open.blog documentation

If you are new, read these in order; each one stands alone otherwise.

1. [Writing content](content.md): where files go, what a post looks like, series, pages,
   drafts, scheduling, images, code blocks, callouts, recipes, and every front matter field.
2. [Configuration](configuration.md): every setting in `openblog.json`, with defaults.
3. [Deploying](deploy.md): GitHub Pages, other static hosts, running your own server,
   and keeping old URLs working.
4. [Publishing from home](publishing.md): the Publish button, git as your backup, view
   counts on a static host, and a counter you can host for free.
5. [Cross-posting](cross-posting.md): safely syndicate articles to Hashnode, DEV, Medium,
   Ghost, and WordPress without leaking credentials or creating duplicate originals.
6. [Themes and the design system](themes.md): how a theme is built from design tokens,
   light and dark, per-series themes, and making your own.
7. [Adding web components to a theme](theme-components.md): scripts, heading effects,
   and the demo theme to copy from.
8. [The admin editor](admin.md): the writing workspace, production-faithful theme and
   social previews, search, answer-readiness and accessibility guidance, scheduling, and
   safe operation.
9. [Sharing, views, analytics, and embeds](features.md): share links, the view counter,
   syntax highlighting, related posts, a CDN, and slots for comments or newsletters.
10. [SEO and answer discovery](seo.md): publishing checks, AI crawler policy, text feeds,
   and machine-access analytics.
11. [Accessibility checks and manual review](accessibility.md): source findings, outcome
   meanings, known limits, and a rendered-site review workflow.
12. [Research posts and Evidence Studio](research-profile.md): DOI and license fields,
   visible references, contributor-credit demonstration, scholarly metadata, deterministic
   evidence checks, and their limits.
13. [Showing your posts on another site](integrations.md): feeds and the latest-posts JSON.
14. [Migrating from Hashnode](hashnode-migration.md): with or without a paid plan.
15. [Migrating inherited authorship](contributor-migration.md): dry-run-first contributor credits.

Architecture decisions and their supporting primary-source research live under
[`docs/adr`](adr/) and [`docs/research`](research/).

Current design frontiers include
[contributor identity and ORCID provenance](research/contributor-identity-and-orcid.md),
which defines the incremental path from one site author to ordered, work-specific credit.

## Command reference

```
openblog init [dir] [--title "..."] [--github-pages]
                                        Create a new blog (optionally with a Pages workflow)
openblog new "Title" [--series s] [--tags a,b] [--draft] [--recipe]
openblog build [--drafts] [--out dir]   Write the site to dist/
openblog serve [--admin] [--drafts] [--host 127.0.0.1] [--port 8080]
openblog check                          Validate content and themes, write nothing
openblog themes                         List themes and what they extend
openblog publish [summary]              Commit changed content with git and push
openblog publish setup                  Create the repository and Pages workflow
openblog analytics backup               Save view counts to the analytics branch
openblog analytics pull <url> --secret s
                                        Merge counts from a hosted counter
openblog analytics worker [dir]         Write a Cloudflare Worker counter
openblog analytics service [dir]        Write a Node + MongoDB counter (Render)
openblog user add|passwd|remove|list <name> [--password-stdin]
openblog contributors migrate --id <stable-id> [--write]
                                        Dry-run or write explicit legacy-author credits
openblog import hashnode <host> [--source public|graphql] [--token t]
                                        [--limit n] [--no-images] [--delay ms] [--overwrite]
openblog help
```

Every command accepts `--root <dir>` to work on a blog in another folder. `--drafts`
includes drafts and scheduled posts, for previews.

`openblog build-wasm` exists for people working on the engine itself: it recompiles the
search module from the open.blog source tree. A blog made with `openblog init` already
contains the compiled module under `web/wasm/`.

## Getting help

Open an issue at <https://github.com/journey-to-code-org/open.blog/issues>. Include the
command you ran and its output; `openblog check` reports most content problems with the
file and reason.
