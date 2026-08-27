import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { locationService } from "@/services/LocationService";

const STORAGE_KEY = "goocart.location.v1";

export type SelectedLocation = {
  label: string;
  city: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
};

export const DEMO_LOCATIONS: SelectedLocation[] = [
  { label: "Home", city: "Jangareddigudem", region: "Andhra Pradesh", latitude: 17.4362, longitude: 81.2661 },
  { label: "Work", city: "Vijayawada", region: "Andhra Pradesh", latitude: 16.5062, longitude: 80.648 },
];

type LocationState = {
  selected: SelectedLocation | null;
  hasHydrated: boolean;
  isResolving: boolean;
  hydrate: () => Promise<void>;
  resolveCurrentLocation: () => Promise<boolean>;
  chooseLocation: (location: SelectedLocation) => Promise<void>;
};

export const useLocationStore = create<LocationState>((set) => ({
  selected: null,
  hasHydrated: false,
  isResolving: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ selected: raw ? (JSON.parse(raw) as SelectedLocation) : null, hasHydrated: true });
    } catch {
      set({ selected: null, hasHydrated: true });
    }
  },
  resolveCurrentLocation: async () => {
    set({ isResolving: true });
    const resolved = await locationService.getCurrentLocation();
    set({ isResolving: false });
    if (!resolved) return false;
    const location: SelectedLocation = {
      label: "Current location",
      city: resolved.city,
      region: resolved.region,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    set({ selected: location });
    return true;
  },
  chooseLocation: async (location: SelectedLocation) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    set({ selected: location });
  },
}));
