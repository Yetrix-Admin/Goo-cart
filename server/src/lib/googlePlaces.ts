// Google Places (search-as-you-type suggestions) and Distance Matrix (real
// driving distance/time) for the Bike Taxi/Parcel pickup-drop flow — the
// same providers Rapido/Ola use, matching what a rider actually expects.
//
// Called only from the server, never the client: these Google Web Service
// endpoints are plain HTTPS/JSON, which an "Android apps" restricted key
// (the one baked into the customer app for the Maps SDK) cannot call at
// all — Android-app restriction is only satisfiable by the native SDK's own
// device attestation, not a raw HTTP request from either the phone or a
// backend. So this needs its own key, kept server-side only, with either no
// application restriction or an IP restriction — never shipped to a client
// bundle. See server/.env.example.
//
// Every function here degrades to null/empty on any failure (missing key,
// network error, zero results, a still-propagating billing/API-enable
// change) rather than throwing — callers fall back to the free
// Nominatim/haversine path (see geocode.ts, geo.ts) so the booking flow
// keeps working even before this key exists.
const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

export type PlaceSuggestion = { placeId: string; label: string };
export type PlaceDetails = { latitude: number; longitude: number; address: string };

export async function autocompletePlaces(input: string, near?: { latitude: number; longitude: number }): Promise<PlaceSuggestion[]> {
  const trimmed = input.trim();
  if (!GOOGLE_PLACES_KEY || trimmed.length < 3) return [];
  try {
    const params = new URLSearchParams({ input: trimmed, key: GOOGLE_PLACES_KEY, components: "country:in" });
    if (near) {
      params.set("location", `${near.latitude},${near.longitude}`);
      params.set("radius", "50000");
    }
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { status: string; predictions?: Array<{ place_id: string; description: string }> };
    if (data.status !== "OK") return [];
    return (data.predictions ?? []).map((p) => ({ placeId: p.place_id, label: p.description }));
  } catch {
    return [];
  }
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  if (!GOOGLE_PLACES_KEY || !placeId.trim()) return null;
  try {
    const params = new URLSearchParams({ place_id: placeId, key: GOOGLE_PLACES_KEY, fields: "geometry,formatted_address" });
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { status: string; result?: { geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string } };
    if (data.status !== "OK") return null;
    const loc = data.result?.geometry?.location;
    if (!loc) return null;
    return { latitude: loc.lat, longitude: loc.lng, address: data.result?.formatted_address ?? "" };
  } catch {
    return null;
  }
}

// Real road distance in km, driving mode — replaces the haversine*1.35
// straight-line approximation whenever this key is configured.
export async function drivingDistanceKm(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): Promise<number | null> {
  if (!GOOGLE_PLACES_KEY) return null;
  try {
    const params = new URLSearchParams({
      origins: `${origin.latitude},${origin.longitude}`,
      destinations: `${destination.latitude},${destination.longitude}`,
      mode: "driving",
      key: GOOGLE_PLACES_KEY,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows?: Array<{ elements?: Array<{ status: string; distance?: { value: number } }> }> };
    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK" || !element.distance) return null;
    return Math.round((element.distance.value / 1000) * 10) / 10;
  } catch {
    return null;
  }
}
