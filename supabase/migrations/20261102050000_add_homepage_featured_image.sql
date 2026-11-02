-- Allow each product to use a separate image in the homepage featured-product showcase.
-- The product detail page continues to use public.products.images unchanged.
alter table public.products
  add column if not exists homepage_featured_image_url text;

comment on column public.products.homepage_featured_image_url is
  'Optional independent image URL used only in the NovaShop homepage featured-product hero; null falls back to the product catalog image.';
