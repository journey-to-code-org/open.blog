# Gifts under the tree

The family leaves the owner a note, or a card they make, from the public site. It stays wrapped
until midnight on December 25 in the owner's time zone, and she opens it in Studio's **Gifts**.
Optional and off unless set up.

## What a guest can send

A name (up to 40 characters); whether everyone who sees the tree, or only the owner, may see it's
from them; a note (up to 1,000 characters) or a card; and wrapping paper. A card is data from
fixed lists only: one of five designs, a message (up to 300), a sign-off (up to 40) and up to eight
stickers, each a kind from the list on a 0 to 100 grid. Nothing a guest writes is ever markup:
Studio and the site draw cards with `createElementNS` and `textContent`.

## Who sees what

- The tree shows wrapped boxes. A box shows who it's from only when the giver chose that **and**
  the owner's **Show who each gift is from on your tree** is on (the default).
- What a gift says is never public. The hosted function hands it over only to Admin's key, and only
  once it's open. The table itself refuses an opening before its time.
- Gifts are taken off the tree, never deleted. Whoever runs the database can read gifts; tell the
  family so.

## Keeping strangers out

A family password (`OPENBLOG_GIFTS_FAMILY_CODE`, at least 6 letters; case, spaces and punctuation
don't matter), a form token that must be a few seconds old, a field only robots fill, five gifts
an hour per visitor and 200 a season.

## Setting it up

1. Run [`supabase/gifts.sql`](../supabase/gifts.sql) (the hosted service does this itself).
2. Where the `gifts` function runs: `OPENBLOG_GIFTS_ENABLED=true`, `OPENBLOG_GIFTS_ADMIN_KEY` (32+
   random characters), `OPENBLOG_GIFTS_FAMILY_CODE`, plus the shared `SUPABASE_*`,
   `OPENBLOG_SITE_ID`, `OPENBLOG_SITE_ORIGIN`, `OPENBLOG_ANALYTICS_SALT` and
   `OPENBLOG_GREETINGS_TIME_ZONE`. `OPENBLOG_GIFTS_OPENS_ON` (`MM-DD`) moves the opening day, for a
   rehearsal only.
3. Where Admin runs: `OPENBLOG_GIFTS_ENDPOINT` (the function's `.../api/gifts` address) and the same
   `OPENBLOG_GIFTS_ADMIN_KEY`. Studio then shows **Gifts**.
4. A theme supplies the guest's form and the boxes under its tree (Grammi's House has
   `gift-maker` and `grammis-tree`), pointed at the public `.../api/gifts` address.

To undo it, [`supabase/gifts-rollback.sql`](../supabase/gifts-rollback.sql) removes every gift.
