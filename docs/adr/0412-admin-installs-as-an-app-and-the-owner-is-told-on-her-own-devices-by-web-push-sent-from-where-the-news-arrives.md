# ADR 0412: Admin installs as an app, and the owner is told on her own devices by Web Push sent from where the news arrives

- Status: Accepted
- Date: 2026-11-13
- Builds on: [ADR 0383](0383-the-owner-is-told-by-one-opt-in-email-to-their-own-address-that-carries-no-contact-details-and-can-never-lose-a-request.md), [ADR 0411](0411-greeting-cards-live-in-the-sites-private-workspace-and-go-out-on-their-day-through-a-transactional-email-service.md)

## Context

A family site's owner wants her phone to buzz when someone leaves a comment, and when her family's other
apps have news for her (a gift left for her, a challenge to a card game). Today she finds out only when she
opens Admin. ADR 0355 deferred a push nudge for exactly this reason.

Two facts decide where a notification can come from. Comments, feedback and quote requests arrive at the
hosted functions, not at Admin. And Admin is often asleep: on Render's free plan it stops when idle, and on
the owner's own computer it is off when the computer is. So the sender has to be the function that just
stored the news. A phone, meanwhile, only takes Web Push for a site it can install: an iPhone only for a web
app added to the Home Screen (iOS 16.4 and later).

## Decision

- **Admin is an installable web app.** It serves a manifest named from the site's title, icons (a site may
  replace them under `<paths.web>/admin/icons/`), and a service worker at `/admin/sw.js` scoped to
  `/admin/`. The worker shows a notification and opens the page it is about when tapped. It caches nothing
  and answers no request, so Admin still always loads from its server. Admin's page policy is unchanged.
- **Devices live in the site's private Supabase project** (`supabase/push.sql`), with row level security on,
  no policies and no public grants, like quote requests and greeting cards. A device is a browser's push
  subscription, a name the owner gives it, and the kinds of news it wants: new comments, reader feedback,
  quote requests, and the owner's other apps.
- **The hosted `push` function owns them**, behind a key of its own (`OPENBLOG_PUSH_ADMIN_KEY`). Admin reaches
  it only from its server (`OPENBLOG_PUSH_ENDPOINT`), as for greeting cards. The endpoint is a capability
  URL, so it goes from the browser to the function and never comes back: Admin knows a device by a hash of
  it, and the page works out the same hash to recognise the browser it runs in.
- **News is sent from where it arrives.** After a comment, feedback item, author answer or quote request is
  stored, its function tells the devices that want that kind. This is bounded (four seconds in all) and inside
  a catch-all, so it can never lose or delay what was stored beyond that, and its outcome does not change the
  reply. A device the push service reports gone (404 or 410) is forgotten.
- **The owner's other apps get one narrow door**: `POST /api/push/notify` with a separate key
  (`OPENBLOG_PUSH_NOTIFY_KEY`), which may only send a title, a line, and a link to an Admin page or an https
  page, to devices that asked for "your other apps". That key cannot list, add or remove devices. Without it
  the door is closed and the kind is not offered.
- **Web Push is implemented on `node:crypto`**: RFC 8291 (`aes128gcm`, one record) and RFC 8292 (VAPID, an
  ES256 JWT for the push service's origin, twelve hours). The functions take no dependency. A subscription is
  sent to only if its endpoint is one of the browsers' push services (Google, Mozilla, Apple, Microsoft),
  over https, with no credentials or port, so a stored device can never make the function request anywhere
  else. The key pair comes from `node scripts/push-keys.mjs`, and the pair is checked to belong together.
- **What a notification says** is what arrived and from whom: a comment's author, the post's path and up to
  90 characters of the comment; for feedback, its post; for a quote request, the same name, service and town
  as the email (ADR 0383), never a phone number, address or description. The content is encrypted end to end
  for the device: the push service carries it without being able to read it. It does show on the device's
  lock screen, which is the owner's own.

## Consequences

- Notifications need the hosted functions and Supabase, as hosted comments do, plus a key pair and a contact
  address for the push services (`OPENBLOG_PUSH_SUBJECT`; Apple refuses requests without one). A site
  without them shows nothing new.
- A notification arrives even when Admin is asleep or off. Tapping it opens Admin, which on a sleeping host
  takes as long as that host takes to wake.
- New keys silently stop every device; each has to turn notifications on again. The docs say to make them once.
- Notifications are not a record. A failed or late push is not retried: the comment, feedback or request is
  already stored and waits in Admin as before.
- Not in this decision: email or SMS as a fallback, quiet hours, a daily digest, notifications to anyone but
  the owner's own devices, and offline Admin. Each would be its own decision.
