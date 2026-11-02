-- One independently configurable product for the homepage hero.
alter table public.products
  add column if not exists is_homepage_featured boolean not null default false;

create unique index if not exists products_single_homepage_featured_idx
  on public.products (is_homepage_featured)
  where is_homepage_featured = true;

create or replace function public.set_homepage_featured_product(p_product_id integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_product_id is not null and not exists (
    select 1 from public.products
    where id = p_product_id and is_active = true
  ) then
    raise exception 'El producto seleccionado no existe o está oculto.'
      using errcode = 'P0002';
  end if;

  update public.products
  set is_homepage_featured = false,
      updated_at = now()
  where is_homepage_featured = true
    and (p_product_id is null or id <> p_product_id);

  if p_product_id is not null then
    update public.products
    set is_homepage_featured = true,
        updated_at = now()
    where id = p_product_id and is_active = true;
  end if;

  return p_product_id;
end;
$$;

revoke all on function public.set_homepage_featured_product(integer) from public, anon, authenticated;
grant execute on function public.set_homepage_featured_product(integer) to service_role;

comment on column public.products.is_homepage_featured is
  'Marks the single product used in the NovaShop homepage hero when no flash-sale carousel is active.';
