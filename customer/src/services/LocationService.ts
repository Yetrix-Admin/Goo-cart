import * as Location from "expo-location";

export type ResolvedLocation = {
  latitude: number;
  longitude: number;
  city: string;
  region: string;
  // Street-level detail from reverse geocoding (house/building + street,
  // or the nearest named place) — this is the "exact" location shown on
  // the home screen, distinct from city/region which are used as a
  // fallback when reverse geocoding can't resolve anything more precise.
  address: string;
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
      const city = place?.city || place?.subregion || "Current location";
      // Prefer the most specific detail reverse geocoding gives us — a
      // named place/house number, street and district — deduped against
      // each other AND against the city (rural reverse-geocode results
      // commonly repeat the same place name across name/district/city),
      // falling back to just the city if nothing more precise survives.
      const candidates = [place?.name, place?.street, place?.district, city].filter((part): part is string => Boolean(part));
      const seen = new Set<string>();
      const address = candidates
        .filter((part) => {
          const key = part.trim().toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .join(", ");
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        city,
        region: place?.region || "",
        address: address || city,
      };
    } catch {
      return null;
    }
  }
}

export const locationService: LocationServiceInterface = new ForegroundLocationService();
