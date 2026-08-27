import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { seedAddresses } from "@/data/addresses";
import { Address } from "@/types";

const STORAGE_KEY = "goocart.addresses.v1";

type AddressState = {
  addresses: Address[];
  selectedId: string | null;
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  select: (id: string) => void;
  addAddress: (address: Address) => void;
  selected: () => Address | null;
};

export const useAddressStore = create<AddressState>((set, get) => ({
  addresses: seedAddresses,
  selectedId: seedAddresses[0]?.id ?? null,
  hasHydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { addresses: Address[]; selectedId: string | null };
        set({ addresses: parsed.addresses.length ? parsed.addresses : seedAddresses, selectedId: parsed.selectedId, hasHydrated: true });
        return;
      }
      set({ hasHydrated: true });
    } catch {
      set({ hasHydrated: true });
    }
  },
  select: (id) => {
    set({ selectedId: id });
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ addresses: get().addresses, selectedId: id }));
  },
  addAddress: (address) => {
    const addresses = [...get().addresses, address];
    set({ addresses, selectedId: address.id });
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ addresses, selectedId: address.id }));
  },
  selected: () => get().addresses.find((a) => a.id === get().selectedId) ?? get().addresses[0] ?? null,
}));

export function useSelectedAddress(): Address | null {
  const addresses = useAddressStore((s) => s.addresses);
  const selectedId = useAddressStore((s) => s.selectedId);
  return addresses.find((a) => a.id === selectedId) ?? addresses[0] ?? null;
}
