import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack, useRouter, useSegments } from "expo-router";
import { getSession, onAuthStateChange } from "../src/lib/api/auth";
import { getProfile } from "../src/lib/api/profiles";
import { useAuthStore } from "../src/lib/stores/useAuthStore";

/**
 * Root layout: wires up the Supabase auth session into useAuthStore, then
 * gates navigation based on session + profile state:
 *   - no session          -> (auth)/sign-in
 *   - session, no build   -> /onboarding
 *   - session + build     -> (tabs)/*
 *
 * The profile lives in useAuthStore so screens that change it (onboarding,
 * profile settings) update it directly and this gate reacts immediately —
 * no refetch loop between /onboarding and the tabs.
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
    if (isLoading || !profileLoaded) return;

    const segmentsRoot = segments[0];
    const inAuthGroup = segmentsRoot === "(auth)";
    const inOnboarding = segmentsRoot === "onboarding";

    if (!session) {
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
  }, [session, profile, profileLoaded, isLoading, segments, router]);

  if (isLoading || !profileLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
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
      </Stack>
    </GestureHandlerRootView>
  );
}
