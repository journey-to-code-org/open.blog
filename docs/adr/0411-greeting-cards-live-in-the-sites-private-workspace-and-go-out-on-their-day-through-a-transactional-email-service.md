# ADR 0411: Greeting cards live in the site's private workspace and go out on their day through a transactional email service

- Status: Accepted
- Date: 2026-11-12
- Builds on: [ADR 0381](0381-quote-requests-are-stored-server-side-only-through-a-fenced-visitor-endpoint-that-is-off-by-default.md), [ADR 0383](0383-the-owner-is-told-by-one-opt-in-email-to-their-own-address-that-carries-no-contact-details-and-can-never-lose-a-request.md), [ADR 0384](0384-the-owner-manages-quote-requests-in-admin-with-no-crm-and-erases-them-only-after-a-preview-with-a-verified-result.md)

## Context

A family site's owner wants to send cards: a birthday card to each grandchild every year, a Christmas card to
everyone. She would write them in Admin and have them go out on the day. Three things make that harder than
it sounds. The repository of a static site is often public, so names and email addresses can't be kept in it.
Email services schedule only a short way ahead (Resend up to 30 days; a birthday card is written months
ahead and comes every year), so something has to hold a card and hand it over on its day. And Admin may run
on the owner's own computer, which is not always on.

## Decision

- **Cards and the address book live in the site's private Supabase project**, in two tables with row level
  security on, no policies and no public grants (`supabase/greetings.sql`), as quote requests do (ADR 0381).
  Nothing about a card is written to the repository, a page, a feed or a log.
- **A hosted function owns them** (`netlify/functions/greetings.mjs`), reachable only with a key of its own
  (`OPENBLOG_GREETINGS_ADMIN_KEY`). Admin reaches it only from its own server, with the endpoint and key from the
  environment of the process running Admin, never from `openblog.json` (as ADR 0384). The browser never holds
  the key; every reply is rebuilt from known fields.
- **An hourly scheduled function sends what is due** (`greetings-send.mjs`). It claims a card before sending (so
  two runs never send one card twice), renders it, hands it to the email service, and then marks it sent,
  moves a yearly card to the same day next year, or keeps it for another try. A refused key or a rejected
  message stops at once; anything else is tried up to three times. The owner sees each outcome in plain words.
- **The first email service is Brevo** (transactional API, free daily allowance, a verified sender address and
  no domain needed). The transport is one function returning `{ ok, id }` or a fixed code, so another service
  is one more function.
- **A card is the owner's words in a fixed design.** A handful of designs (birthday, Christmas, Thanksgiving,
  Easter, valentine, anniversary, congratulations, thinking of you, just because) are email-safe HTML: tables,
  inline styles and emoji, no images to block. The subject, message and sign-off are plain text, escaped;
  `{name}` and `{age}` are filled in when the card goes out. The send time is an hour on the owner's wall clock
  in her time zone, daylight saving included; February 29 comes round on the 28th.
- **She sees it before it goes.** Preview renders the card for its person; Admin keeps the document under a
  random token and serves it like any preview, under a policy that allows its inline styles and runs nothing,
  in a sandboxed frame. **Send me a test** sends it to her own sending address, never to the person on it.

## Consequences

- Greeting cards need the same free hosted pieces as hosted comments and quote requests (Netlify and
  Supabase) plus a Brevo account; a site without them shows nothing new.
- Cards go out even when Admin and the owner's computer are off.
- The address book is personal data held for the owner's own use; removing a person removes their cards.
  `supabase/greetings-rollback.sql` deletes everything after an export.
- Not in this decision: cards to many people at once (a mailing list), replies, images in cards, and other
  email services. Each would be its own decision.
