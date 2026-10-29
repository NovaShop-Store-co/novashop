-- The trusted Edge Functions need to maintain public variant rows and their private supplier references.
grant all on table public.product_variants to service_role;
grant usage, select, update on sequence public.product_variants_id_seq to service_role;
