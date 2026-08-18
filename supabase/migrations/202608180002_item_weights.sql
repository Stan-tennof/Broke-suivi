create table public.item_weights (
  item_name text primary key,
  weight_kg numeric check (weight_kg is null or weight_kg > 0),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.item_weights enable row level security;

create policy "authorized users can read item weights"
on public.item_weights for select to authenticated
using (public.is_authorized());

create policy "admins can create item weights"
on public.item_weights for insert to authenticated
with check (public.is_admin());

create policy "admins can update item weights"
on public.item_weights for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "admins can delete item weights"
on public.item_weights for delete to authenticated
using (public.is_admin());

grant select, insert, update, delete on public.item_weights to authenticated;

comment on table public.item_weights is
  'Manual item weight catalog in kilograms per inventory unit; NULL means pending.';
