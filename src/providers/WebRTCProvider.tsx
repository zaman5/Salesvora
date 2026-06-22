import { createContext, useContext } from "react";
import { trpc } from "@/providers/trpc";
import { useTelnyxRTC } from "@/hooks/useTelnyxRTC";
import { IncomingCallBanner } from "@/components/IncomingCallBanner";

type WebRTCContextValue = ReturnType<typeof useTelnyxRTC>;

const WebRTCContext = createContext<WebRTCContextValue | null>(null);

export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  const { data: dialerConfig } = trpc.integration.getDialerConfig.useQuery();

  const rtc = useTelnyxRTC({
    enabled: Boolean(dialerConfig?.webrtc?.enabled),
    login:    dialerConfig?.webrtc?.login    ?? "",
    password: dialerConfig?.webrtc?.password ?? "",
  });

  const showIncoming =
    rtc.callDirection === "inbound" && rtc.callState === "ringing";

  return (
    <WebRTCContext.Provider value={rtc}>
      {children}

      {/* Hidden audio sink — required for Telnyx WebRTC to play remote audio */}
      <audio id={rtc.remoteAudioId} autoPlay style={{ display: "none" }} />

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