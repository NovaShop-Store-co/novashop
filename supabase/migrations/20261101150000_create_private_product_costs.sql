-- Store supplier costs separately from the public product catalog.
-- The table is intentionally unavailable to anon/authenticated Data API roles.
create table if not exists public.product_costs (
  product_id bigint primary key references public.products(id) on delete cascade,
  unit_cost_cop bigint not null check (unit_cost_cop >= 0 and unit_cost_cop <= 100000000),
  updated_at timestamptz not null default now()
);
alter table public.product_costs enable row level security;
revoke all on table public.product_costs from public, anon, authenticated;
grant select, insert, update, delete on table public.product_costs to service_role;
comment on table public.product_costs is
  'Private supplier cost per product unit. Managed only by the admin-products Edge Function; never expose to storefront roles.';
