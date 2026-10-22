-- =============================================================================
-- 0004 — Remember where an imported product image came from, so re-importing
-- the same CSV doesn't download the same image again. Additive only.
-- =============================================================================
alter table public.products
  add column if not exists image_source_url text
    check (image_source_url is null or (char_length(image_source_url) <= 2000 and image_source_url ~* '^https?://'));
