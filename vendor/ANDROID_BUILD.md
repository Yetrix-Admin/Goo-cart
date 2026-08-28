# Goocart Vendor Android build

- Display name: `Goocart Vendor`
- Android application ID: `com.goocart.vendor`
- Production API: `https://goo-cart.onrender.com`
- App icon and adaptive icon assets: `assets/images/`
- Signing prefix: `GOOCARTVENDOR_`

From the repository root:

```powershell
.\scripts\build-android.ps1 -App vendor -Artifact apk -Prebuild
.\scripts\build-android.ps1 -App vendor -Artifact aab
```

Add a permanent Vendor upload keystore and all four
`GOOCARTVENDOR_UPLOAD_*` values to `android/gradle.properties` before a
publishable build.

See `../ANDROID_RELEASES.md` for complete signing, all-app, EAS, and output
instructions.
