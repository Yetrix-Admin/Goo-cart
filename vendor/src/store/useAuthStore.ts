import { create } from "zustand";
import { apiPost, markAuthReady, setAuthToken } from "@/services/apiClient";
import { registerForPushNotifications, unregisterPushToken } from "@/services/PushService";
import { disconnectSocket } from "@/services/socket";
import { clearLegacyUser, clearToken, migrateLegacyToken, readLegacyUser, readToken, writeLegacyUser, writeToken } from "@/services/SessionStorage";
import { useOrdersStore } from "@/store/useOrdersStore";
import { useVendorStore } from "@/store/useVendorStore";
import { VendorUser } from "@/types";

const VENDOR_ROLES = ["VENDOR_OWNER", "VENDOR_MANAGER", "VENDOR_STAFF"];

type AuthState = {
  user: VendorUser | null;
  token: string | null;
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  /** Every vendor account (owner or admin-created staff) signs in with the password admin set for them. */
  signIn: (email: string, password: string) => Promise<void>;
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
      await migrateLegacyToken();
      const [token, user] = await Promise.all([readToken(), readLegacyUser<VendorUser>()]);
      if (!token || !user) {
        set({ user: null, token: null, hasHydrated: true });
        return;
      }
      setAuthToken(token);
      set({ user, token, hasHydrated: true });
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

  logout: async () => {
    await unregisterPushToken();
    disconnectSocket();
    setAuthToken(null);
    await Promise.all([clearToken(), clearLegacyUser()]);
    useOrdersStore.getState().clear();
    useVendorStore.getState().clear();
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
  await writeToken(data.token);
  await writeLegacyUser(user);
  set({ user, token: data.token });
  void registerForPushNotifications();
}
