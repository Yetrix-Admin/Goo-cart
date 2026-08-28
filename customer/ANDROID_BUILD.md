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
`android/gradle.properties` before a publishable build. The tracking map also
needs real restricted Google Maps keys in `app.json`.

See `../ANDROID_RELEASES.md` for complete signing, all-app, EAS, and output
instructions.
