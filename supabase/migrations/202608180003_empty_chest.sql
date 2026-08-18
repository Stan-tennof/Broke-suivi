create or replace function public.empty_chest(
  p_webhook_id text,
  p_justification text default 'Coffre déclaré vide'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  chest text;
  movement record;
  inserted_count integer := 0;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if length(trim(coalesce(p_justification, ''))) = 0 then raise exception 'Justification required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_webhook_id, 0));

  select canonical_name into chest
  from public.webhook_chests
  where webhook_id = p_webhook_id;
  if chest is null then raise exception 'Chest not found'; end if;

  for movement in
    select item_name, sum(signed_delta)::integer as current_quantity
    from public.transactions
    where discord_webhook_id = p_webhook_id
    group by item_name
    having sum(signed_delta) <> 0
  loop
    insert into public.transactions (
      discord_webhook_id, chest_name, player_name, action, quantity,
      signed_delta, item_name, discord_timestamp, source, justification, created_by
    ) values (
      p_webhook_id,
      chest,
      coalesce(auth.jwt() ->> 'email', 'admin'),
      'adjustment',
      abs(movement.current_quantity),
      -movement.current_quantity,
      movement.item_name,
      now(),
      'manual',
      trim(p_justification),
      auth.uid()
    );
    inserted_count := inserted_count + 1;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.empty_chest(text, text) from public, anon;
grant execute on function public.empty_chest(text, text) to authenticated;

comment on function public.empty_chest(text, text) is
  'Balances every non-zero item in a chest to zero using auditable manual adjustment transactions.';
