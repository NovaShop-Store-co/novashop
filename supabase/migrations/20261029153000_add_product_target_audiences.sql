alter table public.products
  add column if not exists target_audiences text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_target_audiences_allowed'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_target_audiences_allowed
      check (target_audiences <@ array['hombre','mujer']::text[]);
  end if;
end $$;

grant select (target_audiences) on table public.products to anon, authenticated;
create index if not exists products_target_audiences_idx
  on public.products using gin (target_audiences);
