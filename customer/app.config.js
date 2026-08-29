const baseConfig = require("./app.json");

const PLACEHOLDERS = {
  android: "REPLACE_WITH_ANDROID_GOOGLE_MAPS_API_KEY",
  ios: "REPLACE_WITH_IOS_GOOGLE_MAPS_API_KEY",
};

function env(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

module.exports = () => {
  const expo = JSON.parse(JSON.stringify(baseConfig.expo));
  const androidMapsKey =
    env("GOOCART_ANDROID_GOOGLE_MAPS_API_KEY") ||
    env("EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY") ||
    PLACEHOLDERS.android;
  const iosMapsKey =
    env("GOOCART_IOS_GOOGLE_MAPS_API_KEY") ||
    env("EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY") ||
    PLACEHOLDERS.ios;

  expo.android = {
    ...expo.android,
    config: {
      ...expo.android?.config,
      googleMaps: {
        ...expo.android?.config?.googleMaps,
        apiKey: androidMapsKey,
      },
    },
  };

  expo.ios = {
    ...expo.ios,
    config: {
      ...expo.ios?.config,
      googleMapsApiKey: iosMapsKey,
    },
  };

  return { expo };
};
