import * as Location from "expo-location";
import { apiPost } from "@/services/apiClient";

const UPDATE_INTERVAL_MS = 7000; // within the spec's 5-10s window
const MIN_DISTANCE_METERS = 15; // avoid spamming updates while stationary

let subscription: Location.LocationSubscription | null = null;

/**
 * Starts pushing this device's real GPS position to the backend while a
 * delivery is active (spec section 32). Nothing here fabricates or
 * interpolates a position — every point sent is a genuine fix from the
 * device's location hardware, and the server only relays it onward.
 */
export async function startLocationTracking(): Promise<{ ok: boolean; reason?: string }> {
  if (subscription) return { ok: true };

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return { ok: false, reason: "Location permission is required to deliver orders." };

  subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: UPDATE_INTERVAL_MS, distanceInterval: MIN_DISTANCE_METERS },
    (position) => {
      void apiPost("/api/v1/partner/location", {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
      }).catch(() => {
        // A dropped connection here shouldn't crash the delivery flow — the
        // next tick tries again.
      });
    },
  );
  return { ok: true };
}

export function stopLocationTracking(): void {
  subscription?.remove();
  subscription = null;
}

export function isTrackingLocation(): boolean {
  return subscription !== null;
}
