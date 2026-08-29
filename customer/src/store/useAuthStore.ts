import { create } from "zustand";
import { apiPost, markAuthReady, setAuthToken } from "@/services/apiClient";
import { useAddressStore } from "@/store/useAddressStore";
import { useCartStore } from "@/store/useCartStore";
import { useOrderStore } from "@/store/useOrderStore";
import { registerForPushNotifications, unregisterPushToken } from "@/services/PushService";
import { disconnectSocket } from "@/services/socket";
import { clearLegacyUser, clearToken, migrateLegacyToken, readLegacyUser, readToken, writeLegacyUser, writeToken } from "@/services/SessionStorage";
import { CustomerUser } from "@/types";

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
      await migrateLegacyToken();
      const [token, user] = await Promise.all([readToken(), readLegacyUser<CustomerUser>()]);
      if (!token || !user) {
        set({ user: null, token: null, hasHydrated: true });
        return;
      }
      setAuthToken(token);
      set({ user, token, hasHydrated: true });
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
    await unregisterPushToken();
    disconnectSocket();
    setAuthToken(null);
    await Promise.all([clearToken(), clearLegacyUser()]);
    useCartStore.getState().clear();
    useOrderStore.getState().clear();
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
  await writeToken(data.token);
  await writeLegacyUser(user);
  set({ user, token: data.token });
  // A brand-new signup has no addresses yet, but re-fetching is still
  // correct (and cheap) — it clears any stale guest-session cache.
  void useAddressStore.getState().refresh();
  void registerForPushNotifications();
}
