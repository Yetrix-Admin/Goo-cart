import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { DeviceToken, Notification } from "../models.js";

const expo = new Expo();

/**
 * Best-effort push to every device a user is logged into. Failures are
 * logged, never thrown — a push provider outage must not fail the order
 * action that triggered the notification. The same message is also persisted
 * to the Notification collection so the app (and admin) have an in-app
 * history independent of whether the push itself was delivered.
 */
export async function notifyUser(userId: unknown, title: string, body: string, data: Record<string, unknown> = {}, channel = "GENERAL"): Promise<void> {
  try {
    await Notification.create({ userId, title, body, data, channel });
  } catch (e) {
    console.error("Failed to persist notification:", e instanceof Error ? e.message : e);
  }

  try {
    const tokens = await DeviceToken.find({ userId }).lean();
    const messages: ExpoPushMessage[] = [];
    for (const t of tokens) {
      if (!Expo.isExpoPushToken(t.token)) continue;
      messages.push({ to: t.token, sound: "default", title, body, data });
    }
    if (!messages.length) return;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      for (const receipt of receipts) {
        if (receipt.status === "error") console.error("Expo push error:", receipt.message, receipt.details);
      }
    }
  } catch (e) {
    console.error("Push delivery failed:", e instanceof Error ? e.message : e);
  }
}

export async function notifyUsers(userIds: unknown[], title: string, body: string, data: Record<string, unknown> = {}, channel = "GENERAL"): Promise<void> {
  await Promise.all(userIds.map((id) => notifyUser(id, title, body, data, channel)));
}
