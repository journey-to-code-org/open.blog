# Studio UX, retirement slice R3: Notifications and the installed app

By `studio-ux`, 2026-11-13. Sources: `studio-ux`, `retirement-plan.md` (§1 A "Installed app", §1 D `#/notifications`, §1 I, §2 notice callers, §3 Switch, §4 R3, Decided), `r1/ux.md`, `r2/ux.md`, ADR 0412, `docs/notifications.md`, `web/admin/{notifications.js,sw.js,icons/,index.html}`, `crates/openblog-cli/src/admin/push.rs`, `admin.rs:574,614–659,824,4298` (`meta.push`), `site.rs:371,1042–1063`, `admin/tests/push_routes.rs:313–340`, `netlify/functions/{push,engagement,quote}.mjs`, `netlify/lib/push-store.mjs`, and Studio's `router.js`, `shell.js`, `index.html`, `screens/{index,not-yet,comments,tools}.js`.

Owners: **Grammi**, who wants her phone to tell her when someone comments on a recipe, and to tap her blog's icon instead of typing an address. **Mikey**, who set up the push function and keys and wants to see the permission, the worker, the key match and every device.

The job of the whole slice, in her words: **"Tell my phone when someone writes to me, and put my blog on my Home Screen."** After R3, nothing about notifications or the installed app opens the old Admin. Every notification she taps opens a Studio screen.

**Decided (2026-11-13):** `start_url` moves to `/admin/studio/` in R3 (G20), with a bridge in the old Admin (G25), because an installed iPhone app never updates its manifest. The worker stays at `/admin/sw.js`, scope `/admin/`, so existing installs and sign-ups keep working; Studio never registers a second worker. Until R10, a tapped "reader note" notification opens Comments, whose details link bridges to those notes.

**Her words on this slice:** she calls it "my blog", so the first layer says "your blog" and never "Studio", "Admin", "push", "subscription", "PWA", "service worker", "permission" or "endpoint". Those words appear only under **Details for the person who set up your site**. She says "phone", "iPad" or "computer", never "device" or "browser" (except to name the app she is in: "Safari", "Chrome").

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| Turn notifications on or off on the phone in her hand; choose what it tells her about; send a test | **Notifications** | `#/notifications` | old `#/notifications`; `not-yet` |
| Find and fix "not allowed" | Notifications, "This iPhone" | same | old "blocked" sentence |
| See, test, rename, change or remove her other phones and computers | Notifications, "Other phones and computers" | same | old "Other devices" |
| Put her blog on the Home Screen or install it as an app | **Add to Home Screen** sheet | `#/notifications?sheet=home-screen`, account menu, palette | `docs/notifications.md` steps; old iPhone sentence |
| Tap a notification | the screen it is about | `/admin/studio/#/comments`, `#/quotes`, `#/notifications` (G22) | `/admin/#/moderation`, `#/feedback`, `#/quotes`, `#/notifications` |
| Open the installed app | Studio Home | manifest `start_url: /admin/studio/` (G20) | `/admin/` |

**`legacyRoute`:** drop `"notifications"` from `NOT_YET` (and from `not-yet.js` `NAMES`). `#/notifications` is Studio's own name now. `#/notifications/<anything>` → `#/notifications`, keeping the query. Old notice addresses (`/admin/#/moderation`, `/admin/#/feedback`, `/admin/#/quotes`, `/admin/#/notifications`) reach Studio through the worker (G24), which swaps `/admin/` for `/admin/studio/`; `legacyRoute` maps the rest (`moderation`/`feedback` → `#/comments`, as built).

**Route wiring:** `screens/index.js` gains `{ name: "notifications", area: "notifications", create: createNotifications }`, always present so an old link never lands on a blank Home; when `meta.push` is false it shows only "not set up". Not in the side navigation (it belongs to the phone in her hand). Reached from:
- **Account menu:** **Notifications** (when `meta.push`). Below it, **Add to Home Screen** on phones and tablets, or **Install as an app** on computers — shown only when not already opened from the icon, and on computers only when the browser can install.
- **Palette:** "Notifications", "Turn on notifications here", "Send a test notification", "Add to Home Screen" / "Install as an app". Each is listed once: on Notifications the screen's own item replaces the shell's.
- **Where the need arises:** Comments, and Requests on a trade site, show one quiet link under their lede: **Get a notification on this iPhone when someone comments** (Requests: "…when someone asks for a quote"). Only when `meta.push`, this browser can do it, and this phone is not on. Not a banner, no dismiss; it goes when she turns them on.

## Flow

```
Account menu "Notifications" / Comments "Get a notification…" / palette / tapped old link
  v
Notifications (#/notifications)
  |                                   |                           |
  | iPhone, not on Home Screen        | can, not on               | not allowed
  v                                   v                           v
"Add your blog to your           [Turn on notifications]      steps for this phone's
 Home Screen" sheet                   |                       Settings; returns here by
  | (she follows the steps in Safari) | phone asks: Allow?    itself (or "I changed it. Check again")
  v                                   v
taps the new icon, signs in      "On. A test is on its way."  <- toast, test arrives
  v                                   |
Notifications (now can)               | Send a test / Turn off (Undo) / switches save at once
                                      v
                     Other phones and computers: Send it a test, Rename, Change, Remove

A notification on the lock screen
  | tap
  v
worker: Studio window open? -> focus it, ask it to go to #/comments (leave-guard asks first)
        none open           -> open /admin/studio/#/comments (in the installed app if there is one)
```

**Getting back:** Notifications is top-level; the account menu and navigation are always there. Sheets and dialogs close with Escape or ×, focus returns to the opener. The installed app has no browser Back, so every screen a notification opens carries its own way home; nothing depends on browser Back.

## Notifications (`#/notifications`)

- **Job:** "Should this phone tell me when someone writes, and about what?"
- **Title:** "Notifications".
- **Lede:** "Your phone can tell you when someone comments, even when your blog is closed." With quote requests and no comments: "…when someone asks for a quote, …".
- **Primary**, the first that holds:
  1. iPhone/iPad not on the Home Screen: **Add your blog to your Home Screen**.
  2. Off and able: **Turn on notifications**.
  3. Not allowed: **I changed it. Check again**.
  4. On: **Send a test**.
  5. Can't here for another reason: none; the words say where it can work.
- **Loads:** `GET push/status` (`enabled`, `state`, `publicKey`, `kinds`, `otherApps`, `devices`, `limits.devices` from G26). Meanwhile, without waiting: `herePhone()`, the worker registration at `/admin/` and its sign-up, then `endpointHash` to find "mine" among `devices`. `skeleton-block` stands in for "This iPhone" while loading.
- **Watches:** `navigator.permissions.query({name: "notifications"})` `change` and `visibilitychange`, so coming back from Settings redraws without a reload.

```
400 px                                      Desktop (>= 48rem): 1fr + 22rem
+------------------------------------------+
| Notifications                            |  h2 (tabindex -1, focused on open)
| Your phone can tell you when someone     |  p lede
| comments, even when your blog is closed. |
| [status line]                            |  live region
| +--------------------------------------+ |
| | This iPhone                    [Off] | |  content-card; h3 + status-badge
| | Tell me when                         | |  fieldset legend
| | [o] Someone leaves a comment         | |  toggle-switch per offered kind
| | [o] News from your family's other    | |
| |     apps, like a card game           | |
| | [ Turn on notifications ]            | |  primary, full width < 30rem
| | Your iPhone will ask first.          | |  help (only before it has asked)
| | Tap Allow.                           | |
| | They show who wrote and their first  | |  help, always
| | few words, even on your lock screen. | |
| +--------------------------------------+ |
| Other phones and computers               |  h3 (side column on desktop)
| +--------------------------------------+ |
| | Kitchen iPad                         | |
| | Tells you about comments.            | |
| | Last told you 3 hours ago.           | |
| | [ Remove ]                  [More v] | |
| +--------------------------------------+ |
| > Details for the person who set up      |  details (Mikey)
|   your site                              |
+------------------------------------------+
```

Below 48rem the side column moves under the main one. Nothing scrolls sideways at 320 px.

### This iPhone: every state

Card heading via `deviceNoun`: "This iPhone", "This iPad", "This phone" (Android), "This tablet", "This computer". The badge always carries a word.

| State (`hereState`) | Badge | Words | Buttons |
| --- | --- | --- | --- |
| `off`: can, not asked | Off, neutral | switches; help "Your iPhone will ask first. Tap Allow." and the lock-screen line | **Turn on notifications** |
| `off`: can, allowed before | Off, neutral | switches; lock-screen line | **Turn on notifications** (no question) |
| `off`, removed on another device | Off, neutral | "This iPhone was removed from the phones your blog tells, so it's off." + switches | **Turn on notifications** |
| `asking`: no answer after 8 s | Off | "Your iPhone is asking. Choose Allow." Computer: "Don't see the question? Look for a bell at the right end of the bar at the top where the address is and click it." | button stays loading |
| `on` | On, success | "This iPhone is called “iPhone”." **Rename** (link-styled). "Last told you 2 hours ago." / "Hasn't told you anything yet." Switches save at once. "Didn't see the test?" disclosure | **Send a test**; **Turn off on this iPhone** (secondary, own line, after "Didn't see the test?" and spaced well apart from Send a test) |
| `denied` | Not allowed, warning | "You said no when your iPhone asked, so it can't show notifications from your blog. To change that:" + steps (below) + "Then come back here." | **I changed it. Check again**; if still on the list, **Take this iPhone off the list** (secondary) |
| `home-screen-first`: iOS 16.4+ in a tab | none | "On an iPhone, your blog can only send notifications once it's on your Home Screen. It takes four taps." | **Add your blog to your Home Screen** |
| `update-first`: below iOS 16.4 | none | "This iPhone needs a newer iOS before your blog can send it notifications. In the Settings app: General, then Software Update." | none |
| `in-app` (Facebook, Instagram…) | none | "This page is open inside another app, which can't show notifications. Open your blog in Safari: [address]" (Android: "…in Chrome") | **Copy the address** |
| `not-secure` | none | "Notifications only work at your blog's secure address. Tell the person who set up your site." | none |
| `unsupported` | none | "This browser can't show notifications from your blog. On a computer, try Chrome, Edge, Firefox or Safari. On a phone, use Safari on an iPhone or Chrome on Android." | none |

**Switches** (only kinds offered on this site, `offeredKinds(meta, status)`; Studio's words, not the server's `label`):

| Kind id | Switch | In a summary | Offered when |
| --- | --- | --- | --- |
| `comment` | Someone leaves a comment | comments | `meta.engagement` or `meta.engagementSetUp` |
| `feedback` | A reader sends you a note about a post | notes from readers | same |
| `quote` | Someone asks for a quote | quote requests | `meta.quote` |
| `app` | News from your family's other apps, like a card game | news from your other apps | `status.otherApps` |

The push function holds one notify key for all her other apps and knows none of their names, so the `app` switch can't say "News from Card Room"; if `push/status` ever lists their names, the switch names them.

A new phone starts with every offered kind on. A phone whose sign-up the server already has (found by `endpointHash`, say after its answer was reset) shows its saved choices instead (`startingPicks`). Kinds the server holds but this screen doesn't offer are **kept** on change (`keptKinds`); Studio never drops what it doesn't show.

**Nothing offered:** `empty-state` "There's nothing for notifications to tell you about yet" / "They tell you about comments and quote requests, and neither is turned on for your blog."

**Denied: steps for this phone** (`deniedSteps(here)`, an `ol`, only this phone's; her layer never says "address bar", but "the bar at the top where the address is"):
- **iPhone/iPad (from the icon):** 1. Open the Settings app. 2. Tap Notifications. 3. Find your blog in the list (it has the name under its icon) and tap it. 4. Turn on Allow Notifications.
- **Android, from the icon:** 1. Touch and hold your blog's icon. 2. Tap App info (or the small "i"). 3. Tap Notifications and turn them on.
- **Android, in Chrome:** 1. Tap the small icon at the left end of the bar at the top where the address is. 2. Tap Permissions. 3. Turn on Notifications.
- **Chrome or Edge on a computer:** 1. Click the small icon at the left end of the bar at the top where the address is. 2. Turn on Notifications (in Edge: Permissions for this site, then Notifications, Allow).
- **Safari on a Mac:** 1. In the Safari menu, choose Settings. 2. Click Websites, then Notifications. 3. Find your blog and choose Allow.
- **Firefox:** 1. Click the icon at the left end of the bar at the top where the address is. 2. Click the × beside "Blocked: Send notifications". 3. Reload the page.
- **Anything else:** "Look in this browser's settings for this site's notifications and choose Allow."

**"Didn't see the test?"** (her layer, only when on, only this phone's lines):
- "Wait a minute. A phone saving battery can be slow."
- "Check that Do Not Disturb is off."
- iPhone: "In the Settings app: Notifications, then your blog. Allow Notifications should be on, with Lock Screen and Banners turned on."
- Android: "In Settings: Apps, then your blog (or Chrome), then Notifications."
- Mac: "In System Settings: Notifications, then your browser. Allow notifications should be on." Windows: "In Settings: System, Notifications, then your browser."
- "Still nothing? Turn notifications off here, then on again."

### Turn on notifications

One press (button loading; status "Turning on…"):
1. **Ask first, inside the press:** `Notification.requestPermission()` before any `await` (Safari needs the tap). Not asked when already `granted`.
2. Register `/admin/sw.js`, scope `/admin/`; wait for `ready`.
3. Reuse this phone's sign-up if its key matches `status.publicKey` (`sameKey`); otherwise unsubscribe the stale one and subscribe with `userVisibleOnly: true`.
4. `POST push/devices {subscription, label, kinds}` (`turnOnChoices`). When the server already has this sign-up, its `label` stays and its kinds are kept (`keptKinds`, so "quote" is never dropped); otherwise `label` from `guessLabel(userAgent)`, made unique ("iPhone 2").
5. `POST push/test {id}`.
6. Status "On. A test is on its way to this iPhone." Toast "Notifications are on." Focus to the card heading.

| Where it stops | What she sees (focus to the button) |
| --- | --- |
| Closed the question | "You didn't choose Allow, so it's still off. Tap Turn on notifications and choose Allow." |
| Don't Allow / Block | Card turns Not allowed with its steps; status "You said no, so it's off." |
| Worker didn't start | "Your blog couldn't get this iPhone ready. Reload the page, then try again." |
| Sign-up refused | "This iPhone's notification service didn't answer. Try again in a minute." |
| 409 `too-many` | "Your blog can tell up to 20 phones and computers. Remove one you don't use any more, below." Focus to "Other phones and computers". |
| 400 `invalid-subscription` | "This browser's notifications can't be used by your blog. Try Safari, Chrome, Edge or Firefox." |
| 502/504, `hosted-unavailable`, `hosted-timeout`, `storage-unavailable` | "Your blog couldn't reach its notification service. Try again in a minute." |
| `hosted-key-rejected`, `not-enabled`, 404 `not-set-up` | "Notifications aren't working right now. Tell the person who set up your site." |
| Saved, test `send-failed` | "On. The test didn't come through, though. Press Send a test in a minute." |
| 401 | Shell's "Sign in again"; the press finishes after. |

### When it's on

- **A switch changes:** `POST push/devices/<id> {kinds: keptKinds(...)}` at once. "Saved. This iPhone will tell you about comments and news from your other apps." With nothing on: "Saved. Nothing is on, so this iPhone stays quiet. To stop them for good, turn notifications off." Disabled while saving; on failure it flips back with the trouble words.
- **Send a test:** clears the status line first, then `POST push/test {id}` → "Sent. It should show up in a few seconds." 410 `gone`: "This iPhone stopped taking notifications, so your blog forgot it. Turn them on again." (redraw off). 404: "This iPhone was removed from the phones your blog tells, on another phone or computer. Turn them on again." `send-failed`: "The test didn't reach this iPhone. Try again in a minute. If it still doesn't come, turn notifications off, then on again."
- **Rename** (`modal-dialog` "Rename this iPhone"): field "Name" (required, so never marked optional), ≤ 60 chars, help "So you can tell them apart, like Kitchen iPad." → `POST push/devices/<id> {label}` → "Renamed to “Kitchen iPad”." Empty/`label-required`: "Give it a name, like Kitchen iPad." **Rename** / **Cancel**.
- **Turn off on this iPhone** (secondary, own line after "Didn't see the test?", no confirm):
  1. `POST push/devices/<id>/remove`, then `unsubscribe()`. If removal fails, the sign-up stays and she sees the trouble words.
  2. Status "Off. This iPhone won't get notifications." Toast "Turned off." and, under the status line, "Turned off by mistake?" **Undo**, which stays (no timeout) until she presses anything else on the screen (turning on again included; opening a disclosure doesn't count). Focus to **Turn on notifications**.
  3. **Undo** subscribes again without asking and posts the same `label` and `kinds` → "On again." If permission went away: "Turn them on again with Turn on notifications."

### Other phones and computers

Every device except "mine", oldest first. Each `content-card`:
- **Heading:** her name for it (`textContent`, wraps anywhere).
- **Hears:** "Tells you about comments and news from your other apps." (`kindsSummary`). None: "Nothing is on, so it stays quiet."
- **Last:** "Last told you 3 hours ago." / "Hasn't told you anything yet." (`lastToldWords`; G23 makes a test count).
- **Remove** ("Remove Kitchen iPad") and **More** ("More for Kitchen iPad"):
  - **Send it a test** → "Sent to Kitchen iPad. Check that it showed up there." (410: "Kitchen iPad stopped taking notifications, so your blog forgot it." Card goes.)
  - **Change what it tells you…** (`side-sheet` "What Kitchen iPad tells you", switches, **Save**) → "Saved. Kitchen iPad will tell you about comments." Leave-guard: "Save these changes?" **Save** / **Leave without saving**.
  - **Rename…**
- **Remove** (`modal-dialog`): "Remove Kitchen iPad?" / "It won't get notifications from your blog any more. To get them there again, open your blog on it and turn them on." **Keep it** (focused) / **Remove** (destructive) → `POST push/devices/<id>/remove` → "Removed Kitchen iPad." No Undo (the server never returns its sign-up).
- **None:** "No other phones or computers get notifications. Turn them on from each one you use."

### Not set up, and errors

| State | First layer | Details (Mikey) |
| --- | --- | --- |
| `meta.push` false | `empty-state` "Notifications aren't set up for your blog" / "The person who set up your site can turn them on. Your blog works the same without them." | "Set OPENBLOG_PUSH_ENDPOINT and OPENBLOG_PUSH_ADMIN_KEY where Studio runs, after the steps in docs/notifications.md." |
| `state: invalid` | `alert-banner warning` "Notifications aren't set up right" / "Tell the person who set up your site." | setting names in `problems`, never values |
| `state: unavailable` | same banner | "The push function answered but isn't switched on: set OPENBLOG_PUSH_ENABLED=true and its other settings there." |
| `push/status` fails | `alert-banner danger` "Notifications didn't load" + trouble words, **Try again** | HTTP status, `code` |
| On, this phone can't | the card's own state; other devices still managed | `hereState` and why |

## Add to Home Screen (`side-sheet`)

- **Job:** "Put my blog on my phone like an app." **Primary:** **Add it** when the browser can ask; otherwise none (steps happen in the browser).
- **Label:** "Add your blog to your Home Screen"; on a computer "Install your blog as an app".
- **Opens from:** account menu, palette, the `home-screen-first` card, `#/notifications?sheet=home-screen`. Already opened from the icon: menu item hidden; deep link says "You're already using your blog from its icon."
- **How:** `installWay(here, hasPrompt)`. The shell listens for `beforeinstallprompt` from the start (`studio.js`), keeps it and calls `preventDefault()`.

```
iPhone, Safari                              Android or computer, browser can ask
+------------------------------------------+ +------------------------------------------+
| Add your blog to your Home Screen   [x]  | | Install your blog as an app         [x]  |
| Then your blog opens from its own icon,  | | Then your blog opens in its own window,  |
| like your other apps.                    | | like your other apps.                    |
| 1. Tap the Share button [^] at the       | | [ Add it ]                               |
|    bottom of the screen. Don't see it?   | | Your browser asks first. Choose Install. |
|    Tap the three dots (•••) at the      |
|    bottom right first.                   | | > Details for the person who set up ...  |
| 2. Scroll down and tap Add to Home       | +------------------------------------------+
|    Screen.                               |
| 3. You can change the name. Tap Add.     |  ol; [^] inline drawing of Safari's Share
| 4. Open your blog from its new icon and  |  icon, aria-hidden, beside the word
|    sign in again.                        |
| > Details for the person who set up ...  |
+------------------------------------------+
```

| `installWay` | Steps |
| --- | --- |
| `prompt` | **Add it** → `prompt()`. Accepted: phone "Added. Open your blog from its icon from now on."; computer "Added. Your blog opens in its own window from now on." Dismissed: "Not added. You can add it any time from your name's menu." |
| `ios-safari` | before step 1, as help: "You'll sign in once more from the new icon, so have your password handy. If you don't know it, ask the person who set up your site first." Then the four steps; step 1's help "Don't see it? Tap the three dots (•••) at the bottom right first."; iPad: "at the top right" for Share |
| `ios-other` | the sign-in warning and the four steps plus "Don't see Add to Home Screen? Open your blog in Safari: [address] **Copy the address**" |
| `in-app` | "This page is open inside another app. Open your blog in Safari (Android: in Chrome): [address] **Copy the address**" |
| `android-menu` | "1. Open the menu: the three dots at the top right. 2. Tap Add to Home screen, or Install. 3. Open your blog from its new icon." |
| `desktop-chromium` | "Look for the Install button at the right end of the bar at the top where the address is. Or open the menu (the three dots at the top right) and choose Install." |
| `mac-safari` | "In the menu bar, choose File, then Add to Dock." |
| `firefox-desktop` | "Firefox can't add your blog as an app. It works the same in a tab: bookmark it instead." (menu item hidden) |
| `installed` | "You're already using your blog from its icon." |

- **After adding:** `appinstalled` → toast "Added."
- **Copy the address** (`copiedWords`; the sheet and the `in-app` card alike): `location.origin + "/admin/studio/"` → "Copied. Touch and hold in the bar at the top of Safari, then tap Paste." (Android: "…of Chrome…"). Refused: the address is selected, "Select the address and copy it. Then touch and hold in the bar at the top of Safari, and tap Paste."
- **Add it when the question has gone** (asked elsewhere meanwhile): the sheet redraws with this phone's own steps, as if the browser couldn't ask; no other words.
- **Details** (Mikey): display mode, whether `beforeinstallprompt` fired, manifest `id`/`start_url`/`scope`, and: "An iPhone app keeps its own sign-in and its own notifications. Adding a second icon makes a second app that has to turn notifications on by itself. The old icon keeps working; there is no need to add it again."

## The installed app, the worker, and existing installs

| What | Value | Why |
| --- | --- | --- |
| Manifest `id` | `/admin/` (unchanged) | Chrome/Edge treat a new `start_url` as an update of the same app |
| `start_url` | `/admin/studio/` (G20) | The icon opens Studio Home |
| `scope` | `/admin/` (unchanged) | Covers `/admin/studio/` and the R15 redirect; old notice addresses stay in scope |
| Worker | one, `/admin/sw.js`, scope `/admin/`; Studio registers exactly this (`registerWorker`) | Same URL and scope = same registration, so the new file is an update (`skipWaiting`, `clients.claim`) and **existing sign-ups survive**. Never register under `/admin/studio/` |
| Studio page head | `<link rel="manifest" href="/admin/manifest.webmanifest">`, `apple-touch-icon`, `theme-color` (light/dark from tokens); JS sets `apple-mobile-web-app-title` to the short name once `meta` loads | Add to Home Screen offers her blog's name |
| Name under the icon | site title; `short_name` the title if ≤ 12 chars, else "My blog". No "Admin" | Her words |

**Existing installs:**

| Install | After R3 | After R15 |
| --- | --- | --- |
| Android / desktop Chrome or Edge | Manifest update brings new `start_url` and name (Chrome may say "This app has been updated" once). Opens Studio | unchanged |
| iPhone/iPad Home Screen (manifest never updated) | Still opens `/admin/`; G25 sends a launch with no `#` to `/admin/studio/`, same app, cookies, worker. Sign-up keeps working | `/admin/` → 302 `/admin/studio/`; G25 goes with the old Admin |
| Sign-ups made in the old Admin | Same registration; Studio finds them by `endpointHash` and shows On | unchanged |
| Queued notices with `/admin/#/…` | Worker rewrites to `/admin/studio/#/…`; `legacyRoute` maps the rest (G24) | unchanged |

**Tapping a notification (G24)** (`web/studio/sw.js`, classic script, no request handling, no cache):
1. Address: same-origin `/admin/` or `/admin/#…` → `/admin/studio/` + same `#…`. Same-origin `/admin/studio/…` kept. `https` from her other app kept. Anything else → `/admin/studio/`.
2. Studio address and a Studio window open: `focus()` and `postMessage({type: "open", hash})`; the shell calls `router.go(hash)`, so **the leave-guard asks first** (the old `client.navigate()` reloaded without asking).
3. Otherwise `clients.openWindow(address)` (opens in the installed app when there is one).
4. No title: "Something new on your blog". Badge `icons/badge-96.png` (G27), icon `icons/icon-192.png`.

## What Grammi sees and what Mikey sees

| | Grammi | Mikey (details, More, palette) |
| --- | --- | --- |
| This iPhone | On/Off/Not allowed in words; switches; Send a test; Turn off | `hereState`; `isSecureContext`; display mode; `Notification.permission`; worker scope, script URL, state; push service host only (never the full address); key match (first/last 6 chars); device `id` (**Copy**); hash; `createdAt` |
| Choices | "Someone leaves a comment"… | kind ids and server labels; kinds kept but not shown |
| Other devices | name, what it tells her, last told | `id`, hash, `createdAt`, `lastSentAt` instant, the 20-device limit |
| Not allowed | steps for this phone | raw permission state and detection |
| Can't here | one sentence and where it can work | user agent, iOS version, missing APIs |
| Not set up | "The person who set up your site can turn them on." | setting names, `problems`, `docs/notifications.md`, `OPENBLOG_PUSH_NOTIFY_KEY`, "New keys stop every phone; each turns them on again." |
| Errors | what happened and what to do | HTTP status, `code`, server message |
| Hosting | none | "On a host that sleeps (Render's free plan), tapping a notification opens Studio slowly; the notification itself isn't late." |

## Rules each part uses (static imports, DOM-free, tested)

| Part | From | Functions |
| --- | --- | --- |
| This phone | new `parts/notification-rules.js` (pure half of `admin/notifications.js`) | `herePhone({navigator, window})` → `{apple, ios, standalone, inApp, android, desktop, browser, secure, capable, permission}`; `hereState(here, mine, hasSubscription)`; `deviceNoun`; `guessLabel` (kept); `uniqueLabel`; `endpointHash` (kept); `keyBytes`; `sameKey` |
| Words | same | `KIND_WORDS`, `offeredKinds`, `keptKinds`, `kindsSummary`, `lastToldWords` (replaces `ago`), `deniedSteps`, `didntSeeIt`, `pushTrouble` (by `code`, G26) |
| Home Screen | new `parts/install-rules.js` | `installWay`, `installSteps`, `menuLabel` |
| Worker | `web/studio/sw.js`; its address helper copied as `studioAddress(url, origin)` in `notification-rules.js`, with a test that the two copies match | `push`, `notificationclick` |
| Shell | `shell.js`, `studio.js` | `registerWorker()` (exactly `/admin/sw.js`, scope `/admin/`, secure context only); `beforeinstallprompt` kept; `message` → `router.go`; menu and palette items |

- **Port:** `tests/web/admin-notifications.test.mjs` → `studio-notification-rules.test.mjs` (every `browserState` case becomes a `hereState` case) and `studio-notifications.test.mjs`. `netlify-push.test.mjs`, `netlify-quote-notify.test.mjs` take the new addresses and words. `push_routes.rs:313–340`: `start_url` `/admin/studio/`, `id`/`scope` `/admin/`, no "Admin" in the name, `/admin/sw.js` is Studio's worker.
- **New:** `studio-sw.test.mjs` (fake `self`: old addresses rewritten; open window messaged not navigated; foreign `http:` falls back); browser `studio-notifications.spec.mjs` (grant, stub `PushManager`, on, test, off + Undo, remove another); a check that Studio registers no worker but `/admin/`; `hereState` for iOS 16.3/16.4/18 tab and icon, Facebook in-app, plain http, Firefox private.

## Accessibility

- **Keyboard order:** heading, lede, status, This iPhone (heading, Rename, switches, primary, "Didn't see the test?", secondary), other cards (heading, Remove, More), details. Sheets/dialogs focus their heading (Rename: its field); Escape closes; focus returns.
- **Switches:** `fieldset` legend "Tell me when"; each named by its words; while saving `aria-disabled`, announces "Saving" once and "Saved" once.
- **Browser question:** button `aria-busy`; the 8-second hint goes to the live region once.
- **After actions:** on → "This iPhone"; off → **Turn on notifications**; Remove → next card or section heading; **I changed it. Check again** → heading, outcome in status.
- **Errors:** `role="alert"` on the card, linked from the button via `aria-describedby`.
- Badges carry words; the Share drawing is `aria-hidden` beside the word "Share"; steps are `ol`.
- Full names on repeated buttons: "Remove Kitchen iPad", "More for Kitchen iPad", "Send Kitchen iPad a test".
- **320 px:** one column; buttons full width, stacked; names and addresses wrap anywhere, but switch labels wrap only between words (a browser check measures it); controls ≥ 44 px. No motion.
- **Zubra:** `toggle-switch`, `action-button`, `content-card`, `status-badge`, `alert-banner`, `empty-state`, `skeleton-block`, `dropdown-menu`, `side-sheet`, `modal-dialog`, `text-field`, `toast-region`; native `fieldset` styled by tokens. No forks.

## Safety

- The sign-up's full address never shows, is never logged, goes only to `push/devices`, never sent back. Studio knows its phone by `endpointHash`.
- Device names are shown as `textContent`. Notice titles and bodies come from strangers and are plain text; the worker clips them as before.
- The worker opens only same-origin Studio addresses or `https` (`checkUrl` on the function, `studioAddress` in the worker). Never `javascript:`, `data:` or `http:`.
- No caching, no request handling. CSP unchanged (`worker-src`/`manifest-src` fall back to `'self'`).
- Turning off removes on the server **before** unsubscribing.

## Gaps

- **G20. Manifest for Studio** (`push::manifest`): `name` site title (empty: "My blog"); `short_name` title if ≤ 12 chars else "My blog"; `id` `/admin/`; `start_url` `/admin/studio/`; `scope` `/admin/`; colours from Studio tokens; icons as now plus G27 badge. Update `push_routes.rs:313–318`.
- **G21. Worker and icons from Studio's files:** `/admin/sw.js` served from `web/studio/sw.js` (embedded; no `<paths.web>/admin/sw.js` override) with `Cache-Control: no-cache`. `/admin/icons/*` from `web/studio/icons/` (`EMBEDDED_ADMIN_ICONS` repointed; `<paths.web>/admin/icons/` override kept). Remove `sw.js` from the old file table and `EMBEDDED_ADMIN` (`site.rs:371`). The old Admin's `register("/admin/sw.js")` keeps working.
- **G22. Notice addresses go to Studio:** `engagement.mjs:741` → `/admin/studio/#/comments`; `:778,813,865,1354` → `/admin/studio/#/comments` (R10 changes to Readers); `quote.mjs:244` → `/admin/studio/#/quotes`; `push.mjs:131` → `/admin/studio/#/notifications`; `push.mjs:44` and `push-store.mjs` `notice()` default → `/admin/studio/`; `docs/notifications.md` example.
- **G23. Notice words in hers:** comment title "Linda left a comment", body `On “Pumpkin pie”: “Tried this for…”` (name from the path's last part via `pageWords(path)`; `/` → "your front page"; no raw path). Feedback "A reader wrote about “Pumpkin pie”." Author answer "An author answered on “Pumpkin pie”." Test title "Your blog can reach this iPhone" (the device's label), body "You'll get one like this when something you picked comes in." Fallback titles become "Something new on your blog". A sent test stamps `last_sent_at`. Amend ADR 0412's "the post's path" line.
- **G24. The worker's tap:** rewrite old addresses, message an open Studio window instead of navigating it, else `openWindow`. Shell handles `{type: "open", hash}`.
- **G25. Bridge in the old Admin until R15:** `admin.js` sends `#/notifications` to `/admin/studio/#/notifications`, keeping its query (so `?sheet=home-screen` still opens the sheet) (`location.replace`); in standalone mode with an empty hash, `/admin/` → `/admin/studio/`, so Studio's palette item **Open the old Admin** goes to `/admin/#/`, which stays. Deleted in R15.
- **G26. Codes on push errors:** Rust's own errors gain `code` (404 `not-set-up`; 400 `device-required`/`invalid-request`/`unknown-field`; 502 `bad-reply`/`hosted-unavailable`; 504 `hosted-timeout`; the function's 401 → `hosted-key-rejected`); `refusal` keeps the function's code for 503 `storage-unavailable`; `project_status` passes `limits.devices`.
- **G27. Monochrome badge icon:** `web/studio/icons/badge-96.png` (white on transparent), served at `/admin/icons/badge-96.png`.
- **Not gaps:** renaming/changing/testing any device (existing routes take any id); install prompt and denied steps (client-only); quiet hours, digest, email fallback (outside ADR 0412).

## Risks to test on real phones before release

- An iPhone install made in the old Admin with notifications on: after release, the icon opens Studio (G25), shows **On**, and a comment's tap lands on Comments.
- Android and desktop installs update their name and start address without reinstalling; existing sign-ups keep getting notices.
- R2's same-tab trip to Facebook from the iPhone app comes back into the app at `#/sharing/accounts?connection=`.
- Studio pages controlled by the updated worker still load from the server with no stale files.
- `requestPermission` inside the press on iOS Safari (any `await` before it makes Safari refuse silently).

## Docs and release note

- Rewrite `docs/notifications.md` in Studio's words (account menu **Notifications**, Home Screen sheet, Not allowed and how to undo it); keep setup and "From your other apps", with addresses `/admin/studio/#/…`.
- Release note (Mikey): the installed app opens the new screens and its name no longer ends in "Admin"; Chrome may say the app was updated; iPhones keep their icon and notifications; old notification links still open the right screen; `/admin/sw.js` can no longer be overridden by a site.

## Changes to `studio-ux` (adopted)

- In her own words the product is *your blog*; Studio's and the old Admin's names never appear on her layer. R1 and R2 screens that say "Studio" in her sentences change when next touched.
- Banned on her layer, next to "deploy": push, subscription, PWA, service worker, permission, endpoint, device, browser (except naming the app she is in).
- "Works on her phone": every screen works in the installed app, which has no Back button or address bar; every screen has its own way home.
- Review checklist: platform steps show only the ones for the device in her hand.

**Note (R4, 2026-11-13):** the worker now also keeps Studio's own static files (G35: versioned, network-first,
never API replies), so "caches nothing" above is narrowed to "never an API reply". Everything else here (exactly
`/admin/sw.js`, scope `/admin/`, message-not-navigate on tap) is unchanged. See `r4/ux.md`.
