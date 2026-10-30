# Webmention

When one of your posts links someone else's page, you can tell that site so with a
[Webmention](https://www.w3.org/TR/webmention/): a small, open standard many independent sites use to
show replies, likes and mentions from elsewhere on the web. open.blog can send them for you. It is off
until you switch it on, it sends nothing without `--write`, and your site, feeds and cross-posting are
the same whether or not you use it.

Receiving Webmentions on your own site is not part of this yet.

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
[0860](adr/0860-outbound-webmention-is-an-opt-in-command-line-send-that-discovers-each-endpoint-through-the-public-only-fetcher.md),
[0861](adr/0861-a-ping-is-queued-only-for-a-live-published-post-and-each-outcome-is-recorded-in-a-private-queue-that-retries-with-back-off.md),
[0862](adr/0862-webmention-safety-is-pinned-by-a-local-server-and-a-scripted-network-and-sending-off-changes-nothing.md)).

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
