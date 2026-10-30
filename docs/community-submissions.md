# Community submissions: Hacker News and Reddit

open.blog can prepare a post for you to share on Hacker News or in a Reddit community. It never submits for you.
It gathers the title, the exact link to your post, the community's rules as a checklist, and a link to the
community's own submit form. You read the rules, decide, and submit there yourself, or you don't submit at all.
Your Markdown and your own site stay the original.

This is off until you turn it on, and nothing in your build, feeds or cross-posting changes because of it
(ADRs [0800](adr/0800-hacker-news-and-reddit-are-community-destinations-whose-manifests-say-the-author-submits-by-hand.md)
to [0803](adr/0803-a-community-submission-is-recorded-only-as-the-authors-word-and-keeps-a-repeat-from-being-prepared.md)).

## Turn it on

In `openblog.json`:

```json
{
  "community": {
    "hackerNews": { "enabled": true },
    "reddit": {
      "enabled": true,
      "communities": {
        "rust": {
          "rules": [
            "Posts must be about the Rust programming language",
            "Self-promotion: at most one post a week, and take part in the discussion"
          ],
          "reviewed": "2026-10-29",
          "flair": "blog post"
        }
      }
    }
  }
}
```

- `hackerNews.enabled` and `reddit.enabled` are off by default. While a destination is off, `openblog submit` says how
  to turn it on and does nothing else.
- For Reddit, write down each community you take part in under `communities`, by its name without `r/`. `rules` is 1 to
  30 one-line rules you copy from the community's sidebar or rules page. open.blog never reads them from Reddit, so
  the rules in your kit are the rules you read. `reviewed` is the day you last read them; the kit reminds you to read
  them again after 180 days, or when there is no date. `flair` is an optional reminder of the flair the community
  expects.
- `stateFile` (default `.openblog/community-submissions.json`) is where your confirmed submissions are kept. Like the
  cross-posting state, keep it out of version control.

No account, token or password is needed or accepted. There is nothing to sign in to.

## Prepare a submission

```sh
openblog submit <slug> --to hacker-news,reddit:rust
openblog submit <slug> --to hacker-news --kit share-kit
```

The post must be published and your site must have its real `https` address set, as for
[cross-posting](cross-posting.md). Without `--kit` the kit is printed. With `--kit <new folder>` open.blog writes
`index.html` and `kit.json` there. The folder must not exist yet. The page has no script and needs no server: open it
from disk in any browser.

For each destination the kit shows:

- **Status**: ready for you to submit by hand, or blocked, with the reasons.
- **Title and link**: the post's own title (use `--title "…"` to use another for this run) and exactly your canonical
  address, never shortened or tagged.
- **Before you submit**: a checklist of the provider's rules, each linked to where it comes from, followed by the
  community rules you wrote down. The boxes are for you. They are not saved or sent.
- **The submit form link**, only when nothing blocks. It opens Hacker News's or Reddit's own form with the link and
  title filled in. You may need to sign in there, and only your own click submits. If a form ignores the filled-in
  values, copy them from the page.
- **After you submit**: the command that records it (see below).

### What blocks, and what is only advice

| Destination | Blocks (no submit link) | Advice (you decide) |
| --- | --- | --- |
| Hacker News | empty title; title over 80 characters; invisible characters; already submitted (see below) | a title other than the post's; capitals or `!` for emphasis; a leading count such as "10 ways"; the site's name in the title |
| Reddit | empty title; title over 300 characters; invisible characters; the community's rules not written down; already submitted there | rules read more than 180 days ago or undated; several communities in one kit |

## Record what you submitted

open.blog cannot see whether you submitted. If you did, tell it, with the address of your submission if you have it:

```sh
openblog submit <slug> --confirm hacker-news --permalink https://news.ycombinator.com/item?id=12345
openblog submit <slug> --confirm reddit:rust --permalink https://www.reddit.com/r/rust/comments/abc123/
openblog submit <slug> --list
```

A confirmation is recorded as **author-confirmed**: your word, never checked with the provider. The address is only
checked to be the right kind of address for that destination, and is never opened. A confirmation keeps a repeat
from being prepared:

- **Reddit**: a community you confirmed is blocked for that post from then on.
- **Hacker News**: blocked for a year. The HN FAQ allows "a small number of reposts" only of a story that "has not had
  significant attention in the last year or so". After a year, the kit stays blocked until you add `--again`, and then it
  says it is a repost.

Recording the same destination twice needs `--again` too. The record is a small JSON file you can edit if you made a
mistake.

## What open.blog will never do here

- Submit, vote, comment or sign in for you, or read anything from Hacker News or Reddit.
- Ask anyone to upvote or share. Both communities penalise that.
- Post the same link to many communities for you. The kit warns when you prepare more than one.

## What was checked, and where (2026-10-29)

- Hacker News: [guidelines](https://news.ycombinator.com/newsguidelines.html) (original title, no editorialising,
  no capitals or exclamation points for emphasis, no gratuitous numbers or site name, no soliciting of votes,
  comments or submissions, no delete and repost, your own work only part of the time);
  [FAQ](https://news.ycombinator.com/newsfaq.html) (reposts, no asking for upvotes); the official
  [API](https://github.com/HackerNews/API) only publishes data and has no way to submit; the
  [bookmarklet](https://news.ycombinator.com/bookmarklet.html) opens `submitlink?u=…&t=…`, the filled-in form.
  **Not verified from an HN document:** the 80-character title limit is enforced by HN's form and widely reported,
  but the guidelines do not state it.
- Reddit: [Reddit Rules](https://redditinc.com/policies/reddit-rules) (follow each community's rules, post
  authentically where you have a personal interest, no spam or vote manipulation),
  [spam guidance](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam) and the
  [Data API terms](https://redditinc.com/policies/data-api-terms) (API access needs Reddit's approval).
  **Not verified from a Reddit document:** these pages refused automated reading when this was written, so their
  content was confirmed through quotations of them. The community submit address
  (`/r/<community>/submit?url=…&title=…`) and the 300-character title limit are long-standing Reddit behaviour,
  not documented API. If either changes, the title and link on the page still work by copy and paste.

## For developers

- Rust: `openblog_core::community_submission` (`prepare`, `kit_page`, `kit_json`, `confirm`, `normalize_permalink`,
  `SubmissionRecords`); the CLI is `crates/openblog-cli/src/community.rs`.
- Both communities are in the [provider capability](provider-capabilities.md) contract as the `community` family, whose
  manifests must say the link is submitted by hand and nothing else is possible. A community manifest that claims any
  adapter capability is refused.
- Tests: `cargo test -p openblog-core community_submission`, `cargo test -p openblog-cli community::`, the shared
  `tests/fixtures/provider-manifests.json`, and `tests/browser/community-submission.spec.mjs`.
