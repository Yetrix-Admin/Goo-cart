import * as Location from "expo-location";
import { apiGet } from "@/services/apiClient";

// Search suggestions for the pickup/drop map picker. Primary path is
// Google Places Autocomplete via our own server (server/src/lib/googlePlaces.ts)
// — the same provider Rapido/Ola use — which needs no client API key since
// it's called server-side. Falls back to free Nominatim (OpenStreetMap) if
// the server doesn't have GOOGLE_PLACES_API_KEY configured yet, or the
// request fails, so search never goes fully dead.
//
// Google results carry a placeId (coordinates need a separate Place
// Details call — see resolvePlace); Nominatim results already carry
// coordinates directly.
export type PlaceSuggestion = { label: string; placeId?: string; latitude?: number; longitude?: number };

const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "Goocart-Customer/1.0 (pickup/drop location picker)";

async function searchNominatim(query: string, near?: { latitude: number; longitude: number }): Promise<PlaceSuggestion[]> {
  try {
    const params = new URLSearchParams({ format: "json", limit: "6", q: query });
    if (near) {
      const delta = 0.5;
      params.set("viewbox", `${near.longitude - delta},${near.latitude + delta},${near.longitude + delta},${near.latitude - delta}`);
      params.set("bounded", "0");
    }
    const res = await fetch(`${NOMINATIM_URL}/search?${params.toString()}`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ display_name?: string; lat?: string; lon?: string }>;
    return rows
      .filter((row) => row.display_name && row.lat && row.lon)
      .map((row) => ({ label: row.display_name!, latitude: Number(row.lat), longitude: Number(row.lon) }))
      .filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
  } catch {
    return [];
  }
}

export async function searchPlaces(query: string, near?: { latitude: number; longitude: number }): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  try {
    const data = await apiGet<{ results: { placeId: string; label: string }[] }>("/api/v1/customer/places/autocomplete", {
      input: trimmed,
      lat: near?.latitude,
      lng: near?.longitude,
    });
    if (data.results.length > 0) return data.results.map((r) => ({ label: r.label, placeId: r.placeId }));
  } catch {
    // Fall through to Nominatim below.
  }
  return searchNominatim(trimmed, near);
}

// Resolves a suggestion to exact coordinates — a second call for Google
// results (Autocomplete never returns coordinates, only Place Details
// does); Nominatim results already have them.
export async function resolvePlace(suggestion: PlaceSuggestion): Promise<{ latitude: number; longitude: number; address: string } | null> {
  if (suggestion.latitude != null && suggestion.longitude != null) {
    return { latitude: suggestion.latitude, longitude: suggestion.longitude, address: suggestion.label };
  }
  if (!suggestion.placeId) return null;
  try {
    return await apiGet<{ latitude: number; longitude: number; address: string }>("/api/v1/customer/places/details", { placeId: suggestion.placeId });
  } catch {
    return null;
  }
}

// The device's own geocoder (Google Play services on Android) — reliable
// and needs no API key of its own, unlike Nominatim's reverse endpoint
// which this replaced.
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!place) return null;
    const city = place.city || place.subregion || "";
    const candidates = [place.name, place.street, place.district, city].filter((part): part is string => Boolean(part));
    const seen = new Set<string>();
    const address = candidates.filter((part) => {
      const key = part.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(", ");
    return address || null;
  } catch {
    return null;
  }
}
