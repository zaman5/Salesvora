import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Salesvora Android app.
 *
 * The app is a native shell around the live web app: the WebView loads
 * SALESVORA_APP_URL (default https://salesvora.online) directly, so login
 * cookies, the API and every page behave exactly as in the browser, and a web
 * deploy updates the app without a new APK. Native code adds what a browser
 * cannot: Firebase push, a full-screen incoming-call screen on the lock
 * screen, and microphone access for WebRTC calls.
 *
 * Point it at a dev server with e.g. SALESVORA_APP_URL=http://192.168.1.20:3000
 * before `npx cap sync android` (cleartext is then allowed automatically).
 */
const appUrl = (process.env.SALESVORA_APP_URL || "https://salesvora.online").replace(/\/+$/, "");
const host = new URL(appUrl).hostname;

const config: CapacitorConfig = {
  appId: "online.salesvora.app",
  appName: "Salesvora",
  webDir: "dist/public",
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith("http://"),
    allowNavigation: [host],
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
