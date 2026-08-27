import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { apiPost, markAuthReady, setAuthToken } from "@/services/apiClient";
import { VendorUser } from "@/types";

const STORAGE_KEY = "goocart.vendor.auth.v1";
const VENDOR_ROLES = ["VENDOR_OWNER", "VENDOR_MANAGER"];

type StoredAuth = { token: string; user: VendorUser };

type AuthState = {
  user: VendorUser | null;
  token: string | null;
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

type TokenResponse = { token: string; user: { id: string; email: string; name: string; role: string; status: string } };

// This app is for restaurant owners/managers only — a customer or delivery
// partner account that signs in here would otherwise see an empty,
// meaningless dashboard (no restaurant or menu ever matches a role that
// isn't VENDOR_OWNER/VENDOR_MANAGER server-side).
class WrongRoleError extends Error {}

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
    } catch {
      set({ user: null, token: null, hasHydrated: true });
    } finally {
      // Unblocks queued API calls whether or not a session was found.
      markAuthReady();
    }
  },

  signUp: async (email, password, name) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/token", { mode: "signup", email, password, name });
    await persist(data, set);
  },

  signIn: async (email, password) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/token", { mode: "login", email, password });
    await persist(data, set);
  },

  logout: async () => {
    setAuthToken(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
    set({ user: null, token: null });
  },
}));

async function persist(data: TokenResponse, set: (partial: Partial<AuthState>) => void) {
  if (!VENDOR_ROLES.includes(data.user.role)) {
    setAuthToken(null);
    throw new WrongRoleError("This app is for restaurant owners and managers. Ask an admin to link your account, or sign in with a vendor account.");
  }
  const user: VendorUser = { id: data.user.id, name: data.user.name, email: data.user.email, role: data.user.role };
  setAuthToken(data.token);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ token: data.token, user } satisfies StoredAuth));
  set({ user, token: data.token });
}
