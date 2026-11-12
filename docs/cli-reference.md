# Command reference

<!-- Generated from `openblog help` by the reference_docs test in
crates/openblog-cli/src/main.rs. Do not edit by hand: change HELP and run
OPENBLOG_BLESS_DOCS=1 cargo test -p openblog-cli cli_reference -->

This page is the full output of `openblog help`, one section per heading. Run `openblog help` for the same text in a terminal.

openblog: a Markdown blog engine in Rust and WebAssembly

## Usage

```text
openblog <command> [options]
```

## Commands

```text
init [dir]                 Create a new blog in dir (default: current directory)
init [dir] --github-pages  Also write a GitHub Pages deployment workflow
init [dir] --no-voice      Never offer a writing session afterwards (a terminal is
                           asked once; scripts and pipes are never asked)
init [dir] --starter docs  Add a documentation section: pages under content/docs/ published
                           at /docs/ with a sidebar, and a Docs link in the header
init [dir] --starter trade [--trade <trade>]
                           Start a trade business site: business facts, three example
                           services as drafts, jobs, reviews, a quote form and a
                           phone-first home page (trade defaults to general-contractor)
new "Title"                Create content/posts/<date>-<slug>.md
build                      Build the site into dist/
serve                      Build, serve at http://localhost:8080, rebuild on change,
                           and publish scheduled posts on time
serve --admin              Also serve the login-protected editor at /admin
user add|passwd|remove|list <name>
                           Manage who can sign in to the admin editor
check                      Validate content and themes without writing anything
export <slug>              Preview or write a portable Markdown article, the post's
                           cited references as CSL JSON or BibTeX, a recipe as
                           schema.org Recipe JSON-LD, or a recipe directory package
paths export|import        Export reading paths to one file, or check and import one
                           (dry run unless --write)
publish [summary]          Commit changed content with git and push (deploys via CI)
publish setup              Create the repository and Pages workflow, report what is left
syndicate <slug>           Plan cross-posting (add --write to create/update remote drafts)
submit <slug> --to <where>  Prepare a community submission or Product Hunt launch kit to
                           make by hand; open.blog never submits for you
webmention [slug]          Plan Webmentions to the sites a post links (add --write to send;
                           needs webmention.enabled in openblog.json)
mentions [action]          Receive and moderate Webmentions from other sites: list, pull,
                           approve, reject, remove, block, unblock, prune (see mentions OPTIONS)
card <slug>                Build and check a published post's visual cards for Pinterest
                           and link previews from its own images; sends nothing
diagram git [--repo <path>] --from <ref> --to <ref>
                           Print a reviewable Mermaid draft of local Git history; publishes nothing
outcomes [--json] [--days N]
                           Where each post went: every destination's status from your own
                           records, and visits the built-in counter attributed to it (N days,
                           default 30). Reads only; asks no provider and sends nothing
pinterest boards           List the Pinterest boards your token can pin to (opt-in)
pinterest pin <slug>       Preview a post's Pin; --write --confirm <digest> sends it
job-share <slug>           Preview a finished job for Google Business Profile, Facebook and
                           Nextdoor; --kit <new folder> writes the by-hand kit (see job-share
                           OPTIONS)
video <slug>               Check a video post's YouTube release: title, description with the
                           article link, thumbnail, chapters, captions, transcript and consent;
                           uploads nothing unless approved and asked to (see video OPTIONS)
youtube connect|disconnect|status
                           Connect a YouTube channel for approved uploads (off until
                           OPENBLOG_YOUTUBE_CLIENT_ID is set), revoke it, or show it
analytics backup           Save view counts to the analytics branch (and push)
analytics pull <url>       Merge counts from a hosted counter (--secret <s>)
analytics worker [dir]     Write a Cloudflare Worker counter to deploy (default: counter/)
analytics service [dir]    Write a Node + MongoDB counter for Render (default: counter-service/)
analytics attribution      Print the visit attribution settings for a hosted counter
voice [prompt-id]          A timed writing session: draw three prompts (or name one),
                           write in your editor or the terminal, and keep the rough draft
                           exactly as written (see voice OPTIONS)
voice --list               Prompts by pack, with what you have answered
voice --resume             Carry on with an interrupted session (an expired one is locked)
voice erase --yes          Erase every sample, the session record, the guide and editor files
voice guide --move portable|private
                           Move the voice guide between the folders (preview; --yes moves it)
voice polish|diff|promote <sample>
                           Refine a copy, compare it, or make a post draft from it
voice export|import        Move your voice samples and guide in one file, previewed and
                           all or nothing (see voice OPTIONS)
themes                     List themes and the inheritance chain of each
import hashnode <host>     Import a Hashnode blog (e.g. yourname.hashnode.dev)
contributors migrate --id <stable-id> [--write]
                           Plan or write explicit legacy-author credit sidecars
build-wasm                 Rebuild the WebAssembly module (engine repository only)
help                       Show this help
```

## Common options

```text
--root <dir>               Project directory (default: .)
--drafts                   Include drafts and scheduled posts (for previews)
--out <dir>                Output directory for build (default: paths.output)
--port <n>                 Port for serve (default: 8080)
--host <addr>              Address for serve (default: 127.0.0.1; use 0.0.0.0 behind HTTPS)
--password-stdin           For `user`: read the password from standard input
```

## `syndicate` options

```text
--target a,b               Limit the run to named configured targets
--write                    Send remote create/update requests and save private state
--publish                  Request publication (also requires target allowPublish: true)
--json                     Print a deterministic dry-run plan with before/after artifacts
--preview <new folder>     Write each destination's exact copy, plan.json and an accessible
                           index.html preview with eligibility errors; sends nothing
--approve <digest>         Approve exactly the previewed plan (sends nothing); with
                           syndication.requireApproval, --write sends only what is approved
```

## `submit` options

```text
--to hacker-news,reddit:rust
                           Where to prepare a submission (each must be enabled under
                           community in openblog.json; a Reddit community needs the rules
                           you wrote down for it)
--to product-hunt          Prepare a launch kit, alone, from launches/<slug>.json: the
                           fields to copy, the screenshots, a preview and Product Hunt's
                           own form
--title <text>             Your own title for this submission instead of the post's
--kit <new folder>         Write an accessible index.html checklist and kit.json there
                           instead of printing the kit
--confirm <destination>    Record that you submitted it there by hand (your word; open.blog
                           never checks), so it is not prepared again
--permalink <address>      With --confirm: the address of your submission
--again                    Prepare an HN repost after a quiet year or a Product Hunt
                           relaunch, or record a second submission
--list                     Show the submissions you confirmed for the post
```

## `webmention` options

```text
[slug]                     One post (default: every published post)
--write                    Check the post is live, then discover each linked site's endpoint and
                           send the due Webmentions; outcomes go to the private queue
                           (webmention.stateFile) and failures are retried later with back-off
--json                     Print the dry-run plan as JSON
```

## `mentions` options

```text
list [--status <s>]        The private inbox (pending, approved, rejected, removed, blocked)
pull --write               Take what the hosted receiver stored, check each source links the
                           post (through the public-only fetcher) and queue it for moderation;
                           needs webmention.receive in openblog.json and
                           OPENBLOG_WEBMENTION_ADMIN_KEY (a dry run contacts nothing)
approve <id> --revision <n>
                           Publish a mention at the revision you read in the list
reject|remove <id> [--reason spam|abusive|off-topic|duplicate|personal-data|other]
block|unblock <host>       Drop a site's requests unread (its subdomains too) and hide its
                           mentions at once
prune [--write]            Delete closed and stale mentions older than
                           webmention.receive.retentionDays (approved ones are kept)
--json                     Print list or pull as JSON
```

## `card` options

```text
--format a,b               pinterest-pin, facebook-link, linkedin-link (default: all)
--json                     Print the card plan with every check and the chosen images
--preview <new folder>     Write cards.json, an SVG layout preview per card and an
                           accessible index.html; reads only the site's own image files
```

## `diagram git` options

`openblog diagram git --from <ref> --to <ref>` reads local Git history in the current
directory, or in `--repo <path>`, and prints a draft Mermaid `gitGraph` to standard
output. The range excludes `--from` and includes commits reachable from `--to` that are
not reachable from `--from`. It does not write or publish anything.

The draft omits author metadata and commit hashes, and makes a best-effort attempt to
redact email addresses and full hashes in labels. Commit subjects and local ref names
can still contain sensitive information: review the entire draft before sharing it.
Replace the placeholder title and description with meaningful alternatives. The output
shows at most 30 commits and reports omitted history, out-of-range parents and
additional merge parents; branch names are listed as review notes rather than used as
graph identifiers. A commit with multiple tags displays one in the diagram; its refs
are listed in the notes.

Mermaid diagram rendering in published pages is not yet available. The generated source
is a draft, not a publication-ready diagram.

## `job-share` options

Sending is off unless syndication.googleBusinessProfile.enabled; token in GOOGLE_BUSINESS_ACCESS_TOKEN.

```text
--to a,b                   google-business-profile, facebook, nextdoor (default: all)
--json                     Print each destination's words, link, photo, problems and digest
--kit <new folder>         Write index.html, kit.json and the photo to post each by hand
--status                   Show what happened at each destination
--send google-business-profile --confirm <digest>
                           Post exactly the previewed job (--forget-attempt settles an
                           attempt that may have posted, after you checked)
```

## `pinterest` options

Off unless syndication.pinterest.enabled; token in PINTEREST_ACCESS_TOKEN.

```text
--board <id>               The board (default: syndication.pinterest.board)
--section <id>             An optional board section
--json                     Print the Pin plan, or the boards, as JSON
--write --confirm <digest> Send exactly the previewed Pin, after checking the board is yours
--reconcile                Look for the Pin an unsettled attempt may have created
--forget-attempt           After checking the board yourself, allow an unsettled Pin again
```

## `video` options

```text
--json                     Print the YouTube preview as JSON
--preview <new folder>     Write title.txt, description.txt, tags.txt, transcript.txt, the
                           thumbnail, preview.json and an accessible index.html; uploads nothing
--approve <digest>         Approve exactly the previewed release and its video file (sends
                           nothing); add --publish-at <RFC 3339 time> to have YouTube publish it
--upload                   Upload the approved release as a private video, resume an
                           interrupted upload, or retry its thumbnail
--lookup                   After an upload whose outcome is unknown, look in the channel's uploads
--settle uploaded:<id>|not-uploaded
                           Settle an unknown upload by hand after checking YouTube Studio
--status                   Show the release's private upload record (add --json for JSON)
```

## `export` options

```text
--format markdown|csl-json|bibtex|recipe-json-ld|recipe-package
                           Portable format (default: markdown); csl-json and bibtex
                           export the public description of the references the post
                           cites, and list what the format leaves out; recipe-json-ld
                           checks a recipe and exports the schema.org Recipe its page
                           carries, refusing while the check finds an error;
                           recipe-package prepares a folder (recipe.json, the text to
                           paste, the cover and a guide page) for recipe directories'
                           own submission steps, sending nothing
--directory google-search,pinterest,foodgawker
                           recipe-package only: the directories to check and prepare for
--out <path>               Output file for an explicit --write
--write                    Write the export (otherwise print a dry-run preview)
--json                     Print a versioned dry-run manifest with exact content
```

## `paths` options

```text
paths export [--out <file>] [--drafts] [--write]
                           Print the published reading paths as one portable JSON file,
                           or with --out and --write create that file (never replaces one)
paths import <file> [--overwrite] [--write]
                           Check an export and say what would change; with --write apply
                           it all or not at all. A stored path that differs is a conflict
                           unless --overwrite
```

## `voice` options

```text
voice [prompt-id]          Draw three prompts and pick 1-3, r (draw again) or q; or name a
                           prompt id to skip the draw
--portable                 Keep the sample beside shared Assistant context instead of in
                           the private folder (default: private)
--seconds <n>              Writing time, 30 to 3600 (default: 180)
--stdin                    Type in the terminal even if $VISUAL/$EDITOR is set; finish with
                           a line holding only a dot (.) or end of input
--resume                   Resume the open session with its original deadline (one window at
                           a time; $VISUAL/$EDITOR must wait for its window, e.g. code --wait)
--scrap --yes              Give up the open session and save nothing
erase [--yes]              List, then (with --yes) erase ALL voice data: samples in both
                           folders, the session record, the guide and leftover editor
                           files. All or nothing, then checks that nothing is left
guide --move portable|private [--yes]
                           Say what moving the voice guide would do; with --yes move it in one
                           step, copied, checked and only then removed. Moving to portable is
                           refused for a guide that quotes private samples or cannot be read
--list                     Show the prompt packs, answered counts and stages
polish <sample>            Edit a COPY of a rough draft in $VISUAL/$EDITOR and save it as the
                           polished draft (the rough draft is locked and never changes);
                           --title, --slug, --description, --tags a,b set its details
diff <sample>              Show what the polished draft changed (unified diff)
promote <sample>           Create a post draft (draft: true) in content/posts from the polished
                           draft; refuses a taken slug; --dir posts/2026 picks a folder under
                           posts. The sample is left in place.
export [--out <file>] [--include-private] [--write]
                           Put the voice samples and guide in one portable JSON file. Private
                           samples and guide are left out unless --include-private, and such a
                           file is only written outside the project or in .openblog/private/.
                           One guide travels (the portable one when both exist); one export
                           holds at most 100 samples and 8 MiB
import <file> [--overwrite] [--as private] [--write]
                           Check an export and say what would change; with --write apply it all
                           or not at all. Items keep their folder (--as private makes all
                           private); a rough draft is never replaced; --overwrite replaces a
                           differing polished draft or guide
<sample> is a file name from `voice --list` output or a prompt id. The clock is fixed when the
session starts: text after the deadline is not saved, and an interrupted session locks what
was saved when you resume after the deadline. Nothing edits a rough draft.
```

## `new` options

```text
--series <slug>            Put the post in a series
--tags a,b,c               Comma-separated tags
--draft                    Mark the post as a draft
--recipe                   Start from a recipe template (servings, times, ingredients, steps)
--profile job              Start a job: the job front matter and the headings Problem, What we
                           found, What we did, Result. Always a draft until it is filled in
--profile decision         Start a draft decision record with before and after diagram slots
--trade <id>               With --profile job: the trade (bundled, or from extraTrades)
--service <id>             With --profile job: the service, such as hardwood-install
--town <name>              With --profile job: the town (never an address)
--region <name>            With --profile job: the region or state
--profile service          Start a service in content/services/: a draft with version 1 front
                           matter (id, name, summary, price band) until you fill it in
--id <id>                  With --profile service: the id (default: the name, as a slug)
--price-band <band>        With --profile service: under-500, 500-2k, 2k-10k, 10k-50k, over-50k
                           or ask
```

## `import hashnode` options

```text
--source public|graphql    public (default) reads your live site and needs no account;
                           graphql uses Hashnode's API (needs Pro plus --token or HASHNODE_TOKEN)
--no-images                Keep remote image URLs instead of downloading them
--token <pat>              Personal access token for --source graphql (or HASHNODE_TOKEN)
--overwrite                Replace imported posts you have edited since the last run
--limit <n>                Import only the first n posts (useful for a trial run)
--delay <ms>               Pause between requests (default: 250)
```
