-- Keep Dropi identifiers in private tables, not the public catalog or customer-visible order_items.
create table if not exists public.product_supplier_refs (
  product_id integer primary key references public.products(id) on delete cascade,
  dropi_product_id text not null unique,
  updated_at timestamptz not null default now(),
  constraint product_supplier_refs_dropi_id_nonempty
    check (length(btrim(dropi_product_id)) between 1 and 100)
);

create table if not exists public.order_item_supplier_refs (
  order_item_id bigint primary key references public.order_items(id) on delete cascade,
  dropi_product_id text not null
    check (length(btrim(dropi_product_id)) between 1 and 100),
  created_at timestamptz not null default now()
);

alter table public.product_supplier_refs enable row level security;
alter table public.order_item_supplier_refs enable row level security;

revoke all on table public.product_supplier_refs from anon, authenticated;
revoke all on table public.order_item_supplier_refs from anon, authenticated;
grant all on table public.product_supplier_refs to service_role;
grant all on table public.order_item_supplier_refs to service_role;

create index if not exists product_supplier_refs_dropi_id_idx
  on public.product_supplier_refs(dropi_product_id);
create index if not exists order_item_supplier_refs_dropi_id_idx
  on public.order_item_supplier_refs(dropi_product_id);
