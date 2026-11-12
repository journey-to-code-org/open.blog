# Greeting cards

Write a card in Admin, pick the day, and it goes out by email on that day: once, or every year on a
birthday. Cards are optional and off by default; a site without them works exactly the same.

The address book and the cards are kept in your site's private Supabase project, never in your
repository or on a page, so a public site can hold them. A small hosted function sends each card when its
time comes, even when your computer and Admin are off ([ADR 0411](adr/0411-greeting-cards-live-in-the-sites-private-workspace-and-go-out-on-their-day-through-a-transactional-email-service.md)).

## Writing a card

Open **Greeting cards** in Admin.

1. Add the people you send cards to under **Address book**: a name, an email address, and a birthday if
   you'd like birthday cards.
2. Choose **Write a card**, then who it's for and which card (Birthday, Christmas, Thanksgiving, Easter,
   Valentine, Anniversary, Congratulations, Thinking of you, Just because).
3. Write your message. `{name}` becomes their first name and `{age}` how old they're turning. Sign it.
4. Pick the day and time. For a birthday card to someone with a birthday on file, the day is filled in and
   **Send it every year** is ticked.
5. **See the card** shows it as it will arrive. **Send me a test** sends it to your own address.
6. **Schedule this card**.

**Your cards** lists every card with when it goes out, in words. A card that couldn't be sent says why;
open it and schedule it again. **Stop sending it** cancels a card.

## Setting it up

You need the same free hosted pieces as [hosted comments](deploy.md#comments-and-persistent-analytics-on-netlify)
(a Supabase project and a Netlify site running open.blog's functions) and a free
[Brevo](https://www.brevo.com) account. Brevo's free plan sends up to 300 emails a day and adds a small
"Sent with Brevo" line.

1. In Supabase, open **SQL Editor** and run [`supabase/greetings.sql`](../supabase/greetings.sql).
2. In Brevo, add and verify your sender address (**Senders, domains & dedicated IPs → Senders**), then create
   an API key (**SMTP & API → API keys**).
3. In Netlify, set these environment variables and redeploy:

   | Variable | Value |
   | --- | --- |
   | `OPENBLOG_GREETINGS_ENABLED` | `true` |
   | `OPENBLOG_GREETINGS_ADMIN_KEY` | A long random value (32 characters or more) |
   | `BREVO_API_KEY` | The Brevo API key |
   | `OPENBLOG_GREETINGS_FROM` | The verified sender, like `Grammi <grammi@example.com>` |
   | `OPENBLOG_GREETINGS_TIME_ZONE` | Your time zone, like `America/New_York` (the default) |
   | `OPENBLOG_SITE_NAME` | Optional: your site's name, shown at the foot of each card with a link |

   `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENBLOG_SITE_ID`, `OPENBLOG_SITE_ORIGIN` and
   `OPENBLOG_SITE_BASE_PATH` are the ones hosted comments already use.
4. Where Admin runs, set `OPENBLOG_GREETINGS_ENDPOINT` to `https://<your-netlify-site>/api/greetings` and
   `OPENBLOG_GREETINGS_ADMIN_KEY` to the same key, then restart Admin. **Greeting cards** appears in the menu.

The hourly sender (`greetings-send`) is a Netlify scheduled function; it does nothing until greeting cards
are switched on. To remove everything, export the two tables and run
[`supabase/greetings-rollback.sql`](../supabase/greetings-rollback.sql).
