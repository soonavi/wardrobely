-- ===========================================================================
-- 003_affiliate_click_rpc.sql — move affiliate click creation server-side
-- ===========================================================================
-- Applies on top of 002_commerce.sql. Closes a commission-integrity hole in
-- the click path and can be re-run safely: `create extension if not exists`,
-- `create or replace function`, `drop policy if exists`.
--
-- THE HOLE
-- `public.affiliate_clicks` was written directly by the client under an RLS
-- policy of `for insert with check (user_id = auth.uid())`. That check
-- constrains exactly one column. Every column that carries commercial meaning
-- — commission_rate_bps, price_cents_at_click, brand_id, click_token — was
-- taken verbatim from the request body, and the anon key that authorises the
-- request ships inside the app binary and is not a secret.
--
-- So any authenticated user could write a click with
-- commission_rate_bps = 10000 against any product and then complete a genuine
-- purchase. The postback edge function inherits the click's snapshotted rate
-- by design (correctly — the click is the contract that priced the order), so
-- we would then have invoiced the brand partner for 100% of their own order
-- value. The attacker gains nothing personally, which is exactly why this
-- would surface as a partner asking us why their invoice was wrong rather than
-- as anything our own metrics would flag. A forged price_cents_at_click
-- corrupts every funnel and margin figure the same way, and a client-chosen
-- brand_id can be set inconsistently with product_id, which makes the ledger
-- unreconcilable rather than merely wrong.
--
-- THE FIX
-- Resolve the commercial terms server-side from `brands` / `brand_products`
-- inside a security definer function, and remove the client's ability to state
-- them at all by dropping the insert policy. `affiliate_clicks` becomes
-- select-own-only for clients; every client write goes through
-- public.create_affiliate_click().
--
-- Mirrored in the "COMMERCE / AFFILIATE" section of supabase/schema.sql, which
-- is the readable source of truth. Keep the two in sync.
--
-- !! ORDERING HAZARD !! 002_commerce.sql still contains
--    `create policy "own affiliate clicks insert" ...`
-- because it is a snapshot of the pre-fix schema. Re-applying 002 after this
-- file re-opens the hole. Migrations are meant to be applied in order and only
-- once, so this is correct-by-convention, but if you ever re-run 002 by hand
-- against a live project, re-run this file straight afterwards.
-- ===========================================================================

-- --- pgcrypto -------------------------------------------------------------
-- Supplies gen_random_bytes(), used below to mint click_token where the caller
-- can neither see nor choose it. Supabase installs extensions into the
-- `extensions` schema by convention, and the function pins an empty
-- search_path, so the call site is written `extensions.gen_random_bytes(...)`.
--
-- If pgcrypto is already installed in some other schema this statement is a
-- silent no-op and the function will fail to resolve the call — in that case
-- run `alter extension pgcrypto set schema extensions` rather than
-- un-qualifying the call site, which would defeat the pinned search_path.
-- (Nothing in 002 needed an extension: gen_random_uuid() is a core builtin
-- from PG13 on.)
create extension if not exists pgcrypto with schema extensions;

-- --- create_affiliate_click ----------------------------------------------
-- The only path by which a client creates an affiliate click.
--
-- The caller supplies which product and which surface of the app the Buy tap
-- happened on, and nothing else. `p_source` is safe to accept from a client
-- because it is self-reported analytics rather than money — the worst a liar
-- achieves is skewing their own attribution report — and the `click_source`
-- enum bounds it to five known values. Everything with a price attached is
-- derived here from the catalog.
--
-- SECURITY DEFINER is what lets the function insert into a table the caller
-- has no INSERT policy on. The corollary is that RLS does not filter the
-- lookup below: the "public active brand products" policy which normally
-- hides a paused partner's catalog is not applied inside a definer function.
-- Hence the explicit is_active / status checks — without them this would mint
-- a billable click against a brand whose contract has lapsed.
--
-- `create or replace` keeps this re-runnable. Note that replacing a function
-- cannot change its argument types or name; a future change to the signature
-- needs its own drop-and-create migration.
create or replace function public.create_affiliate_click(
  p_product_id uuid,
  p_source public.click_source
) returns public.affiliate_clicks
language plpgsql
security definer
-- Pinned empty search_path, matching public.selv_product_search_text in 002.
-- A definer function that resolves unqualified names through the *caller's*
-- search_path can be induced to read someone else's `brands` table and take
-- its commission rate from there; pinning the path to nothing and
-- schema-qualifying every name (pg_catalog builtins included) removes the
-- question. Supabase's linter also flags definer functions without one.
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
  -- Selv has no anonymous browsing: the Shop tab sits behind the auth gate,
  -- so a null uid is a bug or a probe, never a legitimate guest. Refusing
  -- also keeps affiliate_clicks.user_id meaningful — it is nullable only so
  -- account deletion can de-identify a row after the fact, not so a click can
  -- be born ownerless.
  if v_user_id is null then
    raise exception 'create_affiliate_click: authentication required'
      using errcode = '42501'; -- insufficient_privilege -> 401/403
  end if;

  -- Deliberately unfiltered: "no such product", "product withdrawn" and
  -- "partner paused" should be three distinguishable errors, and folding the
  -- conditions into the WHERE clause collapses all three into an
  -- indistinguishable "not found". brand_products.brand_id is NOT NULL and
  -- FK'd, so the join always matches when the product row exists.
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

  -- A paused or not-yet-launched partner must not be clickable: a conversion
  -- against one is revenue we have no live contract to bill for.
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
  -- two would bill a partner for stock they told us was commission free.
  --
  -- The TS version additionally treats an out-of-range rate as absent; that
  -- branch is unreachable here because both columns carry a
  -- `check (commission_rate_bps between 0 and 10000)`. Not a drift: TS is
  -- validating untrusted feed data on the way in, this reads rows the
  -- constraint has already vetted.
  if v_product_rate_bps is not null then
    v_rate_bps := v_product_rate_bps;
  elsif v_brand_rate_bps is not null then
    v_rate_bps := v_brand_rate_bps;
  else
    v_rate_bps := 1000;
  end if;

  -- Price precedence, mirroring effectivePriceCents(): a sale price counts
  -- only when present AND strictly below list. Partner feeds routinely leave
  -- a stale sale_price_cents at or above list once a promotion ends, and
  -- honouring it would snapshot a price the shopper was never shown.
  if v_sale_cents is not null and v_sale_cents < v_list_cents then
    v_price_cents := v_sale_cents;
  else
    v_price_cents := v_list_cents;
  end if;

  -- The token is minted here rather than by the client for the same reason as
  -- the rate. A client-chosen subid is guessable and collidable and — worse —
  -- lets a user pre-register a token for a click they never made, so a
  -- postback arriving on it would credit a stranger's real order to them.
  -- 16 random bytes is 128 bits, so collision is not a case worth retrying
  -- for, and the unique constraint on click_token turns the impossible case
  -- into a failed insert rather than misattributed revenue. The `selv_`
  -- prefix is carried over from the old client-side generator so a token is
  -- still recognisable as ours in a partner's raw click report, and the hex
  -- body keeps it URL-safe inside any network's wrapper.
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

-- Execute for signed-in users only. `create function` grants EXECUTE to
-- PUBLIC by default, so the revoke is not decoration — without it the anon
-- role inherits the right to call a definer function that writes a
-- revenue-bearing table. Re-running `create or replace` does not reset these
-- grants, but they are re-applied here anyway so a fresh apply and a re-apply
-- end in the same state. The anon revoke is redundant after the PUBLIC one and
-- is spelled out so the intent survives someone re-granting PUBLIC.
-- service_role is absent because it bypasses RLS and writes the table
-- directly; it has no use for this wrapper.
revoke execute on function public.create_affiliate_click(uuid, public.click_source)
  from public;
revoke execute on function public.create_affiliate_click(uuid, public.click_source)
  from anon;
grant execute on function public.create_affiliate_click(uuid, public.click_source)
  to authenticated;

-- --- RLS: revoke the direct client insert path ----------------------------
-- THIS DROP IS THE POINT OF THE MIGRATION. Applying the function above while
-- leaving the policy in place changes nothing: the old insert path would still
-- be open and a client would simply keep using it.
--
-- After this, public.affiliate_clicks is SELECT-OWN-ONLY for clients. There is
-- deliberately no insert, update or delete policy. DO NOT ADD ONE BACK.
-- `for insert with check (user_id = auth.uid())` looks like it secures the row
-- but constrains a single column, and RLS has no way to express "this rate
-- must equal what brand_products says" — that is the whole reason the check
-- was insufficient and the RPC exists.
--
-- If a client insert is failing with "new row violates row-level security
-- policy", the call site is wrong, not this file: point it at
-- create_affiliate_click() (see src/lib/api/affiliate.ts::createCheckoutLink).
-- Restoring the policy re-opens a hole that lets users forge our own
-- commission ledger, and it is undetectable after the fact because a forged
-- click row is byte-identical to a real one.
drop policy if exists "own affiliate clicks insert" on public.affiliate_clicks;

-- Read-your-own stays: the app shows a user their own click history. Recreated
-- rather than left alone so this file, like 002, is the one place a commerce
-- policy is edited.
drop policy if exists "own affiliate clicks select" on public.affiliate_clicks;
create policy "own affiliate clicks select" on public.affiliate_clicks
  for select using (user_id = auth.uid());
