import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { apiPost, ApiError, markAuthReady, setAuthToken } from "@/services/apiClient";
import { registerForPushNotifications } from "@/services/PushService";
import { VendorUser } from "@/types";

const STORAGE_KEY = "goocart.vendor.auth.v1";
const VENDOR_ROLES = ["VENDOR_OWNER", "VENDOR_MANAGER", "VENDOR_STAFF"];

export type OtpPurpose = "LOGIN" | "SIGNUP";

type StoredAuth = { token: string; user: VendorUser };

type AuthState = {
  user: VendorUser | null;
  token: string | null;
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  /** Legacy path for the original owner accounts created before admin-managed vendor users existed. */
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * The normal path for anyone admin created via Admin → Vendors → Vendor
   * Users: they have no password, only an OTP sent to the email/phone the
   * admin registered for them (spec section 13).
   */
  requestOtp: (identifier: string) => Promise<{ delivered: boolean; message: string }>;
  verifyOtp: (identifier: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

type TokenResponse = {
  token: string;
  user: { id: string; email: string; name: string; role: string; status: string; vendorId: string | null; vendorPermissions: string[]; staffTitle: string | null };
};

// This app is for restaurant owners/managers/staff only — a customer or
// delivery partner account that signs in here would otherwise see an empty,
// meaningless dashboard (no restaurant or menu ever matches a role that
// isn't a vendor role server-side).
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
        throw new Error("No vendor account found for this email/number. Ask your admin to create one first.");
      }
      throw e;
    }
  },

  verifyOtp: async (identifier, code) => {
    const data = await apiPost<TokenResponse>("/api/v1/auth/otp/verify", { identifier, purpose: "LOGIN", code });
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
    throw new WrongRoleError("This app is for restaurant owners, managers and staff. Ask an admin to link your account, or sign in with a vendor account.");
  }
  const user: VendorUser = {
    id: data.user.id,
    name: data.user.name,
    email: data.user.email,
    role: data.user.role,
    vendorId: data.user.vendorId,
    permissions: data.user.vendorPermissions ?? [],
    staffTitle: data.user.staffTitle,
  };
  setAuthToken(data.token);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ token: data.token, user } satisfies StoredAuth));
  set({ user, token: data.token });
  void registerForPushNotifications();
}
