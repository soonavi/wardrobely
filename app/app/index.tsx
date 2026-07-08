import { Redirect } from "expo-router";

/**
 * Root index route. Expo Router lands on "/" at startup; without this file
 * it shows "Unmatched Route". We redirect into the tabs — the root layout's
 * auth gate then re-routes to sign-in or onboarding as needed.
 */
export default function Index() {
  return <Redirect href="/(tabs)/wardrobe" />;
}
