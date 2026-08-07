-- ===========================================================================
-- 004_waitlist.sql — Selv+ interest capture ("join the list"), not a paywall
-- ===========================================================================
-- Applies on top of 003_affiliate_click_rpc.sql and can be re-run safely:
-- every statement is guarded (`if not exists`, `drop … if exists` before
-- create, or a do-block that swallows the "already there" error), matching
-- 002/003 so a partial failure can be fixed and the whole file re-applied.
--
-- WHY THIS TABLE EXISTS
-- The Free tier caps a wardrobe at 25 items (src/lib/pricing.ts). Until now
-- the cap dialog offered an "Upgrade" button wired to nothing: there is no
-- RevenueCat dependency in the app and no in-app purchase is shipping in v1.
-- A user who hit the cap was simply stuck.
--
-- v1 keeps the cap and replaces that dead button with an honest email capture:
-- Selv+ is announced as *coming*, never as purchasable, and the user can ask
-- to be told when it opens. That validates willingness to pay before we build
-- StoreKit, and it keeps App Store Guideline 3.1.2 (auto-renewable
-- subscriptions) off the v1 review surface entirely, because nothing in the
-- app sells anything.
--
-- One row per user. `source` records which wall they hit, which is the whole
-- analytic point — "how many people want this" is much less useful than
-- "people want this specifically at the moment they run out of room".
--
-- NOT MIRRORED INTO schema.sql YET. 002 and 003 both carry a "keep the two in
-- sync" note and schema.sql is the readable source of truth for a brand-new
-- project. This table has no counterpart section there; add one (table, enum,
-- grants and the three policies below) next time schema.sql is touched.
-- ===========================================================================

-- --- Enum -----------------------------------------------------------------
-- Which wall the user was standing at when they asked to be told. Same
-- do-block shape as 002's enums because `create type` has no `if not exists`.
-- As in 002, this only makes *creation* idempotent — adding a third entry
-- point later (the Shop's "save to wardrobe" path in
-- src/lib/api/shop.ts::saveProductToWardrobe hits the same cap and has no
-- waitlist affordance yet) needs its own
-- `alter type public.waitlist_source add value if not exists 'shop_save'`
-- migration, which notably cannot run inside a transaction block on PG < 12
-- semantics some poolers still emulate. Only the two values the UI can
-- actually produce are listed; a value no screen can emit is a lie in a
-- funnel report.
do $$ begin
  create type waitlist_source as enum ('wardrobe_grid','add_garment');
exception when duplicate_object then null;
end $$;

-- --- waitlist_signups -----------------------------------------------------
-- `user_id` is the PRIMARY KEY, not a plain FK with a separate id column.
-- That is the "they can't spam-join" requirement expressed as a constraint
-- rather than as application logic: a second insert is a 23505 that the
-- client (src/lib/api/waitlist.ts::joinWaitlist) turns into a reassuring
-- "you're already on the list" instead of an error. There is no interesting
-- second row to keep — a user who taps twice has not expressed twice the
-- demand — so nothing is lost by making the duplicate impossible.
--
-- `on delete cascade` from auth.users is deliberate and load-bearing for
-- privacy: this is a marketing-consent record keyed to a person, and the
-- delete-account edge function must not leave it behind. It is also why no
-- client DELETE policy is needed for account deletion (see the RLS block).
create table if not exists public.waitlist_signups (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- WHY THIS DEFAULTS TO THE CALLER'S OWN JWT EMAIL, BUT IS STILL ACCEPTED
  -- FROM THE CLIENT.
  --
  -- The default means any insert that omits the column records the address
  -- Supabase Auth already verified, taken from the request's own JWT — the
  -- client cannot influence it, and there is no round trip that could be
  -- tampered with. `auth.jwt() ->> 'email'` rather than the deprecated
  -- `auth.email()`, and a function call rather than the more obvious
  -- `(select email from auth.users …)`, because Postgres forbids subqueries
  -- in a DEFAULT expression.
  --
  -- But the column is NOT server-derived-only, and the client is allowed to
  -- state a different address. That is a real tradeoff, made knowingly:
  --
  --   For trusting the client: Sign in with Apple gives us a
  --   @privaterelay.appleid.com address for a large share of iOS users. It is
  --   a genuine mailbox, but it is not one people watch, and a launch
  --   announcement sent only there is a launch announcement nobody reads.
  --   "Tell me at this other address" is the normal case, not the attack.
  --
  --   Against: a user can therefore put a stranger's address in their own
  --   row, and we would email that stranger about Selv+. RLS cannot prevent
  --   this — a `with check` can only constrain `user_id`, which is exactly
  --   the lesson 003 wrote down about affiliate_clicks.
  --
  -- The difference from affiliate_clicks is that nothing here is money.
  -- A forged commission_rate_bps invoices a partner for their own order
  -- value; a forged email costs one message to someone who did not ask, is
  -- bounded to one row per user by the primary key, and is the same exposure
  -- any "email this to a friend" feature carries. So this table does NOT get
  -- the security-definer RPC treatment — that ceremony is reserved for rows
  -- whose contents we bill against. What we owe instead is a confirmation
  -- step before the list is ever mailed: treat every row here as
  -- single-opt-in and confirm before sending, which is required for the
  -- private-relay case anyway.
  --
  -- NOT NULL with no fallback is intentional: a signup we cannot reach is
  -- worse than a failed signup, so an insert with neither a supplied email
  -- nor an email claim in the JWT (a phone-only user, or a service-role
  -- backfill that forgot the column) fails loudly at the database.
  email text not null default (auth.jwt() ->> 'email'),

  source waitlist_source not null,
  created_at timestamptz not null default now()
);

-- Column-level guards for a table that predates this migration, matching
-- 002's pattern. Harmless no-ops on a table just created above. `source` is
-- added with a default only so the guard can succeed against a pre-existing
-- populated table; the create-table above deliberately has no default,
-- because a caller that forgets to say where the user hit the wall should be
-- rejected rather than silently attributed to the wardrobe grid.
--
-- `email` cannot use that same trick. Adding a NOT NULL column evaluates its
-- default once and backfills every existing row with the result, and
-- `auth.jwt()` is NULL over the direct connection a migration runs on — psql,
-- the SQL editor, `supabase db push` — because there is no PostgREST request
-- to read claims from. So against the pre-existing *populated* table these
-- guards exist for, the one-statement form would backfill NULL into every row
-- and then abort on its own NOT NULL. It is split instead: add nullable,
-- backfill from the address Supabase Auth already verified, then attach the
-- default and the constraint. Nothing about the column as the create-table
-- above declares it changes — only the one-time repair of a legacy table.
alter table public.waitlist_signups
  add column if not exists email text;
-- Matches nothing on the table created above (the column arrived populated)
-- and nothing on a re-run (NOT NULL is attached three lines down). This has
-- work to do exactly once: the run where a legacy table gains the column.
update public.waitlist_signups w
   set email = u.email
  from auth.users u
 where u.id = w.user_id
   and w.email is null;
alter table public.waitlist_signups
  alter column email set default (auth.jwt() ->> 'email');
-- Still loud, as the column comment intends: a legacy row belonging to a
-- phone-only user has no address in auth.users either, and stopping here with
-- "contains null values" beats recording a signup we could never reach.
alter table public.waitlist_signups
  alter column email set not null;
alter table public.waitlist_signups
  add column if not exists source waitlist_source not null default 'wardrobe_grid';
alter table public.waitlist_signups
  add column if not exists created_at timestamptz not null default now();

-- Shape-only validation. This is not an attempt to decide whether an address
-- is deliverable — nothing but sending to it can — it exists so a fat-finger
-- ("ben@", a pasted display name, an empty string that NOT NULL happily
-- accepts) fails at write time while the user is still looking at the input
-- and can fix it, instead of surfacing months later as an unexplained gap in
-- the launch send. 254 is the RFC 5321 maximum length for a forward path.
-- Dropped-then-added so a re-run replaces the definition rather than failing
-- on the existing name (same as `garments_image_present` in 002).
alter table public.waitlist_signups
  drop constraint if exists waitlist_signups_email_shape;
alter table public.waitlist_signups
  add constraint waitlist_signups_email_shape check (
    length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

-- The only query we actually run against this table: "who joined, most
-- recent first". Deliberately just the one index — the per-source breakdown
-- is a `group by` over a table that will hold thousands of rows at most, and
-- a second index to serve it would cost more to maintain than the seq scan
-- it saves.
create index if not exists waitlist_signups_created_idx
  on public.waitlist_signups(created_at desc);

-- --- RLS ------------------------------------------------------------------
-- `enable row level security` is idempotent. Policies are not, so each is
-- dropped by name first — that also makes this file the way to *edit* a
-- waitlist policy: change it here and re-apply.
alter table public.waitlist_signups enable row level security;

-- INSERT: own row only.
--
-- Unlike affiliate_clicks (see 003, and the long comment in schema.sql), a
-- plain `with check (user_id = auth.uid())` IS sufficient here, and it is
-- worth saying why so the next reader does not either cargo-cult the RPC
-- pattern onto every table or assume this one was overlooked.
--
-- The check constrains one column, exactly as it did there. The difference is
-- what the other columns are worth. `email` is discussed at length on the
-- column itself: forgeable, not money, mitigated by confirming before we
-- send. `source` is self-reported attribution analytics bounded by an enum to
-- two values — precisely the reasoning that lets `create_affiliate_click`
-- accept `p_source` from the client — and the worst a liar achieves is
-- skewing their own single row in our funnel report. `created_at` is
-- defaulted and is not in the app's insert payload; a client that overrode it
-- would be lying about the timing of one signup, which is noise, not fraud.
-- And `user_id`, the only column that decides ownership, is exactly what this
-- check pins.
--
-- Nothing on this row is ever read back as a commercial term the way a click's
-- snapshotted rate is. If that changes — if a waitlist row ever grants
-- something, a founder price, a free month, early access with a value
-- attached — this policy is no longer sufficient and creation belongs in a
-- security-definer RPC like create_affiliate_click. Until then it is ceremony
-- with a maintenance cost and no security benefit.
drop policy if exists "own waitlist signup insert" on public.waitlist_signups;
create policy "own waitlist signup insert" on public.waitlist_signups
  for insert with check (user_id = auth.uid());

-- SELECT: own row only, and nobody else's under any condition.
--
-- The app needs this to open the sheet in the right state — a user who
-- already joined must be told "you're on the list", not shown the form again
-- and then handed a duplicate-key error for tapping the obvious button.
--
-- The read is scoped to the caller's own uid, so this table cannot be used to
-- enumerate who else signed up, and — more to the point — cannot be used to
-- read other users' email addresses, which is the only thing in here worth
-- stealing. There is no aggregate/count policy either: "how many people are
-- on the list" is a number for us, from the service role, not something the
-- client is entitled to ask PostgREST for.
drop policy if exists "own waitlist signup select" on public.waitlist_signups;
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
-- the fake Upgrade button this whole change exists to remove.
--
-- The case AGAINST is that `source` and `created_at` are the entire analytic
-- value of the table: *where* demand appeared and *when*. A blanket update
-- policy would let a client rewrite both, which does not enrich an attacker
-- but does quietly corrupt the only signal we are collecting.
--
-- Both are satisfied by splitting the question in two. RLS answers "which
-- row" (`using` + `with check`, so a user can neither reach another row nor
-- hand their own away by rewriting user_id). A column-level GRANT answers
-- "which columns" — see the grants below, where UPDATE is revoked wholesale
-- and re-granted on `email` alone. RLS has no column vocabulary; SQL
-- privileges do. Using the right one of the two is what keeps this narrow.
--
-- `created_at` is therefore the join date and never the edit date. That is
-- the intended reading: the consent and its timing are immutable, only the
-- address we honour it at can move. If an audit trail of address changes is
-- ever needed, it is a separate append-only table, not an updated_at here.
drop policy if exists "own waitlist signup email update" on public.waitlist_signups;
create policy "own waitlist signup email update" on public.waitlist_signups
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- DELETE: no policy, deliberately.
--
-- Two paths already cover the legitimate reasons a row should disappear:
-- account deletion (the `on delete cascade` from auth.users above, which the
-- delete-account edge function triggers) and unsubscribing (a link in
-- whatever we eventually send, handled service-side, which is where an
-- unsubscribe belongs because it must work from an email client with no
-- session).
--
-- What remains is a "leave the list" button in the app, and there isn't one.
-- A policy with no caller is surface that outlives the reason it was added.
-- When that button ships, the policy it needs is exactly:
--   create policy "own waitlist signup delete" on public.waitlist_signups
--     for delete using (user_id = auth.uid());
-- and it should ship in the same change, not before it.

-- --- Grants ---------------------------------------------------------------
-- Supabase's default privileges hand `anon` and `authenticated` full DML on
-- new tables in `public`, leaving RLS as the only thing standing between them
-- and the data. That is fine for row scoping and useless for column scoping,
-- so the column-level restriction the UPDATE policy above relies on has to be
-- stated here. Re-running is safe: revoke/grant are absolute, not additive.
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
-- behind the auth gate), so the privilege is removed outright rather than
-- left to be caught one layer down. Same defence-in-depth reasoning as the
-- `revoke execute … from anon` in 003.
revoke all on public.waitlist_signups from anon;
