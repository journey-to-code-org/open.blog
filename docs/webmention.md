# Webmention

When one of your posts links someone else's page, you can tell that site so with a
[Webmention](https://www.w3.org/TR/webmention/): a small, open standard many independent sites use to
show replies, likes and mentions from elsewhere on the web. open.blog can send them for you. It is off
until you switch it on, it sends nothing without `--write`, and your site, feeds and cross-posting are
the same whether or not you use it.

You can also receive them: see [Receive Webmentions](#receive-webmentions). That is off too, and
needs the optional hosted function.

## See what would be sent

This reads your built posts and the private queue, and contacts nothing. It works with sending off:

```sh
openblog webmention your-post-slug
openblog webmention                  # every published post
openblog webmention your-post-slug --json
```

For each post it lists the links to other sites it would tell, with a reason (`new-link`,
`post-changed`, `link-removed`, `retry-due`), the ones it is waiting on or skipping (`retry-later`,
`already-sent`, `settled`) and the links that are not targets and why: `not-web` (not an `http` or
`https` address), `credentials` (the address has a user name or password), `excluded` (you excluded the
site) or `over-limit` (more than 100 links in one post). Links to your own site are never targets.

## Switch it on and send

```json
{ "webmention": { "enabled": true } }
```

Deploy first, then:

```sh
openblog webmention --write
```

Before sending anything for a post, open.blog checks that the post's canonical address answers and
declares itself as canonical, so the site you tell can find your link. If it is not live yet, nothing
is sent for that post and the command fails, so CI notices; deploy and run it again. Then for each due
link it fetches the linked page, finds the Webmention endpoint the page advertises and posts your
post's address and the linked address to it.

Running `openblog webmention --write` after every deploy is the intended pattern. It only sends what is
due: a link it has already told is not told again until you change the post.

## Choosing who is told

- Only published posts that are due are ever considered; drafts and scheduled posts are refused.
- `webmentions: false` in a post's front matter leaves that post out.
- `"excludeHosts": ["example.com"]` in the `webmention` block leaves out that site and its subdomains.

## What happens to each one

The outcome of every ping is kept in a private file, `.openblog/webmentions.json` by default
(`webmention.stateFile`, inside the project, never committed: `.openblog/` is ignored by Git). It holds
addresses, status codes and short error codes, never a page or a reply's text.

| Status | Meaning | Next |
| --- | --- | --- |
| `sent` | The site accepted it (any 2xx; 201 and 202 mean it is still checking your link). | Sent again only when you change the post. |
| `no-endpoint` | The linked page advertises no Webmention endpoint. | Checked again when you change the post. |
| `retrying` | No answer, or the site was busy (408, 425, 429 or 5xx). | Tried again after 10 minutes, 1 hour, 6 hours, then 24 hours. |
| `failed` | Five attempts did not get through. | Tried again when you change the post. |
| `rejected` | The site refused it, or redirected in a way that is not followed. | Tried again when you change the post. |
| `blocked` | An address on the way was not a public internet address. Nothing was sent there. | Tried again when you change the post. |

When you edit a post, every site it links is told again, and a site you have stopped linking is told
once more so it can update or remove the mention. A repeated Webmention is harmless: the receiver treats
it as an update.

## Safety

Every address open.blog contacts comes from someone else's page, so each one, including every redirect
(at most five) and the endpoint itself, must be an `http` or `https` address that resolves only to
public internet addresses. `localhost`, private networks, link-local and other reserved ranges are
refused before any connection, and a name that resolves to one is never connected to. No proxy, cookie
or credential is used, each request has a 15 second limit, and only the first MiB of a linked page is
read, by an HTML parser that never runs it (ADRs
[0361](adr/0361-outbound-webmention-is-an-opt-in-command-line-send-that-discovers-each-endpoint-through-the-public-only-fetcher.md),
[0362](adr/0362-a-ping-is-queued-only-for-a-live-published-post-and-each-outcome-is-recorded-in-a-private-queue-that-retries-with-back-off.md),
[0363](adr/0363-webmention-safety-is-pinned-by-a-local-server-and-a-scripted-network-and-sending-off-changes-nothing.md)).

## What was checked, and where

Checked on 2026-10-29 against the [W3C Webmention Recommendation](https://www.w3.org/TR/webmention/)
(12 January 2017):

- Discovery (3.1.2): the first HTTP `Link` header with `rel="webmention"` wins, then the first `<link>` or
  `<a>` with that relation in document order; a relative endpoint resolves against the linked page's
  address, and a query string on the endpoint is kept, never moved into the request body.
- Sending (3.1.3): a form-encoded POST of `source` and `target`; any 2xx is success; 202 means queued,
  201's `Location` is a status page.
- Updates (3.1.4): re-send previously sent Webmentions when the post changes, including to removed links.
- Security (4.3): never send to a loopback endpoint; open.blog refuses every non-public address.
- The [webmention.rocks](https://webmention.rocks/) discovery tests (an empty `href`, a relative endpoint
  after a redirect, several `rel` values, a query string, a false endpoint inside an HTML comment) are
  covered by open.blog's own tests, which never contact a real site.

Not handled yet: telling sites when a post is deleted (3.1.5 asks the site to answer 410 Gone with a
tombstone page, which open.blog does not serve), and a view of the queue in Admin.

## Receive Webmentions

Other sites can tell yours that they link one of your posts. open.blog takes those notes, checks each
one, and shows the ones you approve under the post as a short list of links. Nothing appears on your
site until you approve it, and a site you block disappears at once.

A static site cannot take a request, so receiving needs the optional hosted function on Netlify with
Supabase, the same setup as hosted comments. Your site still builds and reads without it.

### How it works

1. A post advertises your endpoint in its page head: `<link rel="webmention" href="https://your-site/api/webmention">`.
2. Another site sends it two addresses: its page (`source`) and your post (`target`). The hosted
   function checks only that they are web addresses, that they differ and that the target is one of
   your posts, stores the pair and answers `202 Accepted`. It never opens the other site's page.
3. You run `openblog mentions pull --write`. It opens each source page through the same public-only
   fetcher that sending uses, and keeps it only if the page really links your post. The page is read,
   never run: a link a script would add does not count, and nothing it loads is requested.
4. What links your post waits in your private inbox. You approve, reject or block. Approved mentions go
   into `content/webmentions.json`, and the next build lists them on the post's page.

### Set it up

1. Run [`supabase/webmention.sql`](../supabase/webmention.sql) once in the Supabase SQL editor. It adds
   one private table and two functions and changes nothing else.
2. In Netlify, set these environment variables, then redeploy:

   | Variable | Value |
   | --- | --- |
   | `OPENBLOG_WEBMENTION_ENABLED` | `true`; anything else keeps the endpoint off (every request is a 404) |
   | `OPENBLOG_WEBMENTION_ADMIN_KEY` | A new random value of at least 32 characters, used only by `openblog mentions pull` |
   | `OPENBLOG_WEBMENTION_BLOCKED_HOSTS` | Optional: sites, comma separated, whose requests are never stored |

   It also uses `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENBLOG_SITE_ID` and `OPENBLOG_SITE_ORIGIN`,
   as hosted comments do. The key must differ from every other key you set.
3. In `openblog.json`, switch receiving on and name the endpoint:

   ```json
   {
     "webmention": {
       "receive": { "enabled": true, "endpoint": "https://your-site.example/api/webmention" }
     }
   }
   ```

   Build and deploy. Each post now advertises the endpoint, and the build writes
   `openblog-webmention.json`, the list of posts that accept mentions, which the hosted function reads.
   A post opts out with `webmentions: false` in its front matter: it neither sends nor receives.
4. On the machine where you moderate, set `OPENBLOG_WEBMENTION_ADMIN_KEY` to the same value. It is read
   from the environment only and is never written to a file or printed.

### Moderate

```sh
openblog mentions pull --write            # take what arrived, check each source, queue what links a post
openblog mentions list --status pending   # what waits for you, with each mention's id and revision
openblog mentions approve m-0123456789abcdef --revision 1
openblog mentions reject m-0123456789abcdef --reason spam
openblog mentions remove m-0123456789abcdef --reason off-topic
openblog mentions block spam.example      # also covers its subdomains
openblog mentions unblock spam.example
openblog mentions prune                   # list what retention would delete; add --write to delete it
```

- **Approve names a revision.** If the other page changes its title or author after you read it, the
  mention goes back to pending with a new revision, so you never publish text you have not seen.
- **What a mention can say.** A source page's title, author name and date are its own claims. open.blog
  checks only the page's address and that it links your post, and the list says so. No avatar, photo or
  excerpt is copied, and every link is marked `nofollow ugc`, so mentions give a spammer nothing.
- **When a page takes its link back.** If a later pull finds the page gone (404 or 410) or no longer
  linking your post, its mention comes off your page and its text is deleted.
- **Limits.** The hosted function holds at most 20 waiting requests per sending site and 1000 in all,
  and answers `429` beyond that; a repeat within a minute changes nothing. Your inbox holds at most 20
  pending mentions per site. A source that does not answer is tried again on later pulls for 72 hours.
- **Retention.** Rejected, removed and blocked mentions, and pending ones you never decided, are deleted
  by `openblog mentions prune --write` after `webmention.receive.retentionDays` (default 90). Approved
  mentions stay until you remove them.

The inbox (`webmention.receive.inboxFile`, default `.openblog/webmention-inbox.json`) and your block list
stay private. `content/webmentions.json` holds only what the page shows. Feeds, exports and
cross-posting never include mentions.

### Switch it off

Set `webmention.receive.enabled` to `false` (or remove it) and rebuild: posts stop advertising the
endpoint and the list file is no longer written. Set `OPENBLOG_WEBMENTION_ENABLED` to anything but
`true` and redeploy, and the endpoint answers 404. Mentions you approved stay listed until you remove
them. To remove the hosted table, pull once more and then run
[`supabase/webmention-rollback.sql`](../supabase/webmention-rollback.sql); it loses only requests no
pull has taken.

### Receiving: what was checked

Checked on 2026-10-29 against the [W3C Webmention Recommendation](https://www.w3.org/TR/webmention/)
(12 January 2017):

- Request verification (3.2.1): `source` and `target` must be valid `http(s)` URLs, must differ, and
  the target should be a resource that accepts Webmentions; open.blog answers `400` otherwise.
- Asynchronous processing (3.2, 4.1): open.blog answers `202 Accepted` and verifies later, so the
  endpoint cannot be used to make your site fetch pages on demand.
- Webmention verification (3.2.2): the source is fetched with a bounded number of redirects, and must
  contain an exact link to the target; a `410 Gone` or a page without the link deletes an existing
  mention; a repeat updates it.
- Limits and display (4.1, 4.2): redirects, size (1 MiB) and time (15 seconds) are limited for every
  source, and everything shown is HTML-escaped plain text.

The design is in ADRs
[0364](adr/0364-received-webmentions-are-stored-by-a-hosted-receiver-that-never-fetches-and-verified-by-the-command-line-pull.md),
[0365](adr/0365-received-mentions-wait-in-a-private-inbox-for-a-moderator-who-approves-a-revision-and-a-source-proves-only-its-host.md),
[0366](adr/0366-approved-mentions-are-published-in-a-content-file-and-listed-as-plain-links-on-the-canonical-page-only.md)
and
[0367](adr/0367-received-mentions-are-pruned-by-a-confirmed-retention-run-and-receiving-is-pinned-by-fakes-only.md).
