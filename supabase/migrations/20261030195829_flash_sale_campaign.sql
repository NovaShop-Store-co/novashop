create table if not exists public.flash_sale_campaigns (
  id smallint primary key default 1 check (id = 1),
  title text not null default 'Ofertas relámpago',
  product_ids integer[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint flash_sale_campaigns_max_products check (cardinality(product_ids) <= 6)
);

alter table public.flash_sale_campaigns enable row level security;

grant select on public.flash_sale_campaigns to anon, authenticated;

drop policy if exists "Public can read active flash sale" on public.flash_sale_campaigns;
create policy "Public can read active flash sale"
on public.flash_sale_campaigns
for select
to anon, authenticated
using (is_active = true and starts_at <= now() and ends_at > now());

insert into public.flash_sale_campaigns (id, title, product_ids, starts_at, ends_at, is_active)
values (1, 'Ofertas relámpago', '{}'::integer[], now(), now() + interval '1 day', false)
on conflict (id) do nothing;
