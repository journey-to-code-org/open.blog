# Notifications

Your phone can tell you when someone writes to you: a new comment, a note from a reader, a quote request, or
news from your family's other apps, like a gift left for you or a challenge to a game. Tap one and your blog
opens on that screen. Notifications are optional and off by default; a site without them works exactly the
same ([ADR 0412](adr/0412-admin-installs-as-an-app-and-the-owner-is-told-on-her-own-devices-by-web-push-sent-from-where-the-news-arrives.md)).

They come from the same small hosted functions that take in comments, so they arrive even when your blog's
server and your computer are off.

## Turning them on, on the phone in your hand

Open your blog (Studio, at `/admin/studio/`), choose your name at the top right, then **Notifications**.
The card at the top is about the phone or computer you are holding ("This iPhone", "This computer") and
says what to do next:

- **On an iPhone or iPad** (iOS 16.4 or later), your blog has to be on your Home Screen first. The card's
  **Add your blog to your Home Screen** shows the four taps for your phone: Share, **Add to Home Screen**,
  **Add**, then open your blog from its new icon and sign in again. An older iOS is told to update first.
- **On Android or a computer**, any up-to-date browser works as it is. Your name's menu also offers **Add to
  Home Screen** (Android) or **Install as an app** (Chrome and Edge on a computer, Safari on a Mac), so your
  blog opens in its own window.

Then choose what it tells you about (**Someone leaves a comment**, **A reader sends you a note about a
post**, **Someone asks for a quote**, **Your other apps have news**) and press **Turn on notifications**.
Your phone asks first: choose **Allow**. A test arrives in a few seconds.

While it's on, the switches save at once, **Send a test** checks it still works, **Rename** gives it a name
you'll recognise, and **Turn off on this iPhone** stops it (with **Undo**, which stays until you do something else there). If the test doesn't
come, **Didn't see the test?** lists what to check on that phone.

**Not allowed**: if you chose **Don't Allow**, the card says **Not allowed** and shows the steps for your
phone's Settings (or your browser's). Do them, come back, and the card notices by itself; **I changed it. Check again**
does the same.

**Other phones and computers** lists every other device that gets notifications, what each tells you about,
and when it last did. **Remove** stops one you don't use any more; **More** sends it a test, changes what it
tells you, or renames it.

Comments and Requests also show a quiet **Get a notification on this iPhone when…** link while this phone
doesn't have them yet.

## The installed app

The app keeps its address: the manifest's `id` and `scope` are `/admin/`, and it opens `/admin/studio/`.
Android and computer installs update themselves (Chrome may say the app was updated once). An iPhone app
added before Studio still starts at `/admin/`, which sends it on to Studio, with the same sign-in and the same
notifications. There is no need to add it again: a second icon is a second app that has to turn notifications
on by itself. The one service worker stays at `/admin/sw.js` (scope `/admin/`); it shows notifications and
opens Studio when one is tapped, and can't be replaced by a site's own file. Since Studio R4 it also keeps a
copy of Studio's own files (a new copy with each release, fetched from the server first whenever there is a
signal), so New job opens on a job site with no signal; it never keeps an `/admin/api/` reply, anything of the
session, or the old Admin's pages. A site can still
bring its own icons under `<paths.web>/admin/icons/`.

## Setting it up

You need the same free hosted pieces as [hosted comments](deploy.md#comments-and-persistent-analytics-on-netlify):
a Supabase project and a Netlify site running open.blog's functions.

1. In Supabase, open **SQL Editor** and run [`supabase/push.sql`](../supabase/push.sql).
2. Make a key pair once, on any computer with Node:

   ```sh
   node scripts/push-keys.mjs
   ```

   Keep it. New keys quietly stop every device that turned notifications on, and each has to turn them on again.
3. In Netlify, set these environment variables and redeploy:

   | Variable | Value |
   | --- | --- |
   | `OPENBLOG_PUSH_ENABLED` | `true` |
   | `OPENBLOG_PUSH_ADMIN_KEY` | A long random value (32 characters or more) |
   | `OPENBLOG_PUSH_PUBLIC_KEY` | The public key from step 2 |
   | `OPENBLOG_PUSH_PRIVATE_KEY` | The private key from step 2 |
   | `OPENBLOG_PUSH_SUBJECT` | How the push services can reach you: `mailto:you@example.com` or an https page |
   | `OPENBLOG_PUSH_NOTIFY_KEY` | Optional: another long random value, for your other apps (below) |

   `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `OPENBLOG_SITE_ID` are the ones hosted comments already use.
4. Where Studio runs (the `openblog serve --admin` process), set `OPENBLOG_PUSH_ENDPOINT` to
   `https://<your-netlify-site>/api/push` and `OPENBLOG_PUSH_ADMIN_KEY` to the same key, then restart it.
   **Notifications** appears in the account menu (your name, top right).

Notifications must be turned on at the blog's https address. On Render's free plan the server sleeps when
idle, so tapping a notification can take a little while to open Studio; the notification itself is not delayed.

When something goes wrong, open **Details for the person who set up your site** at the bottom of
Notifications: it shows the permission, the worker's scope and state, whether this browser's sign-up matches
the key, each device's id, and the server's error code.

To remove everything, run [`supabase/push-rollback.sql`](../supabase/push-rollback.sql) and unset
`OPENBLOG_PUSH_ENABLED`. Comments, feedback and requests are not touched.

## From your other apps

With `OPENBLOG_PUSH_NOTIFY_KEY` set, another app you run, like a family gift tree or a card room, can send you
a notification. It sends one request from its server, never from a page:

```sh
curl -X POST https://<your-netlify-site>/api/push/notify \
  -H "Authorization: Bearer $OPENBLOG_PUSH_NOTIFY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Jimmy left you a gift 🎁","body":"It is under the tree.","url":"https://family.example/tree"}'
```

`title` is required (up to 80 characters), `body` is optional (up to 180), and `url` is where tapping goes: a
page in Studio like `/admin/studio/#/comments`, or any https page. (An older `/admin/#/…` address still
works: the worker opens the same screen in Studio.) It reaches only devices with
**News from your family's other apps** turned on. The notify key can send and nothing else: it can't see, add or remove devices. Keep it
on the other app's server.
