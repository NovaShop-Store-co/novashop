-- Optional second-level product taxonomy used by the storefront filters.
alter table public.products
  add column if not exists subcategory text;

comment on column public.products.subcategory is
  'Optional subcategory label within the product main category. Stored per product for category filtering and navigation.';
