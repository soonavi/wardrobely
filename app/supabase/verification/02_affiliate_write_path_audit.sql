-- ===========================================================================
-- 02_affiliate_write_path_audit.sql
-- ===========================================================================
-- Discharges the second half of LAUNCH_CHECKLIST.md §4's RLS item:
--
--   "Deliberate exception, don't 'fix' it: affiliate_clicks /
--    affiliate_conversions are select-only — there is no client insert policy,
--    because those rows carry forgeable commission terms and are written
--    through an RPC / the affiliate-postback Edge Function instead. Audit that
--    the INSERT PATH is what's locked down, not that a missing insert policy
--    gets added."
--
-- ┌───────────────────────────────────────────────────────────────────────┐
-- │ READ THIS BEFORE ACTING ON ANY OUTPUT                                  │
-- │                                                                        │
-- │ The absence of an INSERT policy on affiliate_clicks and                │
-- │ affiliate_conversions is the security control, not a gap in it. This   │
-- │ script reports that absence as EXPECTED-ABSENT and it must stay that   │
-- │ way. DO NOT "fix" it by adding                                         │
-- │     for insert with check (user_id = auth.uid())                       │
-- │ That policy constrains exactly one column. Every column that carries   │
-- │ commercial meaning — commission_rate_bps, price_cents_at_click,        │
-- │ brand_id, click_token — would then arrive verbatim from a client       │
-- │ holding the anon key, which ships inside the app binary and is not a   │
-- │ secret. A user could write a click at 10000 bps, complete a real       │
-- │ purchase, and we would invoice the brand for 100% of their own order   │
-- │ value. See the comment block above "own affiliate clicks select" in    │
-- │ schema.sql, and migrations/003_affiliate_click_rpc.sql, which exists   │
-- │ solely to remove that policy.                                          │
-- └───────────────────────────────────────────────────────────────────────┘
--
-- So the question this script asks is not "is there a policy?" but:
--   A. is every client write path to those two tables actually shut, and
--   B. does the sanctioned path — public.create_affiliate_click() — derive the
--      commercial terms itself rather than accepting them?
--
-- PREREQUISITE: run 00_harness.sql, then 01_rls_two_account_audit.sql (this
-- script reuses its `selv_verify.params`, its two test users and its seeded
-- catalog rows). Do not run 01's teardown before running this.
-- ===========================================================================

reset role;

-- Capture table for the clicks §4–§5 mint through the RPC. A real table rather
-- than a TEMP one so it survives the `set role` / `reset role` hops and so the
-- assertions below can be read as part of the same report.
drop table if exists selv_verify.captured;
create table selv_verify.captured (
  label               text,
  click_token         text,
  user_id             uuid,
  product_id          uuid,
  brand_id            uuid,
  source              text,
  commission_rate_bps integer,
  price_cents_at_click integer
);
grant insert, select on selv_verify.captured to authenticated, anon;

-- ===========================================================================
-- §1. The shape of the lockdown — asserted from the catalog, not from the DDL
-- ===========================================================================

-- Exactly one policy on affiliate_clicks, and it is SELECT.
select selv_verify.expect_count('02','§1 policy shape','affiliate_clicks has exactly 1 policy',
  $q$select count(*) from pg_policies
      where schemaname='public' and tablename='affiliate_clicks'$q$, 1);
select selv_verify.expect_count('02','§1 policy shape','…and it is a SELECT policy on user_id = auth.uid()',
  $q$select count(*) from pg_policies
      where schemaname='public' and tablename='affiliate_clicks'
        and cmd='SELECT' and qual like '%auth.uid()%'$q$, 1);

-- The absence, stated positively so a future reader cannot mistake it for an
-- oversight. If any of these ever returns 1, someone re-opened the hole.
select selv_verify.expect_count('02','§1 policy shape',
  'affiliate_clicks has NO insert/update/delete policy (INTENDED — do not add one)',
  $q$select count(*) from pg_policies
      where schemaname='public' and tablename='affiliate_clicks'
        and cmd in ('INSERT','UPDATE','DELETE','ALL')$q$, 0);
select selv_verify.expect_count('02','§1 policy shape',
  'affiliate_conversions has NO insert/update/delete policy (INTENDED)',
  $q$select count(*) from pg_policies
      where schemaname='public' and tablename='affiliate_conversions'
        and cmd in ('INSERT','UPDATE','DELETE','ALL')$q$, 0);
select selv_verify.note('02','§1 policy shape',
  'missing INSERT policy on affiliate_clicks / affiliate_conversions',
  'Confirmed absent. This is the control. migrations/003_affiliate_click_rpc.sql '
  'drops the old "own affiliate clicks insert" policy on purpose; re-adding it '
  'forges the commission ledger undetectably, because a forged click row is '
  'byte-identical to a real one.',
  'EXPECTED-ABSENT');

-- brand_api_keys: RLS on, ZERO policies. With RLS enabled and no policy at all,
-- anon/authenticated can neither read nor write a row, while service_role
-- bypasses RLS entirely. Partner credentials are reachable only from Edge
-- Functions. Also do-not-add-a-policy territory.
select selv_verify.expect_count('02','§1 policy shape','brand_api_keys has RLS enabled',
  $q$select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='brand_api_keys' and c.relrowsecurity$q$, 1);
select selv_verify.expect_count('02','§1 policy shape','brand_api_keys has ZERO policies (INTENDED)',
  $q$select count(*) from pg_policies
      where schemaname='public' and tablename='brand_api_keys'$q$, 0);

-- ===========================================================================
-- §2. The RPC's own properties
-- ===========================================================================
-- create_affiliate_click is SECURITY DEFINER — it runs as its owner, which is
-- precisely what lets it write a table the caller has no INSERT policy on. Two
-- things therefore have to hold, or the definer privilege becomes the hole:
--   * a pinned empty search_path, so it cannot be induced to resolve
--     `brands` / `brand_products` through the caller's search_path and read a
--     commission rate out of an attacker-controlled schema; and
--   * EXECUTE granted to `authenticated` only. `create function` grants EXECUTE
--     to PUBLIC by default, so without the revoke, `anon` — whose key ships in
--     the app — inherits the right to call a revenue-writing definer function.

select selv_verify.expect_count('02','§2 RPC properties','create_affiliate_click exists and is SECURITY DEFINER',
  $q$select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='create_affiliate_click' and p.prosecdef$q$, 1);
select selv_verify.expect_count('02','§2 RPC properties','…with a pinned empty search_path',
  $q$select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='create_affiliate_click'
        and array_to_string(p.proconfig,',') ~ '^search_path='$q$, 1);
select selv_verify.expect_count('02','§2 RPC properties','EXECUTE granted to authenticated',
  $q$select count(*) from (select 1) x
      where has_function_privilege('authenticated',
            'public.create_affiliate_click(uuid,public.click_source)','EXECUTE')$q$, 1);
select selv_verify.expect_count('02','§2 RPC properties','EXECUTE revoked from anon',
  $q$select count(*) from (select 1) x
      where has_function_privilege('anon',
            'public.create_affiliate_click(uuid,public.click_source)','EXECUTE')$q$, 0);
-- A NULL proacl is NOT "no grants" — it means default privileges are in force,
-- and the default for a function is EXECUTE to PUBLIC. Treating null as clean
-- is the classic way this check reports a false pass, so it is failed here.
select selv_verify.expect_count('02','§2 RPC properties','EXECUTE revoked from PUBLIC (null ACL counts as granted)',
  $q$select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='create_affiliate_click'
        and (p.proacl is null
             or array_to_string(p.proacl,',') ~ '(^|,)=X/')$q$, 0);

-- The signature itself is a control: two arguments, neither of them money.
-- A caller can name a product and a surface. It cannot name a rate, a price, a
-- brand, a token, or a user.
select selv_verify.expect_count('02','§2 RPC properties','RPC accepts exactly 2 args (p_product_id, p_source) — no commercial inputs',
  $q$select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='create_affiliate_click'
        and p.pronargs = 2
        and pg_get_function_arguments(p.oid) = 'p_product_id uuid, p_source click_source'$q$, 1);

-- ===========================================================================
-- §3. Direct client writes must be refused — as owner as well as cross-user
-- ===========================================================================
-- 01 §5 already proved user B cannot forge a click owned by A. The stronger
-- point is here: B cannot write a click owned by B EITHER. Ownership was never
-- the question — the question is whether a client may author a commercial term
-- at all, and the answer must be no even for its own row.

select set_config('request.jwt.claims',
                  selv_verify.claims(selv_verify.uid_b(), selv_verify.email_b()), false);
set role authenticated;

select selv_verify.expect_error('02','§3 direct writes','client INSERT into affiliate_clicks (own user_id) is refused',
  $q$insert into public.affiliate_clicks
       (click_token,user_id,product_id,brand_id,source,commission_rate_bps,price_cents_at_click)
     values ('selv_direct_'||gen_random_uuid()::text, selv_verify.uid_b(),
             selv_verify.prod_id(), selv_verify.brand_id(),'shop',10000,1)$q$);
select selv_verify.expect_error('02','§3 direct writes','client INSERT into affiliate_conversions (own user_id) is refused',
  $q$insert into public.affiliate_conversions
       (user_id,brand_id,network,network_order_id,order_total_cents,commission_rate_bps,commission_cents)
     values (selv_verify.uid_b(), selv_verify.brand_id(),'direct',
             'DIRECT-'||gen_random_uuid()::text, 999999, 10000, 999999)$q$);
select selv_verify.expect_error('02','§3 direct writes','client INSERT into brand_api_keys is refused',
  $q$insert into public.brand_api_keys (brand_id,label,key_hash)
     values (selv_verify.brand_id(),'forged', md5(random()::text))$q$);

-- Catalog tables are read-only to clients too: a client that could edit
-- brand_products.commission_rate_bps would just move the forgery one table
-- over, since the RPC reads its rate from there.
select selv_verify.expect_error('02','§3 direct writes','client cannot INSERT a brand_product',
  $q$insert into public.brand_products
       (brand_id,external_id,name,category,price_cents,image_url,product_url)
     values (selv_verify.brand_id(),'FORGED','x','top',1,'https://x.invalid','https://x.invalid')$q$);
select selv_verify.expect_affected('02','§3 direct writes','client cannot raise a brand_product commission rate',
  $q$update public.brand_products set commission_rate_bps = 10000
      where id = selv_verify.prod_id()$q$, 0);
select selv_verify.expect_affected('02','§3 direct writes','client cannot raise a brand commission rate',
  $q$update public.brands set commission_rate_bps = 10000 where id = selv_verify.brand_id()$q$, 0);

-- ===========================================================================
-- §4. The sanctioned path works, and derives every commercial term itself
-- ===========================================================================
-- Still as user B. The click below is created the only way a client can.
-- Then the assertions check that what landed matches the CATALOG, not anything
-- a caller could have influenced.

insert into selv_verify.captured
  (label, click_token, user_id, product_id, brand_id, source,
   commission_rate_bps, price_cents_at_click)
select 'base', c.click_token, c.user_id, c.product_id, c.brand_id, c.source::text,
       c.commission_rate_bps, c.price_cents_at_click
  from public.create_affiliate_click(selv_verify.prod_id(), 'tryon') c;

reset role;

-- Terms are read off brands/brand_products (brand default 1000 bps, list price
-- 5000 cents as seeded by 01 §1), never supplied.
select selv_verify.expect_count('02','§4 sanctioned path','click snapshots the CATALOG commission rate (1000 bps)',
  $q$select count(*) from selv_verify.captured where label='base' and commission_rate_bps = 1000$q$, 1);
select selv_verify.expect_count('02','§4 sanctioned path','click snapshots the CATALOG price (5000 cents)',
  $q$select count(*) from selv_verify.captured where label='base' and price_cents_at_click = 5000$q$, 1);
select selv_verify.expect_count('02','§4 sanctioned path','brand_id is read off the product row (cannot disagree)',
  $q$select count(*) from selv_verify.captured c
      join public.brand_products p on p.id = c.product_id
      where c.label='base' and c.brand_id = p.brand_id$q$, 1);
select selv_verify.expect_count('02','§4 sanctioned path','user_id is the caller''s, from auth.uid()',
  $q$select count(*) from selv_verify.captured where label='base' and user_id = selv_verify.uid_b()$q$, 1);
select selv_verify.expect_count('02','§4 sanctioned path','click_token is server-minted: selv_ + 32 hex chars',
  $q$select count(*) from selv_verify.captured where label='base' and click_token ~ '^selv_[0-9a-f]{32}$'$q$, 1);
select selv_verify.expect_count('02','§4 sanctioned path','p_source (self-reported analytics) IS honoured',
  $q$select count(*) from selv_verify.captured where label='base' and source = 'tryon'$q$, 1);

-- ===========================================================================
-- §5. Commercial-term precedence — the two rules most likely to be broken
-- ===========================================================================
-- Both mirror src/lib/commerce/commission.ts, and both have a trap in them.

-- (a) A per-product override of 0 must BEAT a brand default of 1000. Plenty of
--     partners pay nothing on clearance, so 0 is a real negotiated rate, not
--     "absent". A coalesce-on-falsy implementation silently bills a partner for
--     stock they told us was commission-free — the same class of error the RPC
--     exists to prevent, pointing the other way.
update public.brand_products set commission_rate_bps = 0 where id = selv_verify.prod_id();

select set_config('request.jwt.claims',
                  selv_verify.claims(selv_verify.uid_b(), selv_verify.email_b()), false);
set role authenticated;
insert into selv_verify.captured
  (label, click_token, user_id, product_id, brand_id, source, commission_rate_bps, price_cents_at_click)
select 'zero-rate', c.click_token, c.user_id, c.product_id, c.brand_id, c.source::text,
       c.commission_rate_bps, c.price_cents_at_click
  from public.create_affiliate_click(selv_verify.prod_id(), 'shop') c;
reset role;

select selv_verify.expect_count('02','§5 precedence','product override of 0 bps beats the brand default (0 is a real rate)',
  $q$select count(*) from selv_verify.captured where label='zero-rate' and commission_rate_bps = 0$q$, 1);

-- (b) A stale sale price that is NOT below list must be ignored. Partner feeds
--     routinely leave sale_price_cents equal to or above list after a promo
--     ends; honouring it snapshots a price the shopper was never shown.
update public.brand_products
   set commission_rate_bps = null, sale_price_cents = 9900   -- above the 5000 list
 where id = selv_verify.prod_id();

set role authenticated;
insert into selv_verify.captured
  (label, click_token, user_id, product_id, brand_id, source, commission_rate_bps, price_cents_at_click)
select 'stale-sale', c.click_token, c.user_id, c.product_id, c.brand_id, c.source::text,
       c.commission_rate_bps, c.price_cents_at_click
  from public.create_affiliate_click(selv_verify.prod_id(), 'shop') c;
reset role;

select selv_verify.expect_count('02','§5 precedence','stale sale price above list is ignored; list price is snapshotted',
  $q$select count(*) from selv_verify.captured where label='stale-sale' and price_cents_at_click = 5000$q$, 1);

update public.brand_products set sale_price_cents = 4000 where id = selv_verify.prod_id();
set role authenticated;
insert into selv_verify.captured
  (label, click_token, user_id, product_id, brand_id, source, commission_rate_bps, price_cents_at_click)
select 'real-sale', c.click_token, c.user_id, c.product_id, c.brand_id, c.source::text,
       c.commission_rate_bps, c.price_cents_at_click
  from public.create_affiliate_click(selv_verify.prod_id(), 'shop') c;
reset role;

select selv_verify.expect_count('02','§5 precedence','a genuine sale price below list IS snapshotted',
  $q$select count(*) from selv_verify.captured where label='real-sale' and price_cents_at_click = 4000$q$, 1);

update public.brand_products set sale_price_cents = null where id = selv_verify.prod_id();

-- ===========================================================================
-- §6. The RPC's refusals — a billable click must not exist without a contract
-- ===========================================================================
-- SECURITY DEFINER means RLS does NOT filter the RPC's own catalog lookup, so
-- the "public active brand products" policy that hides a paused partner is not
-- applied inside it. The explicit is_active / status checks are what stand in
-- for it. Without them the function would happily mint a billable click
-- against a brand whose contract has lapsed.

select set_config('request.jwt.claims',
                  selv_verify.claims(selv_verify.uid_b(), selv_verify.email_b()), false);
set role authenticated;

select selv_verify.expect_error('02','§6 RPC refusals','nonexistent product is refused',
  $q$select public.create_affiliate_click(gen_random_uuid(),'shop')$q$);
reset role;

update public.brand_products set is_active = false where id = selv_verify.prod_id();
set role authenticated;
select selv_verify.expect_error('02','§6 RPC refusals','withdrawn (is_active=false) product is refused',
  $q$select public.create_affiliate_click(selv_verify.prod_id(),'shop')$q$);
reset role;
update public.brand_products set is_active = true where id = selv_verify.prod_id();

update public.brands set status = 'paused' where id = selv_verify.brand_id();
set role authenticated;
select selv_verify.expect_error('02','§6 RPC refusals','PAUSED brand is refused (no contract to bill against)',
  $q$select public.create_affiliate_click(selv_verify.prod_id(),'shop')$q$);
reset role;
update public.brands set status = 'pending' where id = selv_verify.brand_id();
set role authenticated;
select selv_verify.expect_error('02','§6 RPC refusals','PENDING (not yet launched) brand is refused',
  $q$select public.create_affiliate_click(selv_verify.prod_id(),'shop')$q$);
reset role;
update public.brands set status = 'active' where id = selv_verify.brand_id();

-- Anonymous callers: refused twice over — no EXECUTE privilege, and a null
-- auth.uid() inside the function. Selv has no anonymous browsing.
select set_config('request.jwt.claims','',false);
set role anon;
select selv_verify.expect_error('02','§6 RPC refusals','anon cannot call the RPC at all',
  $q$select public.create_affiliate_click(selv_verify.prod_id(),'shop')$q$);
reset role;

-- ===========================================================================
-- §7. Defence-in-depth recommendation (not a failure)
-- ===========================================================================
-- Supabase's default privileges hand `anon` and `authenticated` full DML on
-- new tables in `public`, so on these two tables RLS is the ONLY thing between
-- a client and an INSERT. That is sufficient — the checks in §3 prove it holds
-- — but it is one `alter table … disable row level security` away from being
-- nothing, and it is the one table pair in this schema where a mistake bills a
-- partner instead of leaking a wardrobe.
--
-- The repo already uses the belt-and-braces pattern elsewhere:
-- schema.sql revokes UPDATE on waitlist_signups and re-grants it on one column;
-- 006_age_gate.sql does the same for the age columns. Applying it here costs
-- nothing and removes the privilege as well as the policy:
--
--   revoke insert, update, delete on public.affiliate_clicks       from anon, authenticated;
--   revoke insert, update, delete on public.affiliate_conversions  from anon, authenticated;
--   revoke insert, update, delete on public.brands, public.brand_products from anon, authenticated;
--
-- SELECT is untouched, so "own click history" and the Shop catalog keep
-- working; create_affiliate_click is unaffected because it runs as its owner.
-- Reported as INFO, not FAIL — do not treat this as a submission blocker.
select selv_verify.note('02','§7 defence in depth',
  'authenticated still HOLDS the INSERT privilege on the revenue tables (RLS is the only gate)',
  'has_table_privilege(authenticated, affiliate_clicks, INSERT) = '
    || has_table_privilege('authenticated','public.affiliate_clicks','INSERT')::text
  || ' ; affiliate_conversions = '
    || has_table_privilege('authenticated','public.affiliate_conversions','INSERT')::text
  || ' ; brand_products UPDATE = '
    || has_table_privilege('authenticated','public.brand_products','UPDATE')::text
  || '. Suggested revokes are in the comment above this row. Non-blocking.',
  'INFO');

-- ===========================================================================
-- §8. Report
-- ===========================================================================

select verdict, count(*) as checks
  from selv_verify.results where script='02' group by verdict order by 1;

select id, section, check_name, expected, actual, verdict
  from selv_verify.results where script='02' order by id;

select case
  when exists (select 1 from selv_verify.results where script='02' and verdict='FAIL')
  then '❌ 02 FAILED — the commission write path is not locked down. Do not submit.'
  else '✅ 02 PASSED — clients cannot author a commercial term; the RPC derives all of them.'
end as verdict;

-- ===========================================================================
-- §9. Teardown
-- ===========================================================================
-- delete from public.affiliate_clicks
--  where product_id in (select id from public.brand_products where external_id='SELV-VERIFY-1');
-- then run 01 §10.

-- ===========================================================================
-- APPENDIX — the Edge Function half (affiliate-postback)
-- ===========================================================================
-- Everything above covers the CLIENT write path. Conversions arrive on a
-- different one entirely: a brand's or network's server POSTs to the
-- `affiliate-postback` function, which authenticates with an HMAC over
-- `${timestamp}.${rawBody}` and then writes with the service role. There is no
-- user and no browser in that path, so no amount of SQL exercises it. Run
-- these by hand — they also discharge LAUNCH_CHECKLIST.md §4's
-- "abuse/rate-limit review of the deployed Edge Functions".
--
--   export FN=https://<project-ref>.supabase.co/functions/v1/affiliate-postback
--   export ANON=<anon key>
--
-- 1. No signature at all. MUST be rejected (4xx), MUST NOT create a row.
--    curl -si -X POST "$FN?network=direct" -H "apikey: $ANON" \
--      -H "Content-Type: application/json" \
--      -d '{"subid":"selv_deadbeef","network_order_id":"T1","order_total_cents":9900}'
--
-- 2. Wrong signature. MUST be rejected.
--    curl -si -X POST "$FN?network=direct" -H "apikey: $ANON" \
--      -H "X-Selv-Timestamp: $(date +%s)" -H "X-Selv-Signature: 00" \
--      -H "Content-Type: application/json" \
--      -d '{"subid":"selv_deadbeef","network_order_id":"T2","order_total_cents":9900}'
--
-- 3. Valid signature but a stale timestamp (older than the tolerance window).
--    MUST be rejected — otherwise anyone who captures one valid request can
--    replay that exact body forever.
--
-- 4. Valid signature, correct timestamp, sent TWICE with the same
--    network_order_id. MUST book the conversion exactly once — the
--    (network, network_order_id) unique constraint is the idempotency key, and
--    networks retry aggressively. Confirm with:
--      select count(*) from public.affiliate_conversions
--       where network_order_id = '<the id you used>';    -- must be 1
--
-- 5. Confirm the secret exists as a Supabase Function secret and NOT in the
--    app bundle: Dashboard → Edge Functions → Secrets should list
--    AFFILIATE_POSTBACK_SECRET (or AFFILIATE_POSTBACK_SECRET_<NETWORK>), and
--      grep -R "AFFILIATE_POSTBACK_SECRET\|service_role" app/src app/app
--    must return nothing.
--
-- Delete every conversion row these tests create before going live:
--   delete from public.affiliate_conversions where network_order_id like 'T%';
-- ===========================================================================
