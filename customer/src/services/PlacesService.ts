// Free, no-API-key address search and reverse geocoding for the map-based
// pickup/drop picker, via OpenStreetMap's Nominatim — the same provider the
// admin backend already uses for vendor address geocoding (see
// server/src/lib/geocode.ts). Called directly from the client so a picked
// pin's coordinates are exact — the booking flow never has to re-guess an
// address from typed text.
const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "Goocart-Customer/1.0 (pickup/drop location picker)";

export type PlaceResult = { label: string; latitude: number; longitude: number };

export async function searchPlaces(query: string, near?: { latitude: number; longitude: number }): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  try {
    const params = new URLSearchParams({ format: "json", limit: "6", q: trimmed });
    if (near) {
      // Bias (not restrict) results toward the current map area so "Main
      // Road" resolves to the nearby one, not one in another state.
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

export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  try {
    const params = new URLSearchParams({ format: "json", lat: String(latitude), lon: String(longitude), zoom: "18" });
    const res = await fetch(`${NOMINATIM_URL}/reverse?${params.toString()}`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const row = (await res.json()) as { display_name?: string };
    return row.display_name ?? null;
  } catch {
    return null;
  }
}
