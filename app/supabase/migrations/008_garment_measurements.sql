-- ===========================================================================
-- 008_garment_measurements.sql — per-garment measurements, with provenance
-- ===========================================================================
-- Lets a user state the real measurements of a garment they own, so fit is a
-- number rather than a guess. Users who don't want to reach for a tape get an
-- estimate instead — and the point of this migration is that the database
-- never lets those two be confused.
--
-- WHY PROVENANCE IS A COLUMN AND NOT A COMMENT
-- The same reasoning as `profiles.age_verified_on` in 006: a value we derived
-- and a value the user asserted carry different weight, and a schema that
-- stores only the number cannot tell them apart afterwards. Here the stakes
-- are "we told someone a dress would fit". An estimate presented as a
-- measurement is the failure mode this column exists to make impossible —
-- the UI reads `measurement_source` to decide whether to say "32in waist" or
-- "about 32in, estimated", and it cannot forget to, because the number is
-- never available without it (see the constraint below).
--
-- WHY NOT JSONB
-- Categories need different axes (a shoe has neither a waist nor an inseam),
-- which argues for a bag of keys. But the axes overlap far more than they
-- differ, every one of them is a length in centimetres, and a jsonb blob
-- cannot carry a range check — so a fat-fingered 3200cm waist would sit in
-- the column until it produced a nonsense recommendation months later.
-- Explicit nullable columns keep the constraints, keep the values queryable
-- for the recommendation engine, and cost only NULLs for the axes that do not
-- apply to a category.

do $$ begin
  create type garment_measurement_source as enum ('user', 'estimated', 'brand');
exception when duplicate_object then null;
end $$;

alter table public.garments
  add column if not exists measurement_source garment_measurement_source,
  add column if not exists chest_cm    smallint,
  add column if not exists waist_cm    smallint,
  add column if not exists hip_cm      smallint,
  add column if not exists length_cm   smallint,
  add column if not exists shoulder_cm smallint,
  add column if not exists sleeve_cm   smallint,
  add column if not exists inseam_cm   smallint;

comment on column public.garments.measurement_source is
  'Where the measurements came from: user (they measured it), estimated (we '
  'derived it from category + size + the wearer''s body metrics), or brand '
  '(imported from a partner product feed). NULL means no measurements at all. '
  'Never render a measurement without reading this — see 008_garment_measurements.sql.';

-- --- Ranges -----------------------------------------------------------------
-- Generous deliberately: this is a typo catcher, not a fit opinion. 1cm and
-- 400cm are both real garment dimensions somewhere (a cuff, a wedding train),
-- so the bounds only have to exclude values that cannot be a garment at all.
-- Dropped-then-added so a re-run replaces the definition, matching 002/004/006.
alter table public.garments
  drop constraint if exists garments_measurements_plausible;
alter table public.garments
  add constraint garments_measurements_plausible check (
    (chest_cm    is null or chest_cm    between 1 and 400)
    and (waist_cm    is null or waist_cm    between 1 and 400)
    and (hip_cm      is null or hip_cm      between 1 and 400)
    and (length_cm   is null or length_cm   between 1 and 400)
    and (shoulder_cm is null or shoulder_cm between 1 and 400)
    and (sleeve_cm   is null or sleeve_cm   between 1 and 400)
    and (inseam_cm   is null or inseam_cm   between 1 and 400)
  );

-- --- The invariant ----------------------------------------------------------
-- READ AS A SENTENCE: "either this garment has no measurements and no source,
-- or it has a source and at least one measurement."
--
-- Both half-states are forbidden, and each for its own reason. A measurement
-- with no source is a number the UI cannot honestly label — it would have to
-- either drop the qualifier (presenting a guess as fact) or add one it cannot
-- justify. A source with no measurements is a claim about data that isn't
-- there, which would make `where measurement_source = 'user'` return garments
-- carrying nothing, quietly corrupting any confidence weighting built on top.
alter table public.garments
  drop constraint if exists garments_measurement_source_consistent;
alter table public.garments
  add constraint garments_measurement_source_consistent check (
    (
      measurement_source is null
      and chest_cm is null and waist_cm is null and hip_cm is null
      and length_cm is null and shoulder_cm is null and sleeve_cm is null
      and inseam_cm is null
    )
    or (
      measurement_source is not null
      and (
        chest_cm is not null or waist_cm is not null or hip_cm is not null
        or length_cm is not null or shoulder_cm is not null
        or sleeve_cm is not null or inseam_cm is not null
      )
    )
  );

-- Serves the recommendation engine's "what do I actually know the size of?"
-- query, and the operational question "how many garments still have no
-- measurements". Partial, so it indexes only rows that have them and stays
-- small while most of a wardrobe is unmeasured.
create index if not exists garments_measured_idx
  on public.garments(user_id, category)
  where measurement_source is not null;

-- --- Grants -----------------------------------------------------------------
-- 006 revoked blanket INSERT/UPDATE on profiles and re-granted per column; the
-- same discipline is not needed here, because `garments` has no column a
-- client must be prevented from writing — every measurement on this table is
-- the user's own statement about their own garment, including the choice to
-- record an estimate. The existing "own garments" policy already scopes the
-- row. Stated explicitly so the asymmetry with 006 reads as a decision.
