-- Wardrobe app schema (mirrors src/lib/database.types.ts)

create type body_type as enum
  ('rectangle','hourglass','pear','apple','inverted_triangle','athletic');

create type garment_category as enum
  ('top','bottom','dress','outerwear','shoes','accessory');

create type profile_build as enum
  ('slim','average','athletic','curvy','broad');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  body_type body_type,
  height_cm integer,
  weight_kg integer,
  build profile_build,

  -- --- Minimum account age (13+) -----------------------------------------
  -- LAUNCH_CHECKLIST.md §1 requires a minimum age of 13 that is *enforced*,
  -- not merely stated, and legal/PRIVACY_POLICY.md §12 already promises users
  -- "we enforce a minimum age at signup". These two columns plus
  -- public.record_age_check() below are that enforcement.
  --
  -- DELIBERATELY NOT A BIRTHDATE. A day-precision date of birth is the most
  -- sensitive field this app could hold — a permanent identifier you cannot
  -- rotate after a breach — and legal/DATA_HANDLING.md §2a rates `profiles`
  -- at Medium today. So the exact check runs inside record_age_check(), which
  -- takes the full birthdate as an *argument*, evaluates it to the day, and
  -- discards it. What persists is the verdict and the coarsest signal that
  -- keeps the verdict auditable:
  --
  --   birth_year       year only — no month, no day
  --   age_verified_on  the day an exact >=13 check passed, or null
  --
  -- Null/null means "never age-checked", which is what every row predating
  -- the gate holds and what routes a user to the age step in app/_layout.tsx.
  -- A bare `age_ok boolean` was rejected: a claim written by a client that
  -- nobody can re-derive is the ToS-only enforcement the checklist is
  -- complaining about, moved into a column. These two can be re-checked
  -- against each other forever, by anyone with read access, with no
  -- application code in the loop.
  --
  -- Clients cannot write either one — see the column-level grants in the RLS
  -- section. The idempotent, re-runnable form of all of this (plus the full
  -- reasoning, the backfill decision for existing rows, and the worked
  -- boundary cases) lives in supabase/migrations/006_age_gate.sql; keep the
  -- two in sync.
  birth_year smallint,
  age_verified_on date,

  created_at timestamptz not null default now(),

  -- "Either this profile has never been age-checked, or it carries a birth
  -- year at least 13 years before the day we checked it" — PRIVACY_POLICY.md
  -- §12's claim, written as something the database refuses to violate.
  --
  -- Necessary, not sufficient, and honestly so: keeping only the year means
  -- (2013, 2026-01-05) satisfies this and could describe a 12-year-old. The
  -- exact day-precision test is record_age_check(); this is the backstop that
  -- catches the realistic failure — a bad backfill or a future writer that
  -- sets one column and forgets the other. Tightening it would require
  -- retaining month and day, which is the trade this design exists to refuse.
  --
  -- The is-null/is-not-null pairing forbids both half-states: a verdict with
  -- no birth year is unauditable, and a birth year with no verdict is a
  -- retained fragment of birth data with no purpose.
  --
  -- age_verified_on is a `date` rather than a `timestamptz` specifically so
  -- `extract(year from ...)` here is immutable; over a timestamptz the year
  -- would depend on the session TimeZone.
  constraint profiles_age_verified_consistent check (
    (birth_year is null and age_verified_on is null)
    or (
      birth_year is not null
      and age_verified_on is not null
      -- Typo catcher, not a compliance rule: year 20 passes the >=13
      -- arithmetic just fine.
      and birth_year between 1900 and 2200
      and birth_year <= extract(year from age_verified_on)::int - 13
    )
  )
);

-- Operational: "how many accounts still owe us an answer". Partial, so it
-- indexes only the rows that still owe one and shrinks toward empty as the
-- backlog from 006_age_gate.sql drains:
--   select count(*) from public.profiles where age_verified_on is null;
-- If that count stops falling while signups continue, the client gate has
-- regressed and this is the metric that says so.
create index profiles_age_unverified_idx
  on public.profiles(created_at)
  where age_verified_on is null;

-- System-owned, shared 3D garment meshes (t-shirt, jeans, etc.) that user
-- garments are auto-textured onto — PRODUCT_SPEC.md §5b/§7. Public
-- read-only for active templates; no owner column (not per-user data).
-- Created before garments, which references it.
create table public.garment_templates (
  id uuid primary key default gen_random_uuid(),
  category garment_category not null,
  name text not null,
  glb_path text not null,
  default_texture_path text,
  is_active boolean not null default true
);
create index garment_templates_category_idx on public.garment_templates(category)
  where is_active;

create table public.garments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  category garment_category not null,
  name text,
  color text,
  brand text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  -- Added for the Day 2 3D pipeline (BUILD_ROADMAP_10DAY.md Day 4/Day 6):
  -- links a garment to the shared template mesh it's rendered on, and
  -- tracks the photo -> texture processing pipeline.
  template_id uuid references public.garment_templates(id) on delete set null,
  texture_path text,
  source text not null default 'upload',
  processing_status text not null default 'ready'
);
create index garments_user_id_idx on public.garments(user_id);
create index garments_category_idx on public.garments(user_id, category);
create index garments_template_id_idx on public.garments(template_id);

-- A user's stored avatar: appearance customization from the character
-- creator (PRODUCT PIVOT — see src/features/creator/customization.ts;
-- users build a character instead of uploading a photo / relying on
-- measurements) plus legacy body measurements + derived shape vector
-- (PRODUCT_SPEC.md §5a/§7, BUILD_ROADMAP_10DAY.md Day 2/Day 4). One row
-- per user; src/lib/api/avatars.ts always upserts on user_id.
--
-- height_cm/weight_kg are nullable now that the character creator (not
-- measurements) drives the avatar — they're kept only for the legacy
-- body-shape system in features/avatar3d/bodyModel.ts, and are only ever
-- set if the user goes through the (now unused-by-default) measurements
-- flow.
create table public.avatars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  height_cm numeric,
  weight_kg numeric,
  chest_cm numeric,
  waist_cm numeric,
  hip_cm numeric,
  inseam_cm numeric,
  skin_tone text,
  -- Derived from height_cm/weight_kg/chest_cm/hip_cm via
  -- measurementsToShapeParams (src/features/avatar3d/bodyModel.ts) —
  -- never written independently of the raw measurements above.
  shape_params jsonb not null default '{}',
  -- Appearance customization from the character creator — see
  -- src/features/creator/customization.ts's `Customization` type. This is
  -- the current source of the try-on avatar; src/lib/api/avatars.ts's
  -- saveCustomization() upserts it.
  customization jsonb not null default '{}',
  preview_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keeps avatars.updated_at fresh on every update (upsert's ON CONFLICT DO
-- UPDATE path fires BEFORE UPDATE triggers too, so upsertMyAvatar's calls
-- are covered without the client needing to set this itself).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger avatars_set_updated_at
  before update on public.avatars
  for each row execute function public.set_updated_at();

create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);
create index outfits_user_id_idx on public.outfits(user_id);

create table public.outfit_items (
  outfit_id uuid not null references public.outfits(id) on delete cascade,
  garment_id uuid not null references public.garments(id) on delete cascade,
  layer_order int not null default 0,
  x float8 not null default 0,
  y float8 not null default 0,
  scale float8 not null default 1,
  rotation float8 not null default 0,
  primary key (outfit_id, garment_id)
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- Minimum account age (13+): the gate ------------------------------------
-- The only way a value is ever written to profiles.birth_year /
-- profiles.age_verified_on. Same shape and the same reasoning as
-- public.create_affiliate_click() further down: the row carries a term the
-- client must not be able to state, so the client states the *input* and the
-- database states the *conclusion*. There, a forged commission_rate_bps
-- invoices a partner for their own order value. Here, a forged age verdict is
-- a 12-year-old with an account and a privacy policy claiming we have none.
--
-- Takes the full birthdate, checks it to the day, and throws it away:
-- `p_birthdate` is a function argument, never a column, and it is deliberately
-- not interpolated into any of the raise messages below (create_affiliate_click
-- interpolates product ids; a product id is not personal data and a date of
-- birth is).
--
-- Pinned empty search_path and schema-qualified names, matching
-- create_affiliate_click — a definer function that resolves unqualified names
-- through the caller's search_path can be pointed at someone else's
-- `profiles`. pg_catalog is implicitly searched, so builtin types still
-- resolve.
--
-- The re-runnable form, with the full boundary-case walkthrough and the
-- backfill decision for pre-existing rows, is in
-- supabase/migrations/006_age_gate.sql.
create or replace function public.record_age_check(p_birthdate date)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid := auth.uid();
  v_today      date := current_date;
  v_birth_year smallint;
  v_row        public.profiles;
begin
  -- Selv has no anonymous accounts. For a new signup the gate is answered
  -- *before* the OTP is requested (src/features/auth/SignInScreen.tsx), so no
  -- auth.users row is ever created for a rejected under-13; by the time this
  -- runs there is a session. A null uid is a probe, not a flow.
  if v_user_id is null then
    raise exception 'record_age_check: authentication required'
      using errcode = '42501'; -- insufficient_privilege -> 401/403
  end if;

  if p_birthdate is null then
    raise exception 'record_age_check: a date of birth is required'
      using errcode = '22004'; -- null_value_not_allowed
  end if;

  -- Shape complaints come before the age verdict on purpose: someone who
  -- mistypes the year should be told to check the date, not told they are too
  -- young to use the app.
  if p_birthdate > v_today then
    raise exception 'record_age_check: date of birth is in the future'
      using errcode = '22007'; -- invalid_datetime_format
  end if;

  -- Typo catcher matching MAX_PLAUSIBLE_AGE_YEARS in
  -- src/features/age/minimumAge.ts and the constraint's 1900 floor. Not a
  -- compliance rule — someone born in 1850 is comfortably over 13.
  if p_birthdate < v_today - interval '120 years' then
    raise exception 'record_age_check: date of birth is not plausible'
      using errcode = '22007';
  end if;

  -- THE CHECK. Exact to the day, and the only place in the system that is.
  -- `v_today - interval '13 years'` is the latest birthdate already 13 today,
  -- so "born after the cutoff" means too young. Turning 13 exactly today
  -- passes (you are 13 on your 13th birthday, not the day after); turning 13
  -- tomorrow does not. A 29 Feb birthday lands on 1 March in non-leap years,
  -- because Postgres clamps the cutoff to a real date — the conservative
  -- reading, and the one ageInYearsOn() in src/features/age/minimumAge.ts
  -- produces from the same inputs.
  --
  -- `current_date` is the date in the database session's TimeZone (UTC on
  -- Supabase) while the client previewed the answer against the device
  -- calendar; they can differ by a day at the edges. This one is
  -- authoritative and both directions of disagreement are safe — one of the
  -- two refuses first, and neither ordering admits an under-13.
  if p_birthdate > (v_today - interval '13 years')::date then
    raise exception 'record_age_check: minimum age is 13'
      using errcode = 'P0001'; -- raise_exception; mapped to user copy client-side
  end if;

  v_birth_year := extract(year from p_birthdate)::smallint;

  -- Upsert, not update: handle_new_user() above creates the row so the
  -- conflict branch is what runs in practice, but an account predating that
  -- trigger would otherwise be permanently unable to pass a gate it cannot get
  -- past. Re-recording is allowed and idempotent-in-effect — the client
  -- retries this call if a concurrent profile fetch clobbers its local copy,
  -- and two different dates that each passed >=13 on their own verification
  -- date both leave the constraint and the compliance claim intact.
  insert into public.profiles (id, birth_year, age_verified_on)
  values (v_user_id, v_birth_year, v_today)
  on conflict (id) do update
     set birth_year      = excluded.birth_year,
         age_verified_on = excluded.age_verified_on
  returning * into v_row;

  return v_row;
end $$;

-- Execute for signed-in users only. `create function` grants EXECUTE to PUBLIC
-- by default, so the revoke is not decoration — without it `anon` inherits the
-- right to call a definer function that writes `profiles`. The anon revoke is
-- redundant after the PUBLIC one and is spelled out so the intent survives
-- someone re-granting PUBLIC.
revoke execute on function public.record_age_check(date) from public;
revoke execute on function public.record_age_check(date) from anon;
grant execute on function public.record_age_check(date) to authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.garments enable row level security;
alter table public.garment_templates enable row level security;
alter table public.avatars enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- --- Minimum account age (13+): making the RPC the only path ---------------
-- Everything in record_age_check() above is decoration if a client can write
-- the columns itself. It can: Supabase's default privileges hand `anon` and
-- `authenticated` full DML on new tables in `public`, and the `"own profile"`
-- policy immediately above is `for all using (id = auth.uid())` — which
-- authorises `update profiles set age_verified_on = current_date, birth_year =
-- 1990 where id = auth.uid()` for every signed-in user in the world. RLS
-- decides *which rows*; it has no vocabulary for *which columns*. SQL
-- privileges do, so the restriction has to be stated as a grant.
--
-- Same mechanism the waitlist uses to freeze `source`/`created_at`
-- (migrations/004_waitlist.sql), and the same warning: the policy and the
-- grant are one control split across two statements. Removing these lines
-- does not loosen anything gradually — it hands the age verdict back to the
-- client and turns the RPC into an elaborate suggestion.
--
-- The re-grants enumerate the columns the app legitimately writes
-- (src/lib/api/profiles.ts is the only client-side writer). `id` is insertable
-- but not updatable — a row must be able to name itself, never to re-parent
-- itself. `created_at` is on neither list. Adding a profiles column later
-- means adding it here too, or PostgREST returns 42501 for a write RLS was
-- perfectly happy with.
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, display_name, body_type, height_cm, weight_kg, build)
  on public.profiles to authenticated;
grant update (display_name, body_type, height_cm, weight_kg, build)
  on public.profiles to authenticated;
revoke insert, update, delete on public.profiles from anon;

-- --- Minimum account age (13+): enforcement, not just recording -------------
-- The grants above make a verdict unforgeable; they do not stop an account
-- that *skipped* the gate from using the app, because a hostile client can
-- ignore the routing in app/_layout.tsx and talk to PostgREST directly.
-- Without this, "enforced" would mean "enforced against users who use our UI".
--
-- Narrow on purpose: an account with no age verdict cannot write its own
-- profile row. `profiles.build` is the gate into the product — app/_layout.tsx
-- holds every user in /onboarding until it is set, and the only way to set it
-- is an UPDATE here — so blocking profile writes blocks onboarding from ever
-- completing, for a bypassing client exactly as for an honest one, without
-- touching `garments`, `avatars`, `outfits` or the commerce tables.
--
-- Not extended to the content tables, deliberately: every account predating
-- 006_age_gate.sql is unverified through no fault of its own, and a
-- restrictive policy on `garments` would mean a returning user opens the app
-- to an empty wardrobe. Blocking *progress* until the question is answered is
-- proportionate; making existing data vanish is not.
--
-- `as restrictive` ANDs with the permissive policy above instead of ORing, so
-- it can only subtract. `using` sees the old row and `with check` the new one;
-- both test the same column because a client cannot change it (the grants
-- above), so no update can flip the flag and authorise itself. A `security
-- definer` function bypasses RLS, which is exactly what lets an unverified
-- user pass the gate that is otherwise blocking them; so does the service
-- role, so delete-account keeps working. SELECT stays open — a user must be
-- able to read the column that is blocking them, and the client gate needs it
-- to route.
--
-- A blocked write is not an error: a failed `using` filters rather than
-- raises, so the statement matches zero rows and reports success with the row
-- unchanged. It surfaces only because every writer in src/lib/api/profiles.ts
-- ends `.select().single()`, which PostgREST answers with PGRST116 on zero
-- rows. Do not drop that `.single()`.
create policy "profile writes require the age gate" on public.profiles
  as restrictive
  for update
  using (age_verified_on is not null)
  with check (age_verified_on is not null);

create policy "own garments" on public.garments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- garment_templates is system-owned shared data, not per-user — public
-- read of active templates only, no insert/update/delete policy (only
-- managed via the Supabase dashboard / service role).
create policy "public active garment templates" on public.garment_templates
  for select using (is_active);

create policy "own avatar" on public.avatars
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own outfits" on public.outfits
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own outfit items" on public.outfit_items
  for all using (
    exists (select 1 from public.outfits o
            where o.id = outfit_id and o.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.outfits o
            where o.id = outfit_id and o.user_id = auth.uid())
  );

-- Storage: garments bucket, path {user_id}/{garment_id}.jpg
insert into storage.buckets (id, name, public)
values ('garments', 'garments', false)
on conflict (id) do nothing;

create policy "own garment images select" on storage.objects
  for select using (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own garment images insert" on storage.objects
  for insert with check (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own garment images update" on storage.objects
  for update using (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own garment images delete" on storage.objects
  for delete using (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ===========================================================================
-- COMMERCE / AFFILIATE
-- ===========================================================================
-- Selv's revenue loop: brands list garments here -> a user tries one on their
-- avatar -> they tap Buy -> we hand them off to the brand's PDP through a
-- tracked affiliate link carrying a `click_token` subid -> the brand (or its
-- affiliate network) posts the completed order back to us -> we book a
-- commission. Every table below exists to make one leg of that loop
-- auditable after the fact.
--
-- Money-handling principle used throughout: all amounts are integer cents and
-- all rates are integer basis points (1 bps = 0.01%, so 1000 bps = 10%). No
-- floats anywhere on the money path — a rounding drift of a fraction of a
-- cent per click becomes a reconciliation dispute with a partner at volume.
--
-- The idempotent, re-runnable form of everything below lives in
-- supabase/migrations/002_commerce.sql; keep the two in sync.
-- ===========================================================================

-- Which affiliate network mediates a brand's tracking + payouts. 'direct'
-- means we have a first-party agreement with the brand and no intermediary,
-- so their postbacks hit our own edge function directly.
create type affiliate_network as enum
  ('direct','rakuten','cj','impact','shopstyle','awin');

-- Partner lifecycle. Only 'active' brands are visible to clients (see RLS
-- below); 'pending' is a signed-but-not-launched partner and 'paused' is a
-- temporary takedown (contract lapsed, catalog feed broken, etc.) that must
-- NOT cascade-delete their historical clicks and conversions.
create type brand_status as enum ('pending','active','paused');

-- Affiliate accounting lifecycle. Networks report a sale as 'pending' first,
-- then 'approved' once the return window closes, and finally 'paid' when the
-- money actually lands. 'reversed' is a cancelled/refunded order — it is a
-- terminal state we keep rather than delete, because a deleted conversion
-- looks identical to a postback we never received.
create type conversion_status as enum ('pending','approved','reversed','paid');

-- Where in the app the user was standing when they tapped Buy. Drives
-- attribution reporting: if 'tryon' converts at 3x the rate of 'shop', the
-- try-on-first funnel is the product, not a feature.
create type click_source as enum ('shop','tryon','outfit','wishlist','share');

-- A partner brand whose catalog we surface in the Shop tab.
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  -- Stable, human-readable key used in deep links (selv://shop/brand/<slug>)
  -- and in partner-facing URLs, so it must survive a display-name rebrand.
  slug text unique not null,
  name text not null,
  tagline text,
  description text,
  logo_url text,
  website_url text,
  network affiliate_network not null default 'direct',
  -- Brand-wide default commission. Per-product overrides live on
  -- brand_products.commission_rate_bps; see resolveCommissionRateBps() in
  -- src/lib/commerce/commission.ts for the precedence rules.
  commission_rate_bps integer not null default 1000
    check (commission_rate_bps between 0 and 10000),
  -- Deep-link template for this brand's network, e.g.
  -- 'https://track.net/c?u={URL}&subid={SUBID}'. {URL} is replaced with the
  -- URL-encoded product_url and {SUBID} with the click_token. NULL means the
  -- network takes no wrapper URL, so we append subid params to product_url
  -- directly — see buildAffiliateUrl() in src/lib/api/affiliate.ts, which is
  -- the single implementation of both branches.
  affiliate_url_template text,
  status brand_status not null default 'pending',
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index brands_status_idx on public.brands(status);

-- Flattens the searchable text of a product into one string for the
-- `search_tsv` generated column below.
--
-- This wrapper exists for one non-obvious reason: `array_to_string()` is
-- declared STABLE, not IMMUTABLE, because its volatility has to cover every
-- element type `anyarray` could hold. A generated column may only call
-- IMMUTABLE functions, so referencing it directly makes Postgres reject the
-- table with "generation expression is not immutable". For text[] the
-- operation genuinely is immutable, and re-declaring that here is the
-- standard workaround — it keeps search_tsv a real generated column instead
-- of demoting it to a trigger-maintained one that can silently fall behind.
create or replace function public.selv_product_search_text(
  p_name text,
  p_description text,
  p_tags text[]
) returns text
language sql immutable parallel safe
-- Pinned empty search_path so nothing here can be hijacked by a schema
-- earlier in a caller's path (Supabase's own linter flags functions without
-- it). pg_catalog is always implicitly searched, so the builtins below still
-- resolve.
set search_path = ''
as $$
  select coalesce(p_name, '') || ' ' ||
         coalesce(p_description, '') || ' ' ||
         coalesce(pg_catalog.array_to_string(p_tags, ' '), '')
$$;

-- One purchasable SKU from a partner's catalog. Deliberately mirrors the
-- shape of public.garments (same `garment_category` enum, same name/color/
-- tags vocabulary) so a product can be copied into a user's wardrobe with no
-- translation layer — see saveProductToWardrobe() in src/lib/api/shop.ts.
create table public.brand_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- The brand's own SKU. Unique per brand (not globally) and the key a
  -- catalog re-sync upserts on, so re-importing a feed updates rows in place
  -- instead of duplicating the catalog.
  external_id text not null,
  name text not null,
  description text,
  category garment_category not null,
  color text,
  price_cents integer not null check (price_cents >= 0),
  -- Set only while the item is discounted. Never assume it is lower than
  -- price_cents — bad partner feeds happen — always read the price through
  -- effectivePriceCents() in src/lib/commerce/commission.ts.
  sale_price_cents integer check (sale_price_cents >= 0),
  currency text not null default 'USD',
  -- Public CDN url (the partner's, not our storage bucket) — unlike user
  -- garments there is nothing private here, so no signed-URL dance.
  image_url text not null,
  extra_image_urls text[] not null default '{}',
  -- Transparent cutout PNG for the 2D try-on collage. Falls back to
  -- image_url when a partner hasn't supplied one.
  tryon_image_url text,
  template_id uuid references public.garment_templates(id) on delete set null,
  -- Canonical product detail page. Always the un-wrapped, un-tracked URL:
  -- the affiliate wrapper is applied per click so the token stays unique.
  product_url text not null,
  -- Nullable per-product override of brands.commission_rate_bps. NULL means
  -- "inherit the brand rate"; 0 is a meaningful value (some partners pay
  -- nothing on clearance), so never treat it as absent.
  commission_rate_bps integer check (commission_rate_bps between 0 and 10000),
  sizes text[] not null default '{}',
  tags text[] not null default '{}',
  in_stock boolean not null default true,
  -- Soft delete. Products vanish and reappear as feeds churn; hard-deleting
  -- them would orphan the affiliate_clicks that reference them.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Full-text search vector maintained by Postgres so the Shop search box
  -- never needs a trigger or an application-side reindex step. Queried from
  -- searchProducts() via PostgREST's .textSearch('search_tsv', ...).
  search_tsv tsvector generated always as (
    to_tsvector(
      'english',
      public.selv_product_search_text(name, description, tags)
    )
  ) stored,
  constraint brand_products_brand_external_key unique (brand_id, external_id)
);
create index brand_products_brand_id_idx on public.brand_products(brand_id);
create index brand_products_category_idx on public.brand_products(category)
  where is_active;
create index brand_products_active_created_idx
  on public.brand_products(is_active, created_at desc);
create index brand_products_search_idx
  on public.brand_products using gin(search_tsv);

-- One row per outbound handoff to a partner PDP. This is the ONLY record
-- that exists at the moment a user leaves the app, so it snapshots the two
-- numbers we would otherwise lose: the commission rate and the price as they
-- stood at click time. If a brand renegotiates their rate or drops the price
-- next week, a conversion that arrives against this click must still be
-- valued at the terms the click was made under.
--
-- Because those snapshots are what we later invoice a partner for, clients do
-- NOT write this table directly. Every client-side click goes through
-- public.create_affiliate_click() further down, which resolves the rate, the
-- price, the brand and the token server-side. There is deliberately no client
-- INSERT policy — see the RLS section at the end of this file.
create table public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  -- The subid we hand the network. Unique because it is the join key the
  -- postback comes back on — a collision would misattribute revenue.
  click_token text not null unique,
  -- Nullable + `on delete set null`: a user deleting their account must not
  -- erase the brand's record that a click happened (that's their invoice).
  user_id uuid references auth.users(id) on delete set null,
  product_id uuid not null references public.brand_products(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  source click_source not null default 'shop',
  commission_rate_bps integer not null, -- SNAPSHOT at click time
  price_cents_at_click integer not null, -- SNAPSHOT at click time
  created_at timestamptz not null default now()
);
create index affiliate_clicks_user_idx
  on public.affiliate_clicks(user_id, created_at desc);
create index affiliate_clicks_product_idx on public.affiliate_clicks(product_id);
create index affiliate_clicks_brand_idx
  on public.affiliate_clicks(brand_id, created_at desc);

-- A completed purchase reported back by a brand or network. Written ONLY by
-- the service-role postback edge function; clients can read their own rows so
-- the app can show "your orders", but must never be able to author revenue.
create table public.affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  -- Both the resolved FK and the raw token are kept: postbacks routinely
  -- arrive with a token we can't resolve yet (or ever), and dropping those
  -- would silently lose money. click_id is set once/if the token matches.
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
  -- Verbatim postback body. Networks change their payload shapes without
  -- notice and disputes are settled months later, so we keep the original.
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  -- Idempotency key for postbacks: networks retry aggressively and some send
  -- the same order once per status transition. (network, network_order_id)
  -- lets the edge function upsert instead of double-booking revenue.
  constraint affiliate_conversions_network_order_key
    unique (network, network_order_id)
);
create index affiliate_conversions_user_idx
  on public.affiliate_conversions(user_id, occurred_at desc);
create index affiliate_conversions_brand_idx
  on public.affiliate_conversions(brand_id, occurred_at desc);
create index affiliate_conversions_click_token_idx
  on public.affiliate_conversions(click_token);

-- "Save for later" on a shop product. Composite PK instead of a surrogate id
-- so toggling the heart is a plain insert/delete with no read-then-write.
create table public.wishlist_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.brand_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index wishlist_items_product_idx on public.wishlist_items(product_id);

-- Append-only analytics: the user put this product on their avatar. Separate
-- from affiliate_clicks because a try-on is not a purchase intent signal of
-- the same strength, and we want the ratio between the two.
create table public.product_try_ons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.brand_products(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index product_try_ons_user_idx
  on public.product_try_ons(user_id, created_at desc);
create index product_try_ons_product_idx
  on public.product_try_ons(product_id, created_at desc);

-- Credentials a brand uses to push catalog updates / postbacks into our edge
-- functions. Only the sha256 hex of the key is stored — the raw key is shown
-- to the partner exactly once at creation and is unrecoverable afterwards.
create table public.brand_api_keys (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  label text not null,
  key_hash text not null unique,
  last_used_at timestamptz,
  -- Soft revoke: keeps the audit trail of which key signed which import.
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index brand_api_keys_brand_idx on public.brand_api_keys(brand_id);

-- Keep updated_at fresh on the two mutable commerce tables, reusing the
-- trigger function declared above for avatars.
create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();

create trigger brand_products_set_updated_at
  before update on public.brand_products
  for each row execute function public.set_updated_at();

-- --- Extend garments so a shop product can be saved into a wardrobe -------
-- A catalog-sourced garment has no file in our private 'garments' bucket —
-- its imagery lives on the partner's CDN — so image_path stops being
-- mandatory and image_url takes over for those rows. Exactly one of the two
-- is always populated, which the check constraint enforces.
alter table public.garments
  alter column image_path drop not null,
  add column product_id uuid references public.brand_products(id) on delete set null,
  add column image_url text;

alter table public.garments
  add constraint garments_image_present
  check (image_path is not null or image_url is not null);

-- A user saving the same product twice is a no-op, not a second garment.
-- Enforced in the DB as well as in saveProductToWardrobe() because the app
-- check is a read-then-write and two fast taps can race past it.
create unique index garments_user_product_uidx
  on public.garments(user_id, product_id)
  where product_id is not null;

-- --- Affiliate click creation (server-authoritative) ----------------------
-- Everything in this subsection exists because of one asymmetry: an
-- `affiliate_clicks` row is created in response to a user action, but its
-- contents are a commercial fact we later invoice a brand partner for. Those
-- two things must not be authored by the same party.
--
-- The original design let the client insert the row directly under an RLS
-- policy of `with check (user_id = auth.uid())`. That check constrains
-- exactly one column. Everything that actually matters commercially —
-- commission_rate_bps, price_cents_at_click, brand_id, click_token — was
-- taken verbatim from the request body. So any authenticated user holding the
-- anon key (which ships inside the app binary and is not a secret) could
-- write a click carrying commission_rate_bps = 10000 against any product and
-- then complete a genuine purchase. The postback function inherits the
-- snapshotted rate by design and correctly so, which means we would have
-- billed the brand 100% of their own order value. The attacker gains nothing
-- personally — that is exactly why it would go unnoticed until a partner
-- noticed it for us, and over-billing a partner is the single fastest way to
-- lose them and any standing we have as an affiliate publisher. A forged
-- price_cents_at_click poisons every funnel and margin number we compute the
-- same way, and a client-chosen brand_id can be made inconsistent with
-- product_id, which makes the ledger unreconcilable rather than merely wrong.
--
-- The fix is structural, not a tighter check expression: the commercial terms
-- are resolved below from the `brands` / `brand_products` rows, and the client
-- is given no way to state them at all.

-- pgcrypto supplies gen_random_bytes(), used below to mint a click_token the
-- caller can neither choose nor predict. Supabase installs extensions into the
-- `extensions` schema by convention, and the function below pins an empty
-- search_path, so the call site is written `extensions.gen_random_bytes(...)`.
-- If a deployment already has pgcrypto installed elsewhere this statement is a
-- no-op and the call will not resolve — move it with
-- `alter extension pgcrypto set schema extensions` rather than un-qualifying
-- the call site. (Nothing above needed an extension: gen_random_uuid() has
-- been a core builtin since PG13.)
create extension if not exists pgcrypto with schema extensions;

-- Record one outbound click and hand back the row, including the click_token
-- the caller must embed in the outbound URL. This is the ONLY path by which a
-- client creates an affiliate click.
--
-- The caller supplies two things and only two things: which product, and
-- which surface of the app they tapped Buy on. `p_source` is safe to accept
-- because it is self-reported analytics, not money — the worst a liar
-- achieves is skewing their own attribution report — and the `click_source`
-- enum bounds it to five known values anyway. Everything with a price tag on
-- it is derived here.
--
-- SECURITY DEFINER is what makes that possible: the function runs as its
-- owner, so it can insert into a table the caller has no INSERT policy on.
-- The corollary is that RLS does NOT filter the lookup below — the
-- "public active brand products" policy that hides a paused partner's catalog
-- from a normal select is simply not applied here. Hence the explicit
-- is_active / status checks: without them this function would happily mint a
-- billable click against a brand whose contract has lapsed.
create or replace function public.create_affiliate_click(
  p_product_id uuid,
  p_source public.click_source
) returns public.affiliate_clicks
language plpgsql
security definer
-- Pinned empty search_path, same as public.selv_product_search_text above. A
-- definer function that resolves unqualified names through the *caller's*
-- search_path can be induced to read someone else's `brands` table and take
-- its commission rate; pinning it to nothing and schema-qualifying every name
-- (pg_catalog builtins included, where it costs nothing to be explicit)
-- removes the question. Supabase's linter also flags any definer function
-- without a pinned path.
set search_path = ''
as $$
declare
  v_user_id          uuid := auth.uid();
  v_brand_id         uuid;
  v_product_active   boolean;
  v_brand_status     public.brand_status;
  v_list_cents       integer;
  v_sale_cents       integer;
  v_product_rate_bps integer;
  v_brand_rate_bps   integer;
  v_rate_bps         integer;
  v_price_cents      integer;
  v_click            public.affiliate_clicks;
begin
  -- Selv has no anonymous browsing: the Shop tab is behind the auth gate, so
  -- a null uid here is a bug or a probe, never a legitimate guest. Refusing
  -- outright also keeps `affiliate_clicks.user_id` meaningful — it is
  -- nullable only so account deletion can de-identify a row after the fact,
  -- not so a click can be born ownerless.
  if v_user_id is null then
    raise exception 'create_affiliate_click: authentication required'
      using errcode = '42501'; -- insufficient_privilege -> 401/403
  end if;

  -- Deliberately unfiltered: we want "no such product", "product withdrawn"
  -- and "partner paused" to be three distinguishable log lines, and a lookup
  -- that folds the conditions into the WHERE clause collapses all three into
  -- an indistinguishable "not found". brand_products.brand_id is NOT NULL and
  -- FK'd, so the join always matches whenever the product row exists.
  select p.brand_id, p.is_active, p.price_cents, p.sale_price_cents,
         p.commission_rate_bps, b.status, b.commission_rate_bps
    into v_brand_id, v_product_active, v_list_cents, v_sale_cents,
         v_product_rate_bps, v_brand_status, v_brand_rate_bps
    from public.brand_products p
    join public.brands b on b.id = p.brand_id
   where p.id = p_product_id;

  if not found then
    raise exception 'create_affiliate_click: product % does not exist',
      p_product_id
      using errcode = 'P0002'; -- no_data_found -> 404
  end if;

  if not v_product_active then
    raise exception 'create_affiliate_click: product % is not active',
      p_product_id
      using errcode = 'P0002';
  end if;

  -- A paused or not-yet-launched partner must not be clickable. Minting a
  -- tracked click against a brand we are not currently live with produces a
  -- conversion we have no contract to bill for.
  if v_brand_status <> 'active' then
    raise exception 'create_affiliate_click: brand % is %, not active',
      v_brand_id, v_brand_status
      using errcode = 'P0002';
  end if;

  -- Commission precedence, mirroring resolveCommissionRateBps() in
  -- src/lib/commerce/commission.ts exactly: per-product override, then brand
  -- default, then the 1000 bps (10%) our standard agreement opens at.
  --
  -- The tests are `is not null`, never coalesce-on-falsy, because 0 is a real
  -- negotiated rate — plenty of partners pay nothing on clearance — and a
  -- product override of 0 must beat a brand default of 1200. Collapsing the
  -- two would silently bill a partner for stock they told us was commission
  -- free, which is the same class of error this whole function exists to
  -- prevent, just pointing the other way.
  --
  -- The TS version additionally treats an out-of-range rate as absent; here
  -- that branch is unreachable, because both columns carry a
  -- `check (commission_rate_bps between 0 and 10000)` constraint. The
  -- difference is not a drift: TS is validating untrusted feed data on its way
  -- in, while this reads data the constraint has already vetted.
  if v_product_rate_bps is not null then
    v_rate_bps := v_product_rate_bps;
  elsif v_brand_rate_bps is not null then
    v_rate_bps := v_brand_rate_bps;
  else
    v_rate_bps := 1000;
  end if;

  -- Price precedence, mirroring effectivePriceCents(): the sale price counts
  -- only when it is present AND strictly below the list price. Partner feeds
  -- routinely leave a stale sale_price_cents equal to or above list once a
  -- promotion ends, and honouring that would snapshot a price the shopper was
  -- never shown.
  if v_sale_cents is not null and v_sale_cents < v_list_cents then
    v_price_cents := v_sale_cents;
  else
    v_price_cents := v_list_cents;
  end if;

  -- The token is minted here rather than by the client for the same reason as
  -- the rate. A client-chosen subid is guessable and collidable, and — worse —
  -- lets a user pre-register a token for a click they never made, so a
  -- postback arriving on that token would attribute a stranger's real order to
  -- them. 16 random bytes is 128 bits: collision is not a scenario worth
  -- retrying for, and the `unique` constraint on click_token turns the
  -- impossible case into a failed insert rather than misattributed revenue.
  -- The `selv_` prefix is kept from the old client-side generator so a token
  -- is still recognisable as ours in a partner's raw click report, and the hex
  -- body keeps the whole thing URL-safe inside any network's wrapper.
  insert into public.affiliate_clicks (
    click_token,
    user_id,
    product_id,
    brand_id,
    source,
    commission_rate_bps,
    price_cents_at_click
  ) values (
    'selv_' || pg_catalog.encode(extensions.gen_random_bytes(16), 'hex'),
    v_user_id,          -- never a caller-supplied id
    p_product_id,
    v_brand_id,         -- read off the product row, never from the caller, so
                        -- brand_id and product_id cannot disagree
    p_source,
    v_rate_bps,
    v_price_cents
  )
  returning * into v_click;

  return v_click;
end $$;

-- Execute is granted to signed-in users only. `create function` grants EXECUTE
-- to PUBLIC by default, so the revoke is not decoration — without it the anon
-- role would inherit the right to call a definer function that writes a
-- revenue-bearing table. The anon revoke is redundant after the PUBLIC one and
-- is written out anyway so the intent survives someone re-granting PUBLIC.
-- service_role is not listed because it bypasses RLS entirely and writes the
-- table directly; it has no use for this wrapper.
revoke execute on function public.create_affiliate_click(uuid, public.click_source)
  from public;
revoke execute on function public.create_affiliate_click(uuid, public.click_source)
  from anon;
grant execute on function public.create_affiliate_click(uuid, public.click_source)
  to authenticated;

-- --- Commerce RLS ---------------------------------------------------------
alter table public.brands enable row level security;
alter table public.brand_products enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_conversions enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.product_try_ons enable row level security;
alter table public.brand_api_keys enable row level security;

-- brands/brand_products are system-owned partner data, not per-user — public
-- read of live rows only, with no insert/update/delete policy, following the
-- same pattern as garment_templates above. Catalog writes happen through the
-- service role (dashboard or catalog-import edge function).
create policy "public active brands" on public.brands
  for select using (status = 'active');

-- Also gated on the parent brand: pausing a brand must take their whole
-- catalog off the shelf in one write, without touching 500 product rows.
create policy "public active brand products" on public.brand_products
  for select using (
    is_active
    and exists (select 1 from public.brands b
                where b.id = brand_id and b.status = 'active')
  );

-- affiliate_clicks is SELECT-OWN ONLY for clients. There is NO insert policy
-- here, and its absence is load-bearing. DO NOT ADD ONE.
--
-- The obvious policy — `for insert with check (user_id = auth.uid())` — is
-- the one this table used to have, and it is the reason this comment exists.
-- It reads like it secures the row, but it constrains a single column. RLS
-- has no vocabulary for "commission_rate_bps must equal whatever
-- brand_products says", so every commercially meaningful column
-- (commission_rate_bps, price_cents_at_click, brand_id, click_token) arrives
-- verbatim from a client holding an anon key that ships inside the app.
-- A user could therefore write a click at 100% commission, buy the item for
-- real, and we would invoice the brand for the entire order value. Nothing
-- about that attack benefits the attacker, which is precisely why it would
-- reach a partner before it reached us.
--
-- Client inserts therefore go through public.create_affiliate_click(), a
-- security definer function (defined above) that derives the rate, the price,
-- the brand and the token from the catalog tables. It can write this table
-- because it runs as the owner; the caller still cannot.
--
-- If you are here because a client insert is failing with "new row violates
-- row-level security policy", the call site is wrong, not this file. Point it
-- at the RPC (src/lib/api/affiliate.ts::createCheckoutLink is the reference
-- implementation). Adding the policy back silently re-opens a hole that
-- forges our own commission ledger and cannot be detected after the fact,
-- because a forged click is byte-identical to a real one.
--
-- There is likewise no update or delete policy: clicks are write-once. An
-- editable snapshot would let a client rewrite the rate a conversion is later
-- valued at, which is the same hole with an extra step.
create policy "own affiliate clicks select" on public.affiliate_clicks
  for select using (user_id = auth.uid());

-- Conversions are revenue. Read-only to the owning user (so the app can show
-- their order history); every write path is service-role only, from the
-- postback edge function.
create policy "own affiliate conversions select" on public.affiliate_conversions
  for select using (user_id = auth.uid());

create policy "own wishlist items" on public.wishlist_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own product try ons" on public.product_try_ons
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- brand_api_keys intentionally has RLS ENABLED and NO POLICIES AT ALL. With
-- RLS on and zero policies, PostgREST (anon/authenticated) can neither read
-- nor write a single row, while the service role bypasses RLS entirely. That
-- is exactly the intent: partner credentials are reachable only from
-- server-side edge functions, never from a client holding the anon key.
-- Do not add a policy here.

-- ===========================================================================
-- SELV+ WAITLIST
-- ===========================================================================
-- Interest capture for Selv+, not a paywall and not a purchase.
--
-- The Free tier caps a wardrobe at 25 items (src/lib/pricing.ts). That cap
-- used to end at an "Upgrade" button wired to nothing: there is no RevenueCat
-- dependency in the app and no in-app purchase ships in v1, so a user who hit
-- the cap was simply stuck. v1 keeps the cap and replaces the dead button with
-- an honest email capture — Selv+ is announced as *coming*, never as
-- purchasable, and the user can ask to be told when it opens. That validates
-- willingness to pay before we build StoreKit, and it keeps App Store
-- Guideline 3.1.2 (auto-renewable subscriptions) off the v1 review surface
-- entirely, because nothing in the app sells anything.
--
-- One row per user. `source` records which wall they hit, which is the whole
-- analytic point: "how many people want this" is much less useful than "people
-- want this specifically at the moment they run out of room".
--
-- The idempotent, re-runnable form of everything below lives in
-- supabase/migrations/004_waitlist.sql; keep the two in sync.
-- ===========================================================================

-- Which wall the user was standing at when they asked to be told. Only values
-- the UI can actually produce are listed — a value no screen can emit is a lie
-- in a funnel report. All three walls are wired: the wardrobe grid, the
-- add-garment form, and the Shop's "save to wardrobe" path
-- (saveProductToWardrobe() in src/lib/api/shop.ts, surfaced by
-- ProductDetailScreen). 'shop_save' is deliberately distinct from
-- 'add_garment' — collapsing them would typecheck and insert cleanly while
-- quietly corrupting the only report this table exists to produce.
--
-- 'shop_save' was added to live databases by migrations/005_waitlist_shop_source.sql;
-- it is inlined here because schema.sql stands up a fresh project in one pass.
create type waitlist_source as enum ('wardrobe_grid','add_garment','shop_save');

-- user_id is the PRIMARY KEY, not a plain FK beside a surrogate id. That is
-- the "they can't spam-join" requirement expressed as a constraint rather than
-- as application logic: a second insert is a 23505 that the client
-- (joinWaitlist() in src/lib/api/waitlist.ts) turns into a reassuring "you're
-- already on the list" instead of an error. There is no interesting second row
-- to keep — a user who taps twice has not expressed twice the demand.
--
-- `on delete cascade` from auth.users is load-bearing for privacy: this is a
-- marketing-consent record keyed to a person and the delete-account edge
-- function must not leave it behind. It is also why no client DELETE policy is
-- needed for account deletion (see the RLS block below).
create table public.waitlist_signups (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- Defaults to the caller's own JWT email, but is still accepted from the
  -- client, and that tradeoff is deliberate.
  --
  -- The default records the address Supabase Auth already verified, taken from
  -- the request's own JWT, so an insert that omits the column cannot be
  -- influenced by the client at all. `auth.jwt() ->> 'email'` rather than the
  -- deprecated `auth.email()`, and a function call rather than the more
  -- obvious `(select email from auth.users ...)`, because Postgres forbids
  -- subqueries in a DEFAULT expression.
  --
  -- But the column is NOT server-derived-only. FOR trusting the client: Sign
  -- in with Apple gives us a @privaterelay.appleid.com address for a large
  -- share of iOS users — a genuine mailbox, but not one people watch, and a
  -- launch announcement sent only there is one nobody reads. "Tell me at this
  -- other address" is the normal case, not the attack. AGAINST: a user can
  -- therefore put a stranger's address in their own row. RLS cannot prevent
  -- that — a `with check` can only constrain user_id, which is exactly the
  -- lesson affiliate_clicks wrote down above.
  --
  -- What we owe instead of a server-derived column is a confirmation step:
  -- treat every row here as single-opt-in and confirm before the list is ever
  -- mailed, which the private-relay case needs anyway.
  --
  -- NOT NULL with no fallback is intentional: a signup we cannot reach is
  -- worse than a failed signup, so an insert with neither a supplied email nor
  -- an email claim in the JWT (a phone-only user, or a service-role backfill
  -- that forgot the column) fails loudly at the database.
  email text not null default (auth.jwt() ->> 'email'),

  -- No default, on purpose: a caller that forgets to say where the user hit
  -- the wall should be rejected rather than silently attributed to the
  -- wardrobe grid.
  source waitlist_source not null,
  created_at timestamptz not null default now(),

  -- Shape-only validation. Not an attempt to decide whether an address is
  -- deliverable — nothing but sending to it can — it exists so a fat-finger
  -- ("ben@", a pasted display name, an empty string that NOT NULL happily
  -- accepts) fails at write time while the user is still looking at the input
  -- and can fix it, instead of surfacing months later as an unexplained gap in
  -- the launch send. 254 is the RFC 5321 maximum length for a forward path.
  constraint waitlist_signups_email_shape check (
    length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

-- The only query we actually run against this table: "who joined, most recent
-- first". Deliberately just the one index — the per-source breakdown is a
-- `group by` over a table that will hold thousands of rows at most, and a
-- second index to serve it would cost more to maintain than the seq scan it
-- saves.
create index waitlist_signups_created_idx
  on public.waitlist_signups(created_at desc);

-- --- Waitlist RLS ---------------------------------------------------------
alter table public.waitlist_signups enable row level security;

-- INSERT: own row only.
--
-- Unlike affiliate_clicks above, a plain `with check (user_id = auth.uid())`
-- IS sufficient here, and it is worth saying why so the next reader neither
-- cargo-cults the security-definer RPC pattern onto every table nor assumes
-- this one was overlooked.
--
-- The check constrains one column, exactly as it did there. The difference is
-- what the other columns are worth. `email` is discussed at length on the
-- column itself: forgeable, not money, mitigated by confirming before we send;
-- a forged address costs one message to someone who did not ask, is bounded to
-- one row per user by the primary key, and is the same exposure any "email
-- this to a friend" feature carries — where a forged commission_rate_bps
-- invoices a partner for their own order value. `source` is self-reported
-- attribution analytics bounded by an enum to two values (precisely the
-- reasoning that lets create_affiliate_click accept p_source from the client),
-- and the worst a liar achieves is skewing their own single row in our funnel
-- report. `created_at` is defaulted and is not in the app's insert payload. And
-- user_id, the only column that decides ownership, is exactly what this check
-- pins.
--
-- Nothing on this row is ever read back as a commercial term the way a click's
-- snapshotted rate is. IF THAT CHANGES — if a waitlist row ever grants
-- something of value, a founder price, a free month, early access worth
-- money — this policy is no longer sufficient and creation belongs in a
-- security-definer RPC like create_affiliate_click. Until then the RPC is
-- ceremony with a maintenance cost and no security benefit.
create policy "own waitlist signup insert" on public.waitlist_signups
  for insert with check (user_id = auth.uid());

-- SELECT: own row only, and nobody else's under any condition.
--
-- The app needs this to open the sheet in the right state — a user who already
-- joined must be told "you're on the list", not shown the form again and then
-- handed a duplicate-key error for tapping the obvious button.
--
-- Scoped to the caller's own uid, so this table cannot be used to enumerate
-- who signed up and — more to the point — cannot be used to read other users'
-- email addresses, which is the only thing in here worth stealing. There is no
-- aggregate/count policy either: "how many people are on the list" is a number
-- for us, from the service role, not something the client is entitled to ask
-- PostgREST for.
create policy "own waitlist signup select" on public.waitlist_signups
  for select using (user_id = auth.uid());

-- UPDATE: yes, but only the user's own row, and only the `email` column.
--
-- The case FOR an update policy is the one the primary key creates. Because a
-- user gets exactly one row and a second insert is rejected, someone who
-- typo'd their address on the way in — or who joined on the Apple private
-- relay and later wants the announcement somewhere they read — has no way
-- back. They are permanently on a list that cannot reach them, holding a UI
-- that cheerfully tells them they're all set. That is a worse dishonesty than
-- the fake Upgrade button this whole table exists to remove.
--
-- The case AGAINST is that `source` and `created_at` are the entire analytic
-- value of the table: *where* demand appeared and *when*. A blanket update
-- policy would let a client rewrite both, which does not enrich an attacker
-- but does quietly corrupt the only signal we are collecting.
--
-- Both are satisfied by splitting the question in two. RLS answers "which row"
-- (`using` + `with check`, so a user can neither reach another row nor hand
-- their own away by rewriting user_id). A column-level GRANT answers "which
-- columns" — see the grants below, where UPDATE is revoked wholesale and
-- re-granted on `email` alone. RLS has no column vocabulary; SQL privileges
-- do. Using the right one of the two is what keeps this narrow.
--
-- `created_at` is therefore the join date and never the edit date. That is the
-- intended reading: the consent and its timing are immutable, only the address
-- we honour it at can move. If an audit trail of address changes is ever
-- needed, it is a separate append-only table, not an updated_at here.
create policy "own waitlist signup email update" on public.waitlist_signups
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- DELETE: no policy, deliberately.
--
-- Two paths already cover the legitimate reasons a row should disappear:
-- account deletion (the `on delete cascade` from auth.users above, which the
-- delete-account edge function triggers) and unsubscribing (a link in whatever
-- we eventually send, handled service-side, which is where an unsubscribe
-- belongs because it must work from an email client with no session).
--
-- What remains is a "leave the list" button in the app, and there isn't one. A
-- policy with no caller is surface that outlives the reason it was added. When
-- that button ships, the policy it needs is exactly:
--   create policy "own waitlist signup delete" on public.waitlist_signups
--     for delete using (user_id = auth.uid());
-- and it should ship in the same change, not before it.

-- --- Waitlist grants ------------------------------------------------------
-- Supabase's default privileges hand `anon` and `authenticated` full DML on
-- new tables in `public`, leaving RLS as the only thing standing between them
-- and the data. That is fine for row scoping and useless for column scoping,
-- so the column-level restriction the UPDATE policy above relies on has to be
-- stated here.
--
-- Revoking UPDATE and re-granting it on `email` alone is what actually makes
-- `source` and `created_at` immutable to clients. Without these two lines the
-- policy above still passes and the row is fully rewritable — the policy and
-- the grant are one mechanism split across two statements, so do not delete
-- one without the other.
revoke update on public.waitlist_signups from anon, authenticated;
grant select, insert on public.waitlist_signups to authenticated;
grant update (email) on public.waitlist_signups to authenticated;

-- `anon` has no business here at all. RLS already blocks it — every policy
-- above tests `user_id = auth.uid()`, which is null for an anonymous request
-- and so never true — but Selv has no anonymous browsing (the wardrobe sits
-- behind the auth gate), so the privilege is removed outright rather than left
-- to be caught one layer down. Same defence-in-depth reasoning as the
-- `revoke execute ... from anon` on create_affiliate_click above.
revoke all on public.waitlist_signups from anon;
