import { createContext, useContext, useState, useEffect, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useTelnyxRTC } from "@/hooks/useTelnyxRTC";
import { useSignalWireRTC } from "@/hooks/useSignalWireRTC";
import { IncomingCallBanner } from "@/components/IncomingCallBanner";
import { ActiveCallBar } from "@/components/ActiveCallBar";
import { useNavigate } from "react-router";
import { registerForPush, rememberPushToken, watchNativeAnswer, endNativeCallUi, isNativeApp } from "@/lib/nativeApp";

type WebRTCContextValue = (ReturnType<typeof useTelnyxRTC> | ReturnType<typeof useSignalWireRTC>) & {
  activeInboundCallId?: number | null;
};

const WebRTCContext = createContext<WebRTCContextValue | null>(null);

export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  // This provider wraps the whole router, login screen included, so nothing
  // below it may assume a session. Gate queries on auth.me actually resolving to a user.
  const { data: me } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    staleTime: 1000 * 60 * 5,
  });
  const signedIn = Boolean(me);

  const { data: dialerConfig } = trpc.integration.getDialerConfig.useQuery(undefined, {
    enabled: signedIn,
  });

  const isSignalWire = dialerConfig?.provider === "signalwire";
  const webrtcEnabled = Boolean(dialerConfig?.webrtc?.enabled);

  const telnyxRtc = useTelnyxRTC({
    enabled: !isSignalWire && webrtcEnabled,
    login:    dialerConfig?.webrtc?.login    ?? "",
    password: dialerConfig?.webrtc?.password ?? "",
  });

  const signalWireRtc = useSignalWireRTC({
    enabled: isSignalWire && webrtcEnabled,
  });

  const rtc = isSignalWire ? signalWireRtc : telnyxRtc;

  // Track global inbound call record in DB so incoming calls answered from ANY page are never missed
  const [activeInboundCallId, setActiveInboundCallId] = useState<number | null>(null);
  const activeInboundCallRef = useRef<number | null>(null);
  activeInboundCallRef.current = activeInboundCallId;

  const initiateCallMutation = trpc.calls.initiate.useMutation();
  const updateStatusMutation = trpc.calls.updateStatus.useMutation();

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

  // Global Inbound Call Lifecycle management
  useEffect(() => {
    if (!signedIn || !me) return;

    if (rtc.callState === "active" && rtc.callDirection === "inbound" && !activeInboundCallRef.current) {
      const companyId = me.companyId ?? 1;
      const callerNumber = rtc.incomingCallerNumber || "Unknown";

      initiateCallMutation
        .mutateAsync({
          companyId,
          toNumber: callerNumber,
          type: "inbound",
        })
        .then((call) => {
          if (call?.id) {
            setActiveInboundCallId(call.id);
            updateStatusMutation.mutate({ id: call.id, status: "connected" });
          }
        })
        .catch((err) => {
          console.error("[WebRTCProvider] Failed to log inbound call:", err);
        });
    } else if (rtc.callState === "ended" && activeInboundCallRef.current) {
      const callId = activeInboundCallRef.current;
      setActiveInboundCallId(null);
      updateStatusMutation.mutate({ id: callId, status: "completed" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtc.callState, rtc.callDirection, signedIn, me?.companyId]);

  // ── Android app ─────────────────────────────────────────────────────────
  // Register this phone for push once signed in, so calls/SMS to this user's
  // numbers reach it even when the app is closed.
  const navigate = useNavigate();
  const registerPushToken = trpc.user.registerPushToken.useMutation();
  useEffect(() => {
    if (!signedIn || !isNativeApp()) return;
    let cleanup = () => {};
    void registerForPush({
      save: (token) => {
        rememberPushToken(token);
        registerPushToken.mutate({ token, platform: "android" });
      },
      onOpen: (path) => navigate(path),
    }).then((fn) => { cleanup = fn; });
    return () => cleanup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, me?.id]);

  // "Answer" on the native lock-screen ringing screen launches the app; the
  // SignalWire call then rings this WebRTC client a few seconds later. Arm an
  // auto-answer window so the agent doesn't have to tap Answer twice.
  const answerArmedUntilRef = useRef(0);
  const rtcRef = useRef(rtc);
  rtcRef.current = rtc;
  useEffect(() => {
    if (!signedIn || !isNativeApp()) return;
    let cleanup = () => {};
    void watchNativeAnswer(() => {
      answerArmedUntilRef.current = Date.now() + 45_000;
      const live = rtcRef.current;
      if (live.callDirection === "inbound" && live.callState === "ringing") {
        answerArmedUntilRef.current = 0;
        void live.answerCall();
      }
    }).then((fn) => { cleanup = fn; });
    return () => cleanup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);
  useEffect(() => {
    if (rtc.callDirection === "inbound" && rtc.callState === "ringing" && Date.now() < answerArmedUntilRef.current) {
      answerArmedUntilRef.current = 0;
      void rtc.answerCall();
    }
    if (rtc.callState === "ended" || rtc.callState === "idle") endNativeCallUi();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtc.callState, rtc.callDirection]);

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

  const contextValue: WebRTCContextValue = {
    ...rtc,
    activeInboundCallId,
  };

  return (
    <WebRTCContext.Provider value={contextValue}>
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

      {/* Audio sink — required for WebRTC to play remote caller/client audio */}
      <audio
        id={rtc.remoteAudioId}
        autoPlay
        playsInline
        style={{ position: "fixed", top: -9999, left: -9999, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />

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