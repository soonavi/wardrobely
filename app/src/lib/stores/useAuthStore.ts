import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { ProfileRow } from "../database.types";

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  /** The current user's profile row (null until loaded / when signed out). */
  profile: ProfileRow | null;
  /** True once the profile fetch for the current session has settled. */
  profileLoaded: boolean;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  setProfile: (profile: ProfileRow | null) => void;
  setProfileLoaded: (loaded: boolean) => void;
}

/**
 * Holds the current Supabase auth session and profile so screens/layouts
 * can react to sign-in/sign-out and profile changes (e.g. onboarding
 * setting measurements/build) without each one subscribing to Supabase directly.
 * Populated by the root layout via src/lib/api/auth.ts; screens that
 * mutate the profile (onboarding, profile settings) must call setProfile
 * so the root layout's auth gate sees the change immediately.
 */
export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isLoading: true,
  profile: null,
  profileLoaded: false,
  setSession: (session) => set({ session }),
  setLoading: (isLoading) => set({ isLoading }),
  setProfile: (profile) => set({ profile }),
  setProfileLoaded: (profileLoaded) => set({ profileLoaded }),
}));
