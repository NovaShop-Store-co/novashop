alter table public.flash_sale_campaigns
  add column if not exists sale_prices jsonb not null default '{}'::jsonb;

alter table public.flash_sale_campaigns
  drop constraint if exists flash_sale_campaigns_sale_prices_object;

alter table public.flash_sale_campaigns
  add constraint flash_sale_campaigns_sale_prices_object
  check (jsonb_typeof(sale_prices) = 'object');
