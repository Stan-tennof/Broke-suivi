create extension if not exists pgcrypto;

create table public.app_users (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('viewer', 'admin')) default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.discord_channels (
  channel_id text primary key check (channel_id ~ '^[0-9]+$'),
  label text not null,
  active boolean not null default true,
  last_message_id text check (last_message_id is null or last_message_id ~ '^[0-9]+$'),
  initial_sync_completed boolean not null default false,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_chests (
  webhook_id text primary key check (webhook_id ~ '^[0-9]+$'),
  canonical_name text not null,
  detected_name text not null,
  capacity_kg numeric check (capacity_kg is null or capacity_kg > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id bigint generated always as identity primary key,
  discord_message_id text unique check (
    discord_message_id is null or discord_message_id ~ '^[0-9]+$'
  ),
  discord_webhook_id text references public.webhook_chests(webhook_id),
  discord_channel_id text references public.discord_channels(channel_id),
  chest_name text not null,
  player_name text not null,
  action text not null check (action in ('deposit', 'withdrawal', 'adjustment')),
  quantity integer not null check (quantity > 0),
  signed_delta integer not null check (signed_delta <> 0),
  item_name text not null,
  discord_timestamp timestamptz,
  raw_content text,
  source text not null check (source in ('discord', 'manual')),
  justification text,
  created_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  constraint transaction_sign_matches_action check (
    (action = 'deposit' and signed_delta = quantity)
    or (action = 'withdrawal' and signed_delta = -quantity)
    or (action = 'adjustment' and abs(signed_delta) = quantity)
  ),
  constraint manual_adjustment_has_reason check (
    source <> 'manual' or (action = 'adjustment' and length(trim(justification)) > 0)
  ),
  constraint discord_transaction_has_ids check (
    source <> 'discord' or (
      discord_message_id is not null
      and discord_webhook_id is not null
      and discord_channel_id is not null
      and discord_timestamp is not null
    )
  )
);

create table public.sync_runs (
  id bigint generated always as identity primary key,
  trigger_type text not null check (trigger_type in ('cron', 'manual', 'historical')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  inspected integer not null default 0,
  imported integer not null default 0,
  duplicates integer not null default 0,
  ignored integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  requested_by uuid references auth.users(id)
);

create index transactions_timestamp_idx on public.transactions (discord_timestamp desc, id desc);
create index transactions_player_idx on public.transactions (player_name);
create index transactions_item_idx on public.transactions (item_name);
create index transactions_webhook_idx on public.transactions (discord_webhook_id);

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.app_users
  where email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and active
$$;

create or replace function public.is_authorized()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('viewer', 'admin')
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'admin'
$$;

alter table public.app_users enable row level security;
alter table public.discord_channels enable row level security;
alter table public.webhook_chests enable row level security;
alter table public.transactions enable row level security;
alter table public.sync_runs enable row level security;

create policy "authorized users can see their access"
on public.app_users for select to authenticated
using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin());

create policy "authorized users can read channels"
on public.discord_channels for select to authenticated using (public.is_authorized());
create policy "admins can manage channels"
on public.discord_channels for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "authorized users can read chests"
on public.webhook_chests for select to authenticated using (public.is_authorized());
create policy "admins can manage chests"
on public.webhook_chests for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "authorized users can read transactions"
on public.transactions for select to authenticated using (public.is_authorized());

create policy "authorized users can read sync runs"
on public.sync_runs for select to authenticated using (public.is_authorized());

create or replace function public.ingest_discord_transaction(
  p_message_id text,
  p_webhook_id text,
  p_channel_id text,
  p_chest_name text,
  p_capacity_kg numeric,
  p_player_name text,
  p_action text,
  p_quantity integer,
  p_item_name text,
  p_discord_timestamp timestamptz,
  p_raw_content text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if p_action not in ('deposit', 'withdrawal') or p_quantity <= 0 then
    raise exception 'Invalid Discord transaction';
  end if;

  insert into public.webhook_chests (webhook_id, canonical_name, detected_name, capacity_kg)
  values (p_webhook_id, p_chest_name, p_chest_name, p_capacity_kg)
  on conflict (webhook_id) do update
    set detected_name = excluded.detected_name,
        capacity_kg = coalesce(public.webhook_chests.capacity_kg, excluded.capacity_kg),
        updated_at = now();

  insert into public.transactions (
    discord_message_id, discord_webhook_id, discord_channel_id, chest_name,
    player_name, action, quantity, signed_delta, item_name,
    discord_timestamp, raw_content, source
  ) values (
    p_message_id, p_webhook_id, p_channel_id, p_chest_name,
    p_player_name, p_action, p_quantity,
    case when p_action = 'deposit' then p_quantity else -p_quantity end,
    p_item_name, p_discord_timestamp, p_raw_content, 'discord'
  ) on conflict (discord_message_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function public.create_manual_adjustment(
  p_webhook_id text,
  p_item_name text,
  p_delta integer,
  p_justification text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
  chest text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_delta = 0 then raise exception 'Adjustment must be non-zero'; end if;
  if length(trim(coalesce(p_justification, ''))) = 0 then raise exception 'Justification required'; end if;

  select canonical_name into chest
  from public.webhook_chests where webhook_id = p_webhook_id and active;
  if chest is null then raise exception 'Active chest not found'; end if;

  insert into public.transactions (
    discord_webhook_id, chest_name, player_name, action, quantity,
    signed_delta, item_name, discord_timestamp, source, justification, created_by
  ) values (
    p_webhook_id, chest, coalesce(auth.jwt() ->> 'email', 'admin'), 'adjustment',
    abs(p_delta), p_delta, trim(p_item_name), now(), 'manual', trim(p_justification), auth.uid()
  ) returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.reset_channel_history(p_channel_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.discord_channels
  set last_message_id = null, initial_sync_completed = false, updated_at = now()
  where channel_id = p_channel_id;
  if not found then raise exception 'Channel not found'; end if;
end;
$$;

revoke all on function public.ingest_discord_transaction(text,text,text,text,numeric,text,text,integer,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.ingest_discord_transaction(text,text,text,text,numeric,text,text,integer,text,timestamptz,text) to service_role;
revoke all on function public.create_manual_adjustment(text,text,integer,text) from public, anon;
grant execute on function public.create_manual_adjustment(text,text,integer,text) to authenticated;
revoke all on function public.reset_channel_history(text) from public, anon;
grant execute on function public.reset_channel_history(text) to authenticated;

create view public.inventory_global
with (security_invoker = true)
as
select item_name, sum(signed_delta)::bigint as quantity
from public.transactions
group by item_name
having sum(signed_delta) <> 0;

create view public.inventory_by_chest
with (security_invoker = true)
as
select
  t.discord_webhook_id as webhook_id,
  coalesce(w.canonical_name, t.chest_name) as chest_name,
  w.capacity_kg,
  t.item_name,
  sum(t.signed_delta)::bigint as quantity,
  max(t.discord_timestamp) as last_movement_at
from public.transactions t
left join public.webhook_chests w on w.webhook_id = t.discord_webhook_id
group by t.discord_webhook_id, coalesce(w.canonical_name, t.chest_name), w.capacity_kg, t.item_name
having sum(t.signed_delta) <> 0;

create view public.player_activity
with (security_invoker = true)
as
select
  player_name,
  sum(case when signed_delta > 0 then signed_delta else 0 end)::bigint as deposited,
  abs(sum(case when signed_delta < 0 then signed_delta else 0 end))::bigint as withdrawn,
  count(*)::bigint as movement_count,
  max(discord_timestamp) as last_movement_at
from public.transactions
where source = 'discord'
group by player_name;

grant select on public.inventory_global, public.inventory_by_chest, public.player_activity to authenticated;
grant select on public.app_users, public.discord_channels, public.webhook_chests, public.transactions, public.sync_runs to authenticated;
grant update on public.discord_channels, public.webhook_chests to authenticated;

comment on table public.app_users is 'Email allow-list for dashboard access and administration.';
comment on function public.reset_channel_history(text) is 'Restarts a complete import without deleting transactions; UNIQUE message IDs prevent duplicates.';
