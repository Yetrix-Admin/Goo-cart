import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { colors } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { initNotificationDeepLinking } from "@/services/PushService";

export default function RootLayout() {
  // Hydrated once at the root so a persisted session survives a cold start on
  // any route, not just the splash screen.
  useEffect(() => {
    void useAuthStore.getState().hydrate();
    return initNotificationDeepLinking();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {/* No explicit Stack.Screen children: every file under app/ is
            auto-registered by expo-router with these shared options. Listing
            screens by hand risks silent mismatches for nested routes (e.g.
            "menu" vs the real route name "menu/index"). */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
