import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { apiPost } from "@/services/apiClient";

const LAST_TOKEN_KEY = "goocart.customer.push.token.v1";
const APP_TYPE = "customer";

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
 * Registers this device for push notifications (spec section 40) and hands
 * the token to the backend, which fans out through Expo's push service on
 * order/vendor/delivery events (see server/src/lib/push.ts).
 *
 * KNOWN LIMITATION: getExpoPushTokenAsync() needs an EAS project id, which
 * this repo does not have configured (no `expo.extra.eas.projectId` in
 * app.json — that requires running `eas init` against a real Expo account).
 * Until that's done this silently no-ops rather than throwing, so its
 * absence never breaks app start; the realtime socket channel still
 * delivers live updates while the app is open regardless.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators/emulators cannot receive push

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

type NotificationData = { type?: string; orderId?: string; status?: string };

function routeForNotification(data: NotificationData): void {
  if (!data.orderId) return;
  if (data.type === "ORDER_STATUS" && data.status === "DELIVERED") {
    router.push({ pathname: "/rating/[orderId]", params: { orderId: data.orderId } });
    return;
  }
  router.push("/(tabs)/activity");
}

/**
 * Wires up tap handling for background/killed-app notifications (the
 * foreground display itself is handled by setNotificationHandler above).
 * Call once from the root layout. Safe to call multiple times — Expo
 * de-dupes identical subscriptions per listener instance created here.
 */
export function initNotificationDeepLinking(): () => void {
  // expo-notifications' response APIs are native-only; calling them on web
  // throws synchronously and crashes the whole app root.
  if (Platform.OS === "web") return () => {};

  // App was launched by tapping a notification while fully closed.
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) routeForNotification((response.notification.request.content.data ?? {}) as NotificationData);
  });

  // App was backgrounded (not killed) when the notification was tapped.
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    routeForNotification((response.notification.request.content.data ?? {}) as NotificationData);
  });

  return () => subscription.remove();
}
