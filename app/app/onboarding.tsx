import React from "react";
import { CharacterCreatorScreen } from "../src/features/creator/CharacterCreatorScreen";

/**
 * PRODUCT PIVOT: onboarding no longer collects a photo or tape
 * measurements — new users build their avatar directly in the character
 * creator. `onboarding` tells the creator to replace the whole stack into
 * the tabs on Save (instead of navigating back), since there's nowhere to
 * go back to yet. Save also syncs profile.build from the chosen body
 * type, which is what satisfies app/_layout.tsx's `profile.build` gate
 * and lets the user through to (tabs).
 *
 * The old measurements-based OnboardingScreen has been deleted, not just
 * unrouted — it sat unused in src/features/onboarding/ for long enough to
 * start reading as a live alternative. If a measurements-based flow is ever
 * reintroduced, recover it from git history rather than assuming it still
 * reflects the current profiles schema.
 */
export default function Onboarding() {
  return <CharacterCreatorScreen onboarding />;
}
