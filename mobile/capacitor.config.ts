import type { CapacitorConfig } from '@capacitor/cli';

const apiBaseUrl = process.env.MOBILE_API_BASE_URL?.trim();

const config: CapacitorConfig = {
  appId: 'com.xtobsky.app',
  appName: 'X to Bluesky',
  webDir: '../client/dist',
  bundledWebRuntime: false,
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  server: apiBaseUrl
    ? {
        url: apiBaseUrl,
        cleartext: apiBaseUrl.startsWith('http://'),
      }
    : undefined,
};

export default config;
