-- Persist the 12-hour HOT window for the manually featured homepage product.
alter table public.products
  add column if not exists homepage_featured_started_at timestamptz,
  add column if not exists homepage_featured_ends_at timestamptz;

-- Replace the original one-argument function so the administrator can
-- intentionally restart the 12-hour countdown when saving the selection.
drop function if exists public.set_homepage_featured_product(integer);

create or replace function public.set_homepage_featured_product(
  p_product_id integer,
  p_restart_timer boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_featured_id integer;
  has_discount boolean := false;
begin
  select id into current_featured_id
  from public.products
  where is_homepage_featured = true
  limit 1;

  if p_product_id is null then
    update public.products
    set is_homepage_featured = false,
        homepage_featured_started_at = null,
        homepage_featured_ends_at = null,
        updated_at = now()
    where is_homepage_featured = true
       or homepage_featured_started_at is not null
       or homepage_featured_ends_at is not null;
    return null;
  end if;

  if not exists (
    select 1 from public.products
    where id = p_product_id
      and is_active = true
      and category <> 'Streaming'
  ) then
    raise exception 'El producto seleccionado no existe, está oculto o no se puede destacar.'
      using errcode = 'P0002';
  end if;

  if current_featured_id = p_product_id and p_restart_timer is not true then
    return p_product_id;
  end if;

  update public.products
  set is_homepage_featured = false,
      homepage_featured_started_at = null,
      homepage_featured_ends_at = null,
      updated_at = now()
  where is_homepage_featured = true
    and id <> p_product_id;

  select (old_price_cop is not null and old_price_cop > price_cop)
    into has_discount
  from public.products
  where id = p_product_id;

  update public.products
  set is_homepage_featured = true,
      homepage_featured_started_at = case when has_discount then now() else null end,
      homepage_featured_ends_at = case when has_discount then now() + interval '12 hours' else null end,
      updated_at = now()
  where id = p_product_id
    and is_active = true;

  return p_product_id;
end;
$$;

revoke all on function public.set_homepage_featured_product(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.set_homepage_featured_product(integer, boolean)
  to service_role;

comment on column public.products.homepage_featured_started_at is
  'UTC timestamp when the 12-hour HOT window for the selected homepage product started.';
comment on column public.products.homepage_featured_ends_at is
  'UTC timestamp when the 12-hour HOT window for the selected homepage product ends.';

-- Keep the existing homepage selection (the Smartwatch shown on the current storefront)
-- and start its first 12-hour window if no administrator has selected another product yet.
do $$
begin
  if not exists (select 1 from public.products where is_homepage_featured = true) then
    if exists (
      select 1 from public.products
      where id = 1 and is_active = true and old_price_cop > price_cop
    ) then
      perform public.set_homepage_featured_product(1, true);
    end if;
  end if;
end;
$$;
