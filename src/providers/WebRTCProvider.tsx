import { createContext, useContext, useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { useTelnyxRTC } from "@/hooks/useTelnyxRTC";
import { IncomingCallBanner } from "@/components/IncomingCallBanner";
import { ActiveCallBar } from "@/components/ActiveCallBar";

type WebRTCContextValue = ReturnType<typeof useTelnyxRTC>;

const WebRTCContext = createContext<WebRTCContextValue | null>(null);

export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  // This provider wraps the whole router, login screen included, so nothing
  // below it may assume a session. Both calls it makes (getDialerConfig and
  // the presence heartbeat) require one, and firing them anyway meant the
  // login page issued a burst of guaranteed-401 requests — retried by react-
  // query and repeated every 30s — which is what buried real errors in the
  // console. Gate them on auth.me actually resolving to a user.
  const { data: me } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    staleTime: 1000 * 60 * 5,
  });
  const signedIn = Boolean(me);

  const { data: dialerConfig } = trpc.integration.getDialerConfig.useQuery(undefined, {
    enabled: signedIn,
  });

  const rtc = useTelnyxRTC({
    enabled: Boolean(dialerConfig?.webrtc?.enabled),
    login:    dialerConfig?.webrtc?.login    ?? "",
    password: dialerConfig?.webrtc?.password ?? "",
  });

  // Presence heartbeat: tell the server this user is online (and whether
  // they're on a call) every 30s, so the Users page can show live status.
  const heartbeatMutation = trpc.user.heartbeat.useMutation();
  const onCall = rtc.callState === "active";
  useEffect(() => {
    if (!signedIn) return;
    const send = () => {
      heartbeatMutation.mutate(
        { activity: onCall ? "on-call" : "online" },
        { onError: () => { /* session ended mid-poll — the guard will redirect */ } },
      );
    };
    send();
    const timer = setInterval(send, 30_000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCall, signedIn]);

  // Global muted state managed here so the ActiveCallBar can control it.
  const [isMuted, setIsMuted] = useState(false);

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    rtc.setMuted(next);
  };

  // Reset muted state whenever a new call starts or ends.
  useEffect(() => {
    if (rtc.callState === "idle" || rtc.callState === "ended") {
      setIsMuted(false);
    }
  }, [rtc.callState]);

  const showIncoming  = rtc.callDirection === "inbound" && rtc.callState === "ringing";
  const showActiveBar = rtc.callState === "active";

  // Caller number to display in the active bar (may be null after call ends, keep last value).
  const callerLabel = rtc.incomingCallerNumber ?? "Unknown";

  return (
    <WebRTCContext.Provider value={rtc}>
      {/* Active call bar — shown at top of every page during an active call */}
      {showActiveBar && (
        <ActiveCallBar
          callerNumber={callerLabel}
          onHangup={rtc.hangup}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
        />
      )}

      {children}

      {/* Hidden audio sink — required for Telnyx WebRTC to play remote audio */}
      <audio id={rtc.remoteAudioId} autoPlay style={{ display: "none" }} />

      {/* Incoming call popup with ringtone */}
      {showIncoming && (
        <IncomingCallBanner
          callerNumber={rtc.incomingCallerNumber ?? "Unknown caller"}
          onAnswer={rtc.answerCall}
          onDecline={rtc.hangup}
        />
      )}
    </WebRTCContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
/** Access the shared global Telnyx WebRTC client from any page. */
export function useWebRTC(): WebRTCContextValue {
  const ctx = useContext(WebRTCContext);
  if (!ctx) throw new Error("useWebRTC must be used inside <WebRTCProvider>");
  return ctx;
}