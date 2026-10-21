-- =============================================================================
-- Catalog & WhatsApp ordering — initial schema
-- Run once against your Supabase project (SQL editor, or `supabase db push`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Settings (single row). Readable by everyone: nothing in here is secret.
-- -----------------------------------------------------------------------------
create table public.settings (
  id                  smallint primary key default 1 check (id = 1),
  business_name       text not null default '' check (char_length(business_name) <= 120),
  logo_path           text,
  address             text not null default '' check (char_length(address) <= 500),
  whatsapp_number     text not null default '' check (whatsapp_number ~ '^[0-9]{0,15}$'),
  currency            text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  invoice_prefix      text not null default 'INV-' check (invoice_prefix ~ '^[A-Za-z0-9/_-]{0,12}$'),
  tax_enabled         boolean not null default false,
  tax_label           text not null default 'Tax' check (char_length(tax_label) between 1 and 40),
  tax_rate            numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  invoice_footer      text not null default 'Thank you for your order.' check (char_length(invoice_footer) <= 500),
  pickup_instructions text not null default '' check (char_length(pickup_instructions) <= 1000),
  retention_years     smallint not null default 7 check (retention_years between 1 and 50),
  updated_at          timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- Gapless invoice counter, kept apart from settings so it is never public.
create table public.invoice_counter (
  id        smallint primary key default 1 check (id = 1),
  next_seq  bigint not null default 1001 check (next_seq > 0)
);
insert into public.invoice_counter (id) values (1);

-- -----------------------------------------------------------------------------
-- Administrators (Supabase Auth users allowed into /admin)
-- -----------------------------------------------------------------------------
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- Products
-- -----------------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  price_cents integer not null check (price_cents between 0 and 100000000),
  sku         text check (sku is null or char_length(sku) between 1 and 64),
  description text check (description is null or char_length(description) <= 5000),
  category    text check (category is null or char_length(category) between 1 and 80),
  image_path  text,
  published   boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index products_sku_key on public.products (lower(sku)) where sku is not null;
create index products_catalog_idx on public.products (published, sort_order, name);

-- -----------------------------------------------------------------------------
-- Orders + immutable line-item snapshots
-- -----------------------------------------------------------------------------
create type public.order_status as enum ('new', 'preparing', 'ready_for_pickup', 'completed', 'cancelled');

create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  seq                  bigint not null unique,
  order_number         text not null unique,
  invoice_number       text not null unique,
  access_token         text not null check (access_token ~ '^[A-Za-z0-9_-]{32,128}$'),
  idempotency_key      uuid not null unique,
  business_name        text not null check (char_length(business_name) between 1 and 120),
  currency             text not null,
  subtotal_cents       bigint not null check (subtotal_cents >= 0),
  tax_label            text not null,
  tax_rate             numeric(6,3) not null,
  tax_cents            bigint not null check (tax_cents >= 0),
  total_cents          bigint not null check (total_cents = subtotal_cents + tax_cents),
  seller               jsonb not null,            -- business details as printed on the invoice
  status               public.order_status not null default 'new',
  status_updated_at    timestamptz not null default now(),
  invoice_path         text,
  invoice_generated_at timestamptz,
  whatsapp_status      text not null default 'pending'
                       check (whatsapp_status in ('pending','sending','not_configured','accepted','sent','delivered','read','failed')),
  whatsapp_message_id  text,
  whatsapp_error       text,
  whatsapp_attempts    integer not null default 0,
  whatsapp_updated_at  timestamptz,
  created_at           timestamptz not null default now()
);
create index orders_created_idx on public.orders (created_at desc);
create index orders_wa_msg_idx on public.orders (whatsapp_message_id) where whatsapp_message_id is not null;

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  position         integer not null,
  product_id       uuid references public.products (id) on delete set null,
  name             text not null,
  sku              text,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity         integer not null check (quantity between 1 and 9999),
  line_total_cents bigint not null check (line_total_cents = unit_price_cents::bigint * quantity),
  unique (order_id, position)
);

-- Per-client order counter for rate limiting (hashed, purged daily; not linked to orders).
create table public.order_attempts (
  client_hash text not null,
  created_at  timestamptz not null default now()
);
create index order_attempts_idx on public.order_attempts (client_hash, created_at);

-- -----------------------------------------------------------------------------
-- Immutability guards: what was invoiced can never change.
-- -----------------------------------------------------------------------------
create function public.guard_order_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.id, new.seq, new.order_number, new.invoice_number, new.access_token, new.idempotency_key,
      new.business_name, new.currency, new.subtotal_cents, new.tax_label, new.tax_rate, new.tax_cents,
      new.total_cents, new.seller, new.created_at)
     is distinct from
     (old.id, old.seq, old.order_number, old.invoice_number, old.access_token, old.idempotency_key,
      old.business_name, old.currency, old.subtotal_cents, old.tax_label, old.tax_rate, old.tax_cents,
      old.total_cents, old.seller, old.created_at) then
    raise exception 'ORDER_IMMUTABLE' using errcode = 'P0001';
  end if;
  if old.invoice_path is not null and new.invoice_path is distinct from old.invoice_path then
    raise exception 'INVOICE_IMMUTABLE' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    new.status_updated_at := now();
  end if;
  return new;
end;
$$;
create trigger orders_guard before update on public.orders
  for each row execute function public.guard_order_update();

create function public.guard_order_item_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Only the product link may change (set to null when a product is deleted).
  if (new.id, new.order_id, new.position, new.name, new.sku, new.unit_price_cents, new.quantity, new.line_total_cents)
     is distinct from
     (old.id, old.order_id, old.position, old.name, old.sku, old.unit_price_cents, old.quantity, old.line_total_cents) then
    raise exception 'ORDER_ITEM_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger order_items_guard before update on public.order_items
  for each row execute function public.guard_order_item_update();

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Pricing: the single source of truth for cart quotes and orders.
-- p_items: [{"product_id": "<uuid>", "quantity": <int>}, ...]
-- -----------------------------------------------------------------------------
create function public.quote_items(p_items jsonb)
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

  -- Validate shape before casting.
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
           p.name, p.sku, p.price_cents, p.image_path
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

  v_tax := round(v_subtotal * v_rate / 100.0)::bigint;   -- half away from zero

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

-- -----------------------------------------------------------------------------
-- Place an order atomically. Idempotent on p_idempotency_key.
-- p_expected_total_cents: what the customer saw; a mismatch aborts (PRICE_CHANGED).
-- -----------------------------------------------------------------------------
create function public.place_order(
  p_business_name        text,
  p_items                jsonb,
  p_idempotency_key      uuid,
  p_access_token         text,
  p_expected_total_cents bigint,
  p_client_hash          text default null,
  p_rate_limit           integer default 10,
  p_rate_window_minutes  integer default 10
)
returns table (order_id uuid, order_number text, access_token text, created boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_name     text;
  v_existing public.orders%rowtype;
  v_settings public.settings%rowtype;
  v_quote    jsonb;
  v_seq      bigint;
  v_id       uuid;
  v_count    integer;
  v_line     jsonb;
  v_pos      integer := 0;
begin
  if p_idempotency_key is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  -- Serialise order creation: guarantees gapless invoice numbers and
  -- makes the idempotency check below race-free.
  select c.next_seq into v_seq from public.invoice_counter c where c.id = 1 for update;

  select * into v_existing from public.orders o where o.idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing.id, v_existing.order_number, v_existing.access_token, false;
    return;
  end if;

  -- Business name: collapse whitespace, strip control characters.
  v_name := btrim(regexp_replace(regexp_replace(coalesce(p_business_name, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g'));
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'INVALID_BUSINESS_NAME' using errcode = 'P0001';
  end if;

  if p_client_hash is not null then
    delete from public.order_attempts a where a.created_at < now() - interval '1 day';
    select count(*) into v_count from public.order_attempts a
      where a.client_hash = p_client_hash
        and a.created_at > now() - make_interval(mins => p_rate_window_minutes);
    if v_count >= p_rate_limit then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
  end if;

  v_quote := public.quote_items(p_items);
  if jsonb_array_length(v_quote->'unavailable') > 0 then
    raise exception 'ITEMS_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_quote->'lines') = 0 then
    raise exception 'INVALID_ITEMS' using errcode = 'P0001';
  end if;
  if p_expected_total_cents is distinct from (v_quote->>'total_cents')::bigint then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001';
  end if;

  select * into v_settings from public.settings where id = 1;

  insert into public.orders (
    seq, order_number, invoice_number, access_token, idempotency_key, business_name, currency,
    subtotal_cents, tax_label, tax_rate, tax_cents, total_cents, seller
  ) values (
    v_seq,
    lpad(v_seq::text, 6, '0'),
    v_settings.invoice_prefix || lpad(v_seq::text, 6, '0'),
    p_access_token,
    p_idempotency_key,
    v_name,
    v_quote->>'currency',
    (v_quote->>'subtotal_cents')::bigint,
    v_quote->>'tax_label',
    (v_quote->>'tax_rate')::numeric,
    (v_quote->>'tax_cents')::bigint,
    (v_quote->>'total_cents')::bigint,
    jsonb_build_object(
      'business_name', v_settings.business_name,
      'address', v_settings.address,
      'logo_path', v_settings.logo_path,
      'invoice_footer', v_settings.invoice_footer,
      'pickup_instructions', v_settings.pickup_instructions,
      'tax_enabled', v_settings.tax_enabled
    )
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(v_quote->'lines') loop
    v_pos := v_pos + 1;
    insert into public.order_items (order_id, position, product_id, name, sku, unit_price_cents, quantity, line_total_cents)
    values (
      v_id, v_pos, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
      (v_line->>'unit_price_cents')::int, (v_line->>'quantity')::int, (v_line->>'line_total_cents')::bigint
    );
  end loop;

  update public.invoice_counter set next_seq = v_seq + 1 where id = 1;

  if p_client_hash is not null then
    insert into public.order_attempts (client_hash) values (p_client_hash);
  end if;

  return query select v_id, lpad(v_seq::text, 6, '0'), p_access_token, true;
end;
$$;

-- Atomically claim an order for a WhatsApp send (prevents double sends).
create function public.claim_whatsapp_send(p_order_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.orders o
     set whatsapp_status = 'sending',
         whatsapp_attempts = o.whatsapp_attempts + 1,
         whatsapp_updated_at = now()
   where o.id = p_order_id
     and (o.whatsapp_status in ('pending', 'failed', 'not_configured')
          or (o.whatsapp_status = 'sending' and o.whatsapp_updated_at < now() - interval '5 minutes'));
  return found;
end;
$$;

-- Manual, admin-initiated retention purge. Only finished orders past the
-- configured retention period are removed. Never runs automatically.
create function public.purge_expired_orders()
returns table (order_id uuid, invoice_path text)
language plpgsql security definer set search_path = ''
as $$
declare v_years smallint;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select s.retention_years into v_years from public.settings s where s.id = 1;
  return query
    delete from public.orders o
     where o.status in ('completed', 'cancelled')
       and o.created_at < now() - make_interval(years => v_years)
    returning o.id, o.invoice_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------
alter table public.settings        enable row level security;
alter table public.invoice_counter enable row level security;
alter table public.admins          enable row level security;
alter table public.products        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.order_attempts  enable row level security;

create policy settings_read   on public.settings for select to anon, authenticated using (true);
create policy settings_update on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy admins_self_read on public.admins for select to authenticated using (user_id = auth.uid());

create policy products_public_read on public.products for select to anon, authenticated using (published or public.is_admin());
create policy products_admin_insert on public.products for insert to authenticated with check (public.is_admin());
create policy products_admin_update on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy products_admin_delete on public.products for delete to authenticated using (public.is_admin());

create policy orders_admin_read   on public.orders for select to authenticated using (public.is_admin());
create policy orders_admin_update on public.orders for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy order_items_admin_read on public.order_items for select to authenticated using (public.is_admin());
-- No insert/delete policies on orders: orders are created only by place_order()
-- (server, service role) and removed only by purge_expired_orders().

-- -----------------------------------------------------------------------------
-- Function privileges: nothing callable from the browser except is_admin().
-- -----------------------------------------------------------------------------
revoke execute on function public.quote_items(jsonb) from public, anon, authenticated;
revoke execute on function public.place_order(text, jsonb, uuid, text, bigint, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.claim_whatsapp_send(uuid) from public, anon, authenticated;
revoke execute on function public.purge_expired_orders() from public, anon;
grant  execute on function public.quote_items(jsonb) to service_role;
grant  execute on function public.place_order(text, jsonb, uuid, text, bigint, text, integer, integer) to service_role;
grant  execute on function public.claim_whatsapp_send(uuid) to service_role;
grant  execute on function public.purge_expired_orders() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Storage buckets. All writes go through the server (service role) after an
-- admin check, so no storage policies are needed. Invoices are private.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images', 'product-images', true,  5242880,  array['image/jpeg','image/png','image/webp']),
  ('branding',       'branding',       true,  2097152,  array['image/jpeg','image/png']),
  ('invoices',       'invoices',       false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
