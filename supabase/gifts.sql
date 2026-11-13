-- Gifts under the tree (Studio slice 3b). The family leaves a note or a little card under the
-- owner's tree; it stays wrapped until Christmas morning, when she opens it in Studio. Run once,
-- after openblog.sql (on Railway, service/migrate.sh runs it). Running it twice changes nothing.
-- To undo it, see gifts-rollback.sql.
--
-- Private by construction (as in greetings.sql): row level security is on with no policies, the
-- public roles have no access, and only the hosted function, signed in as service_role, reads and
-- writes. What a gift says is never public: the tree shows wrapped boxes, and a box shows who it's
-- from only if the giver chose that AND the owner shows names (openblog_gift_settings).
--
-- Gifts are taken off the tree (hidden_at), never deleted, so nothing a relative sent is lost by a
-- wrong tap.

begin;

create table if not exists public.openblog_gifts (
  id uuid primary key default gen_random_uuid(),
  site_id text not null check (site_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  from_name text not null check (char_length(from_name) between 1 and 40),
  -- The giver's choice: true shows their name on the tree, false shows it to the owner only.
  show_name boolean not null default false,
  kind text not null check (kind in ('note', 'card')),
  note text check (note is null or char_length(note) between 1 and 1000),
  -- A card is structured data only (a design, words and stickers from fixed lists), checked by the
  -- function: never HTML, never an upload.
  card jsonb check (card is null or (jsonb_typeof(card) = 'object' and pg_column_size(card) < 8192)),
  wrap text not null check (wrap in ('red', 'green', 'gold', 'blue', 'plaid', 'stripes')),
  opens_at timestamptz not null,
  opened_at timestamptz,
  hidden_at timestamptz,
  -- A daily digest of the giver's address with a secret salt, only to count gifts per visitor.
  sender_digest text not null check (char_length(sender_digest) = 64),
  created_at timestamptz not null default now(),
  constraint openblog_gift_has_contents check (
    (kind = 'note' and note is not null and card is null) or (kind = 'card' and card is not null and note is null)
  ),
  constraint openblog_gift_opens_on_time check (opened_at is null or opened_at >= opens_at)
);
create index if not exists openblog_gifts_tree on public.openblog_gifts (site_id, opens_at, created_at) where hidden_at is null;
create index if not exists openblog_gifts_sender on public.openblog_gifts (site_id, sender_digest, created_at);

create table if not exists public.openblog_gift_settings (
  site_id text primary key check (site_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- The owner's choice: show givers' names on the tree (only theirs who said yes).
  show_names boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.openblog_gifts enable row level security;
alter table public.openblog_gift_settings enable row level security;
revoke all on public.openblog_gifts, public.openblog_gift_settings from public, anon, authenticated;
grant select, insert, update on public.openblog_gifts to service_role;
grant select, insert, update on public.openblog_gift_settings to service_role;

commit;
