import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/apiClient";
import { Address } from "@/types";

// A signed-out cache so the last-known list still renders instantly on
// launch; the server (see server/src/routes/customer.ts) is the source of
// truth the moment the customer is authenticated.
const CACHE_KEY = "goocart.addresses.cache.v1";

type ServerAddress = {
  id: string;
  label: "Home" | "Work" | "Other";
  house: string;
  street: string;
  landmark: string;
  area: string;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
  contactName: string;
  contactPhone: string;
  isDefault: boolean;
};

// The server has no separate "building" or "state" field (spec section 6
// lists House/Street/Landmark/Area/City/Pincode/Lat/Lng/Label) — building is
// folded into street, and state isn't persisted server-side since delivery
// assignment relies on lat/lng, not the address text.
function fromServer(a: ServerAddress): Address {
  return {
    id: a.id,
    label: a.label,
    line1: a.house,
    street: a.street || undefined,
    landmark: a.landmark || undefined,
    city: a.city,
    state: a.area || "",
    pincode: a.pincode,
    contactName: a.contactName,
    contactPhone: a.contactPhone,
    latitude: a.latitude,
    longitude: a.longitude,
  };
}

function toServerPayload(a: Omit<Address, "id">) {
  return {
    label: a.label,
    house: a.line1,
    street: [a.building, a.street].filter(Boolean).join(", "),
    landmark: a.landmark ?? "",
    area: a.state ?? "",
    city: a.city,
    pincode: a.pincode,
    latitude: a.latitude,
    longitude: a.longitude,
    contactName: a.contactName,
    contactPhone: a.contactPhone,
  };
}

type AddressState = {
  addresses: Address[];
  selectedId: string | null;
  hasHydrated: boolean;
  loading: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string) => void;
  addAddress: (address: Omit<Address, "id">) => Promise<void>;
  updateAddress: (id: string, patch: Partial<Omit<Address, "id">>) => Promise<void>;
  removeAddress: (id: string) => Promise<void>;
  selected: () => Address | null;
  reset: () => void;
};

function cache(addresses: Address[], selectedId: string | null) {
  void AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ addresses, selectedId }));
}

export const useAddressStore = create<AddressState>((set, get) => ({
  addresses: [],
  selectedId: null,
  hasHydrated: false,
  loading: false,
  error: null,

  // Instant paint from the last-known cache, then refresh() pulls the real
  // list once the auth token is ready. Called once from the root layout.
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { addresses: Address[]; selectedId: string | null };
        set({ addresses: parsed.addresses ?? [], selectedId: parsed.selectedId ?? null });
      }
    } catch {
      // Corrupt cache is discarded rather than blocking app start.
    } finally {
      set({ hasHydrated: true });
    }
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiGet<{ addresses: ServerAddress[] }>("/api/v1/customer/addresses");
      const addresses = data.addresses.map(fromServer);
      const defaultServerAddress = data.addresses.find((s) => s.isDefault);
      const selectedId = defaultServerAddress?.id ?? addresses[0]?.id ?? null;
      set({ addresses, selectedId, loading: false });
      cache(addresses, selectedId);
    } catch (e) {
      // A guest (no session) or an offline device keeps whatever was cached
      // rather than wiping the list to empty.
      set({ loading: false, error: e instanceof Error ? e.message : "Could not load addresses" });
    }
  },

  select: (id) => {
    set({ selectedId: id });
    cache(get().addresses, id);
  },

  addAddress: async (address) => {
    const data = await apiPost<{ address: ServerAddress }>("/api/v1/customer/addresses", toServerPayload(address));
    const created = fromServer(data.address);
    const addresses = [...get().addresses, created];
    set({ addresses, selectedId: created.id });
    cache(addresses, created.id);
  },

  updateAddress: async (id, patch) => {
    const payload: Record<string, unknown> = {};
    if (patch.label !== undefined) payload.label = patch.label;
    if (patch.line1 !== undefined) payload.house = patch.line1;
    if (patch.street !== undefined || patch.building !== undefined) payload.street = [patch.building, patch.street].filter(Boolean).join(", ");
    if (patch.landmark !== undefined) payload.landmark = patch.landmark;
    if (patch.city !== undefined) payload.city = patch.city;
    if (patch.pincode !== undefined) payload.pincode = patch.pincode;
    if (patch.latitude !== undefined) payload.latitude = patch.latitude;
    if (patch.longitude !== undefined) payload.longitude = patch.longitude;
    if (patch.contactName !== undefined) payload.contactName = patch.contactName;
    if (patch.contactPhone !== undefined) payload.contactPhone = patch.contactPhone;

    const data = await apiPatch<{ address: ServerAddress }>(`/api/v1/customer/addresses/${id}`, payload);
    const updated = fromServer(data.address);
    const addresses = get().addresses.map((a) => (a.id === id ? updated : a));
    set({ addresses });
    cache(addresses, get().selectedId);
  },

  removeAddress: async (id) => {
    await apiDelete(`/api/v1/customer/addresses/${id}`);
    const addresses = get().addresses.filter((a) => a.id !== id);
    const selectedId = get().selectedId === id ? addresses[0]?.id ?? null : get().selectedId;
    set({ addresses, selectedId });
    cache(addresses, selectedId);
  },

  selected: () => get().addresses.find((a) => a.id === get().selectedId) ?? get().addresses[0] ?? null,

  // Called on logout — a guest has no addresses of their own to show.
  reset: () => {
    set({ addresses: [], selectedId: null });
    void AsyncStorage.removeItem(CACHE_KEY);
  },
}));

export function useSelectedAddress(): Address | null {
  const addresses = useAddressStore((s) => s.addresses);
  const selectedId = useAddressStore((s) => s.selectedId);
  return addresses.find((a) => a.id === selectedId) ?? addresses[0] ?? null;
}
