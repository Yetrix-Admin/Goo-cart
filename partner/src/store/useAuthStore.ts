import { create } from "zustand";
import { apiPost, markAuthReady, setAuthToken } from "@/services/apiClient";
import { stopLocationTracking } from "@/services/LocationTracker";
import { disconnectSocket } from "@/services/socket";
import { registerForPushNotifications, unregisterPushToken } from "@/services/PushService";
import { clearLegacyUser, clearToken, migrateLegacyToken, readLegacyUser, readToken, writeLegacyUser, writeToken } from "@/services/SessionStorage";
import { useOrdersStore } from "@/store/useOrdersStore";
import { PartnerUser } from "@/types";

type AuthState = {
  user: PartnerUser | null;
  token: string | null;
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  /** Every partner account (admin-created) signs in with the password admin set for them. */
  signIn: (email: string, password: string) => Promise<void>;
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
      await migrateLegacyToken();
      const [token, user] = await Promise.all([readToken(), readLegacyUser<PartnerUser>()]);
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
    stopLocationTracking();
    disconnectSocket();
    setAuthToken(null);
    await Promise.all([clearToken(), clearLegacyUser()]);
    useOrdersStore.getState().clear();
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
  await writeToken(data.token);
  await writeLegacyUser(user);
  set({ user, token: data.token });
  void registerForPushNotifications();
}
