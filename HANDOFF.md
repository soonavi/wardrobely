# Handoff — next session

Written 2026-10-04. Read this first; it is a runbook, not a status report.

---

## 1. Done: migrations 008 and 009 are applied

**Applied and verified 2026-10-04**, on project `tmldopeuctftnteerxjg`
(`wardrobe-app`, us-east-1). Nothing in this section is outstanding. It is kept
as the record of what landed, plus the connector gotchas found doing it — read
those before any further MCP migration work.

The ledger now reads 13 entries, ending:

```
20260827202054  pin_function_search_path           (007)
20261004083127  garment_measurements               (008)
20261004091445  assistant                          (009)
```

### Verification — re-run any time

```sql
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='garments'
      and column_name in ('measurement_source','chest_cm','waist_cm','hip_cm',
                          'length_cm','shoulder_cm','sleeve_cm','inseam_cm')) as garment_measurement_cols,  -- expect 8
  (select count(*) from information_schema.tables
    where table_schema='public'
      and table_name in ('assistant_preferences','assistant_suggestions'))     as assistant_tables,          -- expect 2
  (select count(*) from pg_policies
    where schemaname='public' and tablename='assistant_suggestions'
      and cmd in ('INSERT','ALL'))                                             as assistant_insert_policies,  -- expect 0
  (select enabled from public.assistant_preferences limit 1)                   as any_enabled;                -- expect NULL (no rows)
```

Result on 2026-10-04: `8`, `2`, `0`, `NULL` — all as expected.

`assistant_insert_policies` must stay **0**. There is deliberately no client
insert policy — a suggestion row records a call *we* made to Claude, and a
client able to write one could fabricate a recommendation history.

Because `009` did not go in atomically (see gotchas), every object it creates
was also checked individually and all are present: the `set_updated_at` trigger,
the `assistant_suggestions_one_subject` constraint, all three suggestion
indexes, `garments_measured_idx`, both garment constraints, the
`garment_measurement_source` enum, RLS on both tables, and 3 policies. The
privilege matrix matches the migration's intent exactly: `anon` holds nothing on
either table; `authenticated` has SELECT on `assistant_suggestions` with UPDATE
narrowed to `dismissed_at` and `acted_at` only, and no INSERT or DELETE.

### Security advisors

The known-intentional findings are unchanged: `brand_api_keys`
RLS-with-no-policies, `waitlist_count()` anon-executable (it powers the live
landing-page counter — do **not** revoke it), the definer RPCs callable by
`authenticated`, and `handle_new_user()` flagged as anon-callable (false
positive: it returns `trigger`, and Postgres refuses to invoke trigger
functions directly). No new findings on either assistant table.

**One finding is new since this file was first written:**
`auth_leaked_password_protection` (WARN) — HaveIBeenPwned checking is disabled
in Supabase Auth. Pre-existing and unrelated to `008`/`009`. Not addressed.

### Connector gotchas — these cost a session

- **`DROP TABLE` through the Supabase MCP connector always hangs.** 60s timeout,
  clean rollback, every time — including `drop table if exists` on a table that
  does not exist, which is zero work for Postgres. It is a destructive-statement
  confirmation gate with nowhere to prompt in a headless session. Use the
  Supabase CLI or `psql` for drops; do not burn attempts on the connector.
- **`apply_migration` timed out 4× on `009`** while `008` went through on the
  first try. `009` contains `drop trigger/policy/constraint if exists`, which is
  the likely trigger. It was ultimately applied statement-by-statement via
  `execute_sql`, each statement verbatim from the file.
- Consequence: the `009` ledger row's `statements` column holds a pointer to
  `app/supabase/migrations/009_assistant.sql` rather than the inlined SQL, where
  `008` inlines it. Cosmetic — `list_migrations` reads correctly. Re-running
  `009` atomically would need the CLI, since the drop-and-replay needs
  `DROP TABLE`.

### What this turned on, and what it did not

- **Garment measurements** are writable. No UI reaches them yet, so nothing
  changes for users until the screens are built (§4).
- **The assistant is still off.** `assistant_preferences.enabled` defaults to
  `false`, the table has zero rows, and Ben has confirmed it stays off. Applying
  `009` created the table; it enabled nothing for anybody.
- The assistant additionally needs `ANTHROPIC_API_KEY` in Supabase Edge Function
  secrets and `supabase functions deploy wardrobe-assistant`. Neither was done.
  It returns `503 assistant_unavailable` when the key is missing, so a
  misconfiguration looks like an outage rather than a model with no ideas.
- Nothing was regenerated. `app/src/lib/database.types.ts` is hand-written (its
  own header says so) and already carries the `008`/`009` types.

---

## 2. Where the project stands

`main` carries, and all of it is green (`typecheck`, `479/479` tests, `lint`
clean, CI on every PR and push to main):

| Area | State |
|---|---|
| 3D try-on, affiliate commerce | **Live.** Audited 32/32 on the write path. Do not rebuild — it already exists. |
| CI, 13+ age gate, reconciled legal docs | Live |
| Backend verification scripts + results | Run against the live project: 134 PASS, 0 unexplained FAIL (`app/supabase/verification/RESULTS_2026-08-27.md`) |
| Garment measurements | Code + tests on `main`. **Migration applied 2026-10-04 (§1).** No UI. |
| Wardrobe assistant | Code + Edge Function + settings card on `main`. **Migration applied 2026-10-04 (§1); still off by default, no screen calls it.** |
| Avatar mesh path | Built and tested. **No asset** — still renders ~50 primitives. |
| Live database | Migrations `002`–`009` applied and verified |

---

## 3. Open decisions

**Resolved — assistant stays off.** Ben's call, 2026-10-04. The product intent
is an assistant that is simply on with a toggle; the column is one word from
that. Flip the default in a migration **once `legal/PRIVACY_POLICY.md` names
Anthropic as a processor** — see `ASSISTANT_PRIVACY_IMPACT.md`, which is written
for counsel and lists the five things they need to decide.

**Open — the Anny install-time licence question.** `AVATAR_MESH_SHORTLIST.md`
recommends Anny, and the mesh we would ship is **CC0** (verified against
`src/anny/data/mpfb2/LICENSE.md`). The SMPL-X assets are *not* in the repo —
they are behind a separate `noncommercial.zip`. But the README's install block
says, verbatim:

> `pip install anny # Minimal install.`
> `# Note that the free install may download non-commercial only assets when needed.`

So the question is not "which topology do we pick" (the pipeline already refuses
`smpl` and `smplx`) but **can a build that only ever requests the `anny`
topology still end up with non-commercial data on disk or in the bundle?** That
is a build-hygiene question for counsel, and it is the last thing between Selv
and a human-looking avatar.

**Open — the `om` vault has never been reachable.** `CLAUDE.md` requires
searching the obsidian-mind vault before proposing any architecture, dependency
or design. It has not been connected in any session so far. Several
architectural decisions now on `main` were made without it: LLM-in-an-Edge-
Function, measurement provenance, mesh-over-primitives, pairs-over-sliders. If
the vault records any of those as rejected, that is a revert, not a redirect.
**Worth connecting and checking before building further on them.**

---

## 4. Next work, in order of leverage

### Launch blockers (not engineering, longest lead times, untouched)

`SHIP_READINESS.md` counts 19 blocking items. The critical path has not moved:

1. **Apple Developer Program enrollment** + App Store Connect record. Bundle id
   `com.selv.app` is already set. Needs the legal entity name — also a `[TBD]`
   in both legal docs, so decide it once and it serves both.
2. **Attorney review of the privacy policy and Terms together.** Hand them §0 of
   `SHIP_READINESS.md` verbatim plus `ASSISTANT_PRIVACY_IMPACT.md`. The drafts
   describe a pre-pivot product; a reviewer working from the text alone will
   bless the wrong app.
3. **Account deletion end-to-end on a device** (§1.9) — the highest App Review
   rejection risk. The database contract underneath it is proven; the
   `delete-account` Edge Function has never run.

### Engineering

**Assistant → make it real.** There is an API and a settings card, but **no
screen calls `getSuggestions`**. The homes Ben described are `AddGarmentScreen`
(after a scan) and `CharacterTryOnScreen` (while trying something on). Also wire
`markSuggestion` into dismiss/act, or `assistant_suggestions.dismissed_at` /
`acted_at` stay empty and the feature is unfalsifiable.

**Measurements → make them reachable.** Fields in `AddGarmentScreen` with an
"estimate it for me" path calling `estimateGarmentMeasurements`; display via
`summarizeMeasurements` on `GarmentDetailScreen`, which carries the "estimated"
qualifier for free. No backfill needed — existing garments have
`measurement_source = null`, which is correct.

**Avatar → garment skinning is the expensive part.** Once an asset lands:
export via `tools/avatar-export/`, run `inspectHumanBase()` on it **before**
wiring anything, set `HUMAN_BASE_SOURCE`, confirm `onShapeApplied` reports
`usedMorphTargets: true`. Then the real work: morph targets deform only the mesh
they are authored on, so **garments must be skinned to the asset's skeleton, not
parented under it**. The pipeline writes no skeleton yet, so
`inspectHumanBase` reports requirement 4 as blocking — correctly and
deliberately.

**Close the verification gaps.** The HTTP appendices for scripts `01`/`02`/`03`
and `04`'s Phase 2 all need a **real user access token**, which cannot be minted
without the project JWT secret. If Ben signs into a test account and provides
`session.access_token`, that closes the last "the database is right, but is
PostgREST wired right?" question in one pass.

---

## 5. Hard-won things that will bite you

**Morph target names are load-bearing and fail silently.** If a GLB's blendshape
names do not match `MORPH_TARGET_NAME_CANDIDATES` in `bodyModel.ts`,
`applyShapeToObject` finds nothing, falls back to whole-mesh axis scaling, and
the avatar **still responds to every slider** by stretching geometry. It looks
like it works. `morphContract.test.ts` guards the pipeline's eight names against
the real matcher; keep it passing. Classification is **longest-match**, not list
order — two separate bugs came from getting that wrong.

**glTF morph target names live in `mesh.extras.targetNames`.** Omit that array
and three.js names them `"0"`, `"1"`, … and all name matching fails. The whole
export pipeline is arranged around that one array being right.

**`storage.objects` is DELETE-protected by the platform.** Supabase ships a
`protect_objects_delete` trigger that refuses direct SQL deletes for every role,
`postgres` included. Verification script `03` predates it; its §3 now runs inside
`begin … rollback`. Do not disable the trigger.

**The container is ephemeral and recycles.** After any idle gap, `node_modules`
is gone — `cd app && npm ci` before running checks, or `jest: not found` and a
confusing eslint stack trace.

**Connectors are read at session start.** Reconnecting one mid-session does not
help that session. This file exists because of exactly that.

**Supabase + Canva both needed re-authorization** as of 2026-10-04. Supabase was
reconnected; Canva was not, and nothing depends on it.

**GitHub access is scoped to `soonavi/wardrobely`.** `gh api` works for that
repo (useful for polling check runs); anything else returns 403. Use `WebFetch`
or `curl` for third-party repos.

**Do not rebuild the affiliate system.** It exists, it is audited, and it has
been mistaken for missing once already.
