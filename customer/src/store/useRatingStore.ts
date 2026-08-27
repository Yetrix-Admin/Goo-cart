import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { OrderRating } from "@/types";

const STORAGE_KEY = "goocart.ratings.v1";

type RatingState = {
  ratings: OrderRating[];
  hasHydrated: boolean;
  hydrate: () => Promise<void>;
  submitRating: (rating: OrderRating) => Promise<void>;
  ratingFor: (orderId: string) => OrderRating | undefined;
};

export const useRatingStore = create<RatingState>((set, get) => ({
  ratings: [],
  hasHydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ ratings: raw ? JSON.parse(raw) : [], hasHydrated: true });
    } catch {
      set({ ratings: [], hasHydrated: true });
    }
  },
  submitRating: async (rating) => {
    const ratings = [...get().ratings.filter((r) => r.orderId !== rating.orderId), rating];
    set({ ratings });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
  },
  ratingFor: (orderId) => get().ratings.find((r) => r.orderId === orderId),
}));
