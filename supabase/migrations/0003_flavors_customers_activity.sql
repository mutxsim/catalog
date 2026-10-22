-- =============================================================================
-- 0003 — Product flavors, customer access codes, sessions and login activity.
-- Additive: existing products, orders, invoices and settings are untouched.
-- Run once in the Supabase SQL editor after 0001 and 0002.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Flavors belong to one parent product (price and SKU come from the parent).
-- -----------------------------------------------------------------------------
create table public.product_flavors (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  image_path  text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index product_flavors_name_key on public.product_flavors (product_id, lower(btrim(name)));
create index product_flavors_product_idx on public.product_flavors (product_id, sort_order);
create trigger product_flavors_touch before update on public.product_flavors
  for each row execute function public.touch_updated_at();

alter table public.product_flavors enable row level security;
-- Flavors of published products are public (like the products themselves).
create policy product_flavors_public_read on public.product_flavors for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (p.published or public.is_admin())));
create policy product_flavors_admin_write on public.product_flavors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Order lines keep a snapshot of the flavor and image used at checkout.
-- -----------------------------------------------------------------------------
alter table public.order_items
  add column flavor_id   uuid references public.product_flavors (id) on delete set null,
  add column flavor_name text,
  add column image_path  text;

create or replace function public.guard_order_item_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Only the product/flavor links may change (set to null when deleted).
  if (new.id, new.order_id, new.position, new.name, new.sku, new.unit_price_cents, new.quantity, new.line_total_cents,
      new.flavor_name, new.image_path)
     is distinct from
     (old.id, old.order_id, old.position, old.name, old.sku, old.unit_price_cents, old.quantity, old.line_total_cents,
      old.flavor_name, old.image_path) then
    raise exception 'ORDER_ITEM_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Customers and access codes. Codes are stored only as SHA-256 hashes.
-- -----------------------------------------------------------------------------
alter table public.settings
  add column login_retention_days integer not null default 365 check (login_retention_days between 30 and 3650);

create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  active        boolean not null default true,
  code_hint     text,                       -- last 4 characters, for recognising a code
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index customers_name_key on public.customers (lower(btrim(name))) where deleted_at is null;
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

create table public.customer_codes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  code_hash   text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index customer_codes_customer_idx on public.customer_codes (customer_id);

create table public.customer_sessions (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  code_id      uuid not null references public.customer_codes (id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  ended_at     timestamptz,
  end_reason   text check (end_reason in ('logout', 'expired', 'deactivated', 'code_regenerated', 'deleted'))
);
create index customer_sessions_customer_idx on public.customer_sessions (customer_id, created_at desc);

create table public.login_events (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  customer_id     uuid references public.customers (id) on delete set null,
  session_id      uuid references public.customer_sessions (id) on delete set null,
  success         boolean not null,
  failure_reason  text check (failure_reason in ('invalid_code', 'revoked_code', 'inactive_account', 'deleted_account', 'rate_limited')),
  rate_limited    boolean not null default false,
  ip              text,
  city            text,
  region          text,
  country         text,
  device_type     text not null default 'unknown' check (device_type in ('desktop', 'mobile', 'tablet', 'unknown')),
  browser         text,
  browser_version text,
  os              text,
  user_agent      text check (user_agent is null or char_length(user_agent) <= 400)
);
create index login_events_created_idx on public.login_events (created_at desc);
create index login_events_customer_idx on public.login_events (customer_id, created_at desc);
create index login_events_ip_idx on public.login_events (ip, created_at desc);

-- Orders remember which customer placed them (kept if the customer is removed).
alter table public.orders add column customer_id uuid references public.customers (id) on delete set null;
create index orders_customer_idx on public.orders (customer_id);

-- Admin-only visibility. No insert/update/delete policies: every write goes
-- through the server (service role) after an admin or session check.
alter table public.customers         enable row level security;
alter table public.customer_codes    enable row level security;
alter table public.customer_sessions enable row level security;
alter table public.login_events      enable row level security;
create policy customers_admin_read on public.customers for select to authenticated using (public.is_admin());
create policy customer_sessions_admin_read on public.customer_sessions for select to authenticated using (public.is_admin());
create policy login_events_admin_read on public.login_events for select to authenticated using (public.is_admin());
-- customer_codes: no policies at all — hashes are never readable from a browser.

-- -----------------------------------------------------------------------------
-- Customer administration (called by the server after an admin check).
-- -----------------------------------------------------------------------------
create function public.create_customer(p_name text, p_code_hash text, p_code_hint text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.customers (name, code_hint) values (btrim(p_name), p_code_hint) returning id into v_id;
  insert into public.customer_codes (customer_id, code_hash) values (v_id, p_code_hash);
  return v_id;
end;
$$;

create function public.regenerate_customer_code(p_customer_id uuid, p_code_hash text, p_code_hint text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.deleted_at is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  update public.customer_codes set revoked_at = now() where customer_id = p_customer_id and revoked_at is null;
  insert into public.customer_codes (customer_id, code_hash) values (p_customer_id, p_code_hash);
  update public.customers set code_hint = p_code_hint where id = p_customer_id;
  update public.customer_sessions set ended_at = now(), end_reason = 'code_regenerated'
   where customer_id = p_customer_id and ended_at is null;
end;
$$;

create function public.set_customer_active(p_customer_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.customers set active = p_active where id = p_customer_id and deleted_at is null;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not p_active then
    update public.customer_sessions set ended_at = now(), end_reason = 'deactivated'
     where customer_id = p_customer_id and ended_at is null;
  end if;
end;
$$;

-- Soft delete: the account disappears from the list and loses access; orders,
-- invoices and login history are kept.
create function public.delete_customer(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.customers set deleted_at = now(), active = false where id = p_customer_id and deleted_at is null;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001'; end if;
  update public.customer_codes set revoked_at = now() where customer_id = p_customer_id and revoked_at is null;
  update public.customer_sessions set ended_at = now(), end_reason = 'deleted'
   where customer_id = p_customer_id and ended_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Login. Rate limited per IP; every attempt is recorded (never the code).
-- -----------------------------------------------------------------------------
create function public.customer_login(
  p_code_hash           text,
  p_session_hash        text,
  p_ip                  text,
  p_user_agent          text,
  p_device_type         text,
  p_browser             text,
  p_browser_version     text,
  p_os                  text,
  p_city                text,
  p_region              text,
  p_country             text,
  p_rate_limit          integer default 10,
  p_rate_window_minutes integer default 15,
  p_session_days        integer default 30
)
returns table (status text, customer_id uuid, session_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_failures integer;
  v_code     public.customer_codes%rowtype;
  v_customer public.customers%rowtype;
  v_reason   text;
  v_session  uuid;
  v_device   text := case when p_device_type in ('desktop', 'mobile', 'tablet') then p_device_type else 'unknown' end;
begin
  select count(*) into v_failures from public.login_events e
   where e.ip is not distinct from p_ip and not e.success and not e.rate_limited
     and e.created_at > now() - make_interval(mins => p_rate_window_minutes);

  if p_ip is not null and v_failures >= p_rate_limit then
    insert into public.login_events (success, failure_reason, rate_limited, ip, city, region, country, device_type, browser, browser_version, os, user_agent)
    values (false, 'rate_limited', true, p_ip, p_city, p_region, p_country, v_device, p_browser, p_browser_version, p_os, left(p_user_agent, 400));
    return query select 'rate_limited'::text, null::uuid, null::uuid;
    return;
  end if;

  select * into v_code from public.customer_codes c where c.code_hash = p_code_hash;
  if found then
    select * into v_customer from public.customers c where c.id = v_code.customer_id;
  end if;

  v_reason := case
    when v_code.id is null then 'invalid_code'
    when v_customer.deleted_at is not null then 'deleted_account'
    when v_code.revoked_at is not null then 'revoked_code'
    when not v_customer.active then 'inactive_account'
    else null
  end;

  if v_reason is not null then
    insert into public.login_events (customer_id, success, failure_reason, ip, city, region, country, device_type, browser, browser_version, os, user_agent)
    values (v_customer.id, false, v_reason, p_ip, p_city, p_region, p_country, v_device, p_browser, p_browser_version, p_os, left(p_user_agent, 400));
    -- A deleted account looks the same as an unknown code to the visitor.
    return query select (case when v_reason = 'deleted_account' then 'invalid_code' else v_reason end), null::uuid, null::uuid;
    return;
  end if;

  insert into public.customer_sessions (customer_id, code_id, token_hash, expires_at)
  values (v_customer.id, v_code.id, p_session_hash, now() + make_interval(days => p_session_days))
  returning id into v_session;

  insert into public.login_events (customer_id, session_id, success, ip, city, region, country, device_type, browser, browser_version, os, user_agent)
  values (v_customer.id, v_session, true, p_ip, p_city, p_region, p_country, v_device, p_browser, p_browser_version, p_os, left(p_user_agent, 400));

  update public.customers set last_login_at = now() where id = v_customer.id;
  return query select 'ok'::text, v_customer.id, v_session;
end;
$$;

-- Validate a session cookie on every customer request.
create function public.customer_session(p_session_hash text, p_idle_days integer default 7)
returns table (status text, session_id uuid, customer_id uuid, customer_name text)
language plpgsql security definer set search_path = ''
as $$
declare
  s public.customer_sessions%rowtype;
  c public.customers%rowtype;
  v_revoked timestamptz;
begin
  select * into s from public.customer_sessions x where x.token_hash = p_session_hash;
  if not found then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text; return;
  end if;
  select * into c from public.customers x where x.id = s.customer_id;
  select k.revoked_at into v_revoked from public.customer_codes k where k.id = s.code_id;

  if s.ended_at is not null then
    return query select (case when s.end_reason = 'expired' then 'expired' else 'ended' end), s.id, s.customer_id, null::text; return;
  end if;
  if c.deleted_at is not null or not c.active then
    update public.customer_sessions set ended_at = now(), end_reason = case when c.deleted_at is not null then 'deleted' else 'deactivated' end where id = s.id;
    return query select 'ended'::text, s.id, s.customer_id, null::text; return;
  end if;
  if v_revoked is not null then
    update public.customer_sessions set ended_at = now(), end_reason = 'code_regenerated' where id = s.id;
    return query select 'ended'::text, s.id, s.customer_id, null::text; return;
  end if;
  if s.expires_at <= now() or s.last_seen_at <= now() - make_interval(days => p_idle_days) then
    -- End time is when the session lapsed, not when we noticed.
    update public.customer_sessions
       set ended_at = least(s.expires_at, s.last_seen_at + make_interval(days => p_idle_days)), end_reason = 'expired'
     where id = s.id;
    return query select 'expired'::text, s.id, s.customer_id, null::text; return;
  end if;

  if s.last_seen_at < now() - interval '5 minutes' then
    update public.customer_sessions set last_seen_at = now() where id = s.id;
  end if;
  return query select 'active'::text, s.id, s.customer_id, c.name;
end;
$$;

create function public.customer_logout(p_session_hash text)
returns void
language sql security definer set search_path = ''
as $$
  update public.customer_sessions set ended_at = now(), end_reason = 'logout'
   where token_hash = p_session_hash and ended_at is null;
$$;

-- Manual retention purge for login records (admin-initiated, never automatic).
create function public.purge_old_login_events()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_days integer; v_count integer;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select s.login_retention_days into v_days from public.settings s where s.id = 1;
  delete from public.login_events where created_at < now() - make_interval(days => v_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Summary numbers for the Login Activity page, computed from stored records.
create function public.login_activity_summary(
  p_from         timestamptz default null,
  p_to           timestamptz default null,
  p_customer_ids uuid[] default null,
  p_device       text default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'successes',        count(*) filter (where e.success),
    'unique_customers', count(distinct e.customer_id) filter (where e.success),
    'last_success_at',  max(e.created_at) filter (where e.success),
    'failures',         count(*) filter (where not e.success)
  ) into v
  from public.login_events e
  where (p_from is null or e.created_at >= p_from)
    and (p_to is null or e.created_at < p_to)
    and (p_customer_ids is null or e.customer_id = any (p_customer_ids))
    and (p_device is null or e.device_type = p_device);
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Pricing with flavors. p_items: [{"product_id", "flavor_id" (or null), "quantity"}]
-- Same product in two flavors = two lines.
-- -----------------------------------------------------------------------------
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
       or (r.flavor_id is null and r.has_flavors) then
      v_unavailable := v_unavailable || jsonb_build_object(
        'product_id', r.product_id,
        'flavor_id', r.flavor_id,
        'reason', case
          when not r.product_ok then 'unavailable'
          when r.flavor_id is null then 'flavor_required'
          else 'flavor_unavailable' end
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

-- place_order gains the customer link and the flavor/image snapshot.
drop function public.place_order(text, jsonb, uuid, text, bigint, text, integer, integer);

create function public.place_order(
  p_business_name        text,
  p_items                jsonb,
  p_idempotency_key      uuid,
  p_access_token         text,
  p_expected_total_cents bigint,
  p_client_hash          text default null,
  p_rate_limit           integer default 10,
  p_rate_window_minutes  integer default 10,
  p_customer_id          uuid default null
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

  select c.next_seq into v_seq from public.invoice_counter c where c.id = 1 for update;

  select * into v_existing from public.orders o where o.idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing.id, v_existing.order_number, v_existing.access_token, false;
    return;
  end if;

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
    subtotal_cents, tax_label, tax_rate, tax_cents, total_cents, seller, customer_id
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
    ),
    p_customer_id
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(v_quote->'lines') loop
    v_pos := v_pos + 1;
    insert into public.order_items (order_id, position, product_id, flavor_id, name, flavor_name, sku, image_path, unit_price_cents, quantity, line_total_cents)
    values (
      v_id, v_pos, (v_line->>'product_id')::uuid, nullif(v_line->>'flavor_id', '')::uuid, v_line->>'name', v_line->>'flavor_name',
      v_line->>'sku', v_line->>'image_path',
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

-- -----------------------------------------------------------------------------
-- Privileges: server (service role) only.
-- -----------------------------------------------------------------------------
revoke execute on function public.quote_items(jsonb) from public, anon, authenticated;
revoke execute on function public.place_order(text, jsonb, uuid, text, bigint, text, integer, integer, uuid) from public, anon, authenticated;
revoke execute on function public.create_customer(text, text, text) from public, anon, authenticated;
revoke execute on function public.regenerate_customer_code(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.set_customer_active(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.delete_customer(uuid) from public, anon, authenticated;
revoke execute on function public.customer_login(text, text, text, text, text, text, text, text, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.customer_session(text, integer) from public, anon, authenticated;
revoke execute on function public.customer_logout(text) from public, anon, authenticated;
revoke execute on function public.purge_old_login_events() from public, anon;
revoke execute on function public.login_activity_summary(timestamptz, timestamptz, uuid[], text) from public, anon;

grant execute on function public.quote_items(jsonb) to service_role;
grant execute on function public.place_order(text, jsonb, uuid, text, bigint, text, integer, integer, uuid) to service_role;
grant execute on function public.create_customer(text, text, text) to service_role;
grant execute on function public.regenerate_customer_code(uuid, text, text) to service_role;
grant execute on function public.set_customer_active(uuid, boolean) to service_role;
grant execute on function public.delete_customer(uuid) to service_role;
grant execute on function public.customer_login(text, text, text, text, text, text, text, text, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.customer_session(text, integer) to service_role;
grant execute on function public.customer_logout(text) to service_role;
grant execute on function public.purge_old_login_events() to authenticated, service_role;
grant execute on function public.login_activity_summary(timestamptz, timestamptz, uuid[], text) to authenticated, service_role;
