-- ===========================================================================
-- 001_brands_products.sql — demo catalog for the Shop tab
-- ===========================================================================
-- Six partner brands and thirty products, entirely fictional. The brand
-- names, SKUs, prices, contact addresses and tracking templates below were
-- invented for local development and demos — none of them represent a real
-- company or a real commercial agreement, and every hostname uses the
-- reserved .example TLD so nothing here can ever resolve.
--
-- IMAGERY: there is none, and deliberately so. Every logo_url, image_url,
-- extra_image_urls entry and tryon_image_url below is a `selv-asset://` uri,
-- which the app reads as "no partner artwork exists for this row — draw the
-- bundled placeholder for its category". The resolution lives in
-- src/features/shop/productImagery.tsx and the artwork in assets/shop/*.png:
-- generated gradient tiles carrying a flat garment pictogram, drawn from the
-- palette in lib/theme.ts. When a brand is really onboarded these columns
-- take their https CDN urls and the placeholders stop being reached.
--
-- Four options were weighed. The dead https://images.selv-demo.test host
-- these replaced satisfied none of them — being a plausible-looking https
-- url, it cost a DNS lookup and a timeout per image before failing:
--
--   * A real retailer's CDN is out on its face. These are invented
--     companies; borrowing a real brand's photography would assert a
--     commercial relationship that does not exist.
--   * A public placeholder service (placehold.co and friends) keeps the rows
--     shaped like production data — an https url a partner feed could
--     actually have sent, which is what product-feed-ingest validates for.
--     Rejected because it fails in precisely the situations this catalog
--     exists to serve: an App Store screenshot session, a demo on conference
--     wifi, a plane. It also puts a third party we do not control on the
--     critical path of the first screen a reviewer opens.
--   * Data-uri tiles are the only option that fixes *every* reader of these
--     columns from the seed alone — including the try-on, wardrobe and orders
--     screens, which read image_url directly and never touch the Shop's
--     components. Rejected on file quality: a tile detailed enough to look
--     deliberate is several KB of base64, and ~90 of those turn a fixture
--     meant to be read and edited by hand into an undiffable wall. Shrinking
--     them until this file stays legible yields visibly blocky tiles, which
--     is the original problem wearing a different hat.
--   * Bundled assets — chosen. They ship inside the binary, so they cannot
--     404, cost no network, and render identically in a release build with
--     the radio off. The cost is that resolution must happen client-side, so
--     only surfaces routed through productImagery.tsx benefit; that is the
--     Shop's four screens today, and the module is exported for the try-on,
--     wardrobe and orders screens to adopt.
--
-- Run after supabase/schema.sql (or migrations/002_commerce.sql):
--   psql "$DATABASE_URL" -f supabase/seed/001_brands_products.sql
--
-- Idempotent: every row carries a literal uuid (no gen_random_uuid()) and
-- every insert ends in `on conflict do nothing`, so re-running is a no-op
-- rather than a duplicated catalog. That also means edits to a row here will
-- NOT be picked up on re-run — delete the row first, or write a migration.
--
-- The data is deliberately uneven so the UI's filtering paths get exercised
-- for real rather than only on the happy path:
--   * Ironvale has status 'paused'      -> its 2 products must never appear
--   * hd-chore-shirt has is_active false -> must never appear
--   * 2 products have in_stock false     -> must appear, but not be buyable
--   * 5 products are on sale             -> exercises effectivePriceCents()
--   * 2 products override commission_rate_bps (one to 0) -> exercises
--     resolveCommissionRateBps()'s "0 is a real value, not absent" branch
--   * commission rates span 800..1500 bps across the six brands
-- ===========================================================================

-- --- Brands ---------------------------------------------------------------
insert into public.brands
  (id, slug, name, tagline, description, logo_url, website_url, network,
   commission_rate_bps, affiliate_url_template, status, contact_email)
values
  ('b0000000-0000-4000-8000-000000000001',
   'northwake',
   'Northwake',
   'Built for weather, worn anywhere.',
   'Heritage outerwear and workwear cut in British-milled cotton and waxed canvas. Northwake makes about forty styles a year and reissues the ones that last.',
   'selv-asset://brand/northwake/logo.png',
   'https://northwake.example',
   'direct',
   1200,
   -- 'direct' partners have no network wrapper: buildAffiliateUrl() appends
   -- selv_subid + utm params to the product url itself.
   null,
   'active',
   'partners@northwake.example'),

  ('b0000000-0000-4000-8000-000000000002',
   'studio-meridian',
   'Studio Meridian',
   'Quiet clothes for loud calendars.',
   'A small contemporary label working in silk, crepe and wool. Neutral palette, sharp tailoring, nothing that shouts.',
   'selv-asset://brand/studio-meridian/logo.png',
   'https://studiomeridian.example',
   'shopstyle',
   1000,
   'https://api.shopstyle.example/action/apiVisitRetailer?url={URL}&pid=selv&sid={SUBID}',
   'active',
   'affiliates@studiomeridian.example'),

  ('b0000000-0000-4000-8000-000000000003',
   'halcyon-denim',
   'Halcyon Denim',
   'One fabric, done properly.',
   'Selvedge denim woven on shuttle looms and cut into five fits. Raw, one-wash and stone-washed finishes only.',
   'selv-asset://brand/halcyon-denim/logo.png',
   'https://halcyondenim.example',
   'rakuten',
   900,
   'https://click.linksynergy.example/deeplink?id=selv&mid=48231&murl={URL}&u1={SUBID}',
   'active',
   'partners@halcyondenim.example'),

  ('b0000000-0000-4000-8000-000000000004',
   'verso-athletic',
   'Verso Athletic',
   'Train, then go straight out.',
   'Technical running and training kit designed to not look like technical running and training kit.',
   'selv-asset://brand/verso-athletic/logo.png',
   'https://versoathletic.example',
   'impact',
   1100,
   'https://selv.pxf.example/c/selv/0/0?u={URL}&subId1={SUBID}',
   'active',
   'affiliate@versoathletic.example'),

  ('b0000000-0000-4000-8000-000000000005',
   'palma-knitwear',
   'Palma Knitwear',
   'Knitted in one place, by the same twelve people.',
   'Merino, alpaca and cashmere knitwear from a single family mill. Highest commission on the platform because they sell direct and skip wholesale.',
   'selv-asset://brand/palma-knitwear/logo.png',
   'https://palmaknitwear.example',
   'awin',
   1500,
   'https://www.awin1.example/cread.php?awinmid=17422&awinaffid=selv&clickref={SUBID}&ued={URL}',
   'active',
   'hello@palmaknitwear.example'),

  -- Paused partner: contract lapsed. Their rows stay (historical clicks and
  -- conversions still reference them) but RLS hides the brand and, through
  -- the "public active brand products" policy, its entire catalog.
  ('b0000000-0000-4000-8000-000000000006',
   'ironvale',
   'Ironvale',
   'Goodyear-welted, resoleable, heavy.',
   'Boots and leather goods. Currently paused on Selv pending a renewed affiliate agreement.',
   'selv-asset://brand/ironvale/logo.png',
   'https://ironvale.example',
   'cj',
   800,
   'https://www.anrdoezrs.example/links/selv/type/dlg/sid/{SUBID}/{URL}',
   'paused',
   'wholesale@ironvale.example')
on conflict do nothing;

-- --- Products -------------------------------------------------------------
-- Prices are integer cents, so $118.00 is 11800. sale_price_cents is set only
-- while an item is discounted and is always strictly below price_cents here.
insert into public.brand_products
  (id, brand_id, external_id, name, description, category, color,
   price_cents, sale_price_cents, currency, image_url, extra_image_urls,
   tryon_image_url, product_url, commission_rate_bps, sizes, tags,
   in_stock, is_active)
values
  -- === Northwake (direct, 1200 bps) =======================================
  ('a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'nw-fell-oxford',
   'Fell Oxford Shirt',
   'Mid-weight brushed oxford cotton with a soft button-down collar and a single patch pocket. Cut straight through the body.',
   'top', 'Pale Blue', 11800, null, 'USD',
   'selv-asset://product/northwake/nw-fell-oxford.jpg',
   array['selv-asset://product/northwake/nw-fell-oxford-2.jpg',
         'selv-asset://product/northwake/nw-fell-oxford-3.jpg'],
   'selv-asset://product/northwake/nw-fell-oxford-tryon.png',
   'https://northwake.example/products/fell-oxford-shirt',
   null, array['XS','S','M','L','XL','XXL'],
   array['shirt','oxford','cotton','workwear','everyday'], true, true),

  ('a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', 'nw-cragside-flannel',
   'Cragside Flannel Overshirt',
   'Heavyweight brushed flannel with a double-layer yoke. Sized to layer over a tee or under the field jacket.',
   'top', 'Moss Check', 14500, 10900, 'USD',
   'selv-asset://product/northwake/nw-cragside-flannel.jpg',
   array['selv-asset://product/northwake/nw-cragside-flannel-2.jpg'],
   'selv-asset://product/northwake/nw-cragside-flannel-tryon.png',
   'https://northwake.example/products/cragside-flannel-overshirt',
   null, array['S','M','L','XL'],
   array['overshirt','flannel','check','layering','sale'], true, true),

  ('a0000000-0000-4000-8000-000000000003',
   'b0000000-0000-4000-8000-000000000001', 'nw-waxed-field',
   'Waxed Field Jacket',
   'Eight-ounce waxed cotton, corduroy collar, four bellows pockets and a storm flap. Re-waxable indefinitely.',
   'outerwear', 'Sage', 34000, null, 'USD',
   'selv-asset://product/northwake/nw-waxed-field.jpg',
   array['selv-asset://product/northwake/nw-waxed-field-2.jpg',
         'selv-asset://product/northwake/nw-waxed-field-3.jpg'],
   'selv-asset://product/northwake/nw-waxed-field-tryon.png',
   'https://northwake.example/products/waxed-field-jacket',
   null, array['S','M','L','XL','XXL'],
   array['jacket','waxed-cotton','outerwear','heritage','rain'], true, true),

  ('a0000000-0000-4000-8000-000000000004',
   'b0000000-0000-4000-8000-000000000001', 'nw-ridgeline-chino',
   'Ridgeline Chino',
   'Garment-dyed cotton twill with a touch of stretch and a mid rise. Tapers gently below the knee.',
   'bottom', 'Stone', 9800, null, 'USD',
   'selv-asset://product/northwake/nw-ridgeline-chino.jpg',
   array[]::text[],
   'selv-asset://product/northwake/nw-ridgeline-chino-tryon.png',
   'https://northwake.example/products/ridgeline-chino',
   null, array['28','30','32','34','36','38'],
   array['chino','trousers','cotton','everyday'], true, true),

  -- Out of stock: still listed and still tryable, just not buyable.
  ('a0000000-0000-4000-8000-000000000005',
   'b0000000-0000-4000-8000-000000000001', 'nw-kilnsey-scarf',
   'Kilnsey Wool Scarf',
   'Lambswool woven in a two-tone herringbone, hand-finished with a knotted fringe.',
   'accessory', 'Rust', 6200, null, 'USD',
   'selv-asset://product/northwake/nw-kilnsey-scarf.jpg',
   array[]::text[],
   'selv-asset://product/northwake/nw-kilnsey-scarf-tryon.png',
   'https://northwake.example/products/kilnsey-wool-scarf',
   null, array['One Size'],
   array['scarf','wool','winter','accessory'], false, true),

  -- === Studio Meridian (shopstyle, 1000 bps) ==============================
  ('a0000000-0000-4000-8000-000000000006',
   'b0000000-0000-4000-8000-000000000002', 'sm-column-midi',
   'Column Midi Dress',
   'A clean sleeveless column in heavy matte crepe, with a concealed back zip and a walking slit.',
   'dress', 'Ink', 22800, null, 'USD',
   'selv-asset://product/studio-meridian/sm-column-midi.jpg',
   array['selv-asset://product/studio-meridian/sm-column-midi-2.jpg'],
   'selv-asset://product/studio-meridian/sm-column-midi-tryon.png',
   'https://studiomeridian.example/products/column-midi-dress',
   null, array['XS','S','M','L'],
   array['dress','midi','crepe','occasion','minimal'], true, true),

  ('a0000000-0000-4000-8000-000000000007',
   'b0000000-0000-4000-8000-000000000002', 'sm-sable-slip',
   'Sable Slip Dress',
   'Bias-cut sand-washed silk with adjustable straps and a cowl back.',
   'dress', 'Champagne', 18600, 13020, 'USD',
   'selv-asset://product/studio-meridian/sm-sable-slip.jpg',
   array['selv-asset://product/studio-meridian/sm-sable-slip-2.jpg'],
   'selv-asset://product/studio-meridian/sm-sable-slip-tryon.png',
   'https://studiomeridian.example/products/sable-slip-dress',
   null, array['XS','S','M','L'],
   array['dress','slip','silk','bias-cut','sale','evening'], true, true),

  ('a0000000-0000-4000-8000-000000000008',
   'b0000000-0000-4000-8000-000000000002', 'sm-ecru-camisole',
   'Ecru Silk Camisole',
   'Straight-cut silk charmeuse camisole with French seams throughout.',
   'top', 'Ecru', 12400, null, 'USD',
   'selv-asset://product/studio-meridian/sm-ecru-camisole.jpg',
   array[]::text[],
   'selv-asset://product/studio-meridian/sm-ecru-camisole-tryon.png',
   'https://studiomeridian.example/products/ecru-silk-camisole',
   null, array['XS','S','M','L'],
   array['camisole','silk','layering','minimal'], true, true),

  ('a0000000-0000-4000-8000-000000000009',
   'b0000000-0000-4000-8000-000000000002', 'sm-wideleg-crepe',
   'Wide-Leg Crepe Trouser',
   'High-rise, pressed-crease trouser in the same matte crepe as the column dress. Falls straight from the hip.',
   'bottom', 'Ink', 16800, null, 'USD',
   'selv-asset://product/studio-meridian/sm-wideleg-crepe.jpg',
   array['selv-asset://product/studio-meridian/sm-wideleg-crepe-2.jpg'],
   'selv-asset://product/studio-meridian/sm-wideleg-crepe-tryon.png',
   'https://studiomeridian.example/products/wide-leg-crepe-trouser',
   null, array['XS','S','M','L','XL'],
   array['trousers','wide-leg','crepe','tailoring','workwear'], true, true),

  ('a0000000-0000-4000-8000-000000000010',
   'b0000000-0000-4000-8000-000000000002', 'sm-longline-blazer',
   'Longline Blazer',
   'Single-button wool blazer cut two inches longer than standard, with a half-canvas front.',
   'outerwear', 'Charcoal', 29500, null, 'USD',
   'selv-asset://product/studio-meridian/sm-longline-blazer.jpg',
   array['selv-asset://product/studio-meridian/sm-longline-blazer-2.jpg'],
   'selv-asset://product/studio-meridian/sm-longline-blazer-tryon.png',
   'https://studiomeridian.example/products/longline-blazer',
   null, array['XS','S','M','L'],
   array['blazer','wool','tailoring','workwear','minimal'], true, true),

  ('a0000000-0000-4000-8000-000000000011',
   'b0000000-0000-4000-8000-000000000002', 'sm-card-holder',
   'Folded Leather Card Holder',
   'Four-pocket card holder in vegetable-tanned calfskin, folded from a single piece.',
   'accessory', 'Black', 7500, null, 'USD',
   'selv-asset://product/studio-meridian/sm-card-holder.jpg',
   array[]::text[],
   null, -- no cutout supplied: the try-on collage falls back to image_url
   'https://studiomeridian.example/products/folded-leather-card-holder',
   null, array['One Size'],
   array['leather','wallet','accessory','minimal'], true, true),

  -- === Halcyon Denim (rakuten, 900 bps) ===================================
  ('a0000000-0000-4000-8000-000000000012',
   'b0000000-0000-4000-8000-000000000003', 'hd-401-straight',
   '401 Straight Jean',
   '13.5oz selvedge denim, one-wash, cut straight from hip to hem. Sanforized, so expect roughly a half-inch of shrink.',
   'bottom', 'Indigo', 13800, null, 'USD',
   'selv-asset://product/halcyon-denim/hd-401-straight.jpg',
   array['selv-asset://product/halcyon-denim/hd-401-straight-2.jpg',
         'selv-asset://product/halcyon-denim/hd-401-straight-3.jpg'],
   'selv-asset://product/halcyon-denim/hd-401-straight-tryon.png',
   'https://halcyondenim.example/products/401-straight-jean',
   null, array['28','29','30','31','32','33','34','36'],
   array['jeans','denim','selvedge','straight','indigo'], true, true),

  -- Clearance: brand rate is 900 bps but this SKU is marked down and the
  -- partner only pays 500 on it. Exercises the per-product override path.
  ('a0000000-0000-4000-8000-000000000013',
   'b0000000-0000-4000-8000-000000000003', 'hd-512-slim',
   '512 Slim Jean',
   'The 401 taken in through the thigh and knee. Same 13.5oz selvedge, stone-washed.',
   'bottom', 'Mid Wash', 13800, 9900, 'USD',
   'selv-asset://product/halcyon-denim/hd-512-slim.jpg',
   array['selv-asset://product/halcyon-denim/hd-512-slim-2.jpg'],
   'selv-asset://product/halcyon-denim/hd-512-slim-tryon.png',
   'https://halcyondenim.example/products/512-slim-jean',
   500, array['28','29','30','31','32','33','34'],
   array['jeans','denim','selvedge','slim','sale'], true, true),

  ('a0000000-0000-4000-8000-000000000014',
   'b0000000-0000-4000-8000-000000000003', 'hd-wide-selvedge',
   'Selvedge Wide Jean',
   'A full, high-rise wide leg in raw 14oz denim. Unwashed — it will fade to you.',
   'bottom', 'Raw Indigo', 15800, null, 'USD',
   'selv-asset://product/halcyon-denim/hd-wide-selvedge.jpg',
   array['selv-asset://product/halcyon-denim/hd-wide-selvedge-2.jpg'],
   'selv-asset://product/halcyon-denim/hd-wide-selvedge-tryon.png',
   'https://halcyondenim.example/products/selvedge-wide-jean',
   null, array['24','25','26','27','28','29','30','32'],
   array['jeans','denim','selvedge','wide-leg','raw'], true, true),

  ('a0000000-0000-4000-8000-000000000015',
   'b0000000-0000-4000-8000-000000000003', 'hd-type-three',
   'Type III Denim Jacket',
   'Boxy trucker jacket in 12oz denim with pointed flap pockets and a rear cinch.',
   'outerwear', 'Rinse', 17800, null, 'USD',
   'selv-asset://product/halcyon-denim/hd-type-three.jpg',
   array['selv-asset://product/halcyon-denim/hd-type-three-2.jpg'],
   'selv-asset://product/halcyon-denim/hd-type-three-tryon.png',
   'https://halcyondenim.example/products/type-iii-denim-jacket',
   null, array['XS','S','M','L','XL'],
   array['jacket','denim','trucker','outerwear','layering'], true, true),

  -- Discontinued: is_active false. Must never surface in the Shop, but the
  -- row survives because old affiliate_clicks point at it.
  ('a0000000-0000-4000-8000-000000000016',
   'b0000000-0000-4000-8000-000000000003', 'hd-chore-shirt',
   'Chore Denim Shirt',
   'Discontinued after the SS run. Kept on file so historical clicks resolve.',
   'top', 'Washed Indigo', 11200, null, 'USD',
   'selv-asset://product/halcyon-denim/hd-chore-shirt.jpg',
   array[]::text[],
   'selv-asset://product/halcyon-denim/hd-chore-shirt-tryon.png',
   'https://halcyondenim.example/products/chore-denim-shirt',
   null, array['S','M','L'],
   array['shirt','denim','chore','discontinued'], false, false),

  -- === Verso Athletic (impact, 1100 bps) ==================================
  ('a0000000-0000-4000-8000-000000000017',
   'b0000000-0000-4000-8000-000000000004', 'va-airflow-tee',
   'Airflow Tee',
   'Perforated recycled-poly jersey that reads as cotton at arm''s length. Flat-locked seams, no side seam at all.',
   'top', 'Slate', 4800, null, 'USD',
   'selv-asset://product/verso-athletic/va-airflow-tee.jpg',
   array['selv-asset://product/verso-athletic/va-airflow-tee-2.jpg'],
   'selv-asset://product/verso-athletic/va-airflow-tee-tryon.png',
   'https://versoathletic.example/products/airflow-tee',
   null, array['XS','S','M','L','XL','XXL'],
   array['tee','running','technical','breathable','training'], true, true),

  ('a0000000-0000-4000-8000-000000000018',
   'b0000000-0000-4000-8000-000000000004', 'va-kinetic-baselayer',
   'Kinetic Long-Sleeve Base Layer',
   'Merino-poly blend base layer with thumbholes and a raised collar for cold starts.',
   'top', 'Black', 6800, null, 'USD',
   'selv-asset://product/verso-athletic/va-kinetic-baselayer.jpg',
   array[]::text[],
   'selv-asset://product/verso-athletic/va-kinetic-baselayer-tryon.png',
   'https://versoathletic.example/products/kinetic-base-layer',
   null, array['XS','S','M','L','XL'],
   array['base-layer','merino','running','winter','training'], true, true),

  -- Zero-commission clearance. `commission_rate_bps = 0` is a real value that
  -- must beat the brand's 1100 default, not be treated as "unset".
  ('a0000000-0000-4000-8000-000000000019',
   'b0000000-0000-4000-8000-000000000004', 'va-trail-short-7',
   'Trail Short 7"',
   'Seven-inch unlined trail short with a zip rear pocket and a bonded waistband.',
   'bottom', 'Olive', 6400, 4480, 'USD',
   'selv-asset://product/verso-athletic/va-trail-short-7.jpg',
   array['selv-asset://product/verso-athletic/va-trail-short-7-2.jpg'],
   'selv-asset://product/verso-athletic/va-trail-short-7-tryon.png',
   'https://versoathletic.example/products/trail-short-7',
   0, array['S','M','L','XL'],
   array['shorts','running','trail','sale','clearance'], true, true),

  ('a0000000-0000-4000-8000-000000000020',
   'b0000000-0000-4000-8000-000000000004', 'va-compression-legging',
   'Compression Legging',
   'High-rise compression legging with a side phone pocket and a squat-proof gusset.',
   'bottom', 'Black', 8800, null, 'USD',
   'selv-asset://product/verso-athletic/va-compression-legging.jpg',
   array['selv-asset://product/verso-athletic/va-compression-legging-2.jpg'],
   'selv-asset://product/verso-athletic/va-compression-legging-tryon.png',
   'https://versoathletic.example/products/compression-legging',
   null, array['XS','S','M','L','XL'],
   array['legging','compression','training','gym','technical'], true, true),

  ('a0000000-0000-4000-8000-000000000021',
   'b0000000-0000-4000-8000-000000000004', 'va-drift-runner',
   'Drift Runner',
   'Daily-mileage road shoe on a 8mm-drop supercritical foam midsole. 249g in a US 9.',
   'shoes', 'Bone / Coral', 14200, null, 'USD',
   'selv-asset://product/verso-athletic/va-drift-runner.jpg',
   array['selv-asset://product/verso-athletic/va-drift-runner-2.jpg',
         'selv-asset://product/verso-athletic/va-drift-runner-3.jpg'],
   'selv-asset://product/verso-athletic/va-drift-runner-tryon.png',
   'https://versoathletic.example/products/drift-runner',
   null, array['6','7','8','9','10','11','12','13'],
   array['shoes','running','road','trainers','technical'], true, true),

  -- Second out-of-stock row, in a different category to the first.
  ('a0000000-0000-4000-8000-000000000022',
   'b0000000-0000-4000-8000-000000000004', 'va-trailhead-gtx',
   'Trailhead GTX Runner',
   'Waterproof trail shoe with a 4mm lug outsole and a gusseted tongue.',
   'shoes', 'Graphite', 16500, null, 'USD',
   'selv-asset://product/verso-athletic/va-trailhead-gtx.jpg',
   array['selv-asset://product/verso-athletic/va-trailhead-gtx-2.jpg'],
   'selv-asset://product/verso-athletic/va-trailhead-gtx-tryon.png',
   'https://versoathletic.example/products/trailhead-gtx-runner',
   null, array['7','8','9','10','11','12'],
   array['shoes','trail','waterproof','running','technical'], false, true),

  ('a0000000-0000-4000-8000-000000000023',
   'b0000000-0000-4000-8000-000000000004', 'va-run-cap',
   'Run Cap',
   'Unstructured five-panel cap in perforated ripstop with a reflective rear tab.',
   'accessory', 'Slate', 3400, null, 'USD',
   'selv-asset://product/verso-athletic/va-run-cap.jpg',
   array[]::text[],
   'selv-asset://product/verso-athletic/va-run-cap-tryon.png',
   'https://versoathletic.example/products/run-cap',
   null, array['One Size'],
   array['cap','running','accessory','technical'], true, true),

  -- === Palma Knitwear (awin, 1500 bps) ====================================
  ('a0000000-0000-4000-8000-000000000024',
   'b0000000-0000-4000-8000-000000000005', 'pk-merino-crew',
   'Merino Crewneck',
   'Fine-gauge extra-fine merino with a fully-fashioned shoulder and a tubular neck trim.',
   'top', 'Oatmeal', 15500, null, 'USD',
   'selv-asset://product/palma-knitwear/pk-merino-crew.jpg',
   array['selv-asset://product/palma-knitwear/pk-merino-crew-2.jpg'],
   'selv-asset://product/palma-knitwear/pk-merino-crew-tryon.png',
   'https://palmaknitwear.example/products/merino-crewneck',
   null, array['XS','S','M','L','XL'],
   array['knitwear','merino','sweater','crewneck','everyday'], true, true),

  ('a0000000-0000-4000-8000-000000000025',
   'b0000000-0000-4000-8000-000000000005', 'pk-cashmere-rollneck',
   'Ribbed Cashmere Turtleneck',
   'Grade-A two-ply cashmere in a deep 2x2 rib, with a fold-over neck.',
   'top', 'Camel', 26500, 19875, 'USD',
   'selv-asset://product/palma-knitwear/pk-cashmere-rollneck.jpg',
   array['selv-asset://product/palma-knitwear/pk-cashmere-rollneck-2.jpg'],
   'selv-asset://product/palma-knitwear/pk-cashmere-rollneck-tryon.png',
   'https://palmaknitwear.example/products/ribbed-cashmere-turtleneck',
   null, array['XS','S','M','L'],
   array['knitwear','cashmere','turtleneck','sale','winter'], true, true),

  ('a0000000-0000-4000-8000-000000000026',
   'b0000000-0000-4000-8000-000000000005', 'pk-rib-sweater-dress',
   'Knitted Rib Sweater Dress',
   'Long-sleeved rib-knit dress in a merino-cotton blend, hitting just below the knee.',
   'dress', 'Charcoal', 19800, null, 'USD',
   'selv-asset://product/palma-knitwear/pk-rib-sweater-dress.jpg',
   array['selv-asset://product/palma-knitwear/pk-rib-sweater-dress-2.jpg'],
   'selv-asset://product/palma-knitwear/pk-rib-sweater-dress-tryon.png',
   'https://palmaknitwear.example/products/knitted-rib-sweater-dress',
   null, array['XS','S','M','L'],
   array['dress','knitwear','rib','winter','everyday'], true, true),

  ('a0000000-0000-4000-8000-000000000027',
   'b0000000-0000-4000-8000-000000000005', 'pk-alpaca-cardigan-coat',
   'Alpaca Cardigan Coat',
   'Brushed alpaca-blend coatigan with patch pockets and no closure. Unlined, deliberately heavy.',
   'outerwear', 'Fog', 38500, null, 'USD',
   'selv-asset://product/palma-knitwear/pk-alpaca-cardigan-coat.jpg',
   array['selv-asset://product/palma-knitwear/pk-alpaca-cardigan-coat-2.jpg'],
   'selv-asset://product/palma-knitwear/pk-alpaca-cardigan-coat-tryon.png',
   'https://palmaknitwear.example/products/alpaca-cardigan-coat',
   null, array['S','M','L'],
   array['coat','alpaca','knitwear','outerwear','winter'], true, true),

  ('a0000000-0000-4000-8000-000000000028',
   'b0000000-0000-4000-8000-000000000005', 'pk-cashmere-beanie',
   'Cashmere Beanie',
   'Double-layer cashmere beanie with a folded brim, knitted seamless in the round.',
   'accessory', 'Navy', 7800, null, 'USD',
   'selv-asset://product/palma-knitwear/pk-cashmere-beanie.jpg',
   array[]::text[],
   'selv-asset://product/palma-knitwear/pk-cashmere-beanie-tryon.png',
   'https://palmaknitwear.example/products/cashmere-beanie',
   null, array['One Size'],
   array['beanie','cashmere','winter','accessory'], true, true),

  -- === Ironvale (cj, 800 bps) — PAUSED BRAND ==============================
  -- Both rows are is_active = true, but the brand is paused, so the
  -- "public active brand products" policy must still hide them. If either of
  -- these shows up in the Shop, the brand-level gate is broken.
  ('a0000000-0000-4000-8000-000000000029',
   'b0000000-0000-4000-8000-000000000006', 'iv-derby-boot',
   'Derby Boot',
   'Goodyear-welted six-eyelet derby boot on a Dainite sole. Fully resoleable.',
   'shoes', 'Dark Brown', 31000, null, 'USD',
   'selv-asset://product/ironvale/iv-derby-boot.jpg',
   array['selv-asset://product/ironvale/iv-derby-boot-2.jpg'],
   'selv-asset://product/ironvale/iv-derby-boot-tryon.png',
   'https://ironvale.example/products/derby-boot',
   null, array['7','8','9','10','11','12'],
   array['boots','leather','goodyear-welt','shoes'], true, true),

  ('a0000000-0000-4000-8000-000000000030',
   'b0000000-0000-4000-8000-000000000006', 'iv-bridle-belt',
   'Bridle Belt',
   'Thirty-five millimetre English bridle leather belt with a solid brass buckle.',
   'accessory', 'Chestnut', 9500, null, 'USD',
   'selv-asset://product/ironvale/iv-bridle-belt.jpg',
   array[]::text[],
   'selv-asset://product/ironvale/iv-bridle-belt-tryon.png',
   'https://ironvale.example/products/bridle-belt',
   null, array['30','32','34','36','38'],
   array['belt','leather','accessory'], true, true)
on conflict do nothing;
