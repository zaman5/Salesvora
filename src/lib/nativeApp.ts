import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

/**
 * Bridge between the web app and the Salesvora Android shell. Everything here
 * is a no-op in a normal browser, so the web app can call it unconditionally.
 */

type CallBridgePlugin = {
  consumePendingAnswer(): Promise<{ pending: boolean; callId: string }>;
  endCallUi(): Promise<void>;
  addListener(event: "answerRequested", cb: (data: { callId: string }) => void): Promise<PluginListenerHandle>;
};

const CallBridge = registerPlugin<CallBridgePlugin>("CallBridge");

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Ask for notification permission, register with Firebase and hand the device
 * token to `save` (which stores it on the signed-in account). Tapping a
 * notification calls `onOpen` with the path to show.
 */
export async function registerForPush(opts: {
  save: (token: string) => void;
  onOpen: (path: string) => void;
}): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  const handles: PluginListenerHandle[] = [];
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return () => {};

    handles.push(await PushNotifications.addListener("registration", (t) => opts.save(t.value)));
    handles.push(await PushNotifications.addListener("registrationError", (e) => {
      console.warn("[native] push registration failed:", e.error);
    }));
    handles.push(await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const kind = action.notification.data?.kind;
      opts.onOpen(kind === "sms" ? "/sms" : kind === "missed_call" || kind === "voicemail" ? "/call-logs" : "/dialer");
    }));
    await PushNotifications.register();
  } catch (err) {
    console.warn("[native] push setup failed:", err);
  }
  return () => handles.forEach((h) => void h.remove());
}

/** The current Firebase token, for unregistering on logout. */
let lastToken: string | null = null;
export function rememberPushToken(token: string) {
  lastToken = token;
}
export function currentPushToken(): string | null {
  return lastToken;
}

/**
 * Fires `onAnswer` when the agent tapped Answer on the native ringing screen —
 * immediately if the app was already running, or right after start-up if the
 * tap is what launched it (the request stays valid for 60 seconds).
 */
export async function watchNativeAnswer(onAnswer: () => void): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  const check = async () => {
    try {
      const res = await CallBridge.consumePendingAnswer();
      if (res.pending) onAnswer();
    } catch { /* plugin missing in an old APK */ }
  };
  let handle: PluginListenerHandle | undefined;
  try {
    handle = await CallBridge.addListener("answerRequested", () => void check());
  } catch { /* plugin missing in an old APK */ }
  void check();
  const onVisible = () => { if (document.visibilityState === "visible") void check(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    void handle?.remove();
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Call finished: drop the lock-screen/keep-awake call mode. */
export function endNativeCallUi() {
  if (isNativeApp()) void CallBridge.endCallUi().catch(() => {});
}
