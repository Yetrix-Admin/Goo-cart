# Goocart Customer Android build

- Display name: `Goocart Customer`
- Android application ID: `com.goocart.customer`
- Production API: `https://goo-cart.onrender.com`
- App icon and adaptive icon assets: `assets/images/`
- Signing prefix: `GOOCART_`

From the repository root:

```powershell
.\scripts\build-android.ps1 -App customer -Artifact apk -Prebuild
.\scripts\build-android.ps1 -App customer -Artifact aab
```

The first command refreshes the ignored native project from `app.json`. Add a
permanent Customer upload keystore and all four `GOOCART_UPLOAD_*` values to
`android/gradle.properties` before a publishable build.

The tracking map needs restricted Google Maps keys supplied by environment
variables, not hardcoded into `app.json`. Copy `.env.example` to the ignored
`customer/.env` and set:

- `GOOCART_ANDROID_GOOGLE_MAPS_API_KEY`
- `GOOCART_IOS_GOOGLE_MAPS_API_KEY`

Before release, restrict the Android key in Google Cloud Console to package
`com.goocart.customer` plus the release signing certificate SHA-1, and restrict
the iOS key to bundle id `com.goocart.customer`. Enable only the Google Maps
APIs used by the app, such as Maps SDK for Android/iOS.

See `../ANDROID_RELEASES.md` for complete signing, all-app, EAS, and output
instructions.
