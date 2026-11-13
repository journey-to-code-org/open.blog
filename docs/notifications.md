# Notifications

Get a buzz on your phone or computer when there's something for you: a new comment, reader feedback, a
quote request, or news from your family's other apps, like a gift left for you or a challenge to a game.
Tap it and Admin opens on the right page. Notifications are optional and off by default; a site without
them works exactly the same ([ADR 0412](adr/0412-admin-installs-as-an-app-and-the-owner-is-told-on-her-own-devices-by-web-push-sent-from-where-the-news-arrives.md)).

They come from the same small hosted functions that take in comments, so they arrive even when Admin and
your computer are off.

## Turning them on for a device

On an **iPhone or iPad** (iOS 16.4 or later), Admin has to be on your Home Screen first:

1. Open Admin in Safari and sign in.
2. Tap the Share button, then **Add to Home Screen**, then **Add**.
3. Open Admin from its new icon and sign in again.

On **Android, Windows, Mac or Linux**, any up-to-date browser works as it is. You can also install Admin as
an app there: Chrome and Edge offer **Install** in the address bar or menu.

Then, on that device:

1. Open **Notifications** in Admin.
2. Give the device a name you'll recognise, like "Kitchen iPad", and tick what it should tell you about.
3. Tap **Turn on notifications**, then **Allow**. A test notification arrives in a few seconds.

**Other devices** lists every device that gets notifications. Remove one you no longer have, or open
Notifications on that device to change what it hears about or turn it off.

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
4. Where Admin runs, set `OPENBLOG_PUSH_ENDPOINT` to `https://<your-netlify-site>/api/push` and
   `OPENBLOG_PUSH_ADMIN_KEY` to the same key, then restart Admin. **Notifications** appears in the menu.

Notifications must be turned on from Admin at its https address. On Render's free plan Admin sleeps when
idle, so tapping a notification can take a little while to open; the notification itself is not delayed.

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
page in Admin like `/admin/#/moderation`, or any https page. It reaches only devices that ticked
**Your other apps**. The notify key can send and nothing else: it can't see, add or remove devices. Keep it
on the other app's server.
