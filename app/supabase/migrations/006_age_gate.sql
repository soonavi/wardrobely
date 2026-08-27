-- ===========================================================================
-- 006_age_gate.sql — minimum account age of 13, enforced by the database
-- ===========================================================================
-- Applies on top of 005_waitlist_shop_source.sql and can be re-run safely:
-- every statement is guarded (`if not exists`, `create or replace`, or
-- `drop … if exists` before create), matching 002/003/004/005 so a partial
-- failure can be fixed and the whole file re-applied.
--
-- WHY THIS EXISTS
-- LAUNCH_CHECKLIST.md §1 carries a 🔴 BLOCKING item: "Set minimum account age
-- to 13 at signup (age gate / birthdate field) and confirm this is enforced,
-- not just stated in the ToS". legal/PRIVACY_POLICY.md §12 already tells users
-- "Selv is intended for users 13 and older (we enforce a minimum age at
-- signup)" — so until this file ran, the policy stated a control that did not
-- exist. That is the specific failure mode the checklist item names, and the
-- reason the fix has to land in the database and not only in a screen: a
-- client-side gate is a suggestion to anyone holding the anon key and a
-- Postgrest URL, and "we enforce" has to survive that.
--
-- WHAT WE STORE, AND WHY IT IS NOT A BIRTHDATE
-- The obvious design is `profiles.birthdate date` with
-- `check (birthdate <= current_date - interval '13 years')`. It is exact, it
-- is one column, and it is the wrong trade for this app.
--
-- A full date of birth is a high-value identifier — day-precision DOB plus an
-- email address is most of what a credential-stuffing or account-recovery
-- attack needs, and it is a permanent one (unlike an email, you cannot rotate
-- it after a breach). legal/DATA_HANDLING.md §2a is a table of what each row
-- holds and how sensitive it is; `profiles` sits at "Medium" today, and a DOB
-- column would be the most sensitive field in the app — more sensitive than
-- the garment photos, and considerably more sensitive than the avatar, which
-- the product pivot already reduced to a record of preset choices. The FTC's
-- COPPA guidance points the same way: an age screen should collect the
-- *answer to the age question*, and a service should not retain more birth
-- data than the answer requires.
--
-- So the question is: what is the least data that still lets us *prove*
-- enforcement rather than merely assert it? Two columns:
--
--   age_verified_on  date  -- the day we ran an exact ≥13 check, or null
--   birth_year       smallint -- year only: no month, no day
--
-- The exact, day-precision check happens inside public.record_age_check()
-- below, which receives the full birthdate, evaluates it in SQL, and then
-- *discards it* — the date is a function argument, never a column. What
-- persists is the verdict and the coarsest signal that keeps the verdict
-- independently checkable.
--
-- Two properties make that sufficient, and they are worth stating because
-- "just store the boolean" is the design this replaces and it is not
-- sufficient:
--
--   * A verdict is permanent. Age is monotonic — nobody gets younger — so
--     "this account was ≥13 on 2026-08-20" stays true forever. A timestamped
--     verdict is a complete and permanent proof in a way that, say, a
--     snapshotted price or a commission rate never is. There is nothing to
--     re-derive later, which is exactly why the input can be thrown away.
--
--   * A bare boolean would be unfalsifiable. `age_ok boolean` written by a
--     client is a claim we have no way to audit and no way to disprove; it is
--     the ToS-only enforcement the checklist item is complaining about, moved
--     into a column. `birth_year` + `age_verified_on` can be re-checked
--     against each other by anyone with read access, forever, with no
--     application code in the loop — see the check constraint below.
--
-- The cost of dropping month and day is that the *constraint* is coarser than
-- the *gate*, and this file does not pretend otherwise: see
-- profiles_age_verified_consistent, which spells out exactly what the coarse
-- invariant does and does not catch. The gate is exact; the constraint is a
-- backstop.
--
-- If a future requirement genuinely needs finer age granularity — GDPR Art. 8
-- member-state thresholds run 13–16 and PRIVACY_POLICY.md §12 currently
-- resolves that by leaning on this 13+ floor plus Apple's platform signals —
-- collect it then, for that purpose. Collecting day-precision DOB now against
-- a requirement nobody has written down is how a Medium-sensitivity table
-- becomes a High one by accident.
--
-- NOT THE SAME QUESTION AS "CAN THIS ACCOUNT USE THE APP"
-- This file makes it impossible to *record* an under-13 verdict and
-- impossible to *forge* a verdict. Whether an account that has not passed the
-- gate can go on to use the product is access control, handled by the
-- restrictive UPDATE policy at the bottom (which blocks onboarding from
-- completing) plus the routing gate in app/_layout.tsx. The scope line is
-- drawn deliberately and is discussed there.
--
-- MIRRORED INTO schema.sql. Unlike 004/005 — whose "add this to schema.sql
-- next time it is touched" notes are still outstanding — everything below is
-- also written into supabase/schema.sql, in the profiles table definition and
-- the RLS section. Keep the two in sync.
-- ===========================================================================

-- --- Columns ---------------------------------------------------------------
-- Both nullable, both added with no default. `null` is the honest
-- representation of "this account has never been age-checked", and it is what
-- every row that already exists gets — see the BACKFILL section below, which
-- is the whole reason there is no default here.
--
-- `smallint` for the year is not micro-optimisation; it is a second, cheaper
-- statement of intent. A `date` column invites someone to widen it back to
-- day precision later "since it's already a date"; a smallint holding 2011
-- cannot be quietly upgraded into a birthdate without a migration that has to
-- justify itself.
alter table public.profiles
  add column if not exists birth_year smallint;
alter table public.profiles
  add column if not exists age_verified_on date;

comment on column public.profiles.birth_year is
  'Birth YEAR only (no month, no day) — the coarsest signal that keeps the '
  'age verdict independently checkable. Written only by '
  'public.record_age_check(); clients have no column-level write grant. See '
  '006_age_gate.sql.';
comment on column public.profiles.age_verified_on is
  'Date on which an exact >=13 check passed, or null if this account has '
  'never been age-checked. Null routes the user to the age gate in '
  'app/_layout.tsx. Written only by public.record_age_check().';

-- --- The invariant ---------------------------------------------------------
-- Dropped-then-added so a re-run replaces the definition rather than failing
-- on the existing name (same as `waitlist_signups_email_shape` in 004 and
-- `garments_image_present` in 002).
--
-- READ THIS AS A SENTENCE: "either this profile has never been age-checked,
-- or it carries a birth year at least 13 years before the day we checked it."
-- That is the compliance claim in PRIVACY_POLICY.md §12, written as something
-- the database refuses to violate rather than something a code review has to
-- notice. It holds for every row, forever, with no application code in the
-- loop — including rows written by the service role, by a future edge
-- function, or by hand in the SQL editor at 2am.
--
-- WHAT IT DOES NOT CATCH, SAID PLAINLY. Because we deliberately kept only the
-- year, the arithmetic here is a *necessary* condition, not a sufficient one:
-- a birth year of 2013 with a verification date of 2026-01-05 satisfies it,
-- and describes someone who could be 12 years and 11 months old. The exact,
-- day-precision test lives in record_age_check() below, which sees the real
-- birthdate and is the gate. This constraint is the backstop, and it is worth
-- having anyway because the class of error it does catch is the realistic one:
-- a bad backfill, a service-role script, or a future writer that sets one
-- column and forgets the other. It cannot be tightened without retaining the
-- month and day, which is the trade this file exists to refuse.
--
-- The `is null` / `is not null` pairing in the first branch is load-bearing:
-- it forbids the two half-states. A row with a verification date and no birth
-- year is an unauditable verdict (the boolean design, sneaking back in), and a
-- row with a birth year and no verification date is a retained fragment of
-- birth data with no compliance purpose. Neither is allowed to exist.
--
-- Every function here is immutable over a `date` (`extract(year from date)`
-- is; the same expression over a `timestamptz` would not be, since the year
-- would depend on the session TimeZone — which is why age_verified_on is a
-- `date` and not a `timestamptz`).
alter table public.profiles
  drop constraint if exists profiles_age_verified_consistent;
alter table public.profiles
  add constraint profiles_age_verified_consistent check (
    (birth_year is null and age_verified_on is null)
    or (
      birth_year is not null
      and age_verified_on is not null
      -- Sanity bounds. Not a compliance rule — a typo catcher, so a fumbled
      -- service-role backfill writing year 20 or 20260 fails at the write
      -- instead of quietly satisfying the >=13 arithmetic (year 20 does).
      and birth_year between 1900 and 2200
      and birth_year <= extract(year from age_verified_on)::int - 13
    )
  );

-- --- BACKFILL: what happens to the rows that already exist ------------------
-- This table is populated in production. Every existing row gets
-- (null, null) from the ALTERs above and therefore lands in the first branch
-- of the constraint, which is why the constraint validates instead of
-- aborting the migration. That is the mechanical answer; the policy answer
-- needs stating, because there are three tempting wrong ones.
--
-- WE DO NOT grandfather them in. Writing
--   update public.profiles set birth_year = 1900, age_verified_on = current_date
--   where age_verified_on is null;
-- would make every row satisfy the constraint, make the gate invisible, and
-- make PRIVACY_POLICY.md §12 a false statement about exactly the users it was
-- written to protect. The one thing a compliance control must never do is
-- report success for checks it did not run. A fabricated verdict is worse
-- than a missing one, because a missing one is visible.
--
-- WE DO NOT lock them out. No account is deleted, disabled, or made
-- unreadable by this migration. A returning user keeps their wardrobe, their
-- outfits and their avatar; RLS on those tables is untouched. What they lose
-- is the ability to *continue past the gate* until they answer it — see the
-- restrictive UPDATE policy at the bottom of this file — which is one screen
-- and a few taps, not a lockout, and is the same screen a new user sees.
--
-- WE DO NOT infer an age from anything we already hold. There is nothing in
-- `profiles` that implies one (`height_cm`/`weight_kg` are optional,
-- self-reported and mostly null; `build` is an avatar preset), and inferring
-- an age from body data would be both unreliable and precisely the kind of
-- body-signal inference MARKETING_STRATEGY.md §11 commits against.
--
-- SO: they are re-asked. app/_layout.tsx treats `age_verified_on is null`
-- identically for a legacy account and a brand-new one — both are routed to
-- the age step on the sign-in screen — and src/features/auth/SignInScreen.tsx
-- renders that step for an already-signed-in user with a "not you? sign out"
-- escape hatch. A legacy user answers once and never sees it again.
--
-- The consequence to accept honestly: for the window between deploying this
-- migration and a given user next opening the app, that account is
-- un-age-verified and can still read its own data. The alternative — refusing
-- reads until the answer arrives — punishes people for our omission and does
-- not make any under-13 account less under-13 in the meantime. The window
-- closes on next launch, per user, and the query below is how you watch it
-- close.
--
-- The index exists to serve exactly that operational question ("how many
-- accounts still owe us an answer"), and it is partial so it indexes only the
-- rows that still owe one — meaning it shrinks toward empty as the backlog
-- clears, rather than growing with the table:
--
--   select count(*) from public.profiles where age_verified_on is null;
--
-- If that count stops falling while signups continue, the client gate has
-- regressed and this is the metric that says so.
create index if not exists profiles_age_unverified_idx
  on public.profiles(created_at)
  where age_verified_on is null;

-- --- The gate --------------------------------------------------------------
-- The only way a verdict is ever written. Same shape and for the same reason
-- as public.create_affiliate_click() in 003/schema.sql: the row carries a
-- term the client must not be able to state, so the client states the *input*
-- and the database states the *conclusion*.
--
-- The parallel is exact, and it is the reason this is an RPC rather than a
-- check constraint on a client-writable column. There, a forged
-- commission_rate_bps invoices a partner for their own order value. Here, a
-- forged age verdict is a 12-year-old with an account and a privacy policy
-- that says we do not have any. Both are cases where the client is not a
-- trustworthy source for a value we will later be held to.
--
-- WHAT IT DOES WITH THE BIRTHDATE: reads it, checks it exactly, throws it
-- away. `p_birthdate` is a function argument. It is never inserted, never
-- logged (the raise messages below deliberately do not interpolate it, unlike
-- create_affiliate_click which interpolates product ids — a product id is not
-- personal data and a date of birth is), and it does not survive the call.
-- The only trace it leaves is its year and the fact that it passed.
--
-- Pinned empty search_path and schema-qualified names throughout, matching
-- create_affiliate_click: a definer function that resolves unqualified names
-- through the caller's search_path can be pointed at someone else's
-- `profiles`. pg_catalog is implicitly searched, so builtin types and
-- functions still resolve.
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
  -- Selv has no anonymous browsing and no anonymous accounts: the gate is
  -- answered *before* the OTP is requested for a new signup (so no auth.users
  -- row is ever created for a rejected under-13 — see SignInScreen), and this
  -- call happens once a session exists. A null uid is a probe, not a flow.
  if v_user_id is null then
    raise exception 'record_age_check: authentication required'
      using errcode = '42501'; -- insufficient_privilege -> 401/403
  end if;

  if p_birthdate is null then
    raise exception 'record_age_check: a date of birth is required'
      using errcode = '22004'; -- null_value_not_allowed
  end if;

  -- Order matters below: the shape complaints come before the age verdict, so
  -- a user who mistypes the year gets "check that date" rather than being told
  -- they are too young to use the app. Being wrongly told you are a child is a
  -- bad enough experience that it is worth two extra branches.
  if p_birthdate > v_today then
    raise exception 'record_age_check: date of birth is in the future'
      using errcode = '22007'; -- invalid_datetime_format
  end if;

  -- Typo catcher, matching the constraint's sanity bounds and
  -- MAX_PLAUSIBLE_AGE_YEARS in src/features/age/minimumAge.ts. Not a
  -- compliance rule: someone born in 1850 is comfortably over 13. It exists so
  -- a slipped digit fails loudly instead of passing the age test with a year
  -- that will later trip the constraint's 1900 floor at write time — better to
  -- name the real problem here than to surface a constraint violation.
  if p_birthdate < v_today - interval '120 years' then
    raise exception 'record_age_check: date of birth is not plausible'
      using errcode = '22007';
  end if;

  -- THE CHECK. Exact to the day, and the only place in the system that is.
  --
  -- `v_today - interval '13 years'` is the latest birthdate that is already
  -- 13 today, so the test is "born after the cutoff" = too young. Worked
  -- boundaries, because this single comparison is the whole compliance
  -- control and an off-by-one here is the bug that ships:
  --
  --   * turns 13 exactly today: birthdate = cutoff, `>` is false -> allowed.
  --     Someone is 13 on their 13th birthday, not the day after.
  --   * turns 13 tomorrow: birthdate = cutoff + 1 day, `>` is true -> blocked.
  --   * born 2012-02-29, today 2025-02-28: cutoff is 2012-02-28 (Postgres
  --     clamps 2025-02-28 minus 13 years to a real date), 2012-02-29 > that,
  --     so blocked — a leap-day birthday is treated as falling on March 1 in
  --     non-leap years, which is the conservative reading and the one
  --     ageInYearsOn() in src/features/age/minimumAge.ts produces from the
  --     same inputs. The two implementations agree by construction, not by
  --     coincidence; the test suite pins the shared boundaries.
  --   * born 2012-02-29, today 2025-03-01: cutoff is 2012-03-01, not greater,
  --     allowed.
  --
  -- ON TIMEZONES: `current_date` is the date in the *database* session's
  -- TimeZone (UTC on Supabase); the client computed its own preview from the
  -- device's local calendar. Those can differ by a day at the edges. This one
  -- is authoritative and both directions of disagreement are safe: if the
  -- device is ahead of UTC the server refuses someone the client would have
  -- let through (they retry tomorrow), and if it is behind, the client
  -- refuses first. Neither ordering admits an under-13.
  if p_birthdate > (v_today - interval '13 years')::date then
    raise exception 'record_age_check: minimum age is 13'
      using errcode = 'P0001'; -- raise_exception; mapped to user copy client-side
  end if;

  v_birth_year := extract(year from p_birthdate)::smallint;

  -- Upsert rather than update. public.handle_new_user() creates the profile
  -- row on signup so the conflict branch is what actually runs in practice,
  -- but an account that predates that trigger (or whose row was removed by a
  -- partial cleanup) would otherwise be permanently unable to pass a gate it
  -- cannot get past — a "no profile row" failure with no user-facing remedy.
  -- The FK to auth.users still holds: v_user_id comes from a verified JWT.
  --
  -- Re-recording is deliberately allowed and idempotent-in-effect. The client
  -- retries this call if a concurrent profile fetch clobbers the local copy
  -- (see the recording effect in SignInScreen), and a user who answers twice
  -- with different dates has simply passed the >=13 test twice — both values
  -- satisfied it on their own verification date, so the constraint and the
  -- compliance claim hold either way. There is no state machine here to
  -- protect and so no reason to reject the second call.
  insert into public.profiles (id, birth_year, age_verified_on)
  values (v_user_id, v_birth_year, v_today)
  on conflict (id) do update
     set birth_year      = excluded.birth_year,
         age_verified_on = excluded.age_verified_on
  returning * into v_row;

  return v_row;
end $$;

-- Execute for signed-in users only. `create function` grants EXECUTE to
-- PUBLIC by default, so the revoke is not decoration — without it `anon`
-- inherits the right to call a definer function that writes `profiles`. The
-- anon revoke is redundant after the PUBLIC one and is spelled out anyway so
-- the intent survives someone re-granting PUBLIC. service_role is not listed:
-- it bypasses RLS and writes the columns directly, and has no use for this
-- wrapper (though it is still bound by the check constraint, which is the
-- point of having one).
revoke execute on function public.record_age_check(date) from public;
revoke execute on function public.record_age_check(date) from anon;
grant execute on function public.record_age_check(date) to authenticated;

-- --- Making the RPC the *only* path ----------------------------------------
-- Everything above is decoration if a client can just write the columns
-- itself. It can: Supabase's default privileges hand `anon` and
-- `authenticated` full DML on new tables in `public`, and the existing
-- `"own profile"` policy is `for all using (id = auth.uid())` — which
-- authorises `update profiles set age_verified_on = current_date, birth_year =
-- 1990 where id = auth.uid()` for every signed-in user in the world. RLS
-- decides *which rows*; it has no vocabulary for *which columns*. SQL
-- privileges do, so the restriction has to be stated here.
--
-- Same mechanism 004 used to freeze `waitlist_signups.source`/`created_at`,
-- and the same warning applies: the policy and the grant are one control
-- split across two statements. Deleting these lines does not "loosen"
-- anything gradually — it hands the age verdict straight back to the client
-- and turns the RPC into an elaborate suggestion.
--
-- The re-grants enumerate the columns the app legitimately writes
-- (src/lib/api/profiles.ts is the only client-side writer: updateBodyMetrics,
-- updateDisplayName, updateProfile). `id` is insertable but not updatable —
-- a row must be able to name itself, never to re-parent itself. `created_at`
-- is on neither list: it has a default and nothing should be restating it.
-- Adding a profiles column later means adding it here too, or PostgREST will
-- return 42501 for a write that RLS was perfectly happy with — an error whose
-- text points at permissions and whose cause is this list.
--
-- Revoke/grant are absolute rather than additive, so re-running is safe.
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, display_name, body_type, height_cm, weight_kg, build)
  on public.profiles to authenticated;
grant update (display_name, body_type, height_cm, weight_kg, build)
  on public.profiles to authenticated;

-- `anon` has no business writing profiles under any circumstance. RLS already
-- blocks it (`id = auth.uid()` is null for an anonymous request and so never
-- true) and Selv has no anonymous browsing at all, so the privilege is removed
-- outright rather than left to be caught one layer down. Same defence-in-depth
-- reasoning as the `revoke execute … from anon` above and in 003. SELECT is
-- left alone for `authenticated` — reading your own profile is the whole point
-- of the table — and `anon` never had a row it could see.
revoke insert, update, delete on public.profiles from anon;

-- --- Enforcement, not just recording ---------------------------------------
-- The two controls above make it impossible to record an under-13 verdict and
-- impossible to forge any verdict. Neither of them stops an account that
-- simply *skipped* the gate from using the app, because a hostile client can
-- ignore the routing in app/_layout.tsx entirely and talk to PostgREST
-- directly. Without something here, "enforced" would mean "enforced against
-- users who use our UI", which is the ToS-with-extra-steps outcome the
-- checklist item is asking us not to ship.
--
-- This is that something, and it is deliberately narrow: an account with no
-- age verdict cannot write its own profile row.
--
-- WHY THAT PARTICULAR RESTRICTION. `profiles.build` is the gate into the
-- product — app/_layout.tsx holds every user in /onboarding until it is set,
-- and the only way to set it is an UPDATE on this table (the character
-- creator syncs it on save). So blocking profile writes blocks onboarding
-- from ever completing, for a bypassing client exactly as for an honest one,
-- without a single policy change on `garments`, `avatars`, `outfits` or the
-- commerce tables. One restrictive policy on one table, no cross-table
-- subqueries on any hot read path, and nothing for the RLS audit in
-- LAUNCH_CHECKLIST.md §4 to re-verify beyond this file.
--
-- WHY NOT GO FURTHER and gate reads/writes on the content tables too. It is
-- tempting and it is wrong here, for the reason spelled out in the BACKFILL
-- section: every account that predates this migration is un-verified through
-- no fault of its own, and a restrictive policy on `garments` would mean a
-- returning user opens the app to an empty wardrobe. Blocking *progress*
-- until the question is answered is proportionate; making someone's existing
-- data vanish is not. If that ever needs revisiting, the policy is:
--   create policy "garment writes require the age gate" on public.garments
--     as restrictive for insert with check (exists (
--       select 1 from public.profiles p
--        where p.id = auth.uid() and p.age_verified_on is not null));
-- and it should ship *after* the unverified backlog above has drained, not
-- before.
--
-- MECHANICS. `as restrictive` ANDs with the permissive `"own profile"` policy
-- instead of ORing, so this can only ever subtract. `using` sees the old row
-- and `with check` the new one; both test the same column because a client
-- cannot change it (the grants above), so there is no window where an update
-- flips the flag and authorises itself. The RPC is unaffected — a
-- `security definer` function bypasses RLS, which is what lets an unverified
-- user pass the gate that is otherwise blocking them. So is the service role,
-- so delete-account keeps working.
--
-- HOW A BLOCKED WRITE ACTUALLY LOOKS, because it is not an error and the
-- difference will cost someone an afternoon. A failed `with check` raises; a
-- failed `using` merely *filters*, so the statement matches zero rows and
-- reports plain success. An unverified client running
-- `update profiles set build = 'slim' where id = auth.uid()` gets `UPDATE 0`
-- and an unchanged row — the write does not happen, which is all the
-- enforcement needs, but nothing about the response says "age gate".
--
-- It does surface, and by luck rather than design: every writer in
-- src/lib/api/profiles.ts ends `.select().single()`, and PostgREST answers
-- zero rows there with PGRST116, so the character creator's Save shows an
-- error instead of silently returning to a wardrobe the user never got into.
-- If a future profiles writer drops `.single()`, that write will fail
-- invisibly for unverified accounts. Do not drop it.
--
-- Not `for all`: SELECT stays open (a user must be able to read the very
-- column that is blocking them, and the client gate needs it to route),
-- INSERT is already handled by the grants and by handle_new_user owning the
-- only insert path, and DELETE belongs to the service role.
--
-- `enable row level security` is idempotent and is restated here rather than
-- assumed: a restrictive policy on a table with RLS switched off is not a
-- weaker control, it is no control at all, and this file should not depend on
-- an earlier migration having got that right.
alter table public.profiles enable row level security;

drop policy if exists "profile writes require the age gate" on public.profiles;
create policy "profile writes require the age gate" on public.profiles
  as restrictive
  for update
  using (age_verified_on is not null)
  with check (age_verified_on is not null);
