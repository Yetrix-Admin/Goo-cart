import * as Location from "expo-location";

export type ResolvedLocation = {
  latitude: number;
  longitude: number;
  city: string;
  region: string;
};

// Foreground-only location, safe for Expo Go. Background tracking (needed for
// live delivery-partner/rider location in production) requires a custom dev
// build and is intentionally NOT implemented here — see LocationService.md
// note below. Any future background variant should implement this same
// interface so screens never need to know which one is active.
export interface LocationServiceInterface {
  requestPermission(): Promise<boolean>;
  getCurrentLocation(): Promise<ResolvedLocation | null>;
}

class ForegroundLocationService implements LocationServiceInterface {
  async requestPermission(): Promise<boolean> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  }

  async getCurrentLocation(): Promise<ResolvedLocation | null> {
    try {
      const granted = await this.requestPermission();
      if (!granted) return null;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [place] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        city: place?.city || place?.subregion || "Current location",
        region: place?.region || "",
      };
    } catch {
      return null;
    }
  }
}

export const locationService: LocationServiceInterface = new ForegroundLocationService();
