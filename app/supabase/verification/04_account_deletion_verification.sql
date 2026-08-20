-- ===========================================================================
-- 04_account_deletion_verification.sql
-- ===========================================================================
-- Discharges LAUNCH_CHECKLIST.md §2 / §3:
--
--   "🔴 Manually test the in-app account-deletion flow end to end per
--    legal/DATA_HANDLING.md §3, confirming it actually removes Storage objects
--    and not just DB rows"
--
-- This is the highest App-Review-rejection-risk item in the whole launch.
-- Guideline 5.1.1(v) requires deletion to remove the account record AND the
-- associated personal data; a flow that leaves orphaned rows or orphaned files
-- fails review the same way an email-only "contact us to delete" flow does.
--
-- ┌───────────────────────────────────────────────────────────────────────┐
-- │ THE ONE THING THIS SCRIPT EXISTS TO GET RIGHT                          │
-- │                                                                        │
-- │ `delete-account` does NOT delete everything, and that is correct.      │
-- │ It DE-IDENTIFIES `affiliate_clicks` and `affiliate_conversions` by     │
-- │ nulling user_id, and deletes everything else. Those two tables are     │
-- │ financial records: a conversion is money a brand owes Selv, a click is │
-- │ the evidence backing that invoice including the snapshotted commission │
-- │ rate. Deleting them would let a partner dispute an invoice we can no   │
-- │ longer substantiate, would retroactively change reported revenue every │
-- │ time someone deleted an account, and would leave a later reversal      │
-- │ postback with no row to reverse. Nulling user_id removes the link to   │
-- │ the person — which is what a deletion request actually requires — and  │
-- │ leaves a row indistinguishable from a conversion we never attributed.  │
-- │                                                                        │
-- │ So §4 below asserts those rows STILL EXIST, with user_id NULL and      │
-- │ their commercial fields intact. A surviving de-identified row is a     │
-- │ PASS. Do not "fix" it.                                                 │
-- │                                                                        │
-- │ `product_try_ons` is deliberately NOT in that set: its user_id is      │
-- │ `not null … on delete cascade`, so those rows are destroyed with the   │
-- │ account and per-product try-on counts genuinely do decrease. That is a │
-- │ real caveat on a number quoted to brands — see AFFILIATE_SYSTEM.md     │
-- │ §2.4 — and §4 asserts the rows are GONE, not de-identified.            │
-- └───────────────────────────────────────────────────────────────────────┘
--
-- HOW TO RUN — four phases, and the middle one is not SQL.
--   PHASE 0  On a device/simulator: create a throwaway account and use it, so
--            there is a real footprint to destroy.  (checklist below)
--   PHASE 1  This file, §1–§2. Seeds the one row the app cannot create, then
--            snapshots the footprint. MUST report a non-empty footprint.
--   PHASE 2  On the device: Profile → Delete Account. (Or the curl in §3.)
--   PHASE 3  This file, §4–§5. The proof.
--
-- Between Phase 1 and Phase 3 the baseline must survive, so it is kept in its
-- own schema (`selv_verify_del`) rather than in the harness schema. Re-running
-- 00_harness.sql between phases is safe.
--
-- PREREQUISITE: 00_harness.sql.
-- ===========================================================================

reset role;

-- ===========================================================================
-- CONFIG — the only block you edit.
-- ===========================================================================
create schema if not exists selv_verify_del;

drop table if exists selv_verify_del.target;
create table selv_verify_del.target as
select
  '00000000-0000-0000-0000-0000000000cc'::uuid as user_id,   -- <<< EDIT: the account you will destroy
  'selv-verify-delete@example.com'::text       as email;     -- <<< EDIT

create or replace function selv_verify_del.uid() returns uuid
  language sql stable as $$ select user_id from selv_verify_del.target $$;
grant usage on schema selv_verify_del to authenticated;
grant select on selv_verify_del.target to authenticated;
grant execute on all functions in schema selv_verify_del to authenticated;

-- ===========================================================================
-- PHASE 0 — the manual footprint (do this FIRST, in the app)
-- ===========================================================================
-- Sign in as the throwaway account and actually use it. Planting rows with SQL
-- would test the SQL; using the app tests the app. In particular a real garment
-- upload puts real BYTES in the `garments` bucket, and Storage objects are the
-- one thing no foreign key cascades — they are the part of deletion most likely
-- to silently not happen.
--
--   [ ] Sign up (email OTP) and pass the age gate
--   [ ] Complete the character creator and save         → avatars, profiles
--   [ ] Add TWO garments, each with a real photo        → garments + storage objects
--   [ ] Build and save an outfit from them              → outfits, outfit_items
--   [ ] Shop: heart a product                           → wishlist_items
--   [ ] Shop: try a product on                          → product_try_ons
--   [ ] Shop: tap Buy on a product                      → affiliate_clicks (via RPC)
--   [ ] Hit the 25-item cap or open the sheet and join  → waitlist_signups
--
-- Then come back and run §1.

-- ===========================================================================
-- §1. Seed the one row the app cannot create
-- ===========================================================================
-- A conversion is written only by the affiliate-postback Edge Function, with
-- the service role, from a brand's server. No amount of tapping in the app
-- produces one — so without this seed, the de-identification branch (the whole
-- reason this script is subtle) would go completely untested and Phase 3 would
-- report a cheerful all-green on a code path nobody exercised.
--
-- It is attached to the real click the user made in Phase 0 where possible.

do $$
declare v_click record; v_brand uuid; v_prod uuid;
begin
  select id, brand_id, product_id, click_token, commission_rate_bps
    into v_click
    from public.affiliate_clicks
   where user_id = selv_verify_del.uid()
   order by created_at desc limit 1;

  if v_click.id is null then
    raise warning
      'No affiliate_clicks row for this user. Did Phase 0 include tapping Buy? '
      'Seeding an unattached conversion instead — the de-identification check '
      'still works, but the click leg of it will not be covered.';
    select b.id, p.id into v_brand, v_prod
      from public.brands b join public.brand_products p on p.brand_id = b.id
     where b.status='active' and p.is_active limit 1;
    if v_brand is null then
      raise exception 'No active brand/product exists. Run 01 §1 first, or seed a catalog row.';
    end if;
  else
    v_brand := v_click.brand_id;
    v_prod  := v_click.product_id;
  end if;

  insert into public.affiliate_conversions
    (click_id, click_token, user_id, brand_id, product_id, network,
     network_order_id, order_total_cents, commission_rate_bps, commission_cents, status)
  values
    (v_click.id, v_click.click_token, selv_verify_del.uid(), v_brand, v_prod, 'direct',
     'SELV-VERIFY-DEL-'||substr(md5(random()::text),1,8),
     12900, coalesce(v_click.commission_rate_bps,1000), 1290, 'approved')
  on conflict (network, network_order_id) do nothing;
end $$;

-- ===========================================================================
-- §2. Snapshot the footprint — and REFUSE to continue if it is empty
-- ===========================================================================
-- The trap this guards against: "after deletion, nothing owned by that user
-- exists" is trivially true if nothing ever existed. A deletion test run
-- against an account that only ever signed in proves precisely nothing, and it
-- is the most common way this item gets ticked without being done.

drop table if exists selv_verify_del.baseline;
create table selv_verify_del.baseline as
select
  selv_verify_del.uid()                                                        as user_id,
  (select count(*) from auth.users            where id      = selv_verify_del.uid()) as n_auth_users,
  (select count(*) from auth.identities       where user_id = selv_verify_del.uid()) as n_auth_identities,
  (select count(*) from public.profiles       where id      = selv_verify_del.uid()) as n_profiles,
  (select count(*) from public.avatars        where user_id = selv_verify_del.uid()) as n_avatars,
  (select count(*) from public.garments       where user_id = selv_verify_del.uid()) as n_garments,
  (select count(*) from public.outfits        where user_id = selv_verify_del.uid()) as n_outfits,
  (select count(*) from public.outfit_items oi join public.outfits o on o.id=oi.outfit_id
     where o.user_id = selv_verify_del.uid())                                  as n_outfit_items,
  (select count(*) from public.wishlist_items where user_id = selv_verify_del.uid()) as n_wishlist,
  (select count(*) from public.product_try_ons where user_id = selv_verify_del.uid()) as n_try_ons,
  (select count(*) from public.waitlist_signups where user_id = selv_verify_del.uid()) as n_waitlist,
  (select count(*) from public.affiliate_clicks where user_id = selv_verify_del.uid()) as n_clicks,
  (select count(*) from public.affiliate_conversions where user_id = selv_verify_del.uid()) as n_conversions,
  (select count(*) from storage.objects
     where bucket_id in ('garments','avatar-previews','outfit-thumbnails')
       and (storage.foldername(name))[1] = selv_verify_del.uid()::text)        as n_storage_objects,
  -- Captured identities. After deletion these rows no longer carry the user
  -- id, so they are unfindable unless their keys are recorded NOW. This is the
  -- part of the script that cannot be reconstructed after the fact.
  (select coalesce(array_agg(click_token), '{}')
     from public.affiliate_clicks where user_id = selv_verify_del.uid())       as click_tokens,
  (select coalesce(array_agg(id), '{}')
     from public.affiliate_conversions where user_id = selv_verify_del.uid())  as conversion_ids,
  (select coalesce(array_agg(id), '{}')
     from public.outfits where user_id = selv_verify_del.uid())                as outfit_ids,
  (select coalesce(array_agg(id), '{}')
     from public.garments where user_id = selv_verify_del.uid())               as garment_ids,
  (select coalesce(array_agg(name), '{}') from storage.objects
     where bucket_id in ('garments','avatar-previews','outfit-thumbnails')
       and (storage.foldername(name))[1] = selv_verify_del.uid()::text)        as storage_names,
  -- Commercial values, so §4 can prove de-identification did not damage the
  -- ledger it exists to preserve.
  (select coalesce(sum(commission_rate_bps),0) from public.affiliate_clicks
     where user_id = selv_verify_del.uid())                                    as sum_click_rate_bps,
  (select coalesce(sum(price_cents_at_click),0) from public.affiliate_clicks
     where user_id = selv_verify_del.uid())                                    as sum_click_price_cents,
  (select coalesce(sum(order_total_cents),0) from public.affiliate_conversions
     where user_id = selv_verify_del.uid())                                    as sum_order_cents,
  (select coalesce(sum(commission_cents),0) from public.affiliate_conversions
     where user_id = selv_verify_del.uid())                                    as sum_commission_cents;

select * from selv_verify_del.baseline;

-- Hard stop. Every one of these must be non-zero before the deletion is
-- meaningful; the message names exactly which Phase 0 step was skipped.
do $$
declare b record; v_gaps text := '';
begin
  select * into b from selv_verify_del.baseline;
  if b.n_auth_users     = 0 then v_gaps := v_gaps || 'auth.users (wrong uuid?) '; end if;
  if b.n_profiles       = 0 then v_gaps := v_gaps || 'profiles '; end if;
  if b.n_avatars        = 0 then v_gaps := v_gaps || 'avatars (finish the character creator) '; end if;
  if b.n_garments       = 0 then v_gaps := v_gaps || 'garments (add a garment) '; end if;
  if b.n_storage_objects= 0 then v_gaps := v_gaps || 'STORAGE OBJECTS (add a garment WITH A PHOTO — this is the step that matters most) '; end if;
  if b.n_outfits        = 0 then v_gaps := v_gaps || 'outfits '; end if;
  if b.n_outfit_items   = 0 then v_gaps := v_gaps || 'outfit_items '; end if;
  if b.n_wishlist       = 0 then v_gaps := v_gaps || 'wishlist_items '; end if;
  if b.n_try_ons        = 0 then v_gaps := v_gaps || 'product_try_ons '; end if;
  if b.n_waitlist       = 0 then v_gaps := v_gaps || 'waitlist_signups '; end if;
  if b.n_clicks         = 0 then v_gaps := v_gaps || 'affiliate_clicks (tap Buy) '; end if;
  if b.n_conversions    = 0 then v_gaps := v_gaps || 'affiliate_conversions (§1 seed failed) '; end if;

  if v_gaps <> '' then
    raise exception
      E'FOOTPRINT INCOMPLETE — do not delete yet.\n'
      'These tables have zero rows for this user, so deleting now would prove '
      'nothing about them: %', v_gaps;
  end if;
  raise notice 'Footprint complete across all 12 surfaces. Proceed to PHASE 2.';
end $$;

-- ===========================================================================
-- §3. PHASE 2 — delete the account (NOT SQL)
-- ===========================================================================
-- Preferred: do it in the app, because the in-app flow is the thing App Review
-- actually tests — Profile → Delete Account → confirm. Deleting via curl proves
-- the function works but not that the user can reach it in ≤2 taps, which is
-- the other half of Guideline 5.1.1(v).
--
-- The equivalent direct call, if you need it (the user id comes only from the
-- verified JWT; there is no body and no user_id parameter, which is why one
-- user can never delete another):
--
--   curl -si -X POST \
--     "https://<project-ref>.supabase.co/functions/v1/delete-account" \
--     -H "Authorization: Bearer <THAT USER'S access token>" \
--     -H "apikey: <anon key>" \
--     -H "Content-Type: application/json"
--
--   Expect: {"success": true, "request_id": "…"}
--
-- Note the function returns HTTP 200 with {"success": false, "error": …} for
-- recoverable failures, so read the BODY, not the status code.
--
-- Also confirm in the app, before you tap: the deletion entry point is reachable
-- in ≤2 taps from the main settings screen, the confirmation explains in plain
-- language what is being removed, and the user gets a confirmation when it is
-- done. Those are review criteria too, not just the data removal.
--
--   [ ] deletion initiated IN-APP, not via support
--   [ ] ≤2 taps from settings
--   [ ] plain-language explanation of what is deleted
--   [ ] explicit confirmation step
--   [ ] success confirmation shown to the user
--   [ ] signed out and returned to the auth gate afterwards
--
-- Then run §4.

-- ===========================================================================
-- §4. PHASE 3 — the proof.  RUN THIS AFTER THE DELETION.
-- ===========================================================================
-- Runs as `postgres`, which bypasses RLS deliberately: the question is whether
-- the rows are GONE, not whether they are merely invisible to their old owner.
-- An RLS-filtered check would report a perfect pass against a database where
-- every row is still sitting there.
--
-- If you re-ran 00_harness.sql since Phase 1, that is fine — the baseline lives
-- in selv_verify_del.

-- --- 4a. The account itself ------------------------------------------------
select selv_verify.expect_count('04','§4a account','auth.users row is gone',
  $q$select count(*) from auth.users where id = selv_verify_del.uid()$q$, 0);
select selv_verify.expect_count('04','§4a account','auth.identities rows are gone',
  $q$select count(*) from auth.identities where user_id = selv_verify_del.uid()$q$, 0);
select selv_verify.expect_count('04','§4a account','auth.sessions rows are gone',
  $q$select count(*) from auth.sessions where user_id = selv_verify_del.uid()$q$, 0);

-- --- 4b. Owned rows, deleted ----------------------------------------------
select selv_verify.expect_count('04','§4b owned rows','profiles row is gone',
  $q$select count(*) from public.profiles where id = selv_verify_del.uid()$q$, 0);
select selv_verify.expect_count('04','§4b owned rows','avatars row is gone (character customization)',
  $q$select count(*) from public.avatars where user_id = selv_verify_del.uid()$q$, 0);
select selv_verify.expect_count('04','§4b owned rows','garments rows are gone',
  $q$select count(*) from public.garments where user_id = selv_verify_del.uid()$q$, 0);
select selv_verify.expect_count('04','§4b owned rows','…including by captured garment id (not just by user_id)',
  $q$select count(*) from public.garments
      where id = any((select garment_ids from selv_verify_del.baseline))$q$, 0);
select selv_verify.expect_count('04','§4b owned rows','outfits rows are gone',
  $q$select count(*) from public.outfits where user_id = selv_verify_del.uid()$q$, 0);
select selv_verify.expect_count('04','§4b owned rows','outfit_items are gone (no user_id — cascades from outfits)',
  $q$select count(*) from public.outfit_items
      where outfit_id = any((select outfit_ids from selv_verify_del.baseline))$q$, 0);
select selv_verify.expect_count('04','§4b owned rows','wishlist_items are gone (cascade)',
  $q$select count(*) from public.wishlist_items where user_id = selv_verify_del.uid()$q$, 0);
select selv_verify.expect_count('04','§4b owned rows','waitlist_signups row is gone (marketing consent record, cascade)',
  $q$select count(*) from public.waitlist_signups where user_id = selv_verify_del.uid()$q$, 0);

-- product_try_ons: destroyed, not de-identified. `user_id` is NOT NULL with
-- `on delete cascade`, so nulling it is impossible and the rows go with the
-- account. Per-product try-on counts therefore decrease when someone deletes.
-- Privacy-forward and defensible, but a real caveat on a metric quoted to
-- brands (AFFILIATE_SYSTEM.md §2.4). Asserted as GONE, on purpose.
select selv_verify.expect_count('04','§4b owned rows','product_try_ons are gone (cascade — try-on counts DO decrease)',
  $q$select count(*) from public.product_try_ons where user_id = selv_verify_del.uid()$q$, 0);

-- --- 4c. Storage objects — the part nothing cascades ----------------------
-- Storage objects are not foreign-keyed to auth.users. Nothing removes them
-- except the explicit sweep in delete-account, and that sweep deliberately
-- LOGS failures and continues rather than failing the user's deletion request
-- (blocking a deletion on a transient storage error is the worse outcome). So
-- a silent partial failure is possible by design, and this check is the only
-- thing that catches it.
select selv_verify.expect_count('04','§4c storage','no storage objects remain under the user prefix (all buckets)',
  $q$select count(*) from storage.objects
      where bucket_id in ('garments','avatar-previews','outfit-thumbnails')
        and (storage.foldername(name))[1] = selv_verify_del.uid()::text$q$, 0);
select selv_verify.expect_count('04','§4c storage','…and none of the specific captured object paths survive',
  $q$select count(*) from storage.objects
      where name = any((select storage_names from selv_verify_del.baseline))$q$, 0);

-- Byte-level confirmation. The row being gone means the Storage API deleted
-- the record; fetch one captured path over HTTP as well and confirm a 404
-- rather than an image. The path is printed here for pasting.
select selv_verify.note('04','§4c storage','paths to re-request over HTTP (expect 404, not an image)',
  coalesce(array_to_string(storage_names, E'\n'), '(none captured)'))
from selv_verify_del.baseline;

-- --- 4d. THE DE-IDENTIFIED ROWS — these MUST SURVIVE ----------------------
-- Read the banner at the top of this file before reacting to anything here.

select selv_verify.expect_count('04','§4d de-identified','affiliate_clicks SURVIVE the deletion (financial evidence)',
  $q$select count(*) from public.affiliate_clicks
      where click_token = any((select click_tokens from selv_verify_del.baseline))$q$,
  (select coalesce(array_length(click_tokens,1),0) from selv_verify_del.baseline));
select selv_verify.expect_count('04','§4d de-identified','…and every surviving click has user_id NULL (the person is unlinked)',
  $q$select count(*) from public.affiliate_clicks
      where click_token = any((select click_tokens from selv_verify_del.baseline))
        and user_id is not null$q$, 0);

select selv_verify.expect_count('04','§4d de-identified','affiliate_conversions SURVIVE the deletion (revenue)',
  $q$select count(*) from public.affiliate_conversions
      where id = any((select conversion_ids from selv_verify_del.baseline))$q$,
  (select coalesce(array_length(conversion_ids,1),0) from selv_verify_del.baseline));
select selv_verify.expect_count('04','§4d de-identified','…and every surviving conversion has user_id NULL',
  $q$select count(*) from public.affiliate_conversions
      where id = any((select conversion_ids from selv_verify_del.baseline))
        and user_id is not null$q$, 0);

-- De-identification must not have damaged the ledger it exists to preserve.
-- If the commission terms changed, "we kept the financial record" is false.
select selv_verify.expect_count('04','§4d de-identified','surviving clicks keep their snapshotted commission rate + price',
  $q$select count(*) from (
       select coalesce(sum(c.commission_rate_bps),0) as r,
              coalesce(sum(c.price_cents_at_click),0) as p
         from public.affiliate_clicks c
        where c.click_token = any((select click_tokens from selv_verify_del.baseline))
     ) x join selv_verify_del.baseline b
       on x.r = b.sum_click_rate_bps and x.p = b.sum_click_price_cents$q$, 1);
select selv_verify.expect_count('04','§4d de-identified','surviving conversions keep order_total_cents + commission_cents',
  $q$select count(*) from (
       select coalesce(sum(v.order_total_cents),0)  as o,
              coalesce(sum(v.commission_cents),0)   as m
         from public.affiliate_conversions v
        where v.id = any((select conversion_ids from selv_verify_del.baseline))
     ) x join selv_verify_del.baseline b
       on x.o = b.sum_order_cents and x.m = b.sum_commission_cents$q$, 1);

-- The click→conversion join must also survive: the conversion still points at
-- the click row that priced it. A de-identification that broke click_id would
-- leave a conversion nobody can substantiate, which is the exact outcome
-- keeping the rows was supposed to prevent.
select selv_verify.expect_count('04','§4d de-identified','conversion→click linkage survives de-identification',
  $q$select count(*) from public.affiliate_conversions v
      where v.id = any((select conversion_ids from selv_verify_del.baseline))
        and v.click_id is not null
        and exists (select 1 from public.affiliate_clicks c where c.id = v.click_id)$q$,
  (select count(*) from public.affiliate_conversions v
    where v.id = any((select conversion_ids from selv_verify_del.baseline))
      and v.click_id is not null));

-- --- 4e. The sweep: nothing ANYWHERE still carries this uuid --------------
-- Dynamic on purpose. It walks every uuid column in `public` named like an
-- owner reference and counts matches, so a table added by a future migration
-- (a Phase 2 `shared_outfits`, a `follows`) is covered without anyone
-- remembering to extend this file. The de-identified tables cannot show up
-- here — their user_id is now null, so they cannot match.
do $$
declare r record; v_n bigint; v_total bigint := 0; v_detail text := '';
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type   = 'BASE TABLE'
       and c.data_type    = 'uuid'
       and c.column_name in ('user_id','id','owner_id','author_id','follower_id','followee_id')
     order by c.table_name, c.column_name
  loop
    execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name)
       into v_n using selv_verify_del.uid();
    if v_n > 0 then
      v_total  := v_total + v_n;
      v_detail := v_detail || r.table_name || '.' || r.column_name || '=' || v_n || '  ';
    end if;
  end loop;

  insert into selv_verify.results(script,section,check_name,expected,actual,verdict)
  values ('04','§4e sweep',
          'no row in any public table still carries the deleted uuid',
          '0 row(s)',
          case when v_total = 0 then '0 row(s)'
               else v_total::text || ' row(s): ' || v_detail end,
          case when v_total = 0 then 'PASS' else 'FAIL' end);
end $$;

-- --- 4f. Idempotency -------------------------------------------------------
-- Every step of the function tolerates "already gone", so a user whose first
-- attempt half-completed (app killed mid-request, network drop) can press the
-- button again and reach a clean state. Re-issue the curl in §3 with the SAME
-- (now dead) access token: expect a 401 "Not signed in.", because the token no
-- longer resolves to a user — that is the correct behaviour, not a bug. To
-- exercise true idempotency you need a token that is still valid for a
-- partially-deleted user, which only arises from a real mid-flight failure.
select selv_verify.note('04','§4f idempotency','re-invoking with the dead token',
  'Expect HTTP 401 {"success":false,"error":"Not signed in."} — getUserIdFromRequest '
  'asks GoTrue to validate the token and a deleted user no longer resolves. '
  'That is correct. Idempotency is about retrying a half-finished deletion, '
  'which this path cannot reproduce on demand.');

-- --- 4g. Known spec-vs-code deltas, recorded so review is not surprised ---
select selv_verify.note('04','§4g spec deltas','DATA_HANDLING §3.2 step 6: `deletion_audit` table',
  'Specced (hashed user id + timestamp + reason code) but NOT implemented — the '
  'function writes console logs instead, which Supabase retains on its own '
  'schedule. Non-blocking for review; note it if a compliance question ever '
  'arrives, and either build the table or drop the claim from the spec.');
select selv_verify.note('04','§4g spec deltas','DATA_HANDLING §3.2 step 4: RevenueCat + Sign in with Apple revocation',
  'Both N/A today and correctly absent from the code. There is no RevenueCat '
  'dependency, and auth is email OTP only (src/lib/api/auth.ts — signInWithOtp), '
  'so there is no Apple refresh token to revoke. BOTH become mandatory the day '
  'Sign in with Apple or a paid tier ships; Apple''s account-deletion FAQ makes '
  'token revocation an explicit requirement.');
select selv_verify.note('04','§4g spec deltas','supabase/functions/README.md is wrong about product_try_ons',
  'It says delete-account "de-identifies affiliate_clicks / affiliate_conversions / '
  'product_try_ons by nulling user_id". The code''s DE_IDENTIFY_TABLES is only the '
  'first two, and its comment explains why product_try_ons cannot be de-identified '
  '(NOT NULL + cascade). The README overstates coverage; §4b above tests the code.');

-- ===========================================================================
-- §5. Report
-- ===========================================================================

select verdict, count(*) as checks
  from selv_verify.results where script='04' group by verdict order by 1;

select id, section, check_name, expected, actual, verdict
  from selv_verify.results where script='04' order by id;

select case
  when exists (select 1 from selv_verify.results where script='04' and verdict='FAIL')
  then '❌ 04 FAILED — deletion is incomplete. This is the #1 App Review rejection risk. Do not submit.'
  else '✅ 04 PASSED — every owned row and every storage object is gone; the two '
       'financial tables survive de-identified with their ledger intact.'
end as verdict;

-- ===========================================================================
-- §6. Teardown
-- ===========================================================================
-- Keep the de-identified rows: they are now indistinguishable from any other
-- unattributed conversion, which is the point. Remove only the seeded test
-- conversion, which is not real revenue.
--
-- delete from public.affiliate_conversions where network_order_id like 'SELV-VERIFY-DEL-%';
-- drop schema selv_verify_del cascade;
-- drop schema selv_verify cascade;

-- ===========================================================================
-- §7. Backups — the disclosure this test cannot cover
-- ===========================================================================
-- Everything above proves the LIVE data is gone. Supabase's automated backups
-- still hold point-in-time copies for the plan's retention window, and
-- PRIVACY_POLICY.md §8/§10 discloses exactly that. Apple's guidance explicitly
-- allows non-instant deletion so long as it is disclosed and bounded — so the
-- work item is not "purge the backups", it is "know the number and publish it".
--
--   [ ] Supabase Dashboard → Database → Backups: confirm automated backups are ON
--   [ ] Record the retention window in days for the current plan
--   [ ] Replace the vague wording in PRIVACY_POLICY.md §8 with that number
--
-- See SHIP_READINESS.md; this is also LAUNCH_CHECKLIST.md §4's backups item.
-- ===========================================================================
