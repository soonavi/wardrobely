-- ===========================================================================
-- 03_storage_policy_audit.sql
-- ===========================================================================
-- Discharges LAUNCH_CHECKLIST.md §4:
--
--   "🔴 Confirm Storage bucket policies match the RLS pattern — `garments`
--    bucket already has per-user path policies; `avatar-previews` and
--    `outfit-thumbnails` need the same before they hold real data"
--
-- SCOPE, stated plainly because it is easy to over-read this script:
--   * `garments` is the ONLY bucket schema.sql creates. It is audited here as
--     a live object, four policies deep.
--   * `avatar-previews` and `outfit-thumbnails` do NOT exist. They are named in
--     PRODUCT_SPEC.md §7 and in legal/DATA_HANDLING.md §2b as *planned*, and
--     `delete-account/index.ts` already cleans them up pre-emptively so that
--     creating one later cannot silently start leaking deleted users' files.
--     This script confirms they are absent and prints the exact DDL that must
--     ship WITH them. Their absence is EXPECTED-ABSENT, not a FAIL.
--   * legal/DATA_HANDLING.md §2b also lists `garment-templates` and `catalog`
--     as public-read system buckets. Neither exists in schema.sql either; both
--     are reported below so the data map can be reconciled with reality.
--
-- Storage in Supabase is ordinary Postgres: a bucket is a row in
-- `storage.buckets` and an object is a row in `storage.objects`, and the access
-- rules are RLS policies on `storage.objects`. So the policy layer is testable
-- from SQL exactly like §01 — which is what this does, by planting object rows
-- for two users and proving user B bounces off every one of A's.
--
-- WHAT THIS DOES NOT PROVE: that a real HTTP upload/download through the
-- Storage API is refused, or that signed URLs are scoped. The appendix at the
-- bottom closes that with curl. Run both halves.
--
-- PREREQUISITE: 00_harness.sql, then 01_rls_two_account_audit.sql (reuses its
-- `selv_verify.params` and its two test users).
-- ===========================================================================

reset role;

-- ===========================================================================
-- §1. Bucket inventory
-- ===========================================================================

select selv_verify.note('03','§1 buckets','bucket inventory (live)',
  coalesce(string_agg(id || ' → public=' || public::text, E'\n' order by id),
           '(no buckets exist)'))
from storage.buckets;

select selv_verify.expect_count('03','§1 buckets','`garments` bucket exists',
  $q$select count(*) from storage.buckets where id='garments'$q$, 1);

-- Private, not public. A public bucket serves every object to anyone holding
-- the URL, and RLS on storage.objects does not apply to public reads — so this
-- single boolean can undo all four policies below. Garment photos are photos of
-- a user's real belongings (DATA_HANDLING §2a rates them Medium).
select selv_verify.expect_count('03','§1 buckets','`garments` is PRIVATE (public=false)',
  $q$select count(*) from storage.buckets where id='garments' and public = false$q$, 1);

-- The two planned buckets. Absent today, and that is the expected state.
do $$
declare v_missing text[] := '{}';
begin
  if not exists (select 1 from storage.buckets where id='avatar-previews') then
    v_missing := v_missing || 'avatar-previews';
  end if;
  if not exists (select 1 from storage.buckets where id='outfit-thumbnails') then
    v_missing := v_missing || 'outfit-thumbnails';
  end if;

  if array_length(v_missing,1) is null then
    -- They now exist. That changes the verdict: they must carry the same
    -- per-user path policies before they hold a single real file.
    perform selv_verify.note('03','§1 buckets',
      'avatar-previews / outfit-thumbnails now EXIST',
      'Both buckets are present. §2 below must be re-run against them — see the '
      'DDL in §5. Until then, treat this as a FAIL.', 'FAIL');
  else
    perform selv_verify.note('03','§1 buckets',
      'planned buckets not yet created: ' || array_to_string(v_missing,', '),
      'Expected. schema.sql creates only `garments`. delete-account already '
      'sweeps these prefixes pre-emptively, so creating one later does not leak '
      'deleted users'' files — but the four policies in §5 MUST ship in the same '
      'change that creates the bucket, not after it.', 'EXPECTED-ABSENT');
  end if;
end $$;

-- The two system buckets the data map claims exist.
select selv_verify.note('03','§1 buckets','DATA_HANDLING §2b lists `garment-templates` and `catalog`',
  'garment-templates present: '
    || exists(select 1 from storage.buckets where id='garment-templates')::text
  || ' ; catalog present: '
    || exists(select 1 from storage.buckets where id='catalog')::text
  || '. Neither is created by schema.sql. If they are absent, the data map '
     'over-states the storage footprint and should be corrected before the '
     'privacy policy is published against it.',
  'INFO');

-- ===========================================================================
-- §2. Policy shape on storage.objects
-- ===========================================================================
-- RLS must be on. Storage's own default is on, but a bucket is worthless
-- without it and it is one dashboard toggle away.
select selv_verify.expect_count('03','§2 policy shape','RLS enabled on storage.objects',
  $q$select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='storage' and c.relname='objects' and c.relrowsecurity$q$, 1);

-- Four policies, one per verb, each pinned to bucket_id='garments' AND to the
-- caller's own uid as the first path segment.
select selv_verify.expect_count('03','§2 policy shape','4 `garments` policies exist (select/insert/update/delete)',
  $q$select count(*) from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname in ('own garment images select','own garment images insert',
                           'own garment images update','own garment images delete')$q$, 4);
select selv_verify.expect_count('03','§2 policy shape','every `garments` policy pins bucket_id AND auth.uid() as folder[1]',
  $q$select count(*) from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname like 'own garment images%'
        and coalesce(qual,'') || coalesce(with_check,'') like '%garments%'
        and coalesce(qual,'') || coalesce(with_check,'') like '%foldername%'
        and coalesce(qual,'') || coalesce(with_check,'') like '%auth.uid()%'$q$, 4);

select selv_verify.note('03','§2 policy shape','policy expressions (verbatim)',
  string_agg(policyname || ' [' || cmd || ']' ||
             E'\n    USING: '      || coalesce(qual,'(none)') ||
             E'\n    WITH CHECK: ' || coalesce(with_check,'(none — falls back to USING)'),
             E'\n' order by policyname))
from pg_policies
where schemaname='storage' and tablename='objects' and policyname like 'own garment images%';

-- The UPDATE policy is written with USING and no WITH CHECK. That reads like a
-- gap — "nothing validates the NEW row, so a user could rename their object
-- into someone else's folder" — and it is worth stating why it is not one:
-- PostgreSQL uses the USING expression as the WITH CHECK expression when the
-- latter is omitted. §3 proves that empirically rather than trusting the rule.
select selv_verify.note('03','§2 policy shape','UPDATE policy omits WITH CHECK',
  'Not a defect. Postgres applies USING as the check expression when WITH CHECK '
  'is absent, so a rename into another user''s prefix is still rejected. Proven '
  'empirically in §3 ("B cannot MOVE its own object into A''s folder").',
  'INFO');

-- ===========================================================================
-- §3. Live two-account object test
-- ===========================================================================
-- Plant one object row per user as `postgres` (which bypasses RLS, exactly as
-- the service role does), then wear B's JWT and try everything.
--
-- These are metadata rows with no bytes behind them in S3. That is deliberate
-- and sufficient: the policies read `bucket_id` and `name` and nothing else, so
-- the object body is irrelevant to what is under test. The HTTP appendix covers
-- the byte path.

delete from storage.objects
 where bucket_id='garments'
   and name in (selv_verify.uid_a()::text||'/selv-verify.jpg',
                selv_verify.uid_b()::text||'/selv-verify.jpg',
                selv_verify.uid_a()::text||'/stolen.jpg');

insert into storage.objects (bucket_id, name)
values ('garments', selv_verify.uid_a()::text||'/selv-verify.jpg'),
       ('garments', selv_verify.uid_b()::text||'/selv-verify.jpg');

select set_config('request.jwt.claims',
                  selv_verify.claims(selv_verify.uid_b(), selv_verify.email_b()), false);
set role authenticated;

-- Positive control first. If B cannot see its OWN object, every isolation PASS
-- below is vacuous and the app is broken rather than secure.
select selv_verify.expect_count('03','§3 object isolation','B CAN see its own object',
  $q$select count(*) from storage.objects
      where bucket_id='garments' and name = selv_verify.uid_b()::text||'/selv-verify.jpg'$q$, 1);

select selv_verify.expect_count('03','§3 object isolation','B cannot see A''s object',
  $q$select count(*) from storage.objects
      where bucket_id='garments' and name = selv_verify.uid_a()::text||'/selv-verify.jpg'$q$, 0);
select selv_verify.expect_count('03','§3 object isolation','B cannot list ANY object outside its own prefix',
  $q$select count(*) from storage.objects
      where bucket_id='garments'
        and (storage.foldername(name))[1] is distinct from selv_verify.uid_b()::text$q$, 0);

select selv_verify.expect_error('03','§3 object isolation','B cannot WRITE into A''s folder',
  $q$insert into storage.objects (bucket_id, name)
     values ('garments', selv_verify.uid_a()::text||'/stolen.jpg')$q$);
select selv_verify.expect_error('03','§3 object isolation','B cannot write to the bucket root (no user folder)',
  $q$insert into storage.objects (bucket_id, name) values ('garments','loose.jpg')$q$);

-- The rename attack the missing WITH CHECK appears to allow.
select selv_verify.expect_error('03','§3 object isolation','B cannot MOVE its own object into A''s folder',
  $q$update storage.objects set name = selv_verify.uid_a()::text||'/hijacked.jpg'
      where bucket_id='garments' and name = selv_verify.uid_b()::text||'/selv-verify.jpg'$q$);

-- UPDATE/DELETE against invisible rows: filtered, not raised. Expect 0 rows.
select selv_verify.expect_affected('03','§3 object isolation','B cannot rename A''s object',
  $q$update storage.objects set name = selv_verify.uid_b()::text||'/taken.jpg'
      where bucket_id='garments' and name = selv_verify.uid_a()::text||'/selv-verify.jpg'$q$, 0);
select selv_verify.expect_affected('03','§3 object isolation','B cannot DELETE A''s object',
  $q$delete from storage.objects
      where bucket_id='garments' and name = selv_verify.uid_a()::text||'/selv-verify.jpg'$q$, 0);

reset role;

-- Anon holds the key that ships in the app binary.
select set_config('request.jwt.claims','',false);
set role anon;
select selv_verify.expect_count('03','§3 object isolation','anon sees no garment objects at all',
  $q$select count(*) from storage.objects where bucket_id='garments'$q$, 0);
select selv_verify.expect_error('03','§3 object isolation','anon cannot write a garment object',
  $q$insert into storage.objects (bucket_id,name) values ('garments','anon/x.jpg')$q$);
reset role;

-- ===========================================================================
-- §4. Hygiene: objects that no policy could have created
-- ===========================================================================
-- Every client upload is forced into `{uid}/…` by the insert policy, so any
-- object whose first path segment is not a live auth.users id got there by
-- some other route — a service-role script, a dashboard upload, or an account
-- deleted while its files survived. The last one is the interesting case: it is
-- exactly the residue `delete-account` logs and then deliberately does not fail
-- the request over, and it is a live GDPR/5.1.1 exposure if it accumulates.
select selv_verify.expect_count('03','§4 hygiene','no orphaned objects under a non-existent user prefix',
  $q$select count(*) from storage.objects o
      where o.bucket_id='garments'
        and (storage.foldername(o.name))[1] !~ '^[0-9a-f-]{36}$'$q$, 0);
select selv_verify.expect_count('03','§4 hygiene','no objects belonging to a DELETED user (deletion residue)',
  $q$select count(*) from storage.objects o
      where o.bucket_id='garments'
        and (storage.foldername(o.name))[1] ~ '^[0-9a-f-]{36}$'
        and not exists (select 1 from auth.users u
                        where u.id = ((storage.foldername(o.name))[1])::uuid)$q$, 0);

select selv_verify.note('03','§4 hygiene','orphan sweep query (keep this — run it monthly)',
  'select o.name, o.created_at from storage.objects o '
  'where o.bucket_id = ''garments'' '
  'and not exists (select 1 from auth.users u '
  'where u.id::text = (storage.foldername(o.name))[1]);');

-- ===========================================================================
-- §5. DDL that MUST ship with avatar-previews / outfit-thumbnails
-- ===========================================================================
-- Verbatim from the `garments` pattern in schema.sql, with the bucket id
-- swapped. Ship this in the same migration that creates the bucket — a private
-- bucket with no policies is unreadable by its owner, and a bucket created
-- through the dashboard with "public" ticked is readable by everyone.
--
--   insert into storage.buckets (id, name, public)
--   values ('avatar-previews','avatar-previews', false)
--   on conflict (id) do nothing;
--
--   create policy "own avatar preview select" on storage.objects
--     for select using (bucket_id = 'avatar-previews'
--       and (storage.foldername(name))[1] = auth.uid()::text);
--   create policy "own avatar preview insert" on storage.objects
--     for insert with check (bucket_id = 'avatar-previews'
--       and (storage.foldername(name))[1] = auth.uid()::text);
--   create policy "own avatar preview update" on storage.objects
--     for update using (bucket_id = 'avatar-previews'
--       and (storage.foldername(name))[1] = auth.uid()::text);
--   create policy "own avatar preview delete" on storage.objects
--     for delete using (bucket_id = 'avatar-previews'
--       and (storage.foldername(name))[1] = auth.uid()::text);
--
-- …and the same four for 'outfit-thumbnails'.
--
-- Two things that must land in the same change:
--   * `delete-account/index.ts` already lists both bucket names in
--     USER_SCOPED_BUCKETS, so deletion coverage is already correct — but
--     re-run 04_account_deletion_verification.sql afterwards to prove it
--     against a bucket that actually exists.
--   * legal/DATA_HANDLING.md §2b and PRIVACY_POLICY.md §2 describe both
--     buckets as planned. Publishing the policy while they are live and
--     undisclosed is the mismatch App Review checks for.
select selv_verify.note('03','§5 future buckets','DDL for the two planned buckets',
  'See the commented block above this row. Ship bucket + 4 policies in one '
  'migration, then re-run 04.');

-- ===========================================================================
-- §6. Report
-- ===========================================================================

select verdict, count(*) as checks
  from selv_verify.results where script='03' group by verdict order by 1;

select id, section, check_name, expected, actual, verdict
  from selv_verify.results where script='03' order by id;

select case
  when exists (select 1 from selv_verify.results where script='03' and verdict='FAIL')
  then '❌ 03 FAILED — storage policies do not isolate users. Do not submit.'
  else '✅ 03 PASSED — garments bucket is private and per-user path scoped.'
end as verdict;

-- ===========================================================================
-- §7. Teardown
-- ===========================================================================
delete from storage.objects
 where bucket_id='garments'
   and name in (selv_verify.uid_a()::text||'/selv-verify.jpg',
                selv_verify.uid_b()::text||'/selv-verify.jpg');

-- ===========================================================================
-- APPENDIX — the HTTP half (Storage API)
-- ===========================================================================
--   export URL=https://<project-ref>.supabase.co
--   export ANON=<anon key>
--   export TOKEN_B=<user B's access token>
--   export UID_A=<user A's uuid>
--   export UID_B=<user B's uuid>
--
-- 1. B uploads into its own folder. MUST succeed (200).
--    curl -si -X POST "$URL/storage/v1/object/garments/$UID_B/http-test.jpg" \
--      -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_B" \
--      -H "Content-Type: image/jpeg" --data-binary @some.jpg
--
-- 2. B uploads into A's folder. MUST be rejected (400/403 "new row violates
--    row-level security policy").
--    curl -si -X POST "$URL/storage/v1/object/garments/$UID_A/http-test.jpg" \
--      -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_B" \
--      -H "Content-Type: image/jpeg" --data-binary @some.jpg
--
-- 3. B lists A's folder. MUST return [].
--    curl -s -X POST "$URL/storage/v1/object/list/garments" \
--      -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_B" \
--      -H "Content-Type: application/json" -d "{\"prefix\":\"$UID_A\"}"
--
-- 4. Anonymous read of a known garment path. MUST be 400/404, never the image.
--    This is the check that catches a bucket flipped to public — the one
--    setting that silently voids every policy above.
--    curl -si "$URL/storage/v1/object/public/garments/$UID_A/http-test.jpg"
--
-- 5. Signed URL scope. Ask for a signed URL as B for one of B's own objects,
--    confirm it downloads, then confirm the same call for one of A's paths is
--    refused rather than signed:
--    curl -si -X POST "$URL/storage/v1/object/sign/garments/$UID_A/http-test.jpg" \
--      -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_B" \
--      -H "Content-Type: application/json" -d '{"expiresIn":60}'
--
-- Clean up anything you uploaded before going live.
-- ===========================================================================
