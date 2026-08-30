import { create } from "zustand";

export type RideLocation = { latitude: number; longitude: number; address: string };

type RideBookingState = {
  pickup: RideLocation | null;
  drop: RideLocation | null;
  setPickup: (loc: RideLocation) => void;
  setDrop: (loc: RideLocation) => void;
  reset: () => void;
};

// Holds the map-picked pickup/drop between the service booking screen and
// the location-picker screen it navigates to — expo-router has no built-in
// way to return a value from a pushed screen, so the picker writes here and
// the booking screen reads it back after router.back().
export const useRideBookingStore = create<RideBookingState>((set) => ({
  pickup: null,
  drop: null,
  setPickup: (loc) => set({ pickup: loc }),
  setDrop: (loc) => set({ drop: loc }),
  reset: () => set({ pickup: null, drop: null }),
}));
