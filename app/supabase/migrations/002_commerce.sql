-- ===========================================================================
-- 002_commerce.sql — commerce / affiliate data layer
-- ===========================================================================
-- The same DDL as the "COMMERCE / AFFILIATE" section of supabase/schema.sql,
-- rewritten so it can be applied to an already-deployed project and re-run
-- safely. schema.sql is the readable source of truth (and what a brand-new
-- project gets); this file is what you actually run against staging/prod.
-- Keep the two in sync: if you change one, change the other.
--
-- Every statement below is guarded — `if not exists`, or a do-block that
-- swallows the "already there" error. That means a partial failure halfway
-- through can be fixed and the whole file re-applied, rather than leaving
-- the database in a state only a human can reason about.
-- ===========================================================================

-- --- Enums ----------------------------------------------------------------
-- `create type` has no `if not exists` form, so each one is wrapped in a
-- do-block that catches duplicate_object. Note this only makes *creation*
-- idempotent: adding a value to an existing enum later needs its own
-- `alter type ... add value if not exists` migration.
do $$ begin
  create type affiliate_network as enum
    ('direct','rakuten','cj','impact','shopstyle','awin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type brand_status as enum ('pending','active','paused');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type conversion_status as enum ('pending','approved','reversed','paid');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type click_source as enum ('shop','tryon','outfit','wishlist','share');
exception when duplicate_object then null;
end $$;

-- --- brands ---------------------------------------------------------------
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  tagline text,
  description text,
  logo_url text,
  website_url text,
  network affiliate_network not null default 'direct',
  commission_rate_bps integer not null default 1000
    check (commission_rate_bps between 0 and 10000),
  affiliate_url_template text,
  status brand_status not null default 'pending',
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Column-level guards for a `brands` table that predates this migration.
-- Harmless no-ops on a table just created above.
alter table public.brands add column if not exists tagline text;
alter table public.brands add column if not exists description text;
alter table public.brands add column if not exists logo_url text;
alter table public.brands add column if not exists website_url text;
alter table public.brands add column if not exists affiliate_url_template text;
alter table public.brands add column if not exists contact_email text;
alter table public.brands
  add column if not exists updated_at timestamptz not null default now();

create index if not exists brands_status_idx on public.brands(status);

-- --- brand_products -------------------------------------------------------
-- Flattens a product's searchable text for the `search_tsv` generated column.
-- Needed because `array_to_string()` is declared STABLE (its volatility must
-- cover every element type `anyarray` could hold) and a generated column may
-- only call IMMUTABLE functions — referencing it directly fails with
-- "generation expression is not immutable". For text[] the operation really
-- is immutable; re-declaring that here keeps search_tsv a generated column
-- rather than a trigger-maintained one that can fall behind.
--
-- Must be created before the table that references it. `create or replace`
-- makes it idempotent, but note Postgres will not let the signature or
-- volatility change while a generated column depends on it — a future change
-- needs a drop-column/re-add migration.
create or replace function public.selv_product_search_text(
  p_name text,
  p_description text,
  p_tags text[]
) returns text
language sql immutable parallel safe
-- Pinned empty search_path (Supabase's linter flags functions without one).
-- pg_catalog is always implicitly searched, so the builtins still resolve.
set search_path = ''
as $$
  select coalesce(p_name, '') || ' ' ||
         coalesce(p_description, '') || ' ' ||
         coalesce(pg_catalog.array_to_string(p_tags, ' '), '')
$$;

create table if not exists public.brand_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  external_id text not null,
  name text not null,
  description text,
  category garment_category not null,
  color text,
  price_cents integer not null check (price_cents >= 0),
  sale_price_cents integer check (sale_price_cents >= 0),
  currency text not null default 'USD',
  image_url text not null,
  extra_image_urls text[] not null default '{}',
  tryon_image_url text,
  template_id uuid references public.garment_templates(id) on delete set null,
  product_url text not null,
  commission_rate_bps integer check (commission_rate_bps between 0 and 10000),
  sizes text[] not null default '{}',
  tags text[] not null default '{}',
  in_stock boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    to_tsvector(
      'english',
      public.selv_product_search_text(name, description, tags)
    )
  ) stored,
  constraint brand_products_brand_external_key unique (brand_id, external_id)
);

alter table public.brand_products add column if not exists description text;
alter table public.brand_products add column if not exists color text;
alter table public.brand_products
  add column if not exists sale_price_cents integer;
alter table public.brand_products
  add column if not exists extra_image_urls text[] not null default '{}';
alter table public.brand_products add column if not exists tryon_image_url text;
alter table public.brand_products add column if not exists template_id uuid;
alter table public.brand_products
  add column if not exists commission_rate_bps integer;
alter table public.brand_products
  add column if not exists sizes text[] not null default '{}';
alter table public.brand_products
  add column if not exists tags text[] not null default '{}';
alter table public.brand_products
  add column if not exists in_stock boolean not null default true;
alter table public.brand_products
  add column if not exists is_active boolean not null default true;
alter table public.brand_products
  add column if not exists updated_at timestamptz not null default now();
-- Generated columns support `add column if not exists` too, so an older
-- deployment that predates full-text search picks up search_tsv here and
-- Postgres backfills it for every existing row.
alter table public.brand_products
  add column if not exists search_tsv tsvector generated always as (
    to_tsvector(
      'english',
      public.selv_product_search_text(name, description, tags)
    )
  ) stored;

-- The catalog-sync upsert target. Added by name so re-running cannot create
-- a second, redundant unique index alongside the one the create-table above
-- may already have made.
do $$ begin
  alter table public.brand_products
    add constraint brand_products_brand_external_key unique (brand_id, external_id);
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

create index if not exists brand_products_brand_id_idx
  on public.brand_products(brand_id);
create index if not exists brand_products_category_idx
  on public.brand_products(category) where is_active;
create index if not exists brand_products_active_created_idx
  on public.brand_products(is_active, created_at desc);
create index if not exists brand_products_search_idx
  on public.brand_products using gin(search_tsv);

-- --- affiliate_clicks -----------------------------------------------------
create table if not exists public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  click_token text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  product_id uuid not null references public.brand_products(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  source click_source not null default 'shop',
  commission_rate_bps integer not null,
  price_cents_at_click integer not null,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_clicks_user_idx
  on public.affiliate_clicks(user_id, created_at desc);
create index if not exists affiliate_clicks_product_idx
  on public.affiliate_clicks(product_id);
create index if not exists affiliate_clicks_brand_idx
  on public.affiliate_clicks(brand_id, created_at desc);

-- --- affiliate_conversions ------------------------------------------------
create table if not exists public.affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  click_id uuid references public.affiliate_clicks(id) on delete set null,
  click_token text,
  user_id uuid references auth.users(id) on delete set null,
  brand_id uuid not null references public.brands(id) on delete cascade,
  product_id uuid references public.brand_products(id) on delete set null,
  network affiliate_network not null default 'direct',
  network_order_id text not null,
  order_total_cents integer not null check (order_total_cents >= 0),
  currency text not null default 'USD',
  commission_rate_bps integer not null,
  commission_cents integer not null check (commission_cents >= 0),
  status conversion_status not null default 'pending',
  occurred_at timestamptz not null default now(),
  confirmed_at timestamptz,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint affiliate_conversions_network_order_key
    unique (network, network_order_id)
);

-- The postback idempotency key. Same reasoning as brand_products above: add
-- it by name so a pre-existing table gains it and a fresh one doesn't get a
-- duplicate.
do $$ begin
  alter table public.affiliate_conversions
    add constraint affiliate_conversions_network_order_key
    unique (network, network_order_id);
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

create index if not exists affiliate_conversions_user_idx
  on public.affiliate_conversions(user_id, occurred_at desc);
create index if not exists affiliate_conversions_brand_idx
  on public.affiliate_conversions(brand_id, occurred_at desc);
create index if not exists affiliate_conversions_click_token_idx
  on public.affiliate_conversions(click_token);

-- --- wishlist_items / product_try_ons ------------------------------------
create table if not exists public.wishlist_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.brand_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists wishlist_items_product_idx
  on public.wishlist_items(product_id);

create table if not exists public.product_try_ons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.brand_products(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists product_try_ons_user_idx
  on public.product_try_ons(user_id, created_at desc);
create index if not exists product_try_ons_product_idx
  on public.product_try_ons(product_id, created_at desc);

-- --- brand_api_keys -------------------------------------------------------
create table if not exists public.brand_api_keys (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  label text not null,
  key_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists brand_api_keys_brand_idx
  on public.brand_api_keys(brand_id);

-- --- updated_at triggers --------------------------------------------------
-- public.set_updated_at() already exists from the base schema; recreate it
-- defensively so this migration also applies to a project provisioned before
-- that function landed.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();

drop trigger if exists brand_products_set_updated_at on public.brand_products;
create trigger brand_products_set_updated_at
  before update on public.brand_products
  for each row execute function public.set_updated_at();

-- --- garments: catalog-sourced items --------------------------------------
-- A garment saved from the Shop has no object in our private storage bucket,
-- so image_path becomes optional and image_url (a partner CDN url) carries
-- the imagery instead. `drop not null` is naturally idempotent.
alter table public.garments alter column image_path drop not null;
alter table public.garments add column if not exists product_id uuid;
alter table public.garments add column if not exists image_url text;

-- The FK is added separately from the column so re-running doesn't try to
-- create it twice; add_column_if_not_exists can't carry a named constraint.
do $$ begin
  alter table public.garments
    add constraint garments_product_id_fkey
    foreign key (product_id) references public.brand_products(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- Exactly one imagery source must always be present. Dropped-then-added so a
-- re-run replaces the definition rather than failing on the existing name.
alter table public.garments drop constraint if exists garments_image_present;
alter table public.garments
  add constraint garments_image_present
  check (image_path is not null or image_url is not null);

create unique index if not exists garments_user_product_uidx
  on public.garments(user_id, product_id)
  where product_id is not null;

-- --- RLS ------------------------------------------------------------------
-- `enable row level security` is idempotent. Policies are not, so each is
-- dropped by name first — that also makes this file the way to *edit* a
-- commerce policy: change it here and re-apply.
alter table public.brands enable row level security;
alter table public.brand_products enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_conversions enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.product_try_ons enable row level security;
alter table public.brand_api_keys enable row level security;

drop policy if exists "public active brands" on public.brands;
create policy "public active brands" on public.brands
  for select using (status = 'active');

drop policy if exists "public active brand products" on public.brand_products;
create policy "public active brand products" on public.brand_products
  for select using (
    is_active
    and exists (select 1 from public.brands b
                where b.id = brand_id and b.status = 'active')
  );

-- NO INSERT POLICY ON affiliate_clicks — this is deliberate. Do not add one.
--
-- This migration originally created an insert policy here whose only check
-- was `user_id = auth.uid()`. That constrained who the row belonged to but
-- nothing about its contents, and an affiliate_clicks row carries
-- `commission_rate_bps` and `price_cents_at_click` — the snapshot the
-- postback function trusts when it values a completed sale. Any authenticated
-- user holding the anon key could therefore insert a click at 10000 bps
-- (100%) against any product and then buy it for real, and we would invoice
-- the brand partner for the entire order value. The attacker gains nothing
-- personally, which is exactly why it survived review; the damage is that our
-- commission ledger becomes forgeable by our own users, and over-billing a
-- partner is the fastest possible way to lose them.
--
-- 003_affiliate_click_rpc.sql drops that policy and moves click creation into
-- public.create_affiliate_click(), a security-definer function that resolves
-- the rate, the price, the brand and the token server-side from
-- brand_products/brands. The policy is removed here as well so that
-- re-running 002 by hand — out of order, or to rebuild a scratch database —
-- cannot silently reopen the hole. Clients get select-own only.
--
-- If an insert into affiliate_clicks is failing with an RLS error, the call
-- site is wrong and should be calling the RPC. It is not this file.

drop policy if exists "own affiliate clicks insert" on public.affiliate_clicks;

drop policy if exists "own affiliate clicks select" on public.affiliate_clicks;
create policy "own affiliate clicks select" on public.affiliate_clicks
  for select using (user_id = auth.uid());

drop policy if exists "own affiliate conversions select"
  on public.affiliate_conversions;
create policy "own affiliate conversions select" on public.affiliate_conversions
  for select using (user_id = auth.uid());

drop policy if exists "own wishlist items" on public.wishlist_items;
create policy "own wishlist items" on public.wishlist_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own product try ons" on public.product_try_ons;
create policy "own product try ons" on public.product_try_ons
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- brand_api_keys has RLS ENABLED and NO POLICIES AT ALL, deliberately. With
-- RLS on and zero policies, anon/authenticated clients can neither read nor
-- write any row, while the service role bypasses RLS entirely — so partner
-- credentials are reachable only from server-side edge functions. Do not add
-- a policy here.
