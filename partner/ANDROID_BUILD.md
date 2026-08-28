# Goocart Delivery Partner Android build

- Display name: `Goocart Delivery Partner`
- Android application ID: `com.goocart.delivery`
- Production API: `https://goo-cart.onrender.com`
- App icon and adaptive icon assets: `assets/images/`
- Signing prefix: `GOOCARTDELIVERY_`

From the repository root:

```powershell
.\scripts\build-android.ps1 -App delivery -Artifact apk -Prebuild
.\scripts\build-android.ps1 -App delivery -Artifact aab
```

Add a permanent Delivery upload keystore and all four
`GOOCARTDELIVERY_UPLOAD_*` values to `android/gradle.properties` before a
publishable build.

See `../ANDROID_RELEASES.md` for complete signing, all-app, EAS, and output
instructions.
