import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { colors } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocationStore } from "@/store/useLocationStore";
import { useFavoritesStore } from "@/store/useFavoritesStore";
import { useAddressStore } from "@/store/useAddressStore";
import { useRatingStore } from "@/store/useRatingStore";
import { useCatalogStore } from "@/store/useCatalogStore";
import { usePricingStore } from "@/store/usePricingStore";
import { useCartStore } from "@/store/useCartStore";

export default function RootLayout() {
  // Hydrated once at the root so persisted state survives a cold start on any
  // route — not just the splash screen — including web deep links and
  // Android back-stack restoration that can mount a nested route directly.
  useEffect(() => {
    void useAuthStore.getState().hydrate();
    void useLocationStore.getState().hydrate();
    void useFavoritesStore.getState().hydrate();
    void useAddressStore.getState().hydrate();
    void useRatingStore.getState().hydrate();
    void useCatalogStore.getState().load();
    void usePricingStore.getState().load();
    void useCartStore.getState().hydrate();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {/* No explicit Stack.Screen children: every file under app/ is
            auto-registered by expo-router with these shared options. Listing
            screens by hand risks silent mismatches for nested routes (e.g.
            "food" vs the real route name "food/index"). */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
