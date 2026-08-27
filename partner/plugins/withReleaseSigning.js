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
 * Property names are prefixed GOOCARTPARTNER_ (not GOOCART_) so this app's
 * signing config can never collide with the customer app's if both are ever
 * built from gradle.properties on the same machine.
 */
const SIGNING_CONFIG = `        release {
            if (project.hasProperty('GOOCARTPARTNER_UPLOAD_STORE_FILE')) {
                storeFile file(GOOCARTPARTNER_UPLOAD_STORE_FILE)
                storePassword GOOCARTPARTNER_UPLOAD_STORE_PASSWORD
                keyAlias GOOCARTPARTNER_UPLOAD_KEY_ALIAS
                keyPassword GOOCARTPARTNER_UPLOAD_KEY_PASSWORD
            }
        }
`;

const RELEASE_SIGNING_LINE =
  "            signingConfig project.hasProperty('GOOCARTPARTNER_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;

    // 1. Add the `release` signing config beside the generated `debug` one.
    if (!contents.includes("GOOCARTPARTNER_UPLOAD_STORE_FILE")) {
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
      RELEASE_SIGNING_LINE,
    );

    mod.modResults.contents = contents;
    return mod;
  });
};
