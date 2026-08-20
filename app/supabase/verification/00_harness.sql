-- ===========================================================================
-- 00_harness.sql — shared test harness for the verification scripts
-- ===========================================================================
-- RUN THIS FIRST, ONCE PER SESSION. Scripts 01–04 all depend on it.
--
-- Creates a scratch schema `selv_verify` holding:
--   * a results table every check writes one row into,
--   * three assertion helpers, and
--   * an impersonation helper for building JWT claim payloads.
--
-- Nothing here touches application data or application policies. The schema is
-- dropped by the teardown at the bottom of script 01–04 (or by
-- `drop schema selv_verify cascade;` at any time).
--
-- WHY THE HELPERS ARE SECURITY INVOKER (the default, stated here so nobody
-- "fixes" it): they must execute with the *caller's* privileges so that RLS
-- applies to the statements they run. A SECURITY DEFINER helper owned by
-- `postgres` would bypass RLS and report a green audit against a database with
-- no policies at all.
-- ===========================================================================

reset role;

drop schema if exists selv_verify cascade;
create schema selv_verify;

-- --- results --------------------------------------------------------------
create table selv_verify.results (
  id         bigserial primary key,
  script     text not null,
  section    text not null,
  check_name text not null,
  expected   text,
  actual     text,
  verdict    text not null,   -- PASS | FAIL | INFO | EXPECTED-ABSENT
  at         timestamptz not null default now()
);

-- --- helper: record a plain fact / recommendation, no assertion ------------
create or replace function selv_verify.note(
  p_script text, p_section text, p_name text, p_actual text,
  p_verdict text default 'INFO'
) returns void language sql as $$
  insert into selv_verify.results(script,section,check_name,expected,actual,verdict)
  values (p_script, p_section, p_name, null, p_actual, p_verdict);
$$;

-- --- helper: PASS when the statement RAISES ------------------------------
-- Use for INSERTs that a `with check` (or a missing INSERT policy) must reject.
-- Postgres raises 42501 "new row violates row-level security policy" for those.
--
-- The plpgsql EXCEPTION block opens an implicit savepoint, so a caught error
-- rolls back only the failed statement — the surrounding transaction (and this
-- INSERT into results) survives. That is the whole reason the helper exists
-- rather than 40 hand-run statements whose expected outcome is an error.
create or replace function selv_verify.expect_error(
  p_script text, p_section text, p_name text, p_sql text
) returns text language plpgsql as $$
declare v_verdict text; v_actual text;
begin
  begin
    execute p_sql;
    v_actual  := 'statement SUCCEEDED — the write was accepted';
    v_verdict := 'FAIL';
  exception when others then
    v_actual  := sqlstate || ' ' || sqlerrm;
    v_verdict := 'PASS';
  end;
  insert into selv_verify.results(script,section,check_name,expected,actual,verdict)
  values (p_script, p_section, p_name, 'rejected with an error', v_actual, v_verdict);
  return v_verdict;
end $$;

-- --- helper: assert a scalar count ---------------------------------------
-- `p_sql` must be a query returning exactly one bigint.
create or replace function selv_verify.expect_count(
  p_script text, p_section text, p_name text, p_sql text, p_expected bigint
) returns text language plpgsql as $$
declare v_n bigint; v_verdict text; v_actual text;
begin
  begin
    execute p_sql into v_n;
    v_actual  := v_n::text || ' row(s)';
    v_verdict := case when v_n = p_expected then 'PASS' else 'FAIL' end;
  exception when others then
    v_actual  := 'ERROR ' || sqlstate || ' ' || sqlerrm;
    v_verdict := 'FAIL';
  end;
  insert into selv_verify.results(script,section,check_name,expected,actual,verdict)
  values (p_script, p_section, p_name, p_expected::text || ' row(s)', v_actual, v_verdict);
  return v_verdict;
end $$;

-- --- helper: assert an affected-row count --------------------------------
-- Use for UPDATE/DELETE. RLS does NOT raise on these: rows the `using` clause
-- hides are simply not matched, so a cross-user UPDATE succeeds and reports
-- zero rows. Asserting "an error was raised" here would report a false FAIL,
-- and asserting nothing at all would miss a genuinely open policy.
create or replace function selv_verify.expect_affected(
  p_script text, p_section text, p_name text, p_sql text, p_expected bigint
) returns text language plpgsql as $$
declare v_n bigint; v_verdict text; v_actual text;
begin
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    v_actual  := v_n::text || ' row(s) affected';
    v_verdict := case when v_n = p_expected then 'PASS' else 'FAIL' end;
  exception when others then
    -- An error is also an acceptable denial for a write that must not happen,
    -- but it is a *different* denial than the one we asked about, so surface
    -- it verbatim rather than silently scoring it.
    v_actual  := 'ERROR ' || sqlstate || ' ' || sqlerrm;
    v_verdict := case when p_expected = 0 then 'PASS' else 'FAIL' end;
  end;
  insert into selv_verify.results(script,section,check_name,expected,actual,verdict)
  values (p_script, p_section, p_name, p_expected::text || ' row(s) affected', v_actual, v_verdict);
  return v_verdict;
end $$;

-- --- helper: build a PostgREST-shaped JWT claims payload ------------------
-- Mirrors what PostgREST puts in `request.jwt.claims` for a signed-in user.
-- `email` is included because public.waitlist_signups.email defaults to
-- `auth.jwt() ->> 'email'` — omitting it would make that column's NOT NULL
-- fire and produce a misleading failure unrelated to RLS.
create or replace function selv_verify.claims(p_uid uuid, p_email text)
returns text language sql immutable as $$
  select json_build_object(
    'sub',  p_uid::text,
    'role', 'authenticated',
    'aud',  'authenticated',
    'email', p_email
  )::text;
$$;

-- --- grants ---------------------------------------------------------------
-- The helpers run while the session is impersonating `authenticated`, so that
-- role needs to reach the schema. These grants live and die with the scratch
-- schema; the teardown drops all of it.
grant usage on schema selv_verify to authenticated, anon;
grant select, insert on selv_verify.results to authenticated, anon;
grant usage, select on all sequences in schema selv_verify to authenticated, anon;
grant execute on all functions in schema selv_verify to authenticated, anon;

select 'harness ready — now run 01 / 02 / 03 / 04' as status;
