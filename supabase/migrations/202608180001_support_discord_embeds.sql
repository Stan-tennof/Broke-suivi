alter table public.transactions
  add column discord_movement_index integer,
  add column discord_event_key text;

update public.transactions
set discord_movement_index = 0,
    discord_event_key = discord_message_id
where source = 'discord';

alter table public.transactions
  drop constraint transactions_discord_message_id_key;

alter table public.transactions
  add constraint transactions_discord_event_key_unique unique (discord_event_key),
  add constraint discord_event_key_required check (
    source <> 'discord' or discord_event_key is not null
  ),
  add constraint discord_movement_index_valid check (
    source <> 'discord' or discord_movement_index >= 0
  );

drop function public.ingest_discord_transaction(
  text, text, text, text, numeric, text, text, integer, text, timestamptz, text
);

create or replace function public.ingest_discord_transaction(
  p_message_id text,
  p_event_key text,
  p_movement_index integer,
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
  if p_action not in ('deposit', 'withdrawal') or p_quantity <= 0 or p_movement_index < 0 then
    raise exception 'Invalid Discord transaction';
  end if;

  insert into public.webhook_chests (webhook_id, canonical_name, detected_name, capacity_kg)
  values (p_webhook_id, p_chest_name, p_chest_name, p_capacity_kg)
  on conflict (webhook_id) do update
    set detected_name = excluded.detected_name,
        capacity_kg = coalesce(public.webhook_chests.capacity_kg, excluded.capacity_kg),
        updated_at = now();

  insert into public.transactions (
    discord_message_id, discord_event_key, discord_movement_index,
    discord_webhook_id, discord_channel_id, chest_name, player_name,
    action, quantity, signed_delta, item_name, discord_timestamp,
    raw_content, source
  ) values (
    p_message_id, p_event_key, p_movement_index,
    p_webhook_id, p_channel_id, p_chest_name, p_player_name,
    p_action, p_quantity,
    case when p_action = 'deposit' then p_quantity else -p_quantity end,
    p_item_name, p_discord_timestamp, p_raw_content, 'discord'
  ) on conflict (discord_event_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

revoke all on function public.ingest_discord_transaction(
  text, text, integer, text, text, text, numeric, text, text, integer, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.ingest_discord_transaction(
  text, text, integer, text, text, text, numeric, text, text, integer, text, timestamptz, text
) to service_role;

comment on column public.transactions.discord_event_key is
  'Unique movement key: message ID for content, or message ID plus embed index.';
comment on function public.reset_channel_history(text) is
  'Restarts a complete import without deleting transactions; unique event keys prevent duplicates.';
