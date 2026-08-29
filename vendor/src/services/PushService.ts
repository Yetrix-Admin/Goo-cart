import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { apiPost } from "@/services/apiClient";

const LAST_TOKEN_KEY = "goocart.vendor.push.token.v1";
const APP_TYPE = "vendor";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Registers this device for push notifications (spec section 40: "New
 * Order", "Order requires acceptance", "Delivery Partner assigned", etc).
 *
 * KNOWN LIMITATION: needs an EAS project id (`expo.extra.eas.projectId`),
 * which this repo does not have configured — run `eas init` to enable it.
 * Until then this silently no-ops; the realtime socket still delivers
 * updates live while the app is open.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
    if (!projectId) {
      console.log("[push] Skipping registration — no EAS projectId configured. Run `eas init` to enable push notifications.");
      return;
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      const result = await Notifications.requestPermissionsAsync();
      status = result.status;
    }
    if (status !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "default", importance: Notifications.AndroidImportance.DEFAULT });
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await apiPost("/api/v1/notifications/register-device", { token, platform: Platform.OS, appType: APP_TYPE });
    await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
  } catch (e) {
    console.log("[push] Registration failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

/** Called on logout so a signed-out device stops receiving this account's pushes. */
export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    if (token) await apiPost("/api/v1/notifications/unregister-device", { token });
    await AsyncStorage.removeItem(LAST_TOKEN_KEY);
  } catch (e) {
    console.log("[push] Unregister failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

type NotificationData = { type?: string; orderId?: string };

function routeForNotification(data: NotificationData): void {
  if (!data.orderId) return;
  router.push("/(tabs)/orders");
}

/**
 * Wires up tap handling for background/killed-app notifications (the
 * foreground display itself is handled by setNotificationHandler above).
 * Call once from the root layout.
 */
export function initNotificationDeepLinking(): () => void {
  // expo-notifications' response APIs are native-only; calling them on web
  // throws synchronously and crashes the whole app root.
  if (Platform.OS === "web") return () => {};

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) routeForNotification((response.notification.request.content.data ?? {}) as NotificationData);
  });

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    routeForNotification((response.notification.request.content.data ?? {}) as NotificationData);
  });

  return () => subscription.remove();
}
