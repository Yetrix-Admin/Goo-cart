const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Re-applies the release signing config after `expo prebuild`.
 *
 * `android/` is generated output — prebuild overwrites app/build.gradle, so a
 * hand-edited signingConfig disappears on the next run and release APKs
 * silently fall back to the debug key. This plugin re-injects it every time.
 *
 * Credentials are read from android/gradle.properties (gitignored); nothing
 * secret lives in this file or in build.gradle.
 *
 * Property names are prefixed GOOCARTDELIVERY_ (not GOOCART_) so this app's
 * signing config can never collide with the customer app's if both are ever
 * built from gradle.properties on the same machine.
 */
const SIGNING_CONFIG = `        release {
            if (project.hasProperty('GOOCARTDELIVERY_UPLOAD_STORE_FILE')) {
                storeFile file(GOOCARTDELIVERY_UPLOAD_STORE_FILE)
                storePassword GOOCARTDELIVERY_UPLOAD_STORE_PASSWORD
                keyAlias GOOCARTDELIVERY_UPLOAD_KEY_ALIAS
                keyPassword GOOCARTDELIVERY_UPLOAD_KEY_PASSWORD
            }
        }
`;

const STORE_PROPERTY = "GOOCARTDELIVERY_UPLOAD_STORE_FILE";
const RELEASE_SIGNING_BLOCK = `            if (project.hasProperty('${STORE_PROPERTY}')) {
                signingConfig signingConfigs.release
            } else if ((findProperty('goocart.allowDebugSigning') ?: 'false').toBoolean()) {
                // Explicit opt-in for local build verification only. Never publish this artifact.
                signingConfig signingConfigs.debug
            }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;

    // Remove the legacy Partner signing block when upgrading an existing
    // generated project from GOOCARTPARTNER_ to GOOCARTDELIVERY_.
    contents = contents.replace(
      /\s{8}release \{\n\s{12}if \(project\.hasProperty\('GOOCARTPARTNER_UPLOAD_STORE_FILE'\)\) \{\n\s{16}storeFile file\(GOOCARTPARTNER_UPLOAD_STORE_FILE\)\n\s{16}storePassword GOOCARTPARTNER_UPLOAD_STORE_PASSWORD\n\s{16}keyAlias GOOCARTPARTNER_UPLOAD_KEY_ALIAS\n\s{16}keyPassword GOOCARTPARTNER_UPLOAD_KEY_PASSWORD\n\s{12}\}\n\s{8}\}\n/g,
      "",
    );

    // 1. Add the `release` signing config beside the generated `debug` one.
    if (!contents.includes(STORE_PROPERTY)) {
      const debugBlockEnd = contents.indexOf("keyPassword 'android'\n        }\n");
      if (debugBlockEnd === -1) {
        throw new Error("withReleaseSigning: could not locate the debug signingConfig block.");
      }
      const insertAt = debugBlockEnd + "keyPassword 'android'\n        }\n".length;
      contents = contents.slice(0, insertAt) + SIGNING_CONFIG + contents.slice(insertAt);
    }

    // 2. Point the release buildType at it instead of the debug key.
    contents = contents.replace(
      /^\s*\/\/ Caution! In production.*\n\s*\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n\s*signingConfig signingConfigs\.debug$/m,
      RELEASE_SIGNING_BLOCK,
    );
    // Also re-normalizes a block this plugin generated under a *previous*
    // UPLOAD_* prefix (e.g. GOOCARTPARTNER_ before it was renamed to
    // GOOCARTDELIVERY_) — without this, a stale prefix survives in the
    // buildType's condition even though the signingConfigs.release block
    // above was already updated, and Gradle fails release packaging with
    // "SigningConfig 'release' is missing required property 'storeFile'".
    contents = contents.replace(
      /^(\s*)if \(project\.hasProperty\('\w+_UPLOAD_STORE_FILE'\)\) \{\n\s*signingConfig signingConfigs\.release\n\s*\} else if \(\(findProperty\('goocart\.allowDebugSigning'\) \?: 'false'\)\.toBoolean\(\)\) \{\n\s*\/\/ Explicit opt-in for local build verification only\. Never publish this artifact\.\n\s*signingConfig signingConfigs\.debug\n\s*\}$/m,
      RELEASE_SIGNING_BLOCK,
    );

    mod.modResults.contents = contents;
    return mod;
  });
};
