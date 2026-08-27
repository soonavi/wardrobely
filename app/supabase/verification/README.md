# `supabase/verification/` — runbook

Four SQL scripts a **human** runs against the live (or staging) Supabase project
to discharge the 🔴 items in `LAUNCH_CHECKLIST.md` §4 and the account-deletion
item in §2. They are verification only: none of them changes a policy, a grant,
or application data, and each one cleans up everything it creates.

| Script | Discharges |
|---|---|
| `00_harness.sql` | **run first** — shared results table + assertion helpers. Not a check itself. |
| `01_rls_two_account_audit.sql` | §4 "RLS audit … verified with a real second-user test account" (+ §1's enforced 13+ age gate) |
| `02_affiliate_write_path_audit.sql` | §4 "Audit that the **insert path** is what's locked down" |
| `03_storage_policy_audit.sql` | §4 "Confirm Storage bucket policies match the RLS pattern" |
| `04_account_deletion_verification.sql` | §2 / §3 "Manually test the in-app account-deletion flow end to end" |

---

## Before you start

### 1. Run against staging if you have one

Every script seeds rows and deletes exactly what it seeded (all test data is
tagged — brand slug `selv-verify`, names prefixed `[selv-verify]`). Nothing else
is touched. But `04` **permanently deletes a real account**, so run it against a
throwaway account either way.

### 2. Create two throwaway auth users

Do this through the real signup path so the `on_auth_user_created` trigger fires
and each user gets a `profiles` row, exactly as a real user would:

- Supabase Dashboard → Authentication → Users → **Add user** (×2), or
- sign up twice in the app / simulator.

Suggested addresses: `selv-verify-a@example.com`, `selv-verify-b@example.com`.

Then get their ids:

```sql
select id, email from auth.users
 where email in ('selv-verify-a@example.com','selv-verify-b@example.com');
```

For `04` you need a **third** account you are willing to destroy, plus a real
access token for it (see that script's header).

### 3. Use `psql`, not the dashboard SQL editor, if you can

```bash
psql "$SUPABASE_DB_URL" -f app/supabase/verification/01_rls_two_account_audit.sql
```

The scripts are written to work in the dashboard SQL editor too (they use
session-level `set role` / `set_config`, not `SET LOCAL`, so they do not depend
on how the editor wraps statements). `psql` is preferred only because you get
the whole PASS/FAIL report in one scrollable output.

### 4. Edit the CONFIG block at the top of each script

Each script has a single clearly-marked block where you paste the two UUIDs.
Nothing else needs editing.

---

## How the impersonation works, and why it is a real second-user test

`auth.uid()` in Supabase reads the `sub` claim out of the
`request.jwt.claims` GUC. PostgREST sets that GUC (and `set role authenticated`)
on every request it serves. The scripts do the same two things by hand:

```sql
set role authenticated;                                  -- <-- load-bearing
select set_config('request.jwt.claims', '{"sub":"…"}', false);
```

**Both statements matter.** `postgres` and `service_role` carry `BYPASSRLS`, so
setting only the claims and staying as `postgres` produces a meaningless test
that quietly passes nothing. `set role authenticated` drops to the same role and
the same privilege set PostgREST uses, so from that point on the session is
subject to *exactly* the RLS policies and column grants a real signed-in user
hits.

What this proves: the database refuses cross-user reads and writes. What it does
**not** prove: that PostgREST, the Storage API, and the Edge Functions are
wired to the right roles. Each script therefore ends with a short
**HTTP appendix** — a handful of `curl` calls with two real users' access
tokens — that closes that gap. Run both halves.

### Two failure shapes, and why the scripts distinguish them

RLS denies a write in two different ways, and an audit that only looks for one
of them reports false passes:

- **INSERT** against a failing (or absent) `WITH CHECK` raises
  `42501 new row violates row-level security policy`. The script asserts an
  **error**.
- **UPDATE / DELETE** against rows a `USING` clause hides simply *matches
  nothing*. No error is raised; the statement succeeds and reports **0 rows**.
  The script asserts an **affected-row count of 0**.

`selv_verify.expect_error(...)` and `selv_verify.expect_affected(...)` exist to
keep those apart.

---

## Reading the output

Every check writes one row into `selv_verify.results`. Each script ends with:

```sql
select * from selv_verify.results order by id;
select verdict, count(*) from selv_verify.results group by verdict;
```

- `PASS` — the assertion held.
- `FAIL` — a real defect. Do not submit.
- `INFO` — recorded fact, no assertion. Read it; some `INFO` rows carry
  recommendations (e.g. defence-in-depth grants).
- `EXPECTED-ABSENT` — something the audit deliberately confirms is *missing*,
  because its absence is the design (the affiliate insert policies) or because
  it is not built yet (`avatar-previews`).

**A FAIL count of 0 is the bar.** Anything else, fix before submission.

## Teardown

Each script's final section drops the `selv_verify` schema and removes its seed
rows. `04` deliberately splits into phases and keeps its baseline table between
them — do not run its teardown until Phase 3 has reported.

If a script errors partway through, the session may be left as the
`authenticated` role. Every script starts with `reset role;` for that reason;
re-running from the top is always safe.
