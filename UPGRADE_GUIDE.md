# Goocart — End-to-End Review & Upgrade Guide

Generated from a full pass over all five parts of the product: `customer/`,
`vendor/`, `partner/` (Expo/React Native apps), `server/` (Node/Express/
Mongoose API), and the root Next.js site (`app/`). Findings are ordered so you
can fix the dangerous stuff first, then upgrade the stack, then cut a release.

---

## 0. Do this first — uncommitted secret

`git diff` currently shows `customer/app.json` replacing the placeholder
Google Maps keys with a live key:

```
[REDACTED_GOOGLE_MAPS_API_KEY]
```

used for both `ios.config.googleMapsApiKey` and
`android.config.googleMaps.apiKey`. `ANDROID_RELEASES.md` explicitly says
these placeholders exist to keep secrets out of Git.

- **Do not commit this as-is.** Move it out of the tracked `app.json` (EAS
  secret / `app.config.js` reading `process.env`, or a gitignored config).
- In Google Cloud Console, restrict the key by Android package name + SHA-1
  (and iOS bundle ID) **before** it's used in any build, and check whether it
  needs rotating if it's been used/exposed already.
- Use separate keys per platform rather than sharing one.

---

## 1. Current state — version matrix

| Component | Package | Current | Latest (npm, Aug 2026) | Gap |
|---|---|---|---|---|
| customer/vendor/partner | `expo` | `~54.0.0` | `57.0.18` | 3 major SDKs behind |
| customer/vendor/partner | `react-native` | `0.81.5` | managed by Expo (SDK 57 → RN 0.86.x) | — |
| customer/vendor/partner | `react` | `19.1.0` | `19.2.8` | minor behind |
| customer/vendor/partner | `expo-router` | `~6.0.24` | tracks SDK | routing convention changes across SDKs |
| server | `express` | `4.21.2` | `express@5` exists but not required | stable, no urgent need |
| server | `mongoose` | `8.9.5` | 8.x latest patch | low risk bump |
| server | `express-rate-limit` | `^8.6.2` | current major | see Finding S4 below |
| root site | `next` | `16.3.3` | `16.3.3` | **already latest** |
| root site | `react`/`react-dom` | `19.2.6` | `19.2.8` | minor behind |
| root site | `tailwindcss` | `4.2.1` | current | **installed but unused — see Finding W3** |
| Node.js (local) | — | v24.16.0 | — | satisfies server (`>=20`) and site (`>=22.13.0`) engines |

Also on disk: `mobile/` is a leftover, untracked, gitignored build folder from
before the app was renamed to `customer/` (see commit `cee9bf5`). It's not a
real fourth app — safe to delete locally (`rm -rf mobile`) whenever you want
the disk space back; it has no effect on the repo.

---

## 2. Findings — fix before or shortly after upgrading

Severity: 🔴 critical 🟠 high 🟡 medium ⚪ low

### Backend (`server/`)

| # | Sev | File | Issue | Fix |
|---|---|---|---|---|
| S1 | 🔴 | `src/routes/admin.ts` (`audit()` ~L23, writes ~L228, ~L583) | `AuditLog` stores raw `before`/`after` snapshots including `passwordHash` and `bankDetails`; `GET /audit-logs` (~L739) is gated only by generic `canAdmin`, so `MARKETING_ADMIN`/`SUPPORT_ADMIN` can read password hashes and vendor/partner bank details. | Redact `passwordHash`/`bankDetails` before writing to the audit log; restrict `/audit-logs` to a role that actually needs it. |
| S2 | 🟠 | `src/routes/portal.ts` `transitionDoc`/`ownerGroupForFood` (~L455-530) | Any online, non-busy partner can move a Food order `READY_FOR_PICKUP → DELIVERY_PARTNER_ASSIGNED` via a plain status-guarded update, bypassing `claimDelivery()`'s offer/eligibility/radius checks in `lib/delivery.ts`. Partners never offered an order can self-assign it. | Route Food-order partner claims through `claimDelivery()`. |
| S3 | 🟠 | `src/routes/portal.ts` `partner.toggle` (~L266-270) vs `lib/delivery.ts` `eligiblePartnersNear` / `lib/auth.ts` `isPartnerEligible` | Two disconnected "online" flags: portal writes a `Setting` doc (`partner_online:<id>`), dispatch logic reads `User.partnerOnline`. Toggling online in the portal doesn't make a partner eligible for real dispatch. | Unify on `User.partnerOnline`. |
| S4 | 🟠 | `src/index.ts` (no `app.set('trust proxy', ...)`) | App runs behind Render's proxy but never sets `trust proxy`; `express-rate-limit@8` on `/auth/*` either mis-buckets all clients together or throws on `X-Forwarded-For`, effectively breaking rate limiting in production. | Add `app.set('trust proxy', 1)`. |
| S5 | 🟡 | `src/lib/realtime.ts:37-43` | Socket.IO CORS hardcodes `origin: true, credentials: true`, ignoring the `ALLOWED_ORIGINS` allow-list the REST layer uses. | Reuse the same allow-list for Socket.IO. |
| S6 | 🟡 | `src/index.ts:32-38` | If `ALLOWED_ORIGINS` is unset, CORS fails open (reflect-any-origin + credentials). Fine for local dev, risky if it happens silently in prod. | Default to deny outside development. |
| S7 | 🟡 | `src/routes/catalog.ts:70,74`, `src/routes/admin.ts:35,505` | User query params built directly into Mongo `$regex` filters — ReDoS risk. | Escape regex metacharacters before building the filter. |
| S8 | 🟡 | `src/lib/inventory.ts` + `src/lib/db.ts:38` | `reserveLines`/`releaseReservations` always use multi-document transactions, which throw on a non-replica-set Mongo; `supportsTransactions()` exists but is never called (dead code). | Branch on `supportsTransactions()`, or remove the unused export if transactions are guaranteed. |
| S9 | 🟡 | Most routes (e.g. `orders.ts:270`, `admin.ts`) | Raw `e.message` from caught errors is returned to API clients, leaking internal/driver detail. | Log server-side, return a generic message to clients. |
| S10 | 🟡 | `src/lib/delivery.ts` `pendingTimers` (~L20-40) | Delivery-offer expiry/retry state lives only in in-process `setTimeout`s — lost on restart, duplicated across multiple instances. | Fine for a single instance; revisit before scaling horizontally. |
| S11 | ⚪ | `src/routes/auth.ts` `/otp/request` (~L121) vs `/password/reset-request` (~L199) | Inconsistent account-enumeration protection between the two flows. | Align both to not reveal account existence. |
| S12 | ⚪ | `src/routes/admin.ts` `PATCH /restaurants/:id` (~L221-238) | Skips the lat/lng validation that `POST /restaurants` enforces (~L165). | Apply the same validation on update. |
| S13 | ⚪ | server-wide | No `helmet`/security headers, no HTTPS-redirect middleware (delegated to host). | Confirm acceptable for current hosting; consider `helmet` regardless. |

Good news: no deprecated Mongoose APIs, no Express-4-only patterns, error
middleware correctly registered last — nothing here blocks a dependency bump.

### Customer app

| # | Sev | File | Issue | Fix |
|---|---|---|---|---|
| C1 | 🔴 | `app.json:16,36` | Same leaked Maps key as §0. | See §0. |
| C2 | 🟠 | `src/store/useAuthStore.ts:8,31,37,78` | Bearer auth token persisted in plain `AsyncStorage` (`goocart.auth.v2`), unencrypted. | Move to `expo-secure-store`. |
| C3 | 🟠 | `src/services/RatingService.ts`, `src/services/SupportService.ts` | Ratings and support tickets never call the backend — `submitRating` only writes to local `AsyncStorage`, `createTicket` returns a local object. Vendors/admin never see this data. | Wire both to real API endpoints. |
| C4 | 🟡 | `src/services/PushService.ts:33-37` | Push registration no-ops — `app.json` has no `expo.extra.eas.projectId`. Real users get zero push notifications. | `eas init`, add `extra.eas.projectId`. |
| C5 | 🟡 | `eas.json` | Only `production`/`production-apk` profiles exist; no `development`/`preview` profile or non-prod API URL. | Add a `development` profile with a staging `EXPO_PUBLIC_API_URL`. |
| C6 | 🟡 | `package.json:26,30`, no `babel.config.js` | `react-native-reanimated`/`react-native-worklets` are dependencies but unused anywhere in `src/`/`app/`, and there's no Babel config for them. | Remove if truly unused, or add proper config before anyone imports them. |
| C7 | ⚪ | `app/checkout/payment.tsx:40` | `idempotencyKey` from `Date.now()+Math.random()` instead of a UUID. | Use `crypto.randomUUID()`. |
| C8 | ⚪ | `app/checkout/address.tsx:62,140` | Phone field enforces digits/length on keystroke but not on submit (`save()`), so a pasted value can bypass the check. | Re-validate in `save()`. |
| C9 | ⚪ | `app/checkout/payment.tsx` | Entire payment flow is a "Simulate Payment Success/Failure" prototype, shipped as-is in the `production`/`production-apk` EAS profiles. | Gate behind a flag or replace with a real gateway before store release. |

### Vendor app

| # | Sev | File | Issue | Fix |
|---|---|---|---|---|
| V1 | 🟠 | `src/store/useAuthStore.ts` | Same plaintext-token issue as C2. | `expo-secure-store`. |
| V2 | 🟠 | `src/store/useAuthStore.ts:62-66` (`logout`) | Doesn't call `disconnectSocket()` (partner's does). A stale authenticated socket can keep streaming another account's live order events after sign-out. | Call `disconnectSocket()` in vendor's `logout`. |
| V3 | 🟠 | `src/store/useOrdersStore.ts` | No `clear()` method at all, and sign-out never clears it or `useVendorStore`. The next vendor logging in on the same device briefly sees the previous account's orders/menu. | Add `clear()`, call it on sign-out. |
| V4 | 🟡 | `src/services/PushService.ts:30-34` | Same missing `projectId` as C4. | Same fix. |
| V5 | 🟡 | `app/(tabs)/menu.tsx:19-25,33` | `toggleAvailable`/"add dish" have no client-side permission gating, unlike `orders.tsx` which checks `hasPermission`. Staff get an unlabeled 403 instead of a clear message. | Gate with `hasPermission(user, "CAN_MANAGE_STOCK"/"CAN_MANAGE_PRODUCTS")`. |

### Partner (delivery) app

| # | Sev | File | Issue | Fix |
|---|---|---|---|---|
| P1 | 🟠 | `src/store/useAuthStore.ts` | Same plaintext-token issue as C2. | `expo-secure-store`. |
| P2 | 🟡 | `src/services/PushService.ts:30-34` | Same missing `projectId` as C4. | Same fix. |
| P3 | 🟡 | `src/services/LocationTracker.ts:18,21` | Foreground-only tracking (`requestForegroundPermissionsAsync` + `watchPositionAsync`); no background permission requested. Drivers who switch to a maps app mid-delivery stop reporting location. | Confirm intentional; if not, add background location task + `ACCESS_BACKGROUND_LOCATION`. |
| P4 | 🟡 | `src/services/LocationTracker.ts:24-33` | Location-ping failures are swallowed silently — no retry/backoff/UI signal if permission is revoked or the token expires mid-trip. | Surface a failure state to the driver. |

### Both vendor & partner

| # | Sev | Issue | Fix |
|---|---|---|---|
| VP1 | 🟡 | `apiClient.request` never checks `response.ok`, relies only on the JSON envelope's `success` flag — a non-JSON error page (proxy 502/504, common on Render free-tier cold starts) surfaces as a generic "make sure backend is running" message. | Check `response.ok` before parsing. |
| VP2 | ⚪ | No `development`/`preview` EAS profile in either app. | Add one, as in C5. |
| VP3 | ⚪ | `apiClient.ts` is duplicated near-verbatim between the two apps and has already drifted (vendor has `apiPatch`, partner doesn't) — this drift is *how* V2/V3 happened. | Consider extracting a shared package. |
| VP4 | ⚪ | Both run a poll interval *and* socket listeners that independently call `refresh()`, with no in-flight/request-id guard — can show briefly stale state on overlapping responses. | Add a request-id guard before this becomes user-visible at scale. |

No hardcoded secrets in vendor/partner; both correctly enforce HTTPS-only in
production and `usesCleartextTraffic: false`.

### Next.js site (root `app/`)

| # | Sev | File | Issue | Fix |
|---|---|---|---|---|
| W1 | 🟡 | `app/api/[...path]/route.ts:11-16` | `apiBase()` silently falls back to `http://localhost:3001` if `GOOCART_API_URL` is unset — no production guard. A misconfigured Vercel env var would proxy real `cookie`/`authorization` headers to localhost on the server instance instead of failing loudly. | Throw at module init if unset and `NODE_ENV==="production"`. |
| W2 | 🟡 | `app/layout.tsx` | No `viewport` export, yet `globals.css` has a `@media(max-width:760px)` mobile layout — mobile browsers render at desktop width and scale down instead of using the responsive layout. | Add `export const viewport: Viewport = { width: "device-width", initialScale: 1 }`. |
| W3 | 🟡 | `postcss.config.mjs`, `app/globals.css` | Tailwind is configured and installed but `globals.css` never imports it — 100% hand-written CSS. Pure build overhead/dependency surface right now. | Wire it up or remove the dependency. |
| W4 | 🟡 | `package.json:9-10` | `dev` uses Turbopack (Next 16 default), `build` forces `--webpack`. What's tested locally never matches what ships. | Reconsider dropping `--webpack` unless there's a documented incompatibility. |
| W5 | ⚪ | root — no `app/error.tsx`/`not-found.tsx` | Falls through to Next's default unstyled error overlay on any uncaught render exception. | Add both. |
| W6 | ⚪ | `render.yaml:6-7` | Stale comment says the root repo deploys a Cloudflare Worker admin portal; `app/api/[...path]/route.ts` documents the move off Workers to plain Next.js. `vercel.json` deploys the Next app, `render.yaml` deploys only `server/` — not an active conflict, just confusing. | Update/remove the stale comment; clean local `.wrangler`/`dist` artifacts. |

No hardcoded secrets, no `dangerouslySetInnerHTML`, no hydration-mismatch
patterns found.

---

## 3. Dependency / SDK upgrade guide

### 3a. Mobile apps (customer, vendor, partner) — Expo SDK 54 → 57

Expo's own guidance: **upgrade one SDK at a time**, not straight to 57, so
any breakage is easy to attribute. Do this for each app folder
(`customer/`, `vendor/`, `partner/`) — they're independent projects with
their own `node_modules`, so upgrade and test one at a time.

For each SDK step (54→55, 55→56, 56→57):

```powershell
cd customer   # then vendor, then partner
npm install expo@^55.0.0     # substitute the target SDK each round
npx expo install --fix       # aligns every expo-* package + RN + react to that SDK
npx expo-doctor              # flags anything still mismatched
```

Native folders (`android/`, `ios/`) are Continuous-Native-Generation-managed
here (see `ANDROID_RELEASES.md`) — delete them and let
`.\scripts\build-android.ps1 ... -Prebuild` regenerate from `app.json` after
each SDK bump, rather than hand-patching native project files.

**What actually changes, version by version:**

- **SDK 54 → 55**: React Native 0.81 → 0.83, React 19.2.
  - Breaking: the `notification` field is removed from the `app.json`
    Expo schema — if prebuild throws about it, remove that key (none of the
    three apps currently declare one, so this is likely a no-op here, but
    verify).
  - `expo-av` is removed from Expo Go (already superseded by `expo-video`/
    `expo-audio` — grep confirms none of the three apps import `expo-av`,
    so unaffected).
  - Push notifications stop working in Expo Go on Android — only matters for
    testing in Expo Go, not for dev/production builds. Combined with C4/V4/P4
    above (no EAS `projectId` yet), fix the `projectId` gap as part of this
    step so you can actually verify push end-to-end on a dev build.
  - Requires Xcode 26 to build iOS natively (irrelevant if you only build
    Android from Windows, as the current scripts do).
- **SDK 55 → 56**: React Native 0.85.2, React 19.2.3. Requires Xcode 26.4 for
  iOS; if any Expo config plugin sets an iOS deployment target, bump it to
  16.4. No Android-specific breaking changes surfaced in release notes.
- **SDK 56 → 57**: React Native 0.86. Expo's own release notes describe this
  as a no-breaking-change upgrade — the main mechanical step is bumping
  `react-native-reanimated` (→4.5), `react-native-worklets` (→0.10),
  `react-native-gesture-handler` (→2.32), which `expo install --fix` handles
  automatically. Only `customer/` declares reanimated/worklets, and per C6
  they're currently unused — either delete them now to shrink the diff, or
  keep them and just let the fix command bump them.

**Specifically worth re-testing after the full 54→57 upgrade, per app:**

- All three: `expo-router` (routing conventions have shifted across
  versions — click through every screen), `expo-notifications` (all three
  apps already use the current `shouldShowBanner`/`shouldShowList` handler
  shape, so they're ahead of the deprecated API — low risk), `expo-location`
  foreground permission flow (customer + partner).
- `customer/`: `react-native-maps`, `expo-image` — not called out in Expo's
  release notes but worth a manual smoke test since they're the most
  native-heavy dependencies in that app.

### 3b. Backend (`server/`)

Nothing forces an upgrade — no deprecated Mongoose APIs or Express-4-only
patterns were found. If you want to stay current:

```powershell
cd server
npm outdated
npm update            # patch/minor bumps within current ranges
```

Fix **S4 (`trust proxy`)** and **S8 (transaction guard)** regardless of
whether you touch dependency versions — they're correctness bugs, not
version-gap issues. Moving to Express 5 is optional and not required by
anything found in this review; treat it as its own project if you do it,
since Express 5 changes error-handling and routing semantics.

### 3c. Next.js site (root)

Already on the latest Next.js (`16.3.3`). Just:

```powershell
npm install react@latest react-dom@latest   # 19.2.6 -> 19.2.8
```

Resolve **W3** (Tailwind unused) and **W4** (`--webpack` vs Turbopack
mismatch) as design decisions before or after the bump — they're not
blocking, just worth a deliberate choice rather than leftover drift.

---

## 4. Release guide — cutting a new Android build

This repo already has a release process in `ANDROID_RELEASES.md`; this is
the condensed sequence once the fixes/upgrades above are in:

1. **Bump the version** in the app(s) you're releasing — `customer/app.json`,
   `vendor/app.json`, and/or `partner/app.json`:
   - `expo.version` (user-facing string, e.g. `1.0.0` → `1.1.0`)
   - `expo.android.versionCode` (integer, must strictly increase each Play
     Store upload — currently `1` in all three apps)
2. **Verify config only** (no build) from the repo root:
   ```powershell
   npm run android:verify
   ```
3. **Regenerate native projects from `app.json` and build**, per app:
   ```powershell
   .\scripts\build-android.ps1 -App customer -Artifact apk -Prebuild
   .\scripts\build-android.ps1 -App customer -Artifact aab
   ```
   (repeat with `-App vendor` / `-App delivery`), or build everything at
   once with `npm run android:all`.
4. **Signing**: make sure each app's permanent upload keystore and its four
   `*_UPLOAD_*` properties are present in that app's `android/gradle.properties`
   (see `ANDROID_RELEASES.md` for the exact property names per app) —
   production builds refuse to fall back to debug signing.
5. **Named output** lands in `outputs/android/`; raw Gradle output is under
   each app's `android/app/build/outputs/...`.
6. **EAS alternative**: `npx eas-cli build --platform android --profile production`
   (or `production-apk`) from inside the app folder, once signed in to
   Expo/EAS.
7. Before uploading to Google Play: confirm the Maps API key issue (§0) is
   resolved, and decide whether C9 (simulated payment flow) is acceptable to
   ship as-is.

---

## 5. Suggested order of operations

1. Fix §0 (leaked Maps key) — don't commit the current diff as-is.
2. Fix the 🔴/🟠 server findings (S1-S4) — these are exploitable now,
   independent of any dependency upgrade.
3. Fix V2/V3 (vendor logout/session-clear bugs) — user-visible data leak
   between accounts on shared devices.
4. Add `expo.extra.eas.projectId` to all three apps (C4/V4/P4) so push
   notifications work and you can verify SDK-upgrade push behavior on a dev
   build.
5. Do the SDK 54→55→56→57 upgrade, one app and one SDK step at a time,
   running `expo-doctor` after each step.
6. Move auth tokens to `expo-secure-store` across all three apps (C2/V1/P1).
7. Clean up the remaining 🟡/⚪ items opportunistically.
8. Cut releases per §4.
