-- =============================================================================
-- Out of stock: products and individual flavors can be marked out of stock.
-- Out-of-stock items stay visible in the catalog but can't be added to a cart,
-- and the server refuses them at checkout (quote_items / place_order).
-- Additive only; everything starts in stock.
-- =============================================================================
alter table public.products        add column if not exists in_stock boolean not null default true;
alter table public.product_flavors add column if not exists in_stock boolean not null default true;

-- Same pricing function as 0003, plus the stock checks.
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
  v_uuid        text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
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
       or coalesce(e->>'product_id', '') !~* v_uuid
       or (e ? 'flavor_id' and jsonb_typeof(e->'flavor_id') <> 'null' and coalesce(e->>'flavor_id', '') !~* v_uuid)
       or coalesce(e->>'quantity', '') !~ '^[1-9][0-9]{0,3}$'
  ) then
    raise exception 'INVALID_ITEMS' using errcode = 'P0001';
  end if;

  select * into v_settings from public.settings where id = 1;
  if v_settings.tax_enabled then v_rate := v_settings.tax_rate; end if;

  for r in
    with req as (
      select (e->>'product_id')::uuid as product_id,
             nullif(e->>'flavor_id', '')::uuid as flavor_id,
             sum((e->>'quantity')::int) as quantity,
             min(ord) as first_pos
      from jsonb_array_elements(p_items) with ordinality as t(e, ord)
      group by 1, 2
    )
    select req.product_id, req.flavor_id, req.quantity, req.first_pos,
           p.id is not null and p.published as product_ok,
           exists (select 1 from public.product_flavors pf where pf.product_id = req.product_id) as has_flavors,
           f.id as matched_flavor, f.name as flavor_name, f.image_path as flavor_image,
           coalesce(p.in_stock, false) as product_in_stock, coalesce(f.in_stock, true) as flavor_in_stock,
           case
             when p.variant_name is not null and strpos(lower(p.name), lower(p.variant_name)) = 0
               then p.name || ' — ' || p.variant_name
             else p.name
           end as name,
           p.sku, p.price_cents, p.image_path
    from req
    left join public.products p on p.id = req.product_id
    left join public.product_flavors f on f.id = req.flavor_id and f.product_id = req.product_id
    order by req.first_pos
  loop
    if not r.product_ok
       or (r.flavor_id is not null and r.matched_flavor is null)
       or (r.flavor_id is null and r.has_flavors)
       or not r.product_in_stock
       or not r.flavor_in_stock then
      v_unavailable := v_unavailable || jsonb_build_object(
        'product_id', r.product_id,
        'flavor_id', r.flavor_id,
        'reason', case
          when not r.product_ok then 'unavailable'
          when r.flavor_id is not null and r.matched_flavor is null then 'flavor_unavailable'
          when not r.product_in_stock then 'out_of_stock'
          when r.flavor_id is null then 'flavor_required'
          else 'flavor_out_of_stock' end
      );
      continue;
    end if;
    if r.quantity > 9999 then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
    end if;
    v_lines := v_lines || jsonb_build_object(
      'product_id', r.product_id,
      'flavor_id', r.flavor_id,
      'name', r.name,
      'flavor_name', r.flavor_name,
      'sku', r.sku,
      'image_path', coalesce(r.flavor_image, r.image_path),
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
