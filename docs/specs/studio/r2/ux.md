# Studio UX, retirement slice R2: Accounts in Studio

By `studio-ux`, 2026-11-13. Sources: `studio-ux`, `retirement-plan.md` (§1 D `#/social`, §2 links, §4 R2), `slice-10bc/ux.md` (Your accounts, G6), `r1/ux.md`, `web/admin/social.js`, `crates/openblog-cli/src/admin/social.rs`, `netlify/functions/social.mjs`, `netlify/lib/social-{oauth,discovery,accounts}.mjs`, `supabase/social.sql` (`openblog_social_connections`), `docs/social-publishing.md`, `docs/deploy.md`, and Studio's `screens/{sharing,share-new,index}.js`, `parts/{share-words,sheet}.js`, `router.js`.

Owners: **Grammi**, who connects her Facebook Page once and reconnects it when Facebook asks, and **Mikey**, who set up the apps and wants to see the permissions, the redirect address and the record of each attempt.

The job of the whole slice, in her words: **"Make my posts go to my Facebook Page, and keep it working."** After R2, no Studio screen links to `/admin/` for sharing.

**Decided (2026-11-13):** G6(b) follows the recommendation: the `authorizeUrl` is not kept while pending; **Start again** covers a reload.

**Changed after the Grammi walkthrough (2026-11-13)** — these override the words below where they differ:
- No "(you can say no to this one)" on her layer. The permission list ends with "Leave every box ticked." Optional scopes are marked only in details.
- Badge `expiring` reads "Sign in again by Nov 27" (short `sayDay`); without a date, "Sign in again soon".
- "signing in as the same person" becomes "signing in to the Facebook account you used the first time". The Reconnect sheet says: "Facebook will ask you to sign in. Use the Facebook account you used the first time. If Facebook shows someone else's name, tell the person who set up your site." The log-out advice moves to details.
- Attempt card headings: `authorized` "Almost done: choose your Page" (LinkedIn "…choose where posts go"; Bluesky "…choose your account"); `pending` without link "You didn't finish connecting Facebook". One clock everywhere: "You have until 3:35 PM to finish." `expired` words: "That took too long, so it stopped. Try again." (no minute counts).
- **Stop** becomes **Don't connect**, a quiet link-styled button on its own line below the primary, never beside it.
- `no-posting-role`: "Facebook doesn't let your account post on this Page." `not-administrator`: "LinkedIn doesn't let your account post on this page."
- Bluesky help: "Bluesky lets you make a separate password just for your blog, so your own password stays private. In Bluesky: Settings, then Privacy and security, then App passwords. Paste that one here." The "Never type your real Bluesky password" line moves to the wrong-shape error only.
- Facebook Pages are "your Facebook Page" in prose; avoid bare "Page" next to lower-case "page" in one sentence.
- The details summary is "Details for the person who set up your site".

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| See her accounts and whether they work | **Your accounts**, a new screen under Sharing | `#/sharing/accounts` | `sharing.js:244` link; old `#/social` |
| Connect Facebook, LinkedIn or Mastodon | Connect sheet (the provider's sign-in page) | `#/sharing/accounts?connect=<provider>` | `sharing.js:104`, `share-new.js:68` |
| Connect Bluesky | Connect sheet (name and app password) | `#/sharing/accounts?connect=bluesky` | old inline form |
| Come back from the provider | Your accounts, with the sheet reopened at the step it reached | `#/sharing/accounts?connection=<id>` (G6) | old "I have finished, check now" |
| Choose where posts go | Same sheet, second step | none of its own | old "Connections in progress" |
| Reconnect | Reconnect sheet | `#/sharing/accounts?reconnect=<account id>` | `sharing.js:97,125` links |
| Disconnect | Account card More, then `modal-dialog` | none of its own | as built in Sharing; moves here |
| Stop a half-finished connection | The attempt's card | none of its own | old "Cancel this attempt" |

**`legacyRoute`:** `#/social` and `#/social/<anything>` now go to `#/sharing/accounts` (in R1 they went to `#/sharing`); set `OLD_RENAMED.social = "sharing/accounts"` and drop the trailing rest. `#/announcements` still goes to `#/sharing`.

**Changes to Sharing (`sharing.js`, `share-new.js`):** every Connect and Reconnect opens in the same tab. Nothing uses `target="_blank"` and nothing points at `/admin/`.

- The side column's "Your accounts" becomes a summary: name and badge for each account, then the link **Manage your accounts** (`#/sharing/accounts`). The old-Admin link goes.
- The reconnect banner's **Reconnect it** and a failed row's **Reconnect** go to `#/sharing/accounts?reconnect=<accountId>`.
- The "Nothing to share to yet" empty state and Share a post's link go to `#/sharing/accounts`. When only one provider is set up, the button is named for it (**Connect Facebook**) and goes to `?connect=facebook`.

**Route wiring:** `screens/index.js` sends `route.arg === "accounts"` to `createAccounts`. The screen exists whenever Sharing does; when `meta.social` is false it shows only the "not set up" state.

## Flow

```
Sharing (#/sharing)
  | "Manage your accounts" / banner "Reconnect it" / row "Reconnect" / "Connect an account"
  v
Your accounts (#/sharing/accounts)            <- "< Back to Sharing" returns
  | Connect Facebook                          | Reconnect Grammi's House
  v                                           v
Connect sheet, step 1 ----------------  Reconnect sheet
  | Continue to Facebook (same tab)           | Continue to Facebook (same tab)
  v                                           v
facebook.com: she signs in and says yes (or no)
  v
the site's sharing service: callback, then 303 (G6)
  v
#/sharing/accounts?connection=<id>   (Studio reads the id, then replaces the address with #/sharing/accounts)
  | yes, new account                | yes, reconnect             | no / ran out / failed
  v                                 v                            v
Choose step: "Where should       "Reconnected." and, if any,   sheet step 1 with the reason
Facebook posts go?"              "Try them again"              and "Try again"
  | Connect Grammi's House
  v
card appears, focused; toast "Connected." with "Share a post" -> #/sharing/new
```

**Getting back:** every sheet closes with Escape or the ×, and focus returns to what opened it. The back link is "< Back to Sharing". Browser Back from Facebook's sign-in page lands on Your accounts and shows the attempt is not finished. After a return, the `connection` id is removed with `replaceState`, so Back never reruns the return.

## Your accounts (`#/sharing/accounts`)

- **Job:** "Where can Studio post for me, and is it working?"
- **Primary,** by the first that holds:
  1. A connection waits for her choice: **Choose where posts go**.
  2. An account needs reconnecting: **Reconnect <name>**.
  3. No accounts yet: **Connect <first provider>** (Facebook first when offered; then Bluesky, LinkedIn, Mastodon).
  4. Otherwise: **Share a post** (`#/sharing/new`).
- **Loads:** `GET social/status`; when enabled also `social/accounts`, `social/connections` and `social/announcements` (counts only; if it fails, counts are left out).
- **Accounts listed:** those whose `status` is not `disconnected`. Disconnected accounts appear only in details.

```
400 px                                   Desktop: two columns, 1fr + 22rem
+--------------------------------------+
| < Back to Sharing                    |  link
| Your accounts                        |  h2 (tabindex -1, focused on open)
| Where Studio can post for you. It    |  p lede
| posts only when you share a post.    |
| [attempt card, live only]            |  content-card
|   Facebook: not finished             |
|   Facebook said yes. Choose where    |
|   your posts go. This waits for you  |
|   until 3:35 PM.                     |
|   [ Choose where posts go ] [Stop]   |
| [account card]                       |
|   Grammi's House [Needs reconnecting]|  status-badge warning
|   Facebook Page                      |
|   Facebook stopped taking posts from |
|   Studio. Reconnect it, signing in   |
|   as the same person.                |
|   2 posts are waiting for it.        |  only when > 0
|   [ Reconnect ]           [More v]   |
|   > Details                          |  details (Mikey)
| [account card] @grammi.bsky.social   |  Connected, success
| Add an account                       |  h3
| [provider card per offered provider] |  secondary buttons
| > For the person who set up the site |  details
+--------------------------------------+
```

Below about 48rem, the side column (Add an account, details) moves under the main one.

### Account cards

Heading `displayName`; line under it: provider and kind ("Facebook Page", "LinkedIn profile", "LinkedIn company page", "Bluesky", "Mastodon").

| `health` | Badge (word, variant) | Words | Buttons |
| --- | --- | --- | --- |
| `ok` | Connected, success | none | More only |
| `expiring` | Reconnect soon, warning | "Facebook stops taking posts from Studio on Friday, November 27. Reconnect it before then, signing in as the same person." Without a date: "…soon." | **Reconnect** |
| `needs-reauth` | Needs reconnecting, warning | "Facebook stopped taking posts from Studio. Reconnect it, signing in as the same person." | **Reconnect** |
| reconnect started, not finished | Needs reconnecting, warning | "Reconnecting isn't finished." | **Continue to Facebook** or **Start again**, plus **Stop** |

- **Date:** the later of `credential.refreshExpiresAt` and `accessExpiresAt`, via `sayDay`.
- **"2 posts are waiting for it."** counts this account's shares (`accountId`) that are `pending`, `retrying` or `processing`; shown only when > 0.
- **Card More:** **Disconnect…**. Palette also has "Reconnect <name>".
- **Card details** (Mikey): provider id (`externalId`), kind, "Connected by mikey on November 2", access good until, can renew until, permissions granted as words with codes.

### Provider cards (Add an account)

| Provider | Line | Button |
| --- | --- | --- |
| Facebook | "Post to a Facebook Page you run." (after one is connected: "Add another Page you run.") | **Connect Facebook** |
| Bluesky | "Post as your Bluesky account." | **Connect Bluesky** |
| LinkedIn | "Post as yourself on LinkedIn." With `organizations`: "Post as yourself, or as a company page you run." | **Connect LinkedIn** |
| Mastodon | "Post as your account on mastodon.social." (the instance host) | **Connect Mastodon** |

### Attempt cards

Only live attempts: `pending`, `exchanging` or `authorized`, `expiresAt` in the future, newest per provider. A reconnect attempt sits on its account card. Ended attempts are said once, as the status after a return; never cards.

| State | Heading / words | Buttons |
| --- | --- | --- |
| `pending`, link held in this page | "Waiting for Facebook" / "Finish on Facebook: sign in and say yes." | **Continue to Facebook**, **Stop** |
| `pending`, no link (reload, Back, another device) | "Facebook: not finished" / "You started connecting at 3:05 PM and didn't finish." | **Start again**, **Stop** |
| `exchanging` | "Facebook said yes" / "Studio is finishing up. This takes a few seconds." | none. Reload every 3 s for up to 2 minutes, then: "Facebook is taking a long time. Wait a minute, then reload this page." |
| `authorized` | "Facebook: not finished" / "Facebook said yes. Choose where your posts go. This waits for you until 3:35 PM." | **Choose where posts go** (primary), **Stop** |

- **Stop:** `POST social/connections/<id>/cancel`, no confirm. Status: "Stopped. Nothing was connected." Focus to "Add an account".
- **Start again:** one press: cancel (ignoring "already ended"), start again, then continue as **Continue to Facebook**.

## Connect sheet: Facebook, LinkedIn, Mastodon (`side-sheet`, label "Connect Facebook")

- **Job:** "Let Studio post to my Facebook." **Primary:** **Continue to Facebook**.
- **Opens from:** a provider card, Sharing's empty state (`?connect=`), palette "Connect Facebook", or a failed return.

```
Step 1                                   Step 2 (after she comes back)
+--------------------------------------+ +--------------------------------------+
| Connect Facebook                [x]  | | Where should Facebook posts go? [x]  |
| Studio sends you to Facebook. Sign   | | Facebook said yes. Pick the Page     |
| in there and say yes; Facebook sends | | your posts go to.                    |
| you back here to pick your Page.     | | (o) Grammi's House          Page     |  fieldset + radios
| Facebook will ask to let your site:  | | ( ) Rick's Bait Shop        Page     |
|  - See the Pages you run             | |     Your role on this Page doesn't   |  disabled; reason via aria-describedby
|  - Make posts on your Pages          | |     let you make posts.              |
|  - See basic details of your Pages   | | [ Connect Grammi's House ]           |  primary; label follows choice
|    (you can say no to this one)      | | [ Stop ]                             |
| Nothing is posted until you share a  | | This waits for you until 3:35 PM.    |
| post yourself.                       | | > For the person who set up the site |
| [ Continue to Facebook ]             | +--------------------------------------+
| > For the person who set up the site |
+--------------------------------------+
Desktop: the same sheet, 32rem on the right.
```

**Step 1 words by provider:**

- **LinkedIn:** "…sends you back here to pick where posts go: your profile, or a company page you run." (company part only with `organizations`).
- **Mastodon:** "Studio sends you to mastodon.social. Sign in there and say yes; you come back here to finish." Plus visibility: `public` "Anyone can see your posts there."; `unlisted` "Anyone with the link can see them, but they stay out of public timelines."; `private` "Only your followers see them."; with `media: cover` "Your post's photo goes with it."

**Permissions in her words** (`SCOPE_WORDS`; requested scopes not in `requiredScopes` get "(you can say no to this one)"):

| Scope | Her words |
| --- | --- |
| `openid` | Know it's you |
| `profile` | See your name |
| `w_member_social` | Post as you |
| `r_organization_admin` | See the company pages you run |
| `w_organization_social` | Post as your company pages |
| `pages_show_list` | See the Pages you run |
| `pages_manage_posts` | Make posts on your Pages |
| `pages_read_engagement` | See basic details of your Pages |
| `read:accounts` | See your account's name |
| `write:statuses` | Post as you |
| `read:statuses` | Read your posts, to check whether one went out |
| `write:media` | Add your post's photo |
| unknown | One more permission (its code in details) |

**Continue to Facebook** (button shows loading):

1. `POST social/connections {provider}`.
2. Pass `authorizeUrl` through `safeAuthorizeUrl(url, instance)`.
3. If it passes and `status.returns` is true (G6): `location.assign(url)` in the same tab.
4. If null: cancel the attempt; sheet says "Studio couldn't open Facebook. Tell the person who set up your site." Details: "authorizeUrl refused" (address not shown).

**Without return (fallback):** a new tab can't open after an `await`, so step 1 becomes two presses. **Continue to Facebook** makes the attempt; the sheet then says "Facebook opens in a new tab. Sign in there and say yes, then come back to this tab." and offers **Open Facebook** (link, `target=_blank rel="noopener noreferrer"`, named "Open Facebook, in a new tab"), **I've said yes** (secondary, reloads) and **Stop**. When the window regains focus with an attempt `pending`/`exchanging`, Studio reloads it; once `authorized`, the sheet moves to step 2.

**Step 2, Choose:**

- Labels: `page` "<name>, Page"; `member` "Your profile, <name>"; `organization` "<name>, company page"; `account` "<name>".
- Exactly one eligible: preselected. Several: none picked, button **Connect this one**; pressing with none picked says on the group "Pick where your posts go." Once picked, label "Connect <name>".
- **Connect:** `POST social/connections/<id>/select {destination}`. Sheet closes, new card takes focus, status "Connected. Studio can post to Grammi's House on Facebook now.", toast "Connected." with action **Share a post**. Facebook adds: "To add another Page, connect Facebook again."
- **Stop** as on the attempt card.

**Why an option can't be picked** (`reasonWords`):

| Reason | Words |
| --- | --- |
| `missing-scope` | "Facebook didn't allow posting here. Connect again and leave every box ticked." |
| `not-administrator` | "LinkedIn doesn't list you as an admin of this page." |
| `no-posting-role` | "Your role on this Page doesn't let you make posts." |
| `role-unverified` | "Facebook didn't say what you can do on this Page, so Studio can't use it." |
| `no-page-token` | "Facebook didn't give access to this Page. Connect again and choose it on Facebook." |
| `account-inactive` | "Bluesky says this account isn't active." |
| `account-suspended` | "Mastodon says this account is suspended." |
| other | "Studio can't post here." |

**Notes** (`noteWords`; server `text` only in details):

- First layer: `pages-truncated`, `organizations-truncated` "Facebook sent only some of your Pages. If yours isn't here, tell the person who set up your site."; `media-not-granted` "Your post's photo won't be added on Mastodon; it shows its own preview."; `instance-limit-low` "This Mastodon server takes short posts only, so keep what you say short."
- Details only: `organizations-*`, `no-organizations`, `instance-unavailable`, `statuses-not-readable`, `app-review-unverified`.

**Step 2 errors:**

- 409 `already-connected`: "Grammi's House is already connected. Use Reconnect on it if it stopped working." Sheet closes, that card takes focus.
- 409 `expired`: "That took longer than 30 minutes, so Facebook's yes ran out. Start again." with **Start again**.
- 409 `not-authorized` / `conflict`: reload; "This changed in another tab. Here it is now."
- 409 `destination-not-eligible`: the reason, on that option.
- 500/502 `storage-failed`: "Your site couldn't save it. Press Connect again." (attempt stays `authorized`).

**Sheet details** (Mikey): scopes with codes (optional marked), redirect address (`redirectUri`, **Copy**), API version, PKCE, Mastodon instance/visibility/media, organizations, Facebook App Review note. After a return: connection id, status, `errorCode`, granted scopes, every note's text.

## Connect sheet: Bluesky (`side-sheet`, label "Connect Bluesky")

- **Job:** "Let Studio post to my Bluesky." **Primary:** **Connect Bluesky**.

```
+--------------------------------------+
| Connect Bluesky                 [x]  |
| Your Bluesky name                    |  text-field, autocomplete=username,
| [ grammi.bsky.social             ]   |  autocapitalize=none, spellcheck=false
| App password                         |  text-field type=password, autocomplete=off
| [ ••••-••••-••••-••••            ]   |
| An app password is a separate        |  help, aria-describedby
| password just for Studio. Make one   |
| in Bluesky: Settings, then Privacy   |
| and security, then App passwords.    |
| Never type your real Bluesky         |
| password here.                       |
| [ Connect Bluesky ]                  |
| > For the person who set up the site |
+--------------------------------------+
```

**Press Connect Bluesky:**

1. Check on the device: name not empty, password shaped like an app password (`isAppPassword`).
2. **Empty the password field before anything is sent, every time,** including when the check fails.
3. `POST social/connections {provider: "bluesky", identifier, appPassword}`.
4. Reply is `authorized`: step 2, one account preselected, button **Connect @grammi.bsky.social**. The password never appears in status, details, leave question or logs.

**Field errors** (focus first; password always empty afterwards):

| When | Field | Words |
| --- | --- | --- |
| Name empty, or `invalid-identifier` | Name | "Type your Bluesky name, like grammi.bsky.social." |
| Password empty | App password | "Paste the app password you made in Bluesky." |
| Wrong shape, or `invalid-app-password` | App password | "That isn't an app password. One looks like abcd-efgh-ijkl-mnop. Never use your real password. Paste an app password." |
| `credentials-rejected` | App password | "Bluesky didn't accept that name and app password. Check the name, then paste the app password again, or make a new one." |
| `provider-rate-limited` (429) | sheet | "Bluesky asked Studio to slow down. Wait a few minutes, then try again." |
| `no-destination` | sheet | "Bluesky says this account can't post. Check it in Bluesky." |
| `provider-unavailable` | sheet | "Bluesky couldn't be reached. Try again in a few minutes." |

**Leaving with a typed name** asks "Connect Bluesky?" / "You typed your Bluesky name and didn't connect." with **Connect Bluesky** and **Leave without connecting**.

## Reconnect sheet (`side-sheet`, label "Reconnect <name>")

- **Job:** "Make Grammi's House work again." **Primary:** **Continue to Facebook** (or **Reconnect** for Bluesky).
- **Opens from:** card **Reconnect**, `?reconnect=<id>`, or the palette.
- **Words:** "Facebook will ask you to sign in again. Use the same Facebook account as before; a different one won't work. If Facebook signs you in by itself as someone else, log out of Facebook first."
- **OAuth:** `POST social/accounts/<id>/reconnect {}`, same `safeAuthorizeUrl` check and same-tab handling. On return the attempt is `completed`. Status "Reconnected. Grammi's House works again."; focus to its card.
- **Then, if any:** this account's shares that `failed` with `needsReconnect` codes show as `alert-banner info` on the card: "2 posts didn't go out while it wasn't working." with **Try them again** (one `retry {version}` per share) → "2 posts will be tried again within a minute." Partial: "1 post will be tried again. 1 couldn't be, because it changed. Look at it in Sharing." linking `#/sharing`.
- **Bluesky:** Connect Bluesky's fields; name prefilled from `displayName` without "@"; button **Reconnect @grammi.bsky.social**; `POST social/accounts/<id>/reconnect {identifier, appPassword}` with password emptied first; "Reconnected. @grammi.bsky.social works again."
- **`identity-mismatch`:** "That was a different Facebook account, so nothing changed. Sign in as the person who runs Grammi's House, then try again." Bluesky: "That's a different Bluesky account. Use an app password from @grammi.bsky.social."
- **Account gone** (404 / `disconnected`): "Grammi's House isn't connected any more. Connect it again." Sheet closes; focus to "Add an account".

## Disconnect (card More, then `modal-dialog`)

- **Heading:** "Disconnect Grammi's House?"
- **Text:** n > 0: "2 posts waiting to go there won't be shared. Studio forgets how to post to it; you can connect it again later." n = 0: "Studio forgets how to post to it. You can connect it again later."
- **Buttons:** **Keep it connected** (focused), **Disconnect** (destructive).
- **Then:** `POST social/accounts/<id>/disconnect`. Status "Disconnected Grammi's House." plus " 2 waiting posts won't be shared." when `canceledAnnouncements` > 0. Focus to next card's heading, or "Your accounts".
- **No Undo** (the stored sign-in is erased); it asks once.
- **Details** (Mikey): Facebook: "Facebook isn't asked to withdraw the app, which would cut off your other Pages. Remove it in Facebook under Settings, Business integrations if you want it gone." LinkedIn: "LinkedIn is asked to withdraw the grant when no other LinkedIn account shares it."

## Coming back (`#/sharing/accounts?connection=<id>`, G6)

Studio reads only `id`, checks it is a UUID, finds it in `GET social/connections`, then `history.replaceState` to `#/sharing/accounts`.

| Found as | What she sees |
| --- | --- |
| `authorized`, new account | Connect sheet at step 2; focus on its heading |
| `exchanging` | Sheet with "Facebook said yes. Studio is finishing up…" (reloads as on the attempt card) |
| `completed`, reconnect | "Reconnected. Grammi's House works again." plus Try them again |
| `completed`, new (chosen in another tab) | "Connected. Studio can post to Grammi's House on Facebook now." |
| `canceled` | the plain screen |
| `failed` / `expired` | Sheet at step 1 with `alert-banner warning` (words below) and **Try again** as primary |
| not found | Plain screen. Status: "Studio couldn't find that connection. If your account isn't listed, connect it again." |

**Outcome words** (`outcomeWords(code, provider, {reconnecting, name})`; server `message` only in details):

| Code | Words |
| --- | --- |
| `denied` | "You said no on Facebook, so nothing was connected." |
| `scopes-missing` | "Facebook didn't allow everything Studio needs to post. Try again and leave every box ticked." |
| `no-destination` | "Facebook didn't show any Page you can post to. You need to run the Page. If you do, ask the person who set up your site to add you to its Facebook app." (Others: "LinkedIn didn't show anywhere you can post.", "Mastodon says this account can't post.") |
| `expired` | "That took longer than 10 minutes, so it stopped. Try again." |
| `invalid-state` | "That sign-in link was already used. Try again." |
| `code-rejected`, `provider-error`, `invalid-request` | "Facebook didn't finish connecting. Try again." |
| `provider-unavailable` | "Facebook couldn't be reached. Try again in a few minutes." |
| `provider-rate-limited` | "Facebook asked Studio to slow down. Wait a few minutes, then try again." |
| `identity-mismatch` | as in Reconnect |
| `storage-failed` | "Your site couldn't save the connection. Try again." |
| other | "That didn't connect. Try again." |

## Not set up, and errors

| State (`social/status`) | First layer | Details (Mikey) |
| --- | --- | --- |
| `off` (`meta.social` false) | `empty-state` "Sharing to Facebook isn't set up" / "The person who set up your site can turn it on. Your site works the same without it." | "Set OPENBLOG_SOCIAL_ENDPOINT and OPENBLOG_SOCIAL_ADMIN_KEY where Studio runs (docs/social-publishing.md)." |
| `invalid` | `alert-banner warning` "Sharing isn't set up right" / "Tell the person who set up your site." | names of the settings at fault (`problems`), never values |
| `unavailable` | same banner | server message (OPENBLOG_SOCIAL_ENABLED) |
| on, no providers | `empty-state` "No accounts can be connected yet" / "The person who set up your site needs to add Facebook or another place first." | the client id, secret and CALLBACK_BASE settings needed |
| on, `problems` non-empty | nothing extra | "These provider settings aren't valid and were skipped:" with names |
| status call fails | `alert-banner danger` "Your accounts didn't load" with `shareTrouble` words and **Try again** | status, code, message |

**Errors on any action** map by `code` (G18), never server text:

| Code | Words |
| --- | --- |
| `too-many-attempts` (429) | "Too many connections are unfinished. Stop one above, or wait 10 minutes." |
| `provider-not-configured` (409) | "Facebook isn't set up on your site any more. Tell the person who set up your site." |
| `hosted-key-rejected`, `hosted-unavailable`, 404 `not-set-up` | "Sharing isn't working right now. Tell the person who set up your site." |
| 502 `bad-reply`, 504 `hosted-timeout`, no answer | "Studio couldn't reach your sharing service. Try again in a minute." |
| 401 | Shell's "Sign in again". Typed Bluesky name kept; password emptied. |

## Hosted and self-hosted

The provider always returns the browser to the **sharing service** (`OPENBLOG_SOCIAL_CALLBACK_BASE`, a public `https://` address). G6 makes the service send her on to the Studio she started from.

| Where Studio runs | Return | What Grammi sees |
| --- | --- | --- |
| Public `https` address | same tab, to `<origin>/admin/studio/#/sharing/accounts?connection=` | Facebook, then straight back to "Where should Facebook posts go?". Works on her phone. |
| Her own computer (`localhost`, `127.0.0.1`, `[::1]` over http) | same tab, to the loopback address | The same, on that computer |
| Plain `http` elsewhere, or a service from before G6 (`status.returns` not true) | none (Admin sends no `returnTo`) | The new-tab fallback. The service's own page says to go back to Studio (G19). |
| Bluesky, anywhere | no redirect | name and app password sheet |

Facebook, for Mikey only: until Meta grants **Advanced access**, Facebook offers Pages only to people with a role on the app; otherwise she gets `no-destination` worded as above. Sheet details always show the `app-review-unverified` note.

## What Grammi sees and what Mikey sees

| | Grammi (first layer) | Mikey (one step deeper) |
| --- | --- | --- |
| Accounts | name, "Facebook Page", badge in words, one health line with date, waiting count | provider id, kind, connected by/when, access and renew dates, scopes with codes, disconnected accounts |
| Connect | what Facebook will ask, in her words; one button | scope codes, redirect address with **Copy**, API version, PKCE, Mastodon instance/visibility/media, organizations, App Review |
| After a return | one sentence and the next button | connection id, status, `errorCode`, server `message`, granted scopes, notes' text |
| Not set up | "The person who set up your site can turn it on." | setting names and the doc |
| Errors | what happened and what to do | HTTP status, `code`, server message |
| Palette | none needed | "Go to Your accounts", "Connect Facebook" (each offered provider), "Reconnect <name>" |

## Rules each part uses (static imports, DOM-free, tested)

| Part | From | Functions |
| --- | --- | --- |
| Safety | new `parts/social-rules.js` (pure half of `admin/social.js`) | `AUTHORIZE_HOSTS`, `safeAuthorizeUrl(value, instance)`; new `isAppPassword(value)`, `returnConnectionId(query)` (UUID or null) |
| Words | `parts/social-rules.js` | `SCOPE_WORDS`, `VISIBILITY_WORDS` rewritten; `appPasswordHelp`; new `providerLine`, `destinationLabel`, `reasonWords`, `noteWords` → `{text, first}`, `outcomeWords(code, provider, opts)`, `actionTrouble(error)` |
| Screen state | `parts/social-rules.js` | new `liveAttempts(connections, now)`, `attemptCard(connection, {hasLink, now})`, `primaryAction({connections, accounts, providers})`, `providerOrder(providers)`, `waitingFor(items, accountId)`, `toRetry(items, accountId)` |
| Health | `parts/share-words.js` | `HEALTH_BADGES.expiring` → "Reconnect soon"; `healthWords(account, {now, timeZone})` gains the date and "the same person" |

- **Tests to port:** `tests/web/admin-social.test.mjs` → `studio-social-rules.test.mjs`, keeping every `safeAuthorizeUrl` case.
- **Browser spec to port:** `tests/browser/social-accounts.spec.mjs` opens `/admin/studio/#/sharing/accounts`; the fake function gains `returns` and the 303.
- **New spec cases:** app password empty after a refused shape; Back from the provider shows "not finished"; `?connection=` id gone after load; a foreign `?connection=` value is ignored.

## Safety

- Only `safeAuthorizeUrl` addresses are followed, in Studio and again in Admin (`authorize_url`). Studio never builds a provider address.
- No open redirect: `returnTo` is built by Admin from the request's `Origin` (already matched to `Host` by `check_origin`) plus the fixed path `/admin/studio/`. The service accepts only that shape and redirects only to the value stored on the row its single-use `state` found.
- The return carries only the connection id, in the fragment.
- The app password is emptied before any request and never echoed.
- Nothing is connected until **Connect <name>** is pressed. A reconnect changes only the same account.
- Account names go in as `textContent`, wrap with `overflow-wrap: anywhere`.

## Accessibility

- Keyboard order: back link, heading, attempt cards, account cards (heading, Reconnect, More, details), Add an account cards, details. Sheets focus their heading; Escape closes. Closing a sheet never cancels an attempt.
- Step 2 is a `fieldset` with legend "Where should Facebook posts go?"; arrow keys skip disabled options; each disabled option's reason is its `aria-describedby`; the group's error is linked the same way and takes focus.
- Fallback link named "Open Facebook, in a new tab". On return, focus to the sheet heading, or the card for reconnects and the "not found" status.
- Statuses go in the live region; the "finishing up" reload announces only when it ends.
- Badges carry words. Repeated buttons get full names: "Reconnect Grammi's House", "More for Grammi's House", "Connect Facebook".
- 320 px: one column, buttons stack full width, long names and the redirect address wrap, no sideways scroll; controls ≥ 44 px. No motion.
- Zubra: `radio-group` isn't vendored; use a native `fieldset` with radios styled by Studio tokens (not a fork), as R1 did for `date-range`.

## Gaps

- **G6.** Return to Studio.
  - **(a)** Admin adds `returnTo: "<checked Origin>/admin/studio/"` to `POST social/connections` and `accounts/<id>/reconnect`, only when the function's `GET status` says `returns: true` and the origin is `https` or loopback `http`. The function validates `returnTo` (`https` or loopback `http`, path exactly `/admin/studio/`, no credentials/query/fragment, ≤ 300 chars), stores it in a new nullable `return_to` column (`supabase/social-return.sql` with rollback and a matching `check`). `callback` answers `303 Location: <return_to>#/sharing/accounts?connection=<id>` for every outcome where a row was found; otherwise the fixed page as now. `referrer-policy: no-referrer` stays.
  - **(b)** Decided: don't keep `authorizeUrl` while pending; **Start again** covers it.
  - **(c)** `status` reports `returns`.
- **G18.** Admin's social errors gain `code`s like `announcements.rs`: 400 `invalid-identifier`, `invalid-app-password`, `missing-provider`, `app-password-required`, `oauth-required`, `invalid-request`; 404 `not-set-up`; 502 `hosted-key-rejected`, `hosted-unavailable`, `bad-reply`; 504 `hosted-timeout`. Forward the function's `code` for 429 and 503 (not a bare 502).
- **G19.** The callback page and `OUTCOMES` stop speaking of Admin: heading "Facebook said yes" or "Not connected", the outcome in Studio's words ("…Start again in Studio."), then "You can close this tab and go back to Studio."
- **Not gaps:** retrying several shares is N `retry` calls; the waiting count uses `accountId` already passed; App Review can't be read, so it stays a note.
