# Goocart Android releases

The repository contains three independent Expo/Android apps that share the
existing Goocart backend:

| App | Source folder | Display name | Android application ID | Branding |
|---|---|---|---|---|
| Customer | `customer/` | Goocart Customer | `com.goocart.customer` | `customer/assets/images/` |
| Vendor | `vendor/` | Goocart Vendor | `com.goocart.vendor` | `vendor/assets/images/` |
| Delivery | `partner/` | Goocart Delivery Partner | `com.goocart.delivery` | `partner/assets/images/` |

All production profiles use `https://goo-cart.onrender.com`. The shared build
script rejects HTTP, localhost, private-network, dev, test, and staging API
hosts before Gradle starts. Clear-text Android traffic is disabled in all three
app configs.

## Prerequisites

- Node.js 22.13 or newer and each app's dependencies installed with `npm ci`
- Android Studio/SDK and JDK 17 available through `ANDROID_HOME`/`JAVA_HOME`
- One permanent upload keystore per application ID for publishable artifacts

Run a configuration-only check from the repository root:

```powershell
npm run android:verify
```

If the ignored native folders need to be refreshed from `app.json`, add
`-Prebuild` to the PowerShell commands below.

## Production signing

Put each keystore in its app's `android/app/` directory and add the matching
four values to that app's ignored `android/gradle.properties`:

```properties
# customer
GOOCART_UPLOAD_STORE_FILE=goocart-customer-upload.keystore
GOOCART_UPLOAD_STORE_PASSWORD=<secret>
GOOCART_UPLOAD_KEY_ALIAS=goocart-customer
GOOCART_UPLOAD_KEY_PASSWORD=<secret>

# vendor
GOOCARTVENDOR_UPLOAD_STORE_FILE=goocart-vendor-upload.keystore
GOOCARTVENDOR_UPLOAD_STORE_PASSWORD=<secret>
GOOCARTVENDOR_UPLOAD_KEY_ALIAS=goocart-vendor
GOOCARTVENDOR_UPLOAD_KEY_PASSWORD=<secret>

# delivery
GOOCARTDELIVERY_UPLOAD_STORE_FILE=goocart-delivery-upload.keystore
GOOCARTDELIVERY_UPLOAD_STORE_PASSWORD=<secret>
GOOCARTDELIVERY_UPLOAD_KEY_ALIAS=goocart-delivery
GOOCARTDELIVERY_UPLOAD_KEY_PASSWORD=<secret>
```

Back up these keys securely. They are intentionally excluded from Git. A
normal production build stops if its app's keystore or any required property
is absent; it never silently signs a release with Android's debug key.

## Local Gradle builds

Build one application:

```powershell
.\scripts\build-android.ps1 -App customer -Artifact apk -Prebuild
.\scripts\build-android.ps1 -App customer -Artifact aab

.\scripts\build-android.ps1 -App vendor -Artifact apk -Prebuild
.\scripts\build-android.ps1 -App vendor -Artifact aab

.\scripts\build-android.ps1 -App delivery -Artifact apk -Prebuild
.\scripts\build-android.ps1 -App delivery -Artifact aab
```

Build all three APKs, all three AABs, or all six artifacts:

```powershell
npm run android:apk
npm run android:aab
npm run android:all
```

Named copies are written to `outputs/android/`. Gradle's original outputs are:

```text
<app>/android/app/build/outputs/apk/release/app-release.apk
<app>/android/app/build/outputs/bundle/release/app-release.aab
```

For compilation/install verification before permanent keys are available, add
`-AllowDebugSigning`. Those files are named `verification-debug-signed` and
must never be uploaded to Google Play.

## EAS Build alternative

Each app has `production` (AAB) and `production-apk` profiles in `eas.json`.
After signing in to Expo/EAS and configuring the project/credentials, run from
the selected app folder:

```powershell
npx eas-cli build --platform android --profile production
npx eas-cli build --platform android --profile production-apk
```

## Release-only external configuration

The Customer tracking map needs real restricted Google Maps keys, but those
keys must not be committed to Git. `customer/app.json` keeps placeholders and
`customer/app.config.js` reads the release values from environment variables:

```properties
GOOCART_ANDROID_GOOGLE_MAPS_API_KEY=<restricted Android Maps key>
GOOCART_IOS_GOOGLE_MAPS_API_KEY=<restricted iOS Maps key>
```

For Android, restrict the key in Google Cloud Console to:

- Android application package: `com.goocart.customer`
- Release upload/app-signing certificate SHA-1

For iOS, restrict the iOS key to bundle id `com.goocart.customer`.

Only enable the APIs actually required by Goocart's mobile map experience,
such as Maps SDK for Android/iOS. Do not place server-side secrets in Expo
configuration; client mobile keys are embedded in the app and must be protected
primarily by Google Cloud restrictions.
