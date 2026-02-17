import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.beanlog.app',
  appName: 'BeanLog',
  webDir: 'dist',

  // Server config for live-reload during development (uncomment when running `npm run dev`)
  // server: {
  //   url: 'http://YOUR_LOCAL_IP:5173',
  //   cleartext: true,
  // },

  plugins: {
    Camera: {
      // iOS: added to Info.plist automatically by Capacitor
    },
    StatusBar: {
      // Use default (dark content) status bar
    },
    SplashScreen: {
      launchAutoHide: true,
      androidScaleType: 'CENTER_CROP',
    },
  },

  // Android-specific overrides
  android: {
    // Allow mixed content for Supabase calls over HTTPS from local WebView
    allowMixedContent: true,
  },
};

export default config;

