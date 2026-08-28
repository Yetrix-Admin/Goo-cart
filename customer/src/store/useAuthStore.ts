import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { apiPost, markAuthReady, setAuthToken } from "@/services/apiClient";
import { useAddressStore } from "@/store/useAddressStore";
import { registerForPushNotifications } from "@/services/PushService";
import { CustomerUser } from "@/types";

const STORAGE_KEY = "goocart.auth.v2";

type StoredAuth = { token: string; user: CustomerUser };

type AuthState = {
  user: CustomerUser | null;
  token: string | null;
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  signUp: (input: { email: string; phone: string; username: string; password: string; name: string }) => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

type TokenResponse = { token: string; user: { id: string; email: string; username?: string | null; name: string; role: string; status: string; phone?: string | null } };

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  hasHydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        set({ user: null, token: null, hasHydrated: true });
        return;
      }
      const stored = JSON.parse(raw) as StoredAuth;
      setAuthToken(stored.token);
      set({ user: stored.user, token: stored.token, hasHydrated: true });
      void useAddressStore.getState().refresh();
      void registerForPushNotifications();
    } catch {
      set({ user: null, token: null, hasHydrated: true });
    } finally {
      // Unblocks queued API calls whether or not a session was found.
      markAuthReady();
    }
  },

  signUp: async (input) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/token", { mode: "signup", ...input });
    await persist(data, set);
  },

  signIn: async (identifier, password) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/token", { mode: "login", identifier, password });
    await persist(data, set);
  },

  logout: async () => {
    setAuthToken(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
    set({ user: null, token: null });
    useAddressStore.getState().reset();
  },
}));

async function persist(data: TokenResponse, set: (partial: Partial<AuthState>) => void) {
  const user: CustomerUser = {
    id: data.user.id,
    name: data.user.name,
    email: data.user.email,
    username: data.user.username ?? null,
    role: data.user.role,
    phone: data.user.phone ?? "",
    isDemo: false,
  };
  setAuthToken(data.token);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ token: data.token, user } satisfies StoredAuth));
  set({ user, token: data.token });
  // A brand-new signup has no addresses yet, but re-fetching is still
  // correct (and cheap) — it clears any stale guest-session cache.
  void useAddressStore.getState().refresh();
  void registerForPushNotifications();
}
