import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import { getSession, onAuthStateChange } from "../src/lib/api/auth";
import { getProfile } from "../src/lib/api/profiles";
import { useAuthStore } from "../src/lib/stores/useAuthStore";
import { colors, fonts } from "../src/lib/theme";

/**
 * Root layout: wires up the Supabase auth session into useAuthStore, then
 * gates navigation based on session + profile state:
 *   - no session               -> (auth)/sign-in
 *   - session, no age verdict  -> (auth)/sign-in  (the 13+ age gate)
 *   - session, no build        -> /onboarding
 *   - session + verdict + build-> (tabs)/*
 *
 * The profile lives in useAuthStore so screens that change it (onboarding,
 * profile settings, the age gate) update it directly and this gate reacts
 * immediately — no refetch loop between /onboarding and the tabs.
 */
export default function RootLayout() {
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);
  const profile = useAuthStore((s) => s.profile);
  const profileLoaded = useAuthStore((s) => s.profileLoaded);
  const setSession = useAuthStore((s) => s.setSession);
  const setLoading = useAuthStore((s) => s.setLoading);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setProfileLoaded = useAuthStore((s) => s.setProfileLoaded);

  const router = useRouter();
  const segments = useSegments();

  const [fontsLoaded] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  // Bootstrap session + subscribe to auth changes.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const initialSession = await getSession();
      setSession(initialSession);
      setLoading(false);

      unsubscribe = onAuthStateChange((next) => {
        setSession(next);
      });
    })();

    return () => {
      unsubscribe?.();
    };
  }, [setSession, setLoading]);

  // Load the profile whenever the session's user changes.
  useEffect(() => {
    if (!session?.user.id) {
      setProfile(null);
      setProfileLoaded(true);
      return;
    }

    setProfileLoaded(false);
    getProfile(session.user.id).then(({ data }) => {
      setProfile(data);
      setProfileLoaded(true);
    });
  }, [session?.user.id, setProfile, setProfileLoaded]);

  useEffect(() => {
    if (isLoading || !profileLoaded || !fontsLoaded) return;

    const segmentsRoot = segments[0];
    const inAuthGroup = segmentsRoot === "(auth)";
    const inOnboarding = segmentsRoot === "onboarding";

    if (!session) {
      if (!inAuthGroup) {
        router.replace("/(auth)/sign-in");
      }
      return;
    }

    // Minimum account age of 13 — LAUNCH_CHECKLIST.md §1, and the control
    // legal/PRIVACY_POLICY.md §12 already tells users we run. This sits ahead
    // of the build check because it is the one gate that has to hold before
    // the account does anything at all, including build an avatar.
    //
    // The destination is the sign-in screen rather than a route of its own,
    // and that is deliberate: for a brand-new signup the age question is
    // asked *before* the email step (requesting an OTP creates the account,
    // so a rejected under-13 must never get that far), which means the gate
    // already lives inside (auth). Sending an already-signed-in user back to
    // the same screen keeps one implementation of the question instead of two
    // that can drift, and SignInScreen renders the age step on its own — with
    // a "not you? sign out" link — when it sees a session with no verdict.
    //
    // WHO LANDS HERE WITH A SESSION: every account created before the gate
    // shipped. 006_age_gate.sql deliberately did not backfill them, because a
    // compliance control that reports success for checks it never ran is
    // worse than a missing one. They answer once and never see this again.
    //
    // FAILS CLOSED. A null profile — a fetch that errored, not just an
    // unverified user — also lands here rather than falling through to
    // /onboarding as it used to. Both are stuck states; for an age gate the
    // safe one is the gate.
    if (!profile?.age_verified_on) {
      if (!inAuthGroup) {
        router.replace("/(auth)/sign-in");
      }
      return;
    }

    if (!profile?.build) {
      if (!inOnboarding) {
        router.replace("/onboarding");
      }
      return;
    }

    if (inAuthGroup || inOnboarding) {
      router.replace("/(tabs)/wardrobe");
    }
    // `fontsLoaded` is in the deps because line 1 of this effect guards on it.
    // Without it, a cold launch where the session and profile resolve BEFORE
    // the font assets would run this effect once, bail at the guard, and never
    // re-run — stranding the user on the initial route with no redirect. The
    // spinner below hides it until fonts land, so the symptom is "app opens on
    // the wrong screen", with nothing on screen to suggest routing was skipped.
  }, [session, profile, profileLoaded, isLoading, fontsLoaded, segments, router]);

  if (isLoading || !profileLoaded || !fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: fonts.display, color: colors.ink },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen
          name="add-garment"
          options={{ presentation: "modal", headerShown: true, title: "Add Garment" }}
        />
        <Stack.Screen
          name="garment/[id]"
          options={{ headerShown: true, title: "Garment" }}
        />
        {/*
          Character creator (PRODUCT PIVOT) — build/edit your 3D-avatar
          appearance customization (skin, face, hair, body, etc). Used
          both embedded as the onboarding step (app/onboarding.tsx) and
          reachable afterwards from the Profile tab's "Edit your
          character" button.
        */}
        <Stack.Screen
          name="create-avatar"
          options={{ headerShown: false }}
        />
        {/*
          Procedural stylized 3D character viewer — renders <CharacterAvatar>
          (built entirely from three.js primitives, no external 3D asset)
          from the signed-in user's saved customization. Reachable from the
          character creator's "Preview in 3D" button and the Profile tab's
          "View your character in 3D" entry. Headers hidden: the screen
          draws its own back button/legend overlay on top of the <Canvas>.
        */}
        <Stack.Screen name="character" options={{ headerShown: false }} />
        {/*
          Shop / affiliate commerce (AFFILIATE_SYSTEM.md). Brand catalog
          items a user can try on their avatar and then buy through a
          tracked link. The Shop *browse* surface is a tab; these are the
          screens pushed on top of it.

          Headers stay hidden because each of these screens draws its own
          back row — same convention as `character` above. The alternative
          (headerShown: true) would double up on the in-screen header.
        */}
        <Stack.Screen name="product/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="brand/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="wishlist" options={{ headerShown: false }} />
        <Stack.Screen name="orders" options={{ headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
