-- ===========================================================================
-- 01_rls_two_account_audit.sql
-- ===========================================================================
-- Discharges LAUNCH_CHECKLIST.md §4:
--
--   "🔴 RLS audit: every user-owned table … has `user_id = auth.uid()` policies
--    verified with a real second-user test account, not just code review"
--
-- This is that second-user test. It seeds a footprint for user A, then drops
-- the session into the `authenticated` role wearing user B's JWT claims and
-- proves, table by table, that B can neither SEE, CREATE, ALTER nor DESTROY
-- anything of A's — using the same role and the same policy evaluation path
-- PostgREST uses for a real request.
--
-- Tables covered (all ten named in §4, plus waitlist_signups):
--   profiles, avatars, garments, outfits, outfit_items,
--   wishlist_items, product_try_ons,
--   affiliate_clicks, affiliate_conversions,
--   waitlist_signups
--
-- §7c additionally audits the 13+ minimum-age gate that landed in
-- migrations/006_age_gate.sql, because it is enforced by the same two
-- mechanisms as everything else here (an RLS policy plus a column grant) and
-- LAUNCH_CHECKLIST.md §1 asks for it to be *enforced*, not stated.
--
-- affiliate_clicks / affiliate_conversions are covered here for READ isolation
-- only. Their write path is deliberately not a client policy at all — that is
-- audited in 02_affiliate_write_path_audit.sql. Do not "fix" a missing insert
-- policy on either table; see schema.sql's comment block above
-- "own affiliate clicks select".
--
-- PREREQUISITE: run 00_harness.sql first.
-- SAFE TO RE-RUN: yes. Everything it seeds is tagged `[selv-verify]` /
-- `selv-verify` and removed by the teardown in §9.
-- ===========================================================================

reset role;

-- ===========================================================================
-- CONFIG — the only block you edit.
-- ===========================================================================
-- Paste the ids of the two throwaway accounts you created through the normal
-- signup path (see README §2). They MUST be two different real rows in
-- auth.users: the `on_auth_user_created` trigger has to have run, or the
-- profiles checks below test nothing.
-- ===========================================================================

drop table if exists selv_verify.params;
create table selv_verify.params as
select
  '00000000-0000-0000-0000-00000000000a'::uuid as user_a,   -- <<< EDIT
  '00000000-0000-0000-0000-00000000000b'::uuid as user_b,   -- <<< EDIT
  'selv-verify-a@example.com'::text            as email_a,  -- <<< EDIT
  'selv-verify-b@example.com'::text            as email_b,  -- <<< EDIT
  null::uuid as brand_id,
  null::uuid as product_id;

-- Accessors, so the assertions below read like English and the operator never
-- has to paste a uuid twice.
create or replace function selv_verify.uid_a()    returns uuid language sql stable as $$ select user_a    from selv_verify.params $$;
create or replace function selv_verify.uid_b()    returns uuid language sql stable as $$ select user_b    from selv_verify.params $$;
create or replace function selv_verify.email_a()  returns text language sql stable as $$ select email_a   from selv_verify.params $$;
create or replace function selv_verify.email_b()  returns text language sql stable as $$ select email_b   from selv_verify.params $$;
create or replace function selv_verify.brand_id() returns uuid language sql stable as $$ select brand_id  from selv_verify.params $$;
create or replace function selv_verify.prod_id()  returns uuid language sql stable as $$ select product_id from selv_verify.params $$;

grant select on selv_verify.params to authenticated, anon;
grant execute on all functions in schema selv_verify to authenticated, anon;

-- ===========================================================================
-- §0. Preconditions
-- ===========================================================================
-- A test that runs against one nonexistent user reports a beautiful all-PASS
-- report and means nothing, so refuse to continue if the ids are wrong.

do $$
declare v_n int;
begin
  select count(*) into v_n from auth.users
   where id in (selv_verify.uid_a(), selv_verify.uid_b());
  if v_n <> 2 then
    raise exception
      'CONFIG ERROR: expected 2 auth.users rows for user_a/user_b, found %. '
      'Create both accounts through signup first (see README §2).', v_n;
  end if;
  if selv_verify.uid_a() = selv_verify.uid_b() then
    raise exception 'CONFIG ERROR: user_a and user_b are the same id.';
  end if;
end $$;

-- Reset the age-gate columns on both test accounts so §2/§3 are deterministic
-- regardless of whether these users were created before or after
-- migrations/006_age_gate.sql. Runs as `postgres`, which bypasses both the
-- column grants and the restrictive policy — the only role that can.
--
-- If 006 has not been applied to this project yet, this is a no-op and the
-- age-gate checks in §7c report EXPECTED-ABSENT rather than failing. Applying
-- pending migrations to the live project is itself a hand-off item; see
-- SHIP_READINESS.md.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='profiles'
                and column_name='age_verified_on') then
    update public.profiles set birth_year = null, age_verified_on = null
     where id in (selv_verify.uid_a(), selv_verify.uid_b());
    perform selv_verify.note('01','§0 preconditions','age gate present',
      'migrations/006_age_gate.sql is applied; both test users reset to unverified.');
  else
    perform selv_verify.note('01','§0 preconditions','age gate NOT applied to this project',
      'profiles.age_verified_on does not exist. The §7c rows below will still '
      'read PASS, but for the wrong reason — their `actual` column will say '
      '"column does not exist" rather than "permission denied", so READ IT '
      'before believing the age gate is enforced. Apply '
      'migrations/006_age_gate.sql before submission: LAUNCH_CHECKLIST.md §1 '
      'requires an ENFORCED 13+ minimum, not a stated one.',
      'EXPECTED-ABSENT');
  end if;
end $$;

-- RLS must be ON for every table under audit. A table with RLS off is wide
-- open to anon regardless of how many policies it has, and this is the single
-- cheapest way to catch a migration that created a table and forgot the
-- `alter table … enable row level security`.
select selv_verify.expect_count(
  '01','§0 preconditions',
  'RLS enabled on all 10 audited tables',
  $q$select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relrowsecurity
        and c.relname in ('profiles','avatars','garments','outfits','outfit_items',
                          'wishlist_items','product_try_ons','affiliate_clicks',
                          'affiliate_conversions','waitlist_signups')$q$,
  10);

-- Informational: the full policy inventory, so the report is self-contained
-- and a reviewer does not have to open schema.sql to interpret it.
select selv_verify.note('01','§0 preconditions','policy inventory',
  string_agg(tablename||' → '||policyname||' ('||cmd||')', E'\n' order by tablename, policyname))
from pg_policies
where schemaname='public'
  and tablename in ('profiles','avatars','garments','outfits','outfit_items',
                    'wishlist_items','product_try_ons','affiliate_clicks',
                    'affiliate_conversions','waitlist_signups');

-- ===========================================================================
-- §1. Seed the catalog (service-role work — brands/products are system-owned)
-- ===========================================================================
-- wishlist_items, product_try_ons and affiliate_clicks all FK to a real
-- brand_product, so one has to exist before a user can own anything pointing
-- at it. Catalog rows are written by the service role in production
-- (dashboard / product-feed-ingest), which is what `postgres` stands in for
-- here — the client has no insert policy on either table.

with b as (
  insert into public.brands (slug, name, status, commission_rate_bps, network)
  values ('selv-verify','[selv-verify] Audit Brand','active',1000,'direct')
  on conflict (slug) do update
    set status='active', commission_rate_bps=1000
  returning id
), p as (
  insert into public.brand_products
    (brand_id, external_id, name, category, price_cents, image_url, product_url, is_active)
  select b.id,'SELV-VERIFY-1','[selv-verify] Audit Tee','top',5000,
         'https://example.invalid/img.png','https://example.invalid/p',true
  from b
  on conflict (brand_id, external_id) do update set is_active=true
  returning id, brand_id
)
update selv_verify.params set brand_id = p.brand_id, product_id = p.id from p;

select selv_verify.note('01','§1 catalog seed','test product created',
  'brand='||selv_verify.brand_id()::text||' product='||selv_verify.prod_id()::text);

-- affiliate_conversions has no client write path at all, so A's conversion row
-- is planted here as the service role — exactly how the affiliate-postback
-- Edge Function creates one.
insert into public.affiliate_conversions
  (user_id, brand_id, product_id, network, network_order_id,
   order_total_cents, commission_rate_bps, commission_cents, status)
values
  (selv_verify.uid_a(), selv_verify.brand_id(), selv_verify.prod_id(),
   'direct','SELV-VERIFY-ORDER-A', 5000, 1000, 500, 'pending')
on conflict (network, network_order_id) do update set user_id = excluded.user_id;

-- ===========================================================================
-- §2. Become user A and build A's footprint
-- ===========================================================================
-- Two jobs at once. It plants the rows B must not be able to reach, and it
-- proves the policies are not merely *tight* — a policy that denies everyone
-- including the owner would pass every isolation check in this file while
-- making the app unusable. Every statement here must succeed.

select set_config('request.jwt.claims',
                  selv_verify.claims(selv_verify.uid_a(), selv_verify.email_a()), false);
set role authenticated;

-- profiles: the row already exists (handle_new_user trigger). But since
-- migrations/006_age_gate.sql, a restrictive policy blocks every profile UPDATE
-- until the account has passed the age gate — so pass it the only way a client
-- can, through the security-definer RPC, then do the ordinary owner UPDATE.
do $$ begin
  if to_regprocedure('public.record_age_check(date)') is not null then
    perform public.record_age_check('1990-01-01'::date);
  end if;
end $$;

update public.profiles set display_name = '[selv-verify] A' where id = selv_verify.uid_a();

insert into public.avatars (user_id, customization)
values (selv_verify.uid_a(), '{"skinTone":"#C68A5F","bodyType":"average"}'::jsonb)
on conflict (user_id) do update set customization = excluded.customization;

insert into public.garments (user_id, image_path, category, name)
values (selv_verify.uid_a(), selv_verify.uid_a()::text||'/verify-a.jpg','top','[selv-verify] A tee');

insert into public.outfits (user_id, name) values (selv_verify.uid_a(),'[selv-verify] A outfit');

insert into public.outfit_items (outfit_id, garment_id)
select o.id, g.id
  from public.outfits o, public.garments g
 where o.user_id = selv_verify.uid_a() and o.name = '[selv-verify] A outfit'
   and g.user_id = selv_verify.uid_a() and g.name = '[selv-verify] A tee'
 limit 1;

insert into public.wishlist_items (user_id, product_id)
values (selv_verify.uid_a(), selv_verify.prod_id()) on conflict do nothing;

insert into public.product_try_ons (user_id, product_id)
values (selv_verify.uid_a(), selv_verify.prod_id());

insert into public.waitlist_signups (user_id, email, source)
values (selv_verify.uid_a(), selv_verify.email_a(), 'wardrobe_grid')
on conflict (user_id) do nothing;

-- A's affiliate click, created the only way a client can: through the RPC.
select public.create_affiliate_click(selv_verify.prod_id(), 'shop');

-- Sanity: A can read A's own rows back. If any of these is 0 the policies are
-- too tight and every isolation PASS below is vacuous.
select selv_verify.expect_count('01','§2 owner access','A sees own profile',
  $q$select count(*) from public.profiles where id = selv_verify.uid_a()$q$, 1);
select selv_verify.expect_count('01','§2 owner access','A sees own avatar',
  $q$select count(*) from public.avatars where user_id = selv_verify.uid_a()$q$, 1);
select selv_verify.expect_count('01','§2 owner access','A sees own garment',
  $q$select count(*) from public.garments where user_id = selv_verify.uid_a()$q$, 1);
select selv_verify.expect_count('01','§2 owner access','A sees own outfit',
  $q$select count(*) from public.outfits where user_id = selv_verify.uid_a()$q$, 1);
select selv_verify.expect_count('01','§2 owner access','A sees own outfit_item',
  $q$select count(*) from public.outfit_items oi join public.outfits o on o.id=oi.outfit_id
      where o.user_id = selv_verify.uid_a()$q$, 1);
select selv_verify.expect_count('01','§2 owner access','A sees own wishlist_item',
  $q$select count(*) from public.wishlist_items where user_id = selv_verify.uid_a()$q$, 1);
select selv_verify.expect_count('01','§2 owner access','A sees own try_on',
  $q$select count(*) from public.product_try_ons where user_id = selv_verify.uid_a()$q$, 1);
select selv_verify.expect_count('01','§2 owner access','A sees own waitlist_signup',
  $q$select count(*) from public.waitlist_signups where user_id = selv_verify.uid_a()$q$, 1);
select selv_verify.expect_count('01','§2 owner access','A sees own affiliate_click',
  $q$select count(*) from public.affiliate_clicks where user_id = selv_verify.uid_a()$q$, 1);
select selv_verify.expect_count('01','§2 owner access','A sees own affiliate_conversion',
  $q$select count(*) from public.affiliate_conversions where user_id = selv_verify.uid_a()$q$, 1);

reset role;

-- ===========================================================================
-- §3. Become user B and build a minimal footprint of B's own
-- ===========================================================================
-- Needed so §4's "B sees exactly 1 row, and it is B's" assertions can tell
-- "isolation works" apart from "the query is broken and returns nothing".

select set_config('request.jwt.claims',
                  selv_verify.claims(selv_verify.uid_b(), selv_verify.email_b()), false);
set role authenticated;

-- BEFORE age-verifying B: the restrictive "profile writes require the age gate"
-- policy must block B from writing its OWN profile row. This is the check that
-- turns "we ask for a birthdate" into "the database refuses to let an
-- unverified account finish onboarding" — `profiles.build` is the gate into
-- the product and an UPDATE here is the only way to set it, so a client that
-- skips the age screen and talks to PostgREST directly gets nowhere.
-- 0 rows, not an error: a restrictive `using` clause filters, it does not raise.
select selv_verify.expect_affected('01','§7c age gate',
  'unverified account cannot write its own profile (blocks onboarding bypass)',
  $q$update public.profiles set build='average' where id = selv_verify.uid_b()$q$, 0);

do $$ begin
  if to_regprocedure('public.record_age_check(date)') is not null then
    perform public.record_age_check('1990-01-01'::date);
  end if;
end $$;

update public.profiles set display_name = '[selv-verify] B' where id = selv_verify.uid_b();

insert into public.avatars (user_id, customization)
values (selv_verify.uid_b(), '{"skinTone":"#3C2116","bodyType":"broad"}'::jsonb)
on conflict (user_id) do update set customization = excluded.customization;

insert into public.garments (user_id, image_path, category, name)
values (selv_verify.uid_b(), selv_verify.uid_b()::text||'/verify-b.jpg','bottom','[selv-verify] B jeans');

insert into public.outfits (user_id, name) values (selv_verify.uid_b(),'[selv-verify] B outfit');

-- ===========================================================================
-- §4. READ isolation — B must not see any of A's rows
-- ===========================================================================
-- Still wearing B's claims. Every one of these must be 0.

select selv_verify.expect_count('01','§4 read isolation','B cannot read A profile',
  $q$select count(*) from public.profiles where id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','B cannot read A avatar',
  $q$select count(*) from public.avatars where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','B cannot read A garments',
  $q$select count(*) from public.garments where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','B cannot read A outfits',
  $q$select count(*) from public.outfits where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','B cannot read A outfit_items',
  $q$select count(*) from public.outfit_items oi
      where oi.outfit_id in (select id from public.outfits)
        and oi.garment_id in (select id from public.garments where user_id = selv_verify.uid_a())$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','B cannot read A wishlist_items',
  $q$select count(*) from public.wishlist_items where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','B cannot read A product_try_ons',
  $q$select count(*) from public.product_try_ons where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','B cannot read A affiliate_clicks',
  $q$select count(*) from public.affiliate_clicks where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','B cannot read A affiliate_conversions',
  $q$select count(*) from public.affiliate_conversions where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','B cannot read A waitlist_signup',
  $q$select count(*) from public.waitlist_signups where user_id = selv_verify.uid_a()$q$, 0);

-- The stronger form of the same claim: an UNFILTERED select must return only
-- B's own rows. This catches a policy whose `using` clause is `true` — which a
-- `where user_id = A` probe would still report as 0 rows if the planner
-- filtered it out anyway. It is the version of the check that actually matters
-- for a table like waitlist_signups, where the interesting attack is
-- enumerating everyone's email rather than reading one known person's.
select selv_verify.expect_count('01','§4 read isolation','unfiltered profiles = own row only',
  $q$select count(*) from public.profiles where id <> selv_verify.uid_b()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','unfiltered avatars = own row only',
  $q$select count(*) from public.avatars where user_id <> selv_verify.uid_b()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','unfiltered garments = own rows only',
  $q$select count(*) from public.garments where user_id <> selv_verify.uid_b()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','unfiltered outfits = own rows only',
  $q$select count(*) from public.outfits where user_id <> selv_verify.uid_b()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','unfiltered wishlist_items = own rows only',
  $q$select count(*) from public.wishlist_items where user_id <> selv_verify.uid_b()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','unfiltered product_try_ons = own rows only',
  $q$select count(*) from public.product_try_ons where user_id <> selv_verify.uid_b()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','unfiltered affiliate_clicks = own rows only',
  $q$select count(*) from public.affiliate_clicks where user_id is distinct from selv_verify.uid_b()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','unfiltered affiliate_conversions = own rows only',
  $q$select count(*) from public.affiliate_conversions where user_id is distinct from selv_verify.uid_b()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','unfiltered waitlist_signups = own rows only (no email harvest)',
  $q$select count(*) from public.waitlist_signups where user_id <> selv_verify.uid_b()$q$, 0);
select selv_verify.expect_count('01','§4 read isolation','unfiltered outfit_items = own outfits only',
  $q$select count(*) from public.outfit_items oi
      where not exists (select 1 from public.outfits o
                        where o.id = oi.outfit_id and o.user_id = selv_verify.uid_b())$q$, 0);

-- ===========================================================================
-- §5. WRITE isolation — B must not be able to create a row owned by A
-- ===========================================================================
-- These are INSERTs whose `with check` must reject them, so each one is
-- expected to RAISE (42501). Still wearing B's claims.

select selv_verify.expect_error('01','§5 forged ownership','B cannot insert an avatar as A',
  $q$insert into public.avatars (user_id, customization)
     values (selv_verify.uid_a(), '{"forged":true}'::jsonb)$q$);
select selv_verify.expect_error('01','§5 forged ownership','B cannot insert a garment as A',
  $q$insert into public.garments (user_id, image_path, category)
     values (selv_verify.uid_a(), 'forged/x.jpg', 'top')$q$);
select selv_verify.expect_error('01','§5 forged ownership','B cannot insert an outfit as A',
  $q$insert into public.outfits (user_id, name) values (selv_verify.uid_a(),'forged')$q$);
select selv_verify.expect_error('01','§5 forged ownership','B cannot insert a wishlist_item as A',
  $q$insert into public.wishlist_items (user_id, product_id)
     values (selv_verify.uid_a(), selv_verify.prod_id())$q$);
select selv_verify.expect_error('01','§5 forged ownership','B cannot insert a try_on as A',
  $q$insert into public.product_try_ons (user_id, product_id)
     values (selv_verify.uid_a(), selv_verify.prod_id())$q$);
select selv_verify.expect_error('01','§5 forged ownership','B cannot insert a profile row as A',
  $q$insert into public.profiles (id, display_name) values (selv_verify.uid_a(),'forged')$q$);
select selv_verify.expect_error('01','§5 forged ownership','B cannot join the waitlist as A',
  $q$insert into public.waitlist_signups (user_id, email, source)
     values (selv_verify.uid_a(),'attacker@example.com','wardrobe_grid')$q$);
select selv_verify.expect_error('01','§5 forged ownership','B cannot add an item to A''s outfit',
  $q$insert into public.outfit_items (outfit_id, garment_id)
     select o.id, g.id from public.outfits o, public.garments g
      where o.name='[selv-verify] A outfit' and g.name='[selv-verify] A tee' limit 1$q$);

-- affiliate_clicks / affiliate_conversions: there is NO client insert policy on
-- either table, by design. Both of these must be rejected even when B claims
-- its OWN user_id — the point is not ownership, it is that a client may never
-- author a commercial term. Full audit of the sanctioned write path is in 02.
select selv_verify.expect_error('01','§5 forged ownership','B cannot insert an affiliate_click at all (no insert policy — INTENDED)',
  $q$insert into public.affiliate_clicks
       (click_token,user_id,product_id,brand_id,source,commission_rate_bps,price_cents_at_click)
     values ('selv_forged', selv_verify.uid_b(), selv_verify.prod_id(),
             selv_verify.brand_id(), 'shop', 10000, 1)$q$);
select selv_verify.expect_error('01','§5 forged ownership','B cannot insert an affiliate_conversion at all (no insert policy — INTENDED)',
  $q$insert into public.affiliate_conversions
       (user_id,brand_id,network,network_order_id,order_total_cents,commission_rate_bps,commission_cents)
     values (selv_verify.uid_b(), selv_verify.brand_id(),'direct','FORGED',999999,10000,999999)$q$);

-- ===========================================================================
-- §6. UPDATE / DELETE isolation — B must not be able to alter or destroy A's rows
-- ===========================================================================
-- NOTE THE DIFFERENT ASSERTION. RLS does not raise on UPDATE/DELETE: rows the
-- `using` clause hides are simply never matched, so the statement SUCCEEDS and
-- reports zero rows. Asserting an error here would report false failures; not
-- asserting the row count at all would miss a genuinely open policy. Expect 0.

select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot rename A''s profile',
  $q$update public.profiles set display_name='pwned' where id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot rewrite A''s avatar',
  $q$update public.avatars set customization='{"pwned":true}'::jsonb where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot steal A''s garment',
  $q$update public.garments set user_id = selv_verify.uid_b() where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot delete A''s garment',
  $q$delete from public.garments where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot delete A''s outfit',
  $q$delete from public.outfits where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot delete A''s outfit_items',
  $q$delete from public.outfit_items oi
      using public.outfits o where o.id=oi.outfit_id and o.user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot delete A''s wishlist_item',
  $q$delete from public.wishlist_items where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot delete A''s try_on',
  $q$delete from public.product_try_ons where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot change A''s waitlist email',
  $q$update public.waitlist_signups set email='attacker@example.com' where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot rewrite A''s click commission rate',
  $q$update public.affiliate_clicks set commission_rate_bps = 10000 where user_id = selv_verify.uid_a()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot rewrite A''s conversion total',
  $q$update public.affiliate_conversions set order_total_cents = 999999 where user_id = selv_verify.uid_a()$q$, 0);

-- Write-once check: clicks and conversions are not editable by their OWNER
-- either. There is no update or delete policy on either table, so B's own rows
-- are equally immutable from the client. (0 rows, not an error — same reason.)
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot edit its OWN affiliate_clicks (write-once — INTENDED)',
  $q$update public.affiliate_clicks set commission_rate_bps = 10000 where user_id = selv_verify.uid_b()$q$, 0);
select selv_verify.expect_affected('01','§6 update/delete isolation','B cannot delete its OWN affiliate_conversions (INTENDED)',
  $q$delete from public.affiliate_conversions where user_id = selv_verify.uid_b()$q$, 0);

-- ===========================================================================
-- §7. waitlist_signups column grants
-- ===========================================================================
-- This table's UPDATE protection is split across two mechanisms that only work
-- together: an RLS policy picks the ROW, a column-level GRANT picks the
-- COLUMNS (`revoke update … ; grant update (email) …` in schema.sql). RLS has
-- no column vocabulary, so auditing only pg_policies here would miss half of
-- it and report `source` / `created_at` as protected when they are not.

insert into public.waitlist_signups (user_id, email, source)
values (selv_verify.uid_b(), selv_verify.email_b(), 'add_garment')
on conflict (user_id) do nothing;

select selv_verify.expect_affected('01','§7 waitlist column grants','B CAN correct its own email (1 row)',
  $q$update public.waitlist_signups set email='corrected@example.com' where user_id = selv_verify.uid_b()$q$, 1);
select selv_verify.expect_error('01','§7 waitlist column grants','B cannot rewrite `source` (funnel integrity)',
  $q$update public.waitlist_signups set source='shop_save' where user_id = selv_verify.uid_b()$q$);
select selv_verify.expect_error('01','§7 waitlist column grants','B cannot backdate `created_at` (consent timing)',
  $q$update public.waitlist_signups set created_at = now() - interval '1 year' where user_id = selv_verify.uid_b()$q$);
select selv_verify.expect_affected('01','§7 waitlist column grants','B cannot delete its own signup (no delete policy — INTENDED)',
  $q$delete from public.waitlist_signups where user_id = selv_verify.uid_b()$q$, 0);

-- ===========================================================================
-- §7b. Observation: outfit_items only checks the parent outfit's owner
-- ===========================================================================
-- The "own outfit items" policy constrains `outfit_id` (via the parent's
-- user_id) and says nothing about `garment_id`. So B CAN attach a garment id
-- belonging to A to one of B's own outfits.
--
-- Recorded as an observation, not a failure, and here is the honest reasoning:
-- it discloses nothing. Reading that outfit still joins `garments`, where A's
-- row stays invisible, so the item renders as absent. What it costs is a
-- theoretical existence oracle for a garment uuid — and the uuid is v4, so
-- guessing one is not an attack anyone can mount. Do not block a launch on it.
--
-- If you want it closed anyway, the `with check` becomes:
--     exists (select 1 from public.outfits o
--              where o.id = outfit_id and o.user_id = auth.uid())
--     and exists (select 1 from public.garments g
--                  where g.id = garment_id and g.user_id = auth.uid())
select selv_verify.note('01','§7b observation',
  'outfit_items.with_check constrains outfit_id only, not garment_id',
  'B can reference one of A''s garment ids from B''s own outfit. No data is '
  'disclosed (the garments join is still RLS-filtered); cost is a uuid-v4 '
  'existence oracle. Non-blocking. Tightening expression is in the comment above.',
  'INFO');

-- ===========================================================================
-- §7c. Minimum-age gate (13+) — enforced, not merely stated
-- ===========================================================================
-- LAUNCH_CHECKLIST.md §1 asks for a minimum age of 13 that is *enforced*, and
-- PRIVACY_POLICY.md §12 promises users "we enforce a minimum age at signup".
-- The enforcement is three separate controls, and each one is useless alone:
--   (1) a column-level GRANT so a client cannot write the verdict itself,
--   (2) a SECURITY DEFINER RPC that is the only writer of that verdict, and
--   (3) a RESTRICTIVE policy so an account with no verdict cannot proceed.
-- (3) was already checked above, before B was verified. (1) and (2) are here.
--
-- Still wearing B's claims, and B is now age-verified.

select selv_verify.expect_error('01','§7c age gate','B cannot forge its own age verdict (column grant)',
  $q$update public.profiles set age_verified_on = current_date, birth_year = 1990
      where id = selv_verify.uid_b()$q$);
select selv_verify.expect_error('01','§7c age gate','B cannot set birth_year directly',
  $q$update public.profiles set birth_year = 2020 where id = selv_verify.uid_b()$q$);
select selv_verify.expect_error('01','§7c age gate','record_age_check refuses an under-13 birthdate',
  $q$select public.record_age_check((current_date - interval '12 years')::date)$q$);
select selv_verify.expect_error('01','§7c age gate','record_age_check refuses a future birthdate',
  $q$select public.record_age_check((current_date + interval '1 day')::date)$q$);

-- The grant surface, asserted directly rather than inferred from the DDL.
select selv_verify.expect_count('01','§7c age gate','authenticated has NO update on birth_year/age_verified_on',
  $q$select count(*) from (values ('birth_year'),('age_verified_on')) t(c)
      where has_column_privilege('authenticated','public.profiles',t.c,'UPDATE')$q$, 0);
select selv_verify.expect_count('01','§7c age gate','authenticated DOES keep update on the app-written columns',
  $q$select count(*) from (values ('display_name'),('body_type'),('height_cm'),('weight_kg'),('build')) t(c)
      where has_column_privilege('authenticated','public.profiles',t.c,'UPDATE')$q$, 5);
select selv_verify.expect_count('01','§7c age gate','anon cannot execute record_age_check',
  $q$select count(*) from (select 1) x
      where has_function_privilege('anon','public.record_age_check(date)','EXECUTE')$q$, 0);
select selv_verify.expect_count('01','§7c age gate','record_age_check is SECURITY DEFINER with a pinned search_path',
  $q$select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='record_age_check'
        and p.prosecdef and array_to_string(p.proconfig,',') ~ '^search_path='$q$, 1);

reset role;

-- ===========================================================================
-- §8. Anonymous access — the anon key ships inside the app binary
-- ===========================================================================
-- `anon` is the role every unauthenticated PostgREST request runs as, and its
-- key is embedded in the shipped app, so it is not a secret. Every policy in
-- the schema tests `user_id = auth.uid()`, which is NULL for anon and therefore
-- never true — but Selv has no anonymous browsing at all, so verify it rather
-- than reasoning about it.

select set_config('request.jwt.claims', '', false);
set role anon;

select selv_verify.expect_count('01','§8 anon','anon sees no profiles',       $q$select count(*) from public.profiles$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no avatars',        $q$select count(*) from public.avatars$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no garments',       $q$select count(*) from public.garments$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no outfits',        $q$select count(*) from public.outfits$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no outfit_items',   $q$select count(*) from public.outfit_items$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no wishlist_items', $q$select count(*) from public.wishlist_items$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no product_try_ons',$q$select count(*) from public.product_try_ons$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no affiliate_clicks',$q$select count(*) from public.affiliate_clicks$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no affiliate_conversions',$q$select count(*) from public.affiliate_conversions$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no waitlist_signups (no email harvest)',$q$select count(*) from public.waitlist_signups$q$, 0);
select selv_verify.expect_count('01','§8 anon','anon sees no brand_api_keys',  $q$select count(*) from public.brand_api_keys$q$, 0);
select selv_verify.expect_error('01','§8 anon','anon cannot touch waitlist_signups at all (privileges revoked)',
  $q$insert into public.waitlist_signups (user_id,email,source)
     values (selv_verify.uid_a(),'anon@example.com','wardrobe_grid')$q$);

reset role;

-- ===========================================================================
-- §9. Report
-- ===========================================================================

select verdict, count(*) as checks
  from selv_verify.results where script='01' group by verdict order by 1;

select id, section, check_name, expected, actual, verdict
  from selv_verify.results where script='01' order by id;

select case
  when exists (select 1 from selv_verify.results where script='01' and verdict='FAIL')
  then '❌ 01 FAILED — do not submit. See the FAIL rows above.'
  else '✅ 01 PASSED — cross-user isolation proven for all 10 tables + waitlist.'
end as verdict;

-- ===========================================================================
-- §10. Teardown — removes everything this script created, nothing else
-- ===========================================================================
-- Commented out so you can inspect the results table first. Uncomment and run
-- once you have read the report.
--
-- delete from public.affiliate_conversions where network_order_id like 'SELV-VERIFY-%';
-- delete from public.affiliate_clicks       where product_id in (select id from public.brand_products where external_id='SELV-VERIFY-1');
-- delete from public.product_try_ons        where product_id in (select id from public.brand_products where external_id='SELV-VERIFY-1');
-- delete from public.wishlist_items         where product_id in (select id from public.brand_products where external_id='SELV-VERIFY-1');
-- delete from public.outfit_items oi using public.outfits o
--        where o.id = oi.outfit_id and o.name like '[selv-verify]%';
-- delete from public.outfits   where name like '[selv-verify]%';
-- delete from public.garments  where name like '[selv-verify]%';
-- delete from public.avatars   where user_id in (select user_a from selv_verify.params union select user_b from selv_verify.params);
-- delete from public.waitlist_signups where user_id in (select user_a from selv_verify.params union select user_b from selv_verify.params);
-- delete from public.brand_products where external_id = 'SELV-VERIFY-1';
-- delete from public.brands where slug = 'selv-verify';
-- drop schema selv_verify cascade;
--
-- The two throwaway auth.users rows are left in place — script 02 reuses them.
-- Delete them from the dashboard when you are done with 02 and 03.

-- ===========================================================================
-- APPENDIX — the HTTP half of this test
-- ===========================================================================
-- Everything above proves the DATABASE refuses cross-user access. It does not
-- prove PostgREST is handing requests to the `authenticated` role with the
-- right claims. Run these too, with two real access tokens (sign in as each
-- test user in the app and copy `session.access_token`, or use
-- POST /auth/v1/token?grant_type=password).
--
--   export URL=https://<project-ref>.supabase.co
--   export ANON=<anon key from the Supabase dashboard>
--   export TOKEN_B=<user B's access token>
--   export UID_A=<user A's uuid>
--
-- 1. B asks PostgREST for A's garments. MUST return [].
--    curl -s "$URL/rest/v1/garments?user_id=eq.$UID_A" \
--         -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_B"
--
-- 2. B asks for every garment, unfiltered. MUST return only B's own.
--    curl -s "$URL/rest/v1/garments?select=id,user_id" \
--         -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_B"
--
-- 3. B tries to harvest the waitlist. MUST return only B's own row (or []).
--    curl -s "$URL/rest/v1/waitlist_signups?select=user_id,email" \
--         -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_B"
--
-- 4. B forges a garment owned by A. MUST return 401/403 with code 42501.
--    curl -s -X POST "$URL/rest/v1/garments" \
--         -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_B" \
--         -H "Content-Type: application/json" \
--         -d "{\"user_id\":\"$UID_A\",\"image_path\":\"x/y.jpg\",\"category\":\"top\"}"
--
-- 5. Anon, holding only the shipped app's key. MUST return [] for all of them.
--    curl -s "$URL/rest/v1/garments" -H "apikey: $ANON"
--    curl -s "$URL/rest/v1/waitlist_signups" -H "apikey: $ANON"
--    curl -s "$URL/rest/v1/brand_api_keys" -H "apikey: $ANON"
-- ===========================================================================
