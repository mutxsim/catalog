-- =============================================================================
-- Two catalogs ("happy" and "vapes") and a brand for each product.
-- After logging in, customers pick a catalog; each catalog can be filtered by
-- brand and by category. Additive only: every existing product goes into the
-- "happy" catalog and starts with no brand.
-- =============================================================================
alter table public.products
  add column if not exists catalog text not null default 'happy';
alter table public.products
  add column if not exists brand text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_catalog_check') then
    alter table public.products
      add constraint products_catalog_check check (catalog in ('happy', 'vapes'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_brand_check') then
    alter table public.products
      add constraint products_brand_check check (brand is null or char_length(brand) between 1 and 80);
  end if;
end $$;

create index if not exists products_catalog_browse_idx
  on public.products (catalog, published, sort_order, name);
