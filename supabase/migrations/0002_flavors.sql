-- =============================================================================
-- Flavors / varieties. Additive only: no existing data is changed or removed.
-- Run once in the Supabase SQL editor after 0001_init.sql.
--
-- A flavor is an ordinary product (own price, SKU, image, invoice line) that
-- shares a "product group" with its siblings. The catalog shows each group as
-- one card with flavor options.
-- =============================================================================

alter table public.products
  add column if not exists group_name   text check (group_name   is null or char_length(btrim(group_name))   between 1 and 200),
  add column if not exists variant_name text check (variant_name is null or char_length(btrim(variant_name)) between 1 and 120);

create index if not exists products_group_idx on public.products (lower(group_name)) where group_name is not null;

-- The same flavor can't appear twice in one group.
create unique index if not exists products_group_variant_key
  on public.products (lower(group_name), lower(variant_name))
  where group_name is not null and variant_name is not null;

-- Same pricing as before; the line name now includes the flavor so carts,
-- invoices and WhatsApp messages show exactly which variety was ordered.
create or replace function public.quote_items(p_items jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_settings    public.settings%rowtype;
  v_lines       jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_subtotal    bigint := 0;
  v_rate        numeric := 0;
  v_tax         bigint;
  r             record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ITEMS' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200 then
    raise exception 'INVALID_ITEMS' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(jsonb_typeof(e->'quantity'), '') <> 'number'
       or coalesce(e->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(e->>'quantity', '') !~ '^[1-9][0-9]{0,3}$'
  ) then
    raise exception 'INVALID_ITEMS' using errcode = 'P0001';
  end if;

  select * into v_settings from public.settings where id = 1;
  if v_settings.tax_enabled then v_rate := v_settings.tax_rate; end if;

  for r in
    with req as (
      select (e->>'product_id')::uuid as product_id,
             sum((e->>'quantity')::int) as quantity,
             min(ord) as first_pos
      from jsonb_array_elements(p_items) with ordinality as t(e, ord)
      group by 1
    )
    select req.product_id, req.quantity, req.first_pos,
           p.id is not null and p.published as available,
           case
             when p.variant_name is not null and strpos(lower(p.name), lower(p.variant_name)) = 0
               then p.name || ' — ' || p.variant_name
             else p.name
           end as name,
           p.sku, p.price_cents, p.image_path
    from req left join public.products p on p.id = req.product_id
    order by req.first_pos
  loop
    if not r.available then
      v_unavailable := v_unavailable || to_jsonb(r.product_id::text);
      continue;
    end if;
    if r.quantity > 9999 then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
    end if;
    v_lines := v_lines || jsonb_build_object(
      'product_id', r.product_id,
      'name', r.name,
      'sku', r.sku,
      'image_path', r.image_path,
      'unit_price_cents', r.price_cents,
      'quantity', r.quantity,
      'line_total_cents', r.price_cents::bigint * r.quantity
    );
    v_subtotal := v_subtotal + r.price_cents::bigint * r.quantity;
  end loop;

  v_tax := round(v_subtotal * v_rate / 100.0)::bigint;

  return jsonb_build_object(
    'lines', v_lines,
    'unavailable', v_unavailable,
    'currency', v_settings.currency,
    'subtotal_cents', v_subtotal,
    'tax_enabled', v_settings.tax_enabled,
    'tax_label', v_settings.tax_label,
    'tax_rate', v_rate,
    'tax_cents', v_tax,
    'total_cents', v_subtotal + v_tax
  );
end;
$$;

revoke execute on function public.quote_items(jsonb) from public, anon, authenticated;
grant  execute on function public.quote_items(jsonb) to service_role;
