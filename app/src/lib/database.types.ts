/**
 * Hand-written types mirroring supabase/schema.sql.
 * If you regenerate types with the Supabase CLI
 * (`supabase gen types typescript`), you can replace this file with the
 * generated output — the shape is designed to match it closely.
 */

/** Legacy enum — column still exists in the DB but the app no longer uses it. */
export type BodyType =
  | "rectangle"
  | "hourglass"
  | "pear"
  | "apple"
  | "inverted_triangle"
  | "athletic";

/** General build selected during onboarding (profiles.build). */
export type Build = "slim" | "average" | "athletic" | "curvy" | "broad";

export type GarmentCategory =
  | "top"
  | "bottom"
  | "dress"
  | "outerwear"
  | "shoes"
  | "accessory";

export type ProfileRow = {
  id: string;
  display_name: string | null;
  body_type: BodyType | null;
  height_cm: number | null;
  weight_kg: number | null;
  build: Build | null;

  /**
   * Birth YEAR only — no month, no day. Half of Selv's 13+ age gate
   * (LAUNCH_CHECKLIST.md §1, legal/PRIVACY_POLICY.md §12).
   *
   * DELIBERATELY NOT A BIRTHDATE. A day-precision date of birth is the most
   * sensitive field the app could hold and a permanent one — you cannot
   * rotate it after a breach — so the exact check runs inside the
   * `record_age_check` RPC, which takes the full birthdate as an argument,
   * evaluates it to the day, and discards it. What persists is this coarse
   * signal plus `age_verified_on`, which together keep the verdict auditable
   * without retaining the date. See supabase/migrations/006_age_gate.sql.
   *
   * READ-ONLY TO CLIENTS: the column-level grants in that migration revoke
   * UPDATE/INSERT on it, so it is absent from the `Update`/`Insert` shapes
   * below and a write would fail with 42501 even though RLS allows the row.
   */
  birth_year: number | null;

  /**
   * The day an exact >=13 check passed, or `null` if this account has never
   * been age-checked. `null` is what every row predating the age gate holds,
   * and it is what routes a user to the age step in app/_layout.tsx.
   *
   * A verdict is permanent — nobody gets younger — so a timestamped pass is a
   * complete and permanent proof and there is nothing to re-derive later.
   * That is precisely why the birthdate itself does not need keeping.
   *
   * READ-ONLY TO CLIENTS, same as `birth_year`. Written only by the
   * `record_age_check` RPC.
   */
  age_verified_on: string | null;

  created_at: string;
};

/** Where a garment row came from — matches PRODUCT_SPEC.md §7's `garments.source`. */
export type GarmentSource = "upload" | "catalog";

/**
 * Lifecycle of a garment's texture processing (background removal, UV
 * projection onto its template). Stored as plain `text` in Postgres (not
 * a DB enum, unlike `garment_category`) so this union is an app-level
 * convention, not DB-enforced — same pattern already used for `Build`
 * above, which also has no backing DB enum.
 */
export type GarmentProcessingStatus = "pending" | "processing" | "ready" | "failed";

export type GarmentRow = {
  id: string;
  user_id: string;
  /**
   * Path inside the private "garments" storage bucket, for garments the user
   * photographed themselves (`source: "upload"`). NULL for catalog-sourced
   * garments saved from the Shop — those live on a partner CDN and carry
   * `image_url` instead. Exactly one of the two is always set, which the DB
   * enforces via the `garments_image_present` check constraint, so callers
   * must branch on which one is present rather than assuming a path exists.
   */
  image_path: string | null;
  category: GarmentCategory;
  name: string | null;
  color: string | null;
  brand: string | null;
  tags: string[];
  created_at: string;
  /** FK -> garment_templates.id; null for garments not yet matched to a template. */
  template_id: string | null;
  /** Storage path of the processed (background-removed / UV-projected) texture, once ready. */
  texture_path: string | null;
  source: GarmentSource;
  processing_status: GarmentProcessingStatus;
  /**
   * FK -> brand_products.id when this garment was saved from the Shop, so
   * the wardrobe can link back to the product (re-buy, price drops, sizing).
   * NULL for user-uploaded garments. A partial unique index on
   * (user_id, product_id) stops the same product being saved twice.
   */
  product_id: string | null;
  /**
   * Public partner CDN url for catalog-sourced garments. Unlike `image_path`
   * this needs no signed-URL round trip — render it directly.
   */
  image_url: string | null;
};

/**
 * A system-owned, shared 3D garment mesh (t-shirt, jeans, etc.) that user
 * garments are textured onto. Public-read (`is_active = true` only) — see
 * schema.sql's "public garment templates" policy.
 */
export type GarmentTemplateRow = {
  id: string;
  category: GarmentCategory;
  name: string;
  glb_path: string;
  default_texture_path: string | null;
  is_active: boolean;
};

/**
 * Mirrors `ShapeParams` from `features/avatar3d/bodyModel.ts` (height,
 * volume, chest, hip, each normalized to roughly -1..1). Duplicated here
 * rather than imported so this dependency-light lib file doesn't reach
 * into feature code — keep the two in sync by hand; `bodyModel.ts` is the
 * source of truth for what these fields mean and how they're computed.
 */
export type ShapeParamsJson = {
  height: number;
  volume: number;
  chest: number;
  hip: number;
};

/**
 * Mirrors `Customization` from `features/creator/customization.ts`
 * (PRODUCT PIVOT: users build a character instead of uploading a photo /
 * relying on measurements). Duplicated here rather than imported for the
 * same dependency-light reason as ShapeParamsJson above — customization.ts
 * is the source of truth for what these fields mean and their catalogs;
 * keep the two in sync by hand.
 */
export type CustomizationJson = {
  skinTone: string;
  faceShape: string;
  eyeColor: string;
  eyeShape: string;
  eyebrows: string;
  eyebrowColor: string;
  hairStyle: string;
  hairColor: string;
  facialHair: string;
  facialHairColor: string;
  bodyType: string;
  accessories: string[];
};

/**
 * A user's stored avatar: appearance customization (the current source of
 * the try-on avatar, see features/creator/) plus legacy body measurements
 * and their derived shape vector. One row per user
 * (`avatars_user_id_key` unique constraint) — see src/lib/api/avatars.ts,
 * which always upserts on `user_id` rather than inserting new rows.
 *
 * height_cm/weight_kg/shape_params are nullable now that the character
 * creator (not measurements) drives the avatar; they're kept only for the
 * legacy body-shape system in features/avatar3d/bodyModel.ts.
 */
export type AvatarRow = {
  id: string;
  user_id: string;
  height_cm: number | null;
  weight_kg: number | null;
  /** Optional tape measurements — null when the user skipped them (bodyModel estimates a value for shape purposes, but nothing is stored here). */
  chest_cm: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  inseam_cm: number | null;
  skin_tone: string | null;
  /** Derived from height_cm/weight_kg/chest_cm/hip_cm via measurementsToShapeParams — never edited independently of the raw measurements. Null when no measurements have been saved. */
  shape_params: ShapeParamsJson | null;
  /** Appearance customization from the character creator — see features/creator/customization.ts's `Customization` (this is its jsonb-shaped superset). Defaults to `{}` at the DB level, so treat as partial until run through `mergeCustomization`. */
  customization: Partial<CustomizationJson>;
  /** Storage path of a rendered avatar thumbnail, once one exists (not produced by Day 2 — reserved for a later "save a preview" step). */
  preview_path: string | null;
  created_at: string;
  updated_at: string;
};

export type OutfitRow = {
  id: string;
  user_id: string;
  name: string | null;
  created_at: string;
};

export type OutfitItemRow = {
  outfit_id: string;
  garment_id: string;
  layer_order: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

// ---------------------------------------------------------------------------
// Commerce / affiliate
// ---------------------------------------------------------------------------
// Mirrors the "COMMERCE / AFFILIATE" section of supabase/schema.sql. Money is
// integer cents and rates are integer basis points (1 bps = 0.01%, so 1000 =
// 10%) everywhere below — never floats — because a sub-cent rounding drift
// per click turns into a reconciliation dispute with a partner at volume.
// The helpers that interpret these numbers live in src/lib/commerce/
// commission.ts; read a price through `effectivePriceCents`, never off the
// raw column.

/**
 * Which affiliate network mediates a brand's tracking and payouts.
 * `"direct"` means a first-party agreement with no intermediary — their
 * postbacks hit our own edge function and there is usually no wrapper URL.
 */
export type AffiliateNetwork =
  | "direct"
  | "rakuten"
  | "cj"
  | "impact"
  | "shopstyle"
  | "awin";

/**
 * Partner lifecycle. Only `"active"` brands are visible to clients (RLS
 * enforces it). `"paused"` is a reversible takedown — a lapsed contract or a
 * broken catalog feed — that hides the brand and its whole catalog in one
 * write without deleting the historical clicks that reference them.
 */
export type BrandStatus = "pending" | "active" | "paused";

/**
 * Affiliate accounting lifecycle. Networks report a sale as `"pending"`,
 * promote it to `"approved"` once the return window closes, then `"paid"`
 * when the money lands. `"reversed"` (refund/cancellation) is kept rather
 * than deleted: a deleted conversion is indistinguishable from a postback
 * that never arrived.
 */
export type ConversionStatus = "pending" | "approved" | "reversed" | "paid";

/**
 * Where in the app the user was standing when they tapped Buy. Exists purely
 * for attribution reporting — if `"tryon"` converts far better than
 * `"shop"`, the try-on-first funnel is the product, not a feature.
 */
export type ClickSource = "shop" | "tryon" | "outfit" | "wishlist" | "share";

/** A partner brand whose catalog is surfaced in the Shop tab. */
export type BrandRow = {
  id: string;
  /** Stable deep-link key (selv://shop/brand/<slug>); survives a rename of `name`. */
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  network: AffiliateNetwork;
  /** Brand-wide default commission in basis points; products may override it. */
  commission_rate_bps: number;
  /**
   * Network deep-link template, e.g.
   * `https://track.net/c?u={URL}&subid={SUBID}` — `{URL}` is replaced with
   * the URL-encoded product url and `{SUBID}` with the click token. NULL
   * means no wrapper, so tracking params get appended to the product url
   * directly. Both branches live in `buildAffiliateUrl` (api/affiliate.ts).
   */
  affiliate_url_template: string | null;
  status: BrandStatus;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * One purchasable SKU from a partner's catalog. Deliberately shaped like
 * `GarmentRow` (same `GarmentCategory`, same name/color/tags vocabulary) so
 * `saveProductToWardrobe` can copy a product into a wardrobe with no
 * translation layer.
 */
export type BrandProductRow = {
  id: string;
  brand_id: string;
  /** The brand's own SKU — unique per brand, and the key a catalog re-sync upserts on. */
  external_id: string;
  name: string;
  description: string | null;
  category: GarmentCategory;
  color: string | null;
  price_cents: number;
  /**
   * Set only while discounted. Do NOT assume it is below `price_cents` —
   * partner feeds do send nonsense — always read through
   * `effectivePriceCents`, which ignores a sale price that isn't lower.
   */
  sale_price_cents: number | null;
  currency: string;
  /** Public partner CDN url. Nothing private here, so no signed-URL dance. */
  image_url: string;
  extra_image_urls: string[];
  /** Transparent cutout PNG for the 2D try-on collage; falls back to `image_url`. */
  tryon_image_url: string | null;
  template_id: string | null;
  /** Canonical PDP, always un-wrapped — the affiliate wrapper is applied per click. */
  product_url: string;
  /**
   * Per-product override of the brand rate. `null` means "inherit";
   * `0` is a meaningful value (some partners pay nothing on clearance), so
   * never collapse the two with `??` on a falsy check — see
   * `resolveCommissionRateBps`.
   */
  commission_rate_bps: number | null;
  sizes: string[];
  tags: string[];
  in_stock: boolean;
  /** Soft delete. Feeds churn; hard-deleting would orphan affiliate_clicks. */
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /**
   * Postgres-maintained full-text index over name/description/tags. Declared
   * optional because it is never worth *reading* — it comes back in a
   * `select('*')` response and is otherwise opaque — but it must be part of
   * this type so `.textSearch('search_tsv', …)` in api/shop.ts typechecks
   * against the column list. Generated always as stored, so it can never be
   * written (hence the Omit in the Insert shape below).
   */
  search_tsv?: string;
};

/**
 * One outbound handoff to a partner PDP — the only record that exists at the
 * moment the user leaves the app. `commission_rate_bps` and
 * `price_cents_at_click` are snapshots on purpose: if the brand renegotiates
 * their rate or drops the price next week, a conversion arriving against this
 * click must still be valued at the terms it was made under.
 */
export type AffiliateClickRow = {
  id: string;
  /** The subid handed to the network; unique, because it's the postback join key. */
  click_token: string;
  /** Nullable so deleting an account doesn't erase the brand's record of the click. */
  user_id: string | null;
  product_id: string;
  brand_id: string;
  source: ClickSource;
  commission_rate_bps: number;
  price_cents_at_click: number;
  created_at: string;
};

/**
 * A completed purchase reported back by a brand or network. Written only by
 * the service-role postback edge function — clients can read their own rows
 * (order history) but can never author revenue.
 */
export type AffiliateConversionRow = {
  id: string;
  /** Resolved click, when the token matched one. Postbacks with unknown tokens are still stored. */
  click_id: string | null;
  /** Raw subid as the network sent it, kept even when it resolves to no click. */
  click_token: string | null;
  user_id: string | null;
  brand_id: string;
  product_id: string | null;
  network: AffiliateNetwork;
  network_order_id: string;
  order_total_cents: number;
  currency: string;
  commission_rate_bps: number;
  commission_cents: number;
  status: ConversionStatus;
  occurred_at: string;
  confirmed_at: string | null;
  /** Verbatim postback body — payload shapes change without notice and disputes settle months later. */
  raw_payload: Record<string, unknown>;
  created_at: string;
};

/** "Save for later" on a shop product. Composite PK (user_id, product_id) — no surrogate id. */
export type WishlistItemRow = {
  user_id: string;
  product_id: string;
  created_at: string;
};

/**
 * Append-only analytics: the user put this product on their avatar. Kept
 * apart from `affiliate_clicks` because a try-on is a weaker intent signal
 * than a click-out, and the ratio between the two is the interesting number.
 */
export type ProductTryOnRow = {
  id: string;
  user_id: string;
  product_id: string;
  created_at: string;
};

/**
 * A partner credential for our catalog-import / postback edge functions.
 * Only the sha256 hex of the key is stored; the raw key is shown once at
 * creation and is unrecoverable. This table has RLS enabled with **no
 * policies at all**, so it is unreadable from any client holding the anon
 * key — it is typed here only for service-role code.
 */
export type BrandApiKeyRow = {
  id: string;
  brand_id: string;
  label: string;
  key_hash: string;
  last_used_at: string | null;
  /** Soft revoke, so the audit trail of which key signed which import survives. */
  revoked_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Selv+ waitlist
// ---------------------------------------------------------------------------
// Mirrors the "SELV+ WAITLIST" section of supabase/schema.sql (idempotent form
// in supabase/migrations/004_waitlist.sql). Nothing here is for sale: Selv+ is
// announced as *coming*, and this table is what the 25-item wardrobe cap
// offers instead of the purchase button it used to pretend to have.

/**
 * Which wall the user was standing at when they asked to be told about Selv+.
 * Backed by the `waitlist_source` DB enum, so adding a value here without the
 * matching `alter type` migration is a runtime insert failure rather than a
 * silently mis-attributed row. Only values a screen can actually emit are
 * listed — a value no screen can produce is a lie in a funnel report.
 *
 * All three walls are wired: the wardrobe grid, the add-garment form, and the
 * Shop's "save to wardrobe" path (`saveProductToWardrobe`, surfaced by
 * ProductDetailScreen). `shop_save` is kept distinct rather than folded into
 * `add_garment` because "ran out of room saving something I found in the Shop"
 * and "ran out of room photographing my own clothes" are different signals,
 * and telling them apart is the entire point of storing `source` at all.
 * `shop_save` arrived in migrations/005_waitlist_shop_source.sql.
 */
export type WaitlistSource = "wardrobe_grid" | "add_garment" | "shop_save";

/**
 * One user's Selv+ signup. `user_id` is the PRIMARY KEY rather than a plain FK
 * beside a surrogate id: that is "they can't spam-join" expressed as a
 * constraint, and a second tap arrives as a 23505 that
 * `joinWaitlist` (src/lib/api/waitlist.ts) turns into a reassuring "you're
 * already on the list" instead of an error.
 */
export type WaitlistSignupRow = {
  user_id: string;
  /**
   * Where the launch announcement goes. Defaults at the database to the
   * caller's own verified JWT email, but the client is deliberately allowed to
   * state a different address — Sign in with Apple hands us
   * @privaterelay.appleid.com mailboxes that are real and that nobody reads.
   * NOT NULL with no fallback, because a signup we cannot reach is worse than
   * a failed signup. See the long rationale on the column in 004_waitlist.sql
   * for why this is forgeable-but-acceptable here when
   * `affiliate_clicks.commission_rate_bps` is not.
   */
  email: string;
  source: WaitlistSource;
  /**
   * The join date, and never an edit date: only `email` is updatable (see the
   * Update shape below), so the consent and its timing are immutable.
   */
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        /**
         * `birth_year`/`age_verified_on` are omitted from both write shapes,
         * and the omission is enforced, not stylistic: 006_age_gate.sql
         * revokes client INSERT/UPDATE on those two columns and re-grants
         * only the rest, so PostgREST answers 42501 for a write RLS would
         * otherwise have allowed. They move only through the
         * `record_age_check` RPC below. Keeping them out of the types means
         * that shows up as a compile error rather than a runtime one.
         */
        Insert: Omit<Partial<ProfileRow>, "birth_year" | "age_verified_on"> & {
          id: string;
        };
        Update: Omit<Partial<ProfileRow>, "birth_year" | "age_verified_on">;
        Relationships: [];
      };
      garments: {
        Row: GarmentRow;
        /**
         * `image_path` is no longer required: catalog-sourced garments carry
         * an `image_url` instead. The DB still insists on one of the two via
         * the `garments_image_present` check, but that's not expressible in
         * TypeScript without splitting this into a union that every existing
         * call site would have to narrow, so it stays a runtime guarantee.
         */
        Insert: Partial<GarmentRow> & {
          user_id: string;
          category: GarmentCategory;
        };
        Update: Partial<GarmentRow>;
        Relationships: [];
      };
      garment_templates: {
        Row: GarmentTemplateRow;
        Insert: Partial<GarmentTemplateRow> & {
          category: GarmentCategory;
          name: string;
          glb_path: string;
        };
        Update: Partial<GarmentTemplateRow>;
        Relationships: [];
      };
      avatars: {
        Row: AvatarRow;
        /** height_cm/weight_kg are optional now — the character creator no longer requires measurements. */
        Insert: Partial<AvatarRow> & {
          user_id: string;
        };
        Update: Partial<AvatarRow>;
        Relationships: [];
      };
      outfits: {
        Row: OutfitRow;
        Insert: Partial<OutfitRow> & { user_id: string };
        Update: Partial<OutfitRow>;
        Relationships: [];
      };
      outfit_items: {
        Row: OutfitItemRow;
        Insert: Partial<OutfitItemRow> & {
          outfit_id: string;
          garment_id: string;
        };
        Update: Partial<OutfitItemRow>;
        Relationships: [];
      };
      // --- Commerce / affiliate --------------------------------------------
      // brands and brand_products are read-only to clients (RLS grants
      // select on live rows and nothing else), so their Insert/Update shapes
      // exist only to satisfy the client's generic — the service role, which
      // bypasses RLS, is the only thing that can actually use them.
      brands: {
        Row: BrandRow;
        Insert: Partial<BrandRow> & { slug: string; name: string };
        Update: Partial<BrandRow>;
        Relationships: [];
      };
      brand_products: {
        Row: BrandProductRow;
        /** `search_tsv` is `generated always as … stored` — Postgres rejects any write to it. */
        Insert: Omit<Partial<BrandProductRow>, "search_tsv"> & {
          brand_id: string;
          external_id: string;
          name: string;
          category: GarmentCategory;
          price_cents: number;
          image_url: string;
          product_url: string;
        };
        Update: Omit<Partial<BrandProductRow>, "search_tsv">;
        Relationships: [];
      };
      affiliate_clicks: {
        Row: AffiliateClickRow;
        /**
         * Service-role only in practice. Clients have **no insert policy** on
         * this table — see the RLS section of schema.sql — because a policy
         * can only constrain `user_id`, leaving `commission_rate_bps`,
         * `price_cents_at_click`, `brand_id` and `click_token` client-stated
         * on a revenue-bearing row. Client-side click creation goes through
         * the `create_affiliate_click` RPC below, which derives all of those
         * server-side. This Insert shape exists for the service role (which
         * bypasses RLS); a client `.insert()` here typechecks and then fails
         * at the database, by design.
         *
         * Both snapshot columns are required, not defaulted: a click written
         * without the rate and price it was made under can never be valued
         * correctly later, and a silent zero would be worse than a failure.
         */
        Insert: Partial<AffiliateClickRow> & {
          click_token: string;
          product_id: string;
          brand_id: string;
          commission_rate_bps: number;
          price_cents_at_click: number;
        };
        /** Clicks are write-once — no client policy grants update. */
        Update: never;
        Relationships: [];
      };
      affiliate_conversions: {
        Row: AffiliateConversionRow;
        /** Service-role only (the postback edge function); no client insert policy exists. */
        Insert: Partial<AffiliateConversionRow> & {
          brand_id: string;
          network_order_id: string;
          order_total_cents: number;
          commission_rate_bps: number;
          commission_cents: number;
        };
        Update: Partial<AffiliateConversionRow>;
        Relationships: [];
      };
      wishlist_items: {
        Row: WishlistItemRow;
        Insert: Partial<WishlistItemRow> & {
          user_id: string;
          product_id: string;
        };
        Update: Partial<WishlistItemRow>;
        Relationships: [];
      };
      product_try_ons: {
        Row: ProductTryOnRow;
        Insert: Partial<ProductTryOnRow> & {
          user_id: string;
          product_id: string;
        };
        Update: Partial<ProductTryOnRow>;
        Relationships: [];
      };
      /** Service-role only — RLS is enabled with no policies, so no client can touch this. */
      brand_api_keys: {
        Row: BrandApiKeyRow;
        Insert: Partial<BrandApiKeyRow> & {
          brand_id: string;
          label: string;
          key_hash: string;
        };
        Update: Partial<BrandApiKeyRow>;
        Relationships: [];
      };
      // --- Selv+ waitlist ---------------------------------------------------
      waitlist_signups: {
        Row: WaitlistSignupRow;
        /**
         * `email` and `created_at` are optional because both carry database
         * defaults — the caller's own verified JWT email, and now(). `source`
         * is required: the table deliberately declares it without a default,
         * so a caller that forgets to say which wall the user hit is rejected
         * rather than silently attributed to the wardrobe grid, and an
         * unattributed signup is the one thing this table exists to avoid.
         */
        Insert: Partial<WaitlistSignupRow> & {
          user_id: string;
          source: WaitlistSource;
        };
        /**
         * Narrower than `Partial<Row>` on purpose. The migration revokes
         * UPDATE on the table and re-grants it on `email` alone, which is what
         * actually makes `source` and `created_at` immutable to clients — RLS
         * scopes rows, not columns. Widening this type would typecheck and
         * then be refused by the database.
         */
        Update: Pick<WaitlistSignupRow, "email">;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      /**
       * Create one affiliate click and return the inserted row.
       *
       * The only way a client can write `affiliate_clicks` — the table has no
       * insert policy, deliberately. A `security definer` function in
       * schema.sql resolves the commission rate, the effective price, the
       * owning brand and the click token from `brands`/`brand_products`, so
       * the two arguments below are the entire surface a caller controls.
       * `p_source` is safe to accept because it is self-reported attribution
       * analytics, not money, and the `click_source` enum bounds it.
       *
       * Raises rather than returning null on failure, so `.rpc()` surfaces a
       * `PostgrestError`: `42501` when unauthenticated, `P0002` when the
       * product is missing/withdrawn or its brand is not `active`.
       * `createCheckoutLink` in api/affiliate.ts maps those to user-facing
       * strings and is the only intended call site.
       *
       * Declared as a non-SETOF composite return, so `Returns` is a single
       * row rather than an array — see api/affiliate.ts, which normalises
       * both shapes anyway rather than betting on PostgREST's version.
       */
      create_affiliate_click: {
        Args: {
          p_product_id: string;
          p_source: ClickSource;
        };
        Returns: AffiliateClickRow;
      };

      /**
       * Run the 13+ age check and record its verdict on the caller's profile.
       *
       * The only way a client can write `profiles.birth_year` /
       * `profiles.age_verified_on` — column-level grants revoke both, for the
       * same reason `affiliate_clicks` has no insert policy: the row carries
       * a term the client must not be able to state. A forged commission rate
       * invoices a partner for their own order value; a forged age verdict is
       * a 12-year-old with an account and a privacy policy saying we have
       * none.
       *
       * `p_birthdate` is `YYYY-MM-DD` and is an *argument*, never a column.
       * The `security definer` function in schema.sql evaluates it to the day
       * against `current_date` and then discards it; only the year and the
       * verification date survive the call.
       *
       * Raises rather than returning null: `42501` when unauthenticated,
       * `22004` for a null date, `22007` for a future or implausible one, and
       * `P0001` for under-13. `recordAgeCheck` in api/profiles.ts maps those
       * to user-facing strings and is the only intended call site.
       *
       * Declared as a non-SETOF composite return, so `Returns` is a single
       * row rather than an array — same as `create_affiliate_click`, and
       * api/profiles.ts normalises both shapes anyway rather than betting on
       * PostgREST's version.
       */
      record_age_check: {
        Args: {
          p_birthdate: string;
        };
        Returns: ProfileRow;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
