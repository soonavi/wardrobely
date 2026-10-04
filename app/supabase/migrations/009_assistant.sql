-- ===========================================================================
-- 009_assistant.sql — the Selv wardrobe assistant: consent, and its record
-- ===========================================================================
-- The assistant looks at what a user is holding — a garment they just scanned,
-- a product they are trying on — and suggests things from their own wardrobe
-- that would go with it. The suggestions come from Claude, called server-side
-- by the `wardrobe-assistant` Edge Function.
--
-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ THIS FEATURE SENDS USER DATA TO A THIRD PARTY. THAT IS NEW.          │
-- │                                                                       │
-- │ Until now every processor in this app was Supabase and nothing else — │
-- │ that is the whole reason PRIVACY_POLICY.md could be reconciled down   │
-- │ to one vendor in cf7e317. Anthropic is a second one, and the wardrobe │
-- │ inventory that reaches it is personal data: what clothes someone      │
-- │ owns, in what colours, from what brands, in what sizes.               │
-- │                                                                       │
-- │ Hence `enabled boolean not null default false`. Off until asked for.  │
-- │ See the note on that column for why the default is not `true`.        │
-- └──────────────────────────────────────────────────────────────────────┘

-- --- assistant_preferences --------------------------------------------------
-- One row per user, `user_id` as the primary key — same shape and the same
-- reasoning as `waitlist_signups` in 004: a user has exactly one setting, so a
-- second row is not a thing to reconcile, it is a thing to make impossible.
create table if not exists public.assistant_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- WHY THIS DEFAULTS TO FALSE.
  --
  -- The product intent is an assistant that is simply on, and a toggle for
  -- people who don't want it. That is the right *product*, and this column is
  -- one word away from it. It ships off for a reason that is about timing, not
  -- about the idea:
  --
  --   1. Turning it on sends a user's wardrobe to a processor the published
  --      privacy policy does not currently name. The policy is with counsel
  --      right now (SHIP_READINESS.md §1.2). Shipping default-on would mean
  --      the first users are sharing data under a document that does not
  --      describe the sharing.
  --   2. The App Privacy questionnaire (§1.13) has not been filled in yet.
  --      "Data shared with third parties" is one of its questions, and a
  --      default-on answer changes it.
  --
  -- Both clear at the same moment: when counsel returns the policy with
  -- Anthropic named as a processor, flip this default and the first-run
  -- prompt becomes redundant. It is deliberately a default and not a hard
  -- rule, so that flip is a migration and not a rewrite.
  enabled boolean not null default false,

  -- Whether the user has been *asked*. Distinct from `enabled`, because
  -- "declined" and "never saw the prompt" are different states and only one of
  -- them should stop us asking again. Without this, a user who says no would
  -- be re-prompted on every launch, which is how a consent dialog becomes a
  -- dark pattern.
  prompted_at timestamptz,

  -- How chatty. Not a privacy control — every level sends the same data — so
  -- it is a plain preference with no consent weight attached.
  suggestion_frequency text not null default 'balanced'
    check (suggestion_frequency in ('minimal', 'balanced', 'frequent')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.assistant_preferences.enabled is
  'Whether the wardrobe assistant may send this user''s wardrobe to Claude. '
  'Defaults FALSE: the published privacy policy does not yet name Anthropic '
  'as a processor. See 009_assistant.sql.';

drop trigger if exists assistant_preferences_set_updated_at
  on public.assistant_preferences;
create trigger assistant_preferences_set_updated_at
  before update on public.assistant_preferences
  for each row execute function public.set_updated_at();

-- --- assistant_suggestions --------------------------------------------------
-- What we suggested, and what came of it.
--
-- WHY PERSIST AT ALL rather than render and forget. Two reasons, and neither
-- is analytics-for-its-own-sake:
--   * Cost. A suggestion for "this dress, from this wardrobe" is stable until
--     the wardrobe changes. Re-asking Claude on every screen open would spend
--     real money to regenerate an identical answer.
--   * Honesty about quality. `dismissed_at` and `acted_at` are the only way to
--     find out whether the recommendations are any good. Without them the
--     feature is unfalsifiable.
create table if not exists public.assistant_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- What the user was looking at. Exactly one of these is set — enforced
  -- below. Both nullable and both `on delete cascade`, so deleting the garment
  -- a suggestion was about takes the suggestion with it rather than leaving a
  -- recommendation pointing at nothing.
  subject_garment_id uuid references public.garments(id) on delete cascade,
  subject_product_id uuid references public.brand_products(id) on delete cascade,

  -- The suggested items, as an ordered array of garment ids, plus the model's
  -- reason for each. jsonb rather than a child table: this is an opaque
  -- payload rendered as a unit and never queried by its interior.
  suggestions jsonb not null default '[]',

  -- Which model produced it. When a future model changes the character of the
  -- suggestions, this is what separates the old ones from the new in any
  -- quality comparison.
  model text not null,

  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  acted_at timestamptz
);

-- Exactly one subject. A suggestion about both a garment and a product is
-- incoherent — there is one thing on screen — and a suggestion about neither
-- has no anchor to be rendered against.
alter table public.assistant_suggestions
  drop constraint if exists assistant_suggestions_one_subject;
alter table public.assistant_suggestions
  add constraint assistant_suggestions_one_subject check (
    (subject_garment_id is not null and subject_product_id is null)
    or (subject_garment_id is null and subject_product_id is not null)
  );

create index if not exists assistant_suggestions_user_idx
  on public.assistant_suggestions(user_id, created_at desc);
create index if not exists assistant_suggestions_subject_garment_idx
  on public.assistant_suggestions(subject_garment_id)
  where subject_garment_id is not null;
create index if not exists assistant_suggestions_subject_product_idx
  on public.assistant_suggestions(subject_product_id)
  where subject_product_id is not null;

-- --- RLS --------------------------------------------------------------------
alter table public.assistant_preferences enable row level security;
alter table public.assistant_suggestions enable row level security;

drop policy if exists "own assistant preferences" on public.assistant_preferences;
create policy "own assistant preferences" on public.assistant_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- SELECT and UPDATE only. There is deliberately no client INSERT policy:
-- a suggestion row is a record of a call *we* made to Claude, and a client
-- able to write one could fabricate a recommendation history — which is the
-- same argument 003 makes about affiliate_clicks, for a smaller stake. The
-- Edge Function writes them with the service role, which bypasses RLS.
--
-- UPDATE is granted so the user can dismiss or act on a suggestion. It is
-- narrowed to those two columns by the grant below, not by the policy: RLS
-- decides which row, privileges decide which column — the split 004 and 006
-- both use.
drop policy if exists "own assistant suggestions select" on public.assistant_suggestions;
create policy "own assistant suggestions select" on public.assistant_suggestions
  for select using (user_id = auth.uid());

drop policy if exists "own assistant suggestions update" on public.assistant_suggestions;
create policy "own assistant suggestions update" on public.assistant_suggestions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --- Grants -----------------------------------------------------------------
-- Supabase hands anon and authenticated full DML on new public tables, so the
-- column narrowing has to be stated. Without these two lines the UPDATE policy
-- above still passes and a client could rewrite `suggestions` or `model`,
-- making the quality record it exists to provide worthless.
revoke insert, update, delete on public.assistant_suggestions from anon, authenticated;
grant select on public.assistant_suggestions to authenticated;
grant update (dismissed_at, acted_at) on public.assistant_suggestions to authenticated;

revoke all on public.assistant_preferences from anon;
revoke all on public.assistant_suggestions from anon;
