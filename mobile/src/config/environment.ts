import Constants from "expo-constants";

// Where the app finds the Goocart backend.
//
// Resolution order:
//   1. EXPO_PUBLIC_API_URL — baked in at build time. REQUIRED for a real APK,
//      because a standalone build has no Metro server to infer a host from.
//   2. In Expo Go / dev, derive the host from the Metro bundler URL the device
//      already connected to (your machine's LAN IP). "localhost" would resolve
//      to the phone itself, so it is never a useful default on a device.
//
// If neither works we surface `apiConfigError` and let the UI show a clear
// message. Throwing here would crash the app before it can render anything.

const DEV_BACKEND_PORT = 3001;

function inferDevHost(): string | null {
  const constants = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    manifest?: { debuggerHost?: string };
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
  };
  const hostUri =
    constants.expoConfig?.hostUri ??
    constants.manifest?.debuggerHost ??
    constants.manifest2?.extra?.expoGo?.debuggerHost ??
    null;
  if (typeof hostUri !== "string") return null;
  const host = hostUri.split(":")[0];
  if (!host || host === "localhost" || host === "127.0.0.1") return null;
  return host;
}

function resolve(): { url: string; error: string | null } {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return { url: explicit.replace(/\/$/, ""), error: null };

  const host = inferDevHost();
  if (host) return { url: `http://${host}:${DEV_BACKEND_PORT}`, error: null };

  if (__DEV__) return { url: `http://localhost:${DEV_BACKEND_PORT}`, error: null };

  return {
    url: "",
    error:
      "This build has no backend configured. Set EXPO_PUBLIC_API_URL in mobile/.env to your Goocart server address and rebuild.",
  };
}

const resolved = resolve();

export const API_URL = resolved.url;
export const apiConfigError = resolved.error;
export const API_TIMEOUT_MS = 12000;
