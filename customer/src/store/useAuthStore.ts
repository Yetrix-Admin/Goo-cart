import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { apiPost, ApiError, markAuthReady, setAuthToken } from "@/services/apiClient";
import { useAddressStore } from "@/store/useAddressStore";
import { registerForPushNotifications } from "@/services/PushService";
import { CustomerUser } from "@/types";

const STORAGE_KEY = "goocart.auth.v2";

type StoredAuth = { token: string; user: CustomerUser };

export type OtpPurpose = "LOGIN" | "SIGNUP";

type AuthState = {
  user: CustomerUser | null;
  token: string | null;
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Sends a code without asking the caller whether this is a new or
   * returning account (spec section 4: "automatically determine whether the
   * user already exists"). It tries LOGIN first and falls back to SIGNUP
   * when the backend reports no account exists yet, returning whichever
   * purpose actually got a code sent so the UI knows whether to also collect
   * a name before verifying.
   */
  requestOtp: (identifier: string) => Promise<{ purpose: OtpPurpose; delivered: boolean; message: string }>;
  verifyOtp: (identifier: string, purpose: OtpPurpose, code: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
};

type TokenResponse = { token: string; user: { id: string; email: string; name: string; role: string; status: string; phone?: string | null } };
type OtpRequestResponse = { identifier: string; delivered: boolean };

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

  signUp: async (email, password, name) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/token", { mode: "signup", email, password, name });
    await persist(data, set);
  },

  signIn: async (email, password) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/token", { mode: "login", email, password });
    await persist(data, set);
  },

  requestOtp: async (identifier) => {
    try {
      const data = await apiPost<OtpRequestResponse>("/api/v1/auth/otp/request", { identifier, purpose: "LOGIN" });
      return { purpose: "LOGIN" as const, delivered: data.delivered, message: data.delivered ? "Code sent" : "Delivery is not configured — check the server log for the code" };
    } catch (e) {
      if (e instanceof ApiError && e.code === "ACCOUNT_NOT_FOUND") {
        const data = await apiPost<OtpRequestResponse>("/api/v1/auth/otp/request", { identifier, purpose: "SIGNUP" });
        return { purpose: "SIGNUP" as const, delivered: data.delivered, message: data.delivered ? "Code sent" : "Delivery is not configured — check the server log for the code" };
      }
      throw e;
    }
  },

  verifyOtp: async (identifier, purpose, code, name) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/otp/verify", { identifier, purpose, code, name });
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
