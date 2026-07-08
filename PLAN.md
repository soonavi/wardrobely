# wardrobeSpec — Virtual Closet & Try-On App

## Product summary
Users photograph their clothes to build a virtual wardrobe catalog, pick a body-type avatar, and layer clothing onto the avatar to compose and save outfits before dressing IRL.

## Stack
- **App:** Expo SDK 54 (React Native 0.81, React 19.1, TypeScript), Expo Router v6
- **Backend:** Supabase — Auth (email/OTP), Postgres, Storage (clothing images)
- **Image processing:** background removal deferred to phase 2 (on-device crop for MVP)
- **State:** Zustand + simple fetch hooks

## Data model (Postgres)
```
profiles      id (uuid, = auth.uid), display_name, body_type (enum), created_at
garments      id, user_id, image_path, category (top|bottom|dress|outerwear|shoes|accessory),
              name, color, brand, tags text[], created_at
outfits       id, user_id, name, created_at
outfit_items  outfit_id, garment_id, layer_order int, x float, y float, scale float, rotation float
```
RLS: every table scoped to `user_id = auth.uid()`.

Storage bucket `garments/` — path `{user_id}/{garment_id}.jpg`, RLS-scoped.

## Body types (MVP avatars)
6 SVG avatar silhouettes: rectangle, hourglass, pear, apple, inverted-triangle, athletic — each with two build variants (12 total). Rendered via `react-native-svg`. Each avatar defines anchor zones (torso, legs, feet, head) that garment layers snap to by category; user fine-tunes with drag/pinch gestures.

## Screens
1. **Auth** — sign in / sign up (Supabase email OTP)
2. **Onboarding** — pick body type + avatar
3. **Wardrobe** — grid of garments, filter by category/color/tags, FAB → add
4. **Add garment** — camera or gallery (expo-image-picker), crop, categorize, tag
5. **Garment detail** — view/edit/delete
6. **Try-on studio** — avatar canvas; tap garments from bottom drawer to layer; drag/pinch/rotate (react-native-gesture-handler + reanimated); save as outfit
7. **Outfits** — saved looks gallery; open re-loads layers onto avatar
8. **Profile/settings** — change body type, sign out

## Build phases
**Phase A (Sonnet agent 1):** ✅ DONE (2026-07-04) — Expo Router nav, email-OTP auth, onboarding, wardrobe CRUD + garment detail, signed-URL image loading, profile screen, `supabase/schema.sql`.

**Phase B (Sonnet agent 2):** ✅ DONE (2026-07-04) — 6 SVG avatars + BodyTypePicker, try-on studio (drag/pinch/rotate layers, anchor zones, 300×600 viewBox coord system), outfits API/store/gallery.

**Backend:** ✅ Supabase project `wardrobe-app` (tmldopeuctftnteerxjg, us-east-1, $10/mo) provisioned; schema + RLS + private `garments` bucket applied; `.env` written. Enable email OTP in Supabase Auth settings if not on by default.

**Review & fixes (2026-07-04, session 2):** ✅ Full code review + backend verification done. Backend confirmed live and matching schema (tables, enums, RLS, signup trigger, private `garments` bucket, 4 storage policies). Fixed:
1. **Onboarding redirect loop** — root layout never refetched the profile after onboarding saved `body_type`, so the auth gate bounced users back to `/onboarding` forever. Profile now lives in `useAuthStore`; onboarding/profile screens update it directly.
2. **Try-on gesture crash** — gesture-handler callbacks are worklets (UI thread); `GarmentLayer` called JS props directly, which throws at runtime. Now wrapped in `runOnJS`.
3. **Layer/avatar misalignment** — layers were positioned against the full canvas while the avatar floated centered. Both now share a fixed 260×520 stage so viewBox coords line up.
4. **Duplicate-garment save failure** — `outfit_items` PK is (outfit_id, garment_id); adding the same garment twice made saves fail. Duplicates now blocked in the studio and deduped in `createOutfit`.
5. **app.json referenced nonexistent `./assets/*.png`** (would break `expo start`) — removed; Expo defaults used.
6. **Wardrobe double-fetch** — redundant `useEffect` alongside `useFocusEffect` removed.

**SDK 54 upgrade (2026-07-04, session 2):** ✅ Upgraded from SDK 51 → 54 for current Expo Go. All deps pinned to SDK 54 bundled versions (RN 0.81.5, React 19.1.0, expo-router ~6.0.23, reanimated ~4.1.1 + react-native-worklets 0.5.1, gesture-handler ~2.28.0, zustand ^5, @types/react ~19.1, TS ~5.9.2). Code changes: removed manual reanimated babel plugin (babel-preset-expo handles worklets now); `useFocusEffect` now imported from expo-router (dropped direct @react-navigation/native dep); ImagePicker `MediaTypeOptions.Images` → `["images"]`; `newArchEnabled: true` in app.json (required by reanimated 4).

**Rebrand + body-metrics rework (2026-07-04, session 2):** ✅
- **Rebranded to wardrobeSpec** with a "tailor's studio" design system (`src/lib/theme.ts`): warm ivory bg #FAF7F2, warm ink #1C1814, terracotta accent #B4552D, serif display type (system Georgia/serif — no font loading), uppercase tracked labels, pill chips, bordered cards. All screens themed from this single file.
- **Body types → measurements**: onboarding now asks height + weight (imperial/metric toggle, stored metric) and a general build (slim / average / athletic / curvy / broad). DB migration `add_body_metrics_to_profiles` added `height_cm`, `weight_kg`, `build` (enum profile_build) to profiles; legacy `body_type` column kept but unused. Avatar silhouettes map from build, with a BMI-derived width scale (`buildWidthScale`) so the avatar reflects entered measurements; picker thumbnails react live. Auth gate now keys on `profile.build`.
- **iOS safe-area fix**: tab screens (Wardrobe/Try-On/Outfits/Profile) + onboarding now pad below the status bar via `useSafeAreaInsets` — headers no longer collide with the clock/battery.
- Profile screen rebuilt: view/edit measurements in either unit system, change build, sign out.

**Next steps:** restart with `npx expo start -c` (theme/route changes). Existing test accounts created before this change will be sent back through onboarding once (build is empty until entered). Known MVP limitation: re-saving a loaded outfit creates a new outfit rather than updating the original.

**Phase C (later):** background removal (on-device or API), AI photoreal try-on, outfit sharing, weather-based suggestions.

## Conventions for sub-agents
- TypeScript strict; feature folders under `src/features/*`
- All Supabase calls in `src/lib/api/*` — screens never import the client directly
- Env via `.env.example` (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY)
- No custom native modules — must run in Expo Go
