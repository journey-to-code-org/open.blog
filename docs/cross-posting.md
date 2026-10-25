# Cross-posting to Hashnode, DEV, Medium, Ghost, and WordPress

Keep open.blog as the source of truth, then send a copy of each published article to
the communities where your readers already are. The safest order is:

1. build and deploy open.blog;
2. confirm the article's public URL works;
3. create drafts on the other platforms with that URL as the canonical URL;
4. inspect the drafts, then publish them.

That order matters. A syndicated copy should never point search engines at a canonical
URL that does not exist yet.

open.blog includes a safe, draft-first command for DEV, Hashnode, Ghost, and WordPress,
plus guided manual import for Medium. It can also supply full-content RSS and JSON Feed for
external feed automation.

## Built-in command

Copy the `syndication` object from
[`openblog.syndication.json`](../examples/cross-posting/openblog.syndication.json) into
`openblog.json`, enable the destinations you want, and add an immutable `syndicationId` to
posts you plan to cross-post. Keep credentials in your shell or CI secret store.

Inspect the plan first; these commands do not read secrets or contact a provider:

```sh
openblog syndicate your-post-slug
openblog syndicate your-post-slug --target dev,medium
```

The plan identifies the portable Markdown or HTML projection used by each destination and
calls out interactions that remain on the canonical article.

For automation or a complete before/after review, request the deterministic JSON dry-run plan:

```sh
openblog syndicate your-post-slug --json
```

The plan includes authored Markdown, the exact provider artifact, destination policy, intended
draft/publication action, and source-scoped diagnostics. `--json` cannot be combined with
`--write`.

For a local Markdown artifact, preview it before writing:

```sh
openblog export your-post-slug --format markdown
openblog export your-post-slug --format markdown --json
openblog export your-post-slug --format markdown --out exports/your-post.md --write
```

The export does not replace or modify the canonical post, and it refuses to overwrite an
existing destination file. Full-content RSS and JSON Feed likewise use portable HTML rather
than native open.blog component markup; JSON Feed includes a plain-text companion.
The version-1 JSON export manifest includes exact Markdown bytes, byte count, canonical identity,
source revision, capability portability levels, and diagnostics. It is dry-run-only, creates no
manifest file, and cannot be combined with `--write`. An explicit write stages the complete file
in the selected parent directory and publishes it atomically without replacing an existing file,
even if another writer creates that name concurrently. Paths containing `..` or symlink
components are rejected. Filesystems without hard-link support return an explicit error rather
than falling back to a partial or overwriting write. Only published, due posts are eligible.

After the open.blog URL is deployed and reachable, create or update remote drafts:

```sh
openblog syndicate your-post-slug --write
```

The private state file records remote IDs, so later writes update instead of duplicating.
Public publication requires both `--publish` and `allowPublish: true`. Hashnode remains
draft-only in this iteration. WordPress core cannot portably set an external canonical, so
the command warns for those targets. See the complete
[automated syndication specification](specs/automated-syndication.md).

The source post must already be production-visible: drafts and future-scheduled posts are
rejected. On `--write`, the command fetches the public open.blog URL before the first provider
mutation and requires a successful page whose canonical link points back to that same URL.
A dry run remains network-free, so deployment reachability is checked only when a write is
explicitly requested.

For feed automation, make sure `feeds.rss`, `feeds.json`, and `feeds.fullContent` are all
`true`. In either route, begin with drafts rather than unattended publishing.

## Before connecting a platform

Set the public `url` in `openblog.json`, run the content checks, and deploy:

```sh
openblog check
openblog build
```

Open the final article URL and verify its canonical link points to itself. Then prepare
your automation with these rules:

- Keep API keys in your CI provider's encrypted secrets, never in a post, browser
  script, committed workflow, or generated site.
- Trigger cross-posting only after the primary deployment succeeds.
- Create a draft first. Make public publishing a separate, explicit opt-in.
- Convert relative links and images to absolute URLs before sending the article.
- Store the remote article ID returned by each API. Use that ID for later updates;
  creating again on every run produces duplicates.
- Do not automatically delete remote articles when a local Markdown file disappears.

For GitHub Actions, add credentials under **Settings → Secrets and variables → Actions**
and read GitHub's guidance for [using secrets in workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
Never give publishing secrets to a workflow that runs untrusted pull-request code.

## Choose a publishing route

| Destination | Recommended route | Draft support | Canonical to open.blog | Main limitation |
| --- | --- | --- | --- | --- |
| Hashnode | Official GitHub Action or GraphQL API | Yes | Yes | API publishing requires Hashnode Pro |
| DEV Community | DEV API | Yes | Yes | Save the returned article ID for updates |
| Medium | Manual **Import a story** | Editable before publish | Added automatically | Medium does not accept new API integrations |
| Ghost / Ghost(Pro) | Admin API | Yes | Yes | Markdown must be converted to HTML or Lexical |
| WordPress.com | WordPress.com REST API | Yes | Not portable | OAuth2 is required |
| Self-hosted WordPress | Core REST API | Yes | Not portable | Core has no external-canonical field |

A feed automation service is the easiest route when it supports your destination. Point
it at `https://your-domain.example/rss.xml`, select **create draft**, and map the source
article URL to the destination's canonical field. If the connector cannot set a
canonical URL or update an existing item, do not use it for automatic public copies.

## Hashnode

Hashnode maintains an official
[`publish-github-action`](https://github.com/Hashnode/publish-github-action#readme) that
reads Markdown from a repository, publishes on pushes, and updates a post by its stable
slug. It supports draft and dry-run modes as well as `canonical` or `canonicalUrl` in
front matter.

1. Confirm the target publication has an active Pro plan. Hashnode moved GraphQL API
   access to Pro on May 13, 2026.
2. Create a Hashnode Personal Access Token and save it as the repository secret
   `HASHNODE_PAT`.
3. Follow the action's README to set the publication host or ID and the directory
   `content/posts`.
4. Start with its `dry-run` option. Then use `saveAsDraft` while checking how open.blog
   front matter and images render.
5. Give each post a stable slug and set its canonical URL to the already-deployed
   open.blog article.
6. Pin the action to a reviewed full commit SHA before allowing it to receive secrets.

Do not copy the action's standalone push trigger unchanged. Put the Hashnode step in a
job with `needs: deploy` in the same workflow, or trigger a separate workflow with
`workflow_run` after your deployment workflow completes successfully. In either case,
verify the canonical URL returns a successful response before creating the Hashnode
copy. This preserves the deploy-first order described above.

Read the action's [behavior and limits](https://github.com/Hashnode/publish-github-action#behavior-details)
before enabling a large batch. In particular, repeatedly pushing a file configured with
`saveAsDraft: true` can create duplicate drafts. Hashnode also limits tags, request size,
and image formats and sizes.

If you build a custom adapter instead, use Hashnode's current GraphQL recipes and create
a draft before publishing it. The official
[GraphQL recipes](https://github.com/Hashnode/gql-skill/blob/main/skills/gql-api/references/recipes.md)
show the current endpoint and mutations.

## DEV Community (dev.to)

Create an API key in DEV account settings and store it as `DEVTO_API_KEY`. A request to
`POST https://dev.to/api/articles` can create a draft directly from Markdown:

```sh
curl https://dev.to/api/articles \
  -H "api-key: $DEVTO_API_KEY" \
  -H "Accept: application/vnd.forem.api-v1+json" \
  -H "Content-Type: application/json" \
  -H "User-Agent: open.blog cross-publisher" \
  --data '{
    "article": {
      "title": "Your title",
      "body_markdown": "Your Markdown body",
      "published": false,
      "canonical_url": "https://your-domain.example/posts/your-slug/",
      "description": "Your description",
      "tags": "rust,tutorial"
    }
  }'
```

Use a JSON library rather than hand-built strings in a real script. Record the `id` in
the successful response, then send later edits to `PUT /api/articles/{id}`. DEV accepts
up to four tags in this API and defaults `published` to `false`, but set it explicitly so
the safety choice is visible in your code. See the current
[Forem API v1 article reference](https://developers.forem.com/api/v1#tag/articles).

Before changing `published` to `true`, open the DEV draft and check code blocks, images,
tags, description, and the canonical URL.

### Complete GitHub Actions example

The repository includes a dependency-free
[`dev-to.mjs`](../examples/cross-posting/dev-to.mjs) adapter and a matching
[`dev-to.yml`](../examples/cross-posting/dev-to.yml) workflow template. Together they:

- run only after a workflow named `Deploy` succeeds on `main`;
- read the newest item from the deployed `/feed.json` rather than parsing front matter;
- confirm the canonical article is publicly reachable;
- find an existing DEV article by canonical URL and update it instead of duplicating it;
- create new articles as drafts; and
- preserve the publication state when updating an article that already exists.

Set it up as follows:

1. Confirm `feeds.json` and `feeds.fullContent` are enabled and that the newest deployed
   article appears in `/feed.json`. Increase `feeds.limit` if you plan to re-run older
   articles.
2. Copy `examples/cross-posting/dev-to.yml` to
   `.github/workflows/cross-post-dev.yml`.
3. Change `workflows: ["Deploy"]` to the exact `name` of your deployment workflow and
   change `SITE_URL` to the public base URL from `openblog.json`.
4. Add `DEVTO_API_KEY` as a GitHub Actions repository secret.
5. Push a disposable post through the normal deployment. After deployment succeeds,
   inspect the new draft in DEV.
6. To process a specific article still present in the feed, run the workflow manually
   and supply its complete canonical URL as `post_url`.

The template uses version tags for readability. For production, replace third-party
action tags such as `actions/checkout@v4` with reviewed full commit SHAs.

## Medium

Do not build a new Medium API integration. Medium no longer issues integration tokens
or accepts new API integrations, and its old API is unsupported.

Use Medium's supported import flow instead:

1. Deploy the article on open.blog.
2. In Medium, open **Stories**, choose **Import a story**, and paste the open.blog URL.
3. Open the imported story, inspect its formatting, and publish when ready.

Medium says this flow backdates the story and automatically adds the original URL as
canonical. See Medium's official [Importing a post](https://help.medium.com/hc/en-us/articles/214550207-Importing-a-post-to-Medium)
instructions. Existing legacy token holders may still have API access, but that is not a
dependable setup for new users.

## Ghost and Ghost(Pro)

Create a Custom Integration in Ghost Admin and keep its Admin API key only in CI or a
trusted server. Ghost explicitly warns that Admin API keys are not safe in browser code.

1. Store the Admin API URL and key as CI secrets.
2. Convert the post Markdown to HTML or Ghost's Lexical format.
3. Sign the short-lived JWT described in Ghost's
   [Admin API authentication guide](https://docs.ghost.org/admin-api/).
4. Send `POST /ghost/api/admin/posts/?source=html` with `status: "draft"` and the
   open.blog URL in `canonical_url`.
5. Save the returned post ID, review the draft in Ghost Admin, and use that ID for
   updates and eventual publication.

Ghost documents the request shape in [Creating a post](https://docs.ghost.org/admin-api/posts/creating-a-post).
Its [custom canonical URL](https://ghost.org/changelog/canonical-urls/) support makes it
a good syndication target, but HTML-to-Lexical conversion can be lossy, so visual review
is important.

## WordPress.com and self-hosted WordPress

WordPress can receive posts automatically, but core WordPress does not expose a portable
field for an external canonical URL. Most WordPress posts therefore identify their own
permalink as canonical. Unless a known SEO plugin or site customization exposes a
canonical field through the REST API, use WordPress as the original publisher rather
than an SEO-safe copy.

For WordPress.com:

1. Create an OAuth2 application and store its access token in CI.
2. Find the numeric site ID.
3. Create a draft with `POST https://public-api.wordpress.com/wp/v2/sites/{site_id}/posts`
   and `status: "draft"`.
4. Store the returned post ID for updates.

Follow WordPress.com's [REST API getting-started guide](https://developer.wordpress.com/docs/api/getting-started/)
and its [site URL rules](https://developer.wordpress.com/docs/rest-api-urls-by-site-type/).

For self-hosted WordPress 5.6 or later:

1. Create a dedicated, revocable Application Password for the publishing user.
2. Send it with HTTP Basic authentication over HTTPS only.
3. Create a draft with `POST https://your-wordpress.example/wp-json/wp/v2/posts` and
   `status: "draft"`.
4. Store the returned post ID for updates.

The official [posts endpoint](https://developer.wordpress.org/rest-api/reference/posts/)
lists the supported fields, and the [Application Passwords guide](https://developer.wordpress.org/advanced-administration/security/application-passwords/)
explains credential handling.

## A safe CI pipeline

Whichever adapters you write, keep the workflow in this order:

```text
validate -> build -> deploy open.blog -> verify public URL
         -> render platform payloads -> create/update drafts
         -> verify drafts -> explicitly publish
```

Persist a small private state record for each source post and destination:

```json
{
  "source": "content/posts/2026-02-09-automated-cross-posting.md",
  "revision": "sha256-of-publishable-content",
  "destinations": {
    "devto": { "id": 123456, "url": "https://dev.to/..." },
    "ghost": { "id": "remote-id", "url": "https://ghost.example/..." }
  }
}
```

Keep this state out of the public article body. Serialize updates per post and platform,
retry only temporary failures such as rate limits or server errors, and report partial
success instead of trying to undo copies that were already published.

Finally, test the workflow with one disposable article and drafts on every destination.
Only enable unattended public posting after updates are idempotent, canonical URLs are
verified, and credential rotation has been rehearsed.
