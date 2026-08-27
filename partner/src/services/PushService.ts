import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { apiPost } from "@/services/apiClient";

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
 * Delivery Available", "Delivery cancelled", "Delivery reassigned").
 *
 * KNOWN LIMITATION: needs an EAS project id (`expo.extra.eas.projectId`),
 * which this repo does not have configured — run `eas init` to enable it.
 * Until then this silently no-ops; the realtime socket still delivers
 * offers live while the app is open.
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
    await apiPost("/api/v1/notifications/register-device", { token, platform: Platform.OS });
  } catch (e) {
    console.log("[push] Registration failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}
