import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { apiPost, ApiError, markAuthReady, setAuthToken } from "@/services/apiClient";
import { stopLocationTracking } from "@/services/LocationTracker";
import { disconnectSocket } from "@/services/socket";
import { registerForPushNotifications } from "@/services/PushService";
import { PartnerUser } from "@/types";

const STORAGE_KEY = "goocart.partner.auth.v1";

type StoredAuth = { token: string; user: PartnerUser };

type AuthState = {
  user: PartnerUser | null;
  token: string | null;
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  /** Legacy path for accounts created before OTP-only onboarding. */
  signIn: (email: string, password: string) => Promise<void>;
  /** The normal path: an admin creates the account, the partner signs in with an OTP (spec section 13, applied the same way to Delivery Partners). */
  requestOtp: (identifier: string) => Promise<{ delivered: boolean; message: string }>;
  verifyOtp: (identifier: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

type TokenResponse = { token: string; user: { id: string; email: string; name: string; role: string; status: string; partnerApprovalStatus: string | null } };

// This app is for delivery partners only — a customer or vendor account that
// signs in here would otherwise see an empty, meaningless dashboard (no
// orders ever match a role that isn't DELIVERY_PARTNER server-side).
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
      void registerForPushNotifications();
    } catch {
      set({ user: null, token: null, hasHydrated: true });
    } finally {
      // Unblocks queued API calls whether or not a session was found.
      markAuthReady();
    }
  },

  signIn: async (email, password) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/token", { mode: "login", email, password });
    await persist(data, set);
  },

  requestOtp: async (identifier) => {
    try {
      const data = await apiPost<{ delivered: boolean }>("/api/v1/auth/otp/request", { identifier, purpose: "LOGIN" });
      return { delivered: data.delivered, message: data.delivered ? "Code sent" : "Delivery is not configured — check the server log for the code" };
    } catch (e) {
      if (e instanceof ApiError && e.code === "ACCOUNT_NOT_FOUND") {
        throw new Error("No delivery partner account found for this email/number. Ask your admin to create one first.");
      }
      throw e;
    }
  },

  verifyOtp: async (identifier, code) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/otp/verify", { identifier, purpose: "LOGIN", code });
    await persist(data, set);
  },

  logout: async () => {
    stopLocationTracking();
    disconnectSocket();
    setAuthToken(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
    set({ user: null, token: null });
  },
}));

async function persist(data: TokenResponse, set: (partial: Partial<AuthState>) => void) {
  if (data.user.role !== "DELIVERY_PARTNER") {
    setAuthToken(null);
    throw new WrongRoleError("This app is for delivery partners. Ask an admin to link your account, or sign in with a partner account.");
  }
  const user: PartnerUser = {
    id: data.user.id,
    name: data.user.name,
    email: data.user.email,
    role: data.user.role,
    partnerApprovalStatus: (data.user.partnerApprovalStatus as PartnerUser["partnerApprovalStatus"]) ?? "APPROVED",
  };
  setAuthToken(data.token);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ token: data.token, user } satisfies StoredAuth));
  set({ user, token: data.token });
  void registerForPushNotifications();
}
