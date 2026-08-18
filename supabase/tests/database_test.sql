begin;

insert into public.discord_channels (channel_id, label)
values ('100', 'Test channel');

select public.ingest_discord_transaction(
  '1000', '1000:1', 1, '200', '100', 'Coffre 500kg', 500, 'Stan Broke',
  'deposit', 39, 'Fertilisant premium', now(), '**raw**'
);

do $$
declare inserted_again boolean;
begin
  select public.ingest_discord_transaction(
    '1000', '1000:1', 1, '200', '100', 'Coffre 500kg', 500, 'Stan Broke',
    'deposit', 39, 'Fertilisant premium', now(), '**raw**'
  ) into inserted_again;
  if inserted_again then raise exception 'Duplicate transaction was inserted'; end if;
  if (select count(*) from public.transactions where discord_message_id = '1000') <> 1 then
    raise exception 'Discord event key is not unique';
  end if;
  if (select quantity from public.inventory_global where item_name = 'Fertilisant premium') <> 39 then
    raise exception 'Global stock calculation failed';
  end if;
  if (select quantity from public.inventory_by_chest where webhook_id = '200' and item_name = 'Fertilisant premium') <> 39 then
    raise exception 'Chest stock calculation failed';
  end if;
end $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'admin@test.local', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.app_users (email, role) values ('admin@test.local', 'admin');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"admin@test.local","role":"authenticated"}';

select public.create_manual_adjustment('200', 'Fertilisant premium', -4, 'Correction de test');

do $$
begin
  if (select quantity from public.inventory_global where item_name = 'Fertilisant premium') <> 35 then
    raise exception 'Manual adjustment was not included in stock';
  end if;
  if not exists (
    select 1 from public.transactions
    where source = 'manual' and signed_delta = -4 and justification = 'Correction de test'
  ) then
    raise exception 'Manual adjustment audit record is incomplete';
  end if;
end $$;

select public.empty_chest('200', 'Coffre déclaré vide pendant le test');

do $$
begin
  if exists (select 1 from public.inventory_by_chest where webhook_id = '200') then
    raise exception 'Empty chest did not reset every balance to zero';
  end if;
  if not exists (
    select 1 from public.transactions
    where source = 'manual' and justification = 'Coffre déclaré vide pendant le test'
  ) then
    raise exception 'Empty chest adjustment audit record is missing';
  end if;
end $$;

rollback;
