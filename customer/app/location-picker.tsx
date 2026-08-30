import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { PROVIDER_GOOGLE, Region } from "react-native-maps";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Icon } from "@/components/Icon";
import { colors, radius, spacing, typography } from "@/theme";
import { locationService } from "@/services/LocationService";
import { PlaceResult, reverseGeocode, searchPlaces } from "@/services/PlacesService";
import { useRideBookingStore } from "@/store/useRideBookingStore";

const DEFAULT_DELTA = 0.01;
const SEARCH_DEBOUNCE_MS = 400;

// Tap-and-pan-to-place picker in the Rapido/Ola/Uber style: the pin stays
// fixed at the screen center and the map moves under it, rather than a
// draggable marker — this is the map interaction model those apps use, and
// it's far less fiddly on a touchscreen than dragging a small marker.
export default function LocationPickerScreen() {
  const { field } = useLocalSearchParams<{ field: "pickup" | "drop" }>();
  const setPickup = useRideBookingStore((s) => s.setPickup);
  const setDrop = useRideBookingStore((s) => s.setDrop);
  const existing = useRideBookingStore((s) => (field === "drop" ? s.drop : s.pickup));

  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      if (existing) {
        setRegion({ latitude: existing.latitude, longitude: existing.longitude, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA });
        setAddress(existing.address);
        return;
      }
      const current = await locationService.getCurrentLocation();
      if (current) {
        setRegion({ latitude: current.latitude, longitude: current.longitude, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA });
        setAddress(current.address);
      } else {
        // Jangareddigudem — same fallback the rest of the app uses when
        // location permission isn't granted, so the map always has somewhere
        // sensible to start rather than the middle of the ocean (0,0).
        setRegion({ latitude: 17.4362, longitude: 81.2661, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA });
      }
    })();
    // Only on mount — the map's own pan/search interactions own `region` after this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRegionChangeComplete = (next: Region) => {
    setRegion(next);
    setResolving(true);
    void reverseGeocode(next.latitude, next.longitude).then((label) => {
      setAddress(label ?? `${next.latitude.toFixed(5)}, ${next.longitude.toFixed(5)}`);
      setResolving(false);
    });
  };

  const useCurrentLocation = async () => {
    setLocating(true);
    try {
      const current = await locationService.getCurrentLocation();
      if (current) {
        const next = { latitude: current.latitude, longitude: current.longitude, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA };
        mapRef.current?.animateToRegion(next, 400);
        setRegion(next);
        setAddress(current.address);
      }
    } finally {
      setLocating(false);
    }
  };

  const onSearchChange = (text: string) => {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 3) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      void searchPlaces(text, region ?? undefined)
        .then(setResults)
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
  };

  const pickResult = (result: PlaceResult) => {
    Keyboard.dismiss();
    const next = { latitude: result.latitude, longitude: result.longitude, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA };
    mapRef.current?.animateToRegion(next, 400);
    setRegion(next);
    setAddress(result.label);
    setQuery("");
    setResults([]);
  };

  const confirm = () => {
    if (!region || !address) return;
    const loc = { latitude: region.latitude, longitude: region.longitude, address };
    if (field === "drop") setDrop(loc);
    else setPickup(loc);
    router.back();
  };

  const title = field === "drop" ? "Set drop location" : "Set pickup location";
  const canConfirm = useMemo(() => Boolean(region && address && !resolving), [region, address, resolving]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader title={title} subtitle="Search, or pan the map to place the pin" />

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Icon name="search" size={16} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={onSearchChange}
            placeholder="Search for an address or place"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
          />
          {searching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        {results.length > 0 && (
          <View style={styles.resultsList}>
            {results.map((result, index) => (
              <Pressable key={`${result.latitude}-${result.longitude}-${index}`} style={styles.resultRow} onPress={() => pickResult(result)}>
                <Icon name="location" size={15} color={colors.muted} />
                <Text style={styles.resultText} numberOfLines={2}>{result.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={styles.mapWrap}>
        {region ? (
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
            initialRegion={region}
            onRegionChangeComplete={onRegionChangeComplete}
          />
        ) : (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        <View style={styles.pinWrap} pointerEvents="none">
          <Icon name="location" size={36} color={colors.primary} />
        </View>

        <Pressable style={styles.currentLocationBtn} onPress={() => void useCurrentLocation()} disabled={locating} accessibilityLabel="Use current location">
          {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="location" size={20} color={colors.primary} />}
        </Pressable>
      </View>

      <View style={styles.footer}>
        <View style={styles.addressRow}>
          <Icon name="location" size={16} color={colors.primary} />
          <Text style={styles.addressText} numberOfLines={2}>
            {resolving ? "Finding this location…" : address ?? "Pan the map to choose a location"}
          </Text>
        </View>
        <PrimaryButton label={field === "drop" ? "Confirm drop location" : "Confirm pickup location"} onPress={confirm} disabled={!canConfirm} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  searchWrap: { position: "absolute", top: 90, left: spacing.lg, right: spacing.lg, zIndex: 10 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 46,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.text, height: "100%" },
  resultsList: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  resultRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  resultText: { ...typography.body, flex: 1 },
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  mapLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  // Offset upward by half the icon height so the pin's visual tip — not its
  // center — lands on the true center of the map, matching where the marker
  // would sit if it were a real anchored map annotation.
  pinWrap: { position: "absolute", top: "50%", left: "50%", marginLeft: -18, marginTop: -36 },
  currentLocationBtn: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  footer: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  addressRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  addressText: { ...typography.bodyStrong, flex: 1 },
});
