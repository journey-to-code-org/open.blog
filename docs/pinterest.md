# Pinterest Pins

`openblog pinterest` sends one of your published posts to a Pinterest board as a Pin: the post's
[visual card](visual-cards.md) (one of your own images, its title and description, the image's alternative text and
a link back to the post on your site). You see exactly what will be sent, and nothing is sent until you confirm
it. It is off until you turn it on, and your Markdown and your site stay the original: a Pin only links to them.

Nothing here changes a build, a feed, an export or cross-posting. open.blog never generates an image or words for a
Pin, never asks Pinterest to fetch anything, and never asks for your Pinterest password.

## Before you start: a Pinterest app and a token

Pinterest only lets apps it has approved create Pins (checked on 2026-10-29; see
[ADR 0783](adr/0783-pinterest-pins-are-a-social-destination-sent-from-the-cli-under-the-authors-own-oauth-token-sandbox-first.md)).

1. Create an app at [developers.pinterest.com](https://developers.pinterest.com/) with your Pinterest business
   account. An approved app starts with **Trial access**: every Pin and board it creates is a *sandbox* entity that
   only you can see.
2. Get an access token with the scopes `boards:read`, `boards:write`, `pins:read` and `pins:write`. For the
   sandbox, open your app's **Configure** tab, choose **Sandbox** under *Generate access token*, and generate one;
   it lasts 30 days. A sandbox token does not work in production, and a production token does not work in the
   sandbox.
3. Put the token in the environment where you run open.blog, never in `openblog.json` or a file you commit:

   ```sh
   export PINTEREST_ACCESS_TOKEN=pina_...
   ```

4. To publish Pins other people can see, ask Pinterest to upgrade the app to **Standard access** (Pinterest reviews
   a video of the app), get a production token through Pinterest's OAuth for your app, and set `environment` to
   `production` below.

## Turn it on

In `openblog.json`:

```json
{
  "syndication": {
    "pinterest": {
      "enabled": true,
      "environment": "sandbox",
      "board": "549755885175"
    }
  }
}
```

| Key | Meaning |
| --- | --- |
| `enabled` | Must be `true`. Without it every `openblog pinterest` command stops before reading the token. |
| `environment` | `sandbox` (default: Pins only you see) or `production`. |
| `board` | The board a Pin goes to unless you pass `--board`. |
| `boardSection` | Optional: a section of that board (`--section` overrides it). |
| `stateFile` | Where open.blog records the Pins it sent (default `.openblog/pinterest.json`, private). |

List the boards your token can pin to, and copy an id:

```sh
openblog pinterest boards
```

Secret boards are not listed: open.blog does not ask for the secret-board scopes.

## Preview, confirm, send

```sh
openblog pinterest pin lemon-tart                 # what would be sent, and its Pin digest
openblog pinterest pin lemon-tart --json          # the same as JSON (without the image bytes)
openblog pinterest pin lemon-tart --write --confirm 3f2a...   # send exactly that Pin
```

The preview shows the board, the title, the description, the alternative text, the link and the image file, and
ends with the Pin digest and the exact command to send it. `--write` sends only when `--confirm` repeats the
digest the Pin has now: if you change the post, the image file, the board or the words after previewing, the run
stops and asks you to preview again. Before sending, open.blog checks that the board is one your token can pin to.

What a Pin carries:

- **Title and description**: `cardTitle` and `cardDescription`, else the post's own (see
  [Visual cards](visual-cards.md)). If you recorded an image credit (`coverCredit`,
  `cardImageCredit`), it is added at the end of the description as "Image: …".
- **Alternative text**: the image's own, exactly as you wrote it. A Pin is never sent without it.
- **Link**: your post's canonical address, unchanged.
- **Image**: the card's image file, sent as its bytes (JPEG or PNG). An image on another site cannot be sent.

A Pin is refused, with "No request was sent to Pinterest.", when the card is not ready (run
`openblog card <slug> --format pinterest-pin` to see why), when the image is not a file your site serves, when a
photograph still records where it was taken, when the description with its credit is longer than 800 characters,
when your site's `url` is not a public address, or when no board is chosen.

Each post is pinned to a board once: open.blog records the Pin and refuses to send the same post to the same board
again.
