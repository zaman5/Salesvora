import { useCallback, useEffect, useRef, useState } from "react";

export type RtcStatus = "off" | "connecting" | "registered" | "error";
export type RtcCallState = "idle" | "ringing" | "active" | "ended";

type Options = { enabled: boolean; login: string; password: string };

// Lazily loaded Telnyx WebRTC client. We use `any` for the SDK objects because
// the SDK is dynamically imported (browser-only) and not part of our types.
type AnyClient = {
  on: (ev: string, cb: (p: unknown) => void) => void;
  connect: () => void;
  disconnect: () => void;
  newCall: (opts: Record<string, unknown>) => AnyCall;
  remoteElement?: string;
};
type AnyCall = {
  hangup: () => void;
  answer: () => void;
  dtmf?: (digit: string) => void;
  muteAudio: () => void;
  unmuteAudio: () => void;
  state?: string;
  direction?: "inbound" | "outbound";
  cause?: string;
  causeCode?: number;
  sipReason?: string;
  sipCode?: number;
  remoteCallerNumber?: string;
  remoteCallerName?: string;
  remoteStream?: MediaStream;
  localStream?: MediaStream;
};

const REMOTE_AUDIO_ID = "telnyx-remote-audio";

/**
 * Pull the caller's phone number out of a Telnyx call object. Depending on
 * SDK version and call state the caller ID lives on the call itself OR on
 * call.options, and may arrive as a bare number, "+E.164", or a SIP URI like
 * "sip:+15550001234@sip.telnyx.com". Checking only call.remoteCallerNumber
 * (the old behavior) showed "Unknown" for most real inbound calls.
 */
function extractCallerNumber(call: AnyCall): string | null {
  const opts = ((call as unknown as { options?: Record<string, unknown> }).options ?? {}) as Record<string, unknown>;
  const candidates = [
    call.remoteCallerNumber,
    opts.remoteCallerNumber,
    opts.callerNumber,
    call.remoteCallerName,
    opts.remoteCallerName,
    opts.callerName,
  ];
  // First pass: anything containing a dialable number wins.
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      const m = c.match(/\+?\d[\d\s().-]{5,}/);
      if (m) {
        const cleaned = m[0].replace(/[^\d+]/g, "");
        if (cleaned.replace(/\D/g, "").length >= 6) return cleaned;
      }
    }
  }
  // Second pass: fall back to a display name (better than "Unknown").
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && !/^(anonymous|unknown)$/i.test(c.trim())) {
      return c.trim();
    }
  }
  return null;
}

/**
 * Force the call's remote audio stream into the hidden <audio> element and
 * start playback. The SDK is supposed to do this via remoteElement, but on
 * answered inbound calls the stream sometimes arrives after the element was
 * wired (or the SDK skips it entirely) — leaving the agent unable to hear
 * the caller. Safe to call repeatedly; it only reassigns when needed.
 */
function attachRemoteAudio(call: AnyCall | null) {
  if (!call || typeof document === "undefined") return;
  const el = document.getElementById(REMOTE_AUDIO_ID) as HTMLAudioElement | null;
  const stream = call.remoteStream;
  if (!el || !(stream instanceof MediaStream) || stream.getAudioTracks().length === 0) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  el.muted = false;
  el.play().catch(() => { /* autoplay may need the user gesture that answered the call */ });
}

// Telnyx sends errors as objects, strings, or Errors. Pull out something useful.
function describeError(e: unknown): string {
  if (!e) return "Unknown WebRTC error.";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  const o = e as Record<string, unknown>;
  const nested = (o.error ?? {}) as Record<string, unknown>;
  const parts = [
    o.message,
    nested.message,
    nested.cause,
    o.cause,
    o.reason,
    o.code != null ? `code ${o.code}` : undefined,
    nested.code != null ? `code ${nested.code}` : undefined,
  ].filter(Boolean);
  if (parts.length) return String(parts.join(" — "));
  try {
    return JSON.stringify(o);
  } catch {
    return "WebRTC error.";
  }
}

export function useTelnyxRTC({ enabled, login, password }: Options) {
  const [status, setStatus] = useState<RtcStatus>("off");
  const [callState, setCallState] = useState<RtcCallState>("idle");
  const [callDirection, setCallDirection] = useState<"inbound" | "outbound" | null>(null);
  const [incomingCallerNumber, setIncomingCallerNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<AnyClient | null>(null);
  const callRef = useRef<AnyCall | null>(null);

  // Connect / disconnect when credentials become available.
  useEffect(() => {
    let cancelled = false;
    // Hoisted so the cleanup function can always clear it, even if the async
    // IIFE hasn't set it yet (e.g. the effect is torn down before the dynamic
    // import resolves).
    let regTimeout: ReturnType<typeof setTimeout> | undefined;

    if (!enabled || !login || !password) {
      setStatus("off");
      return;
    }
    setStatus("connecting");
    setError(null);

    (async () => {
      try {
        const mod = await import("@telnyx/webrtc");
        if (cancelled) return;
        const TelnyxRTC = (mod as { TelnyxRTC: new (o: Record<string, unknown>) => AnyClient }).TelnyxRTC;
        const client = new TelnyxRTC({
          login,
          password,
          // Relay media through Telnyx TURN to traverse firewalls/NAT.
          forceRelayCandidate: true,
          prefetchIceCandidates: true,
        });
        // The SDK IGNORES a remoteElement constructor option — its
        // constructor resets the field to null, and only this property
        // setter (the way the official docs wire it) registers the element.
        // Inbound calls inherit it from the client; without it the SDK never
        // attaches the caller's audio and answered calls are silent.
        client.remoteElement = REMOTE_AUDIO_ID;

        let reconnects = 0;
        let registered = false;

        // If telnyx.ready doesn't fire within 30 s, credentials are wrong.
        regTimeout = setTimeout(() => {
          if (!cancelled && !registered) {
            setStatus("error");
            setError(
              "SIP registration timed out. Check your SIP username and password in Settings — they must match your Telnyx Credential Connection exactly.",
            );
          }
        }, 30_000);

        client.on("telnyx.ready", () => {
          if (cancelled) return;
          registered = true;
          clearTimeout(regTimeout);
          setStatus("registered");
        });
        client.on("telnyx.error", (e: unknown) => {
          if (cancelled) return;
          console.error("[Telnyx] error:", e);
          setStatus("error");
          setError(describeError(e));
        });
        client.on("telnyx.socket.error", (e: unknown) => {
          if (cancelled) return;
          console.error("[Telnyx] socket error:", e);
          setStatus("error");
          setError(describeError(e) || "Could not reach Telnyx (socket error).");
        });
        client.on("telnyx.socket.close", () => {
          if (cancelled) return;
          reconnects += 1;
          registered = false;
          setStatus((s) => (s === "registered" ? "connecting" : s));
          // Repeated drops = unhealthy signaling path (often a VPN/proxy or
          // restrictive network). Tell the user something actionable.
          if (reconnects >= 2) {
            setError(
              "Connection to Telnyx keeps dropping (signaling timed out). This is a network issue — disable any VPN/proxy, avoid restrictive Wi-Fi, and try again.",
            );
          }
          // The SDK does not always re-open the signaling socket on its own —
          // without this, the agent silently stays unregistered and misses
          // every inbound call until they manually refresh the page.
          const delay = Math.min(1000 * reconnects, 10_000);
          setTimeout(() => {
            if (!cancelled) {
              try { clientRef.current?.connect(); } catch { /* noop */ }
            }
          }, delay);
        });
        client.on("telnyx.notification", (n: unknown) => {
          if (cancelled) return;
          const note = n as { type?: string; call?: AnyCall; error?: unknown };
          if (note?.type === "userMediaError") {
            setError("Microphone access failed. Allow mic permission and use http://localhost or https.");
            return;
          }
          if (note?.type === "callUpdate" && note.call) {
            callRef.current = note.call;
            const s = String(note.call.state || "");
            if (["new", "requesting", "trying", "ringing", "early"].includes(s)) {
              const dir = note.call.direction === "inbound" ? "inbound" : "outbound";
              setCallDirection(dir);
              if (dir === "inbound") {
                setIncomingCallerNumber(extractCallerNumber(note.call) || "Unknown");
              }
              setCallState("ringing");
            } else if (s === "active") {
              setCallState("active");
              // Make sure the caller's audio actually reaches the speakers —
              // the remote stream can lag behind the "active" event, so retry
              // a few times instead of attaching once and hoping.
              attachRemoteAudio(note.call);
              const activeCall = note.call;
              [300, 1000, 2500].forEach((ms) =>
                setTimeout(() => { if (callRef.current === activeCall) attachRemoteAudio(activeCall); }, ms),
              );
              // Caller ID sometimes only becomes available once the call is
              // answered — refresh it so the active bar shows the real number.
              if (note.call.direction === "inbound") {
                const n = extractCallerNumber(note.call);
                if (n) setIncomingCallerNumber(n);
              }
            } else if (["hangup", "destroy", "purge"].includes(s)) {
              const c = note.call;
              const failed = c.sipCode && c.sipCode >= 400;
              if (failed || (c.cause && c.cause !== "NORMAL_CLEARING" && c.cause !== "USER_HANGUP")) {
                // Provide actionable messages for common SIP error codes
                let msg = `${c.sipReason || c.cause || "Call failed"}`;
                if (c.sipCode === 480) {
                  msg = "Destination temporarily unavailable (SIP 480). Usually the connection " +
                    "has no Outbound Voice Profile or the from-number isn't on your Telnyx account. " +
                    "Fix: ask your superadmin to open Settings and click \"Fix Outbound Calling\" — " +
                    "it attaches a voice profile to every Salesvora connection automatically.";
                } else if (c.sipCode === 403) {
                  msg = "Call forbidden (SIP 403) — the from-number may not be authorized on this connection.";
                } else if (c.sipCode === 486) {
                  msg = "Destination busy (SIP 486).";
                } else if (c.sipCode === 404) {
                  msg = "Number not found (SIP 404) — check the destination number format (+country code).";
                } else if (c.sipCode) {
                  msg += ` (SIP ${c.sipCode})`;
                }
                setError(msg);
              }
              setCallState("ended");
              setCallDirection(null);
              setIncomingCallerNumber(null);
              callRef.current = null;
            }
          }
        });

        client.connect();
        clientRef.current = client;
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Failed to load the WebRTC client.");
        }
      }
    })();

    return () => {
      cancelled = true;
      try { clearTimeout(regTimeout); } catch { /* noop */ }
      try {
        callRef.current?.hangup();
      } catch { /* noop */ }
      try {
        clientRef.current?.disconnect();
      } catch { /* noop */ }
      clientRef.current = null;
      callRef.current = null;
    };
  }, [enabled, login, password]);

  const makeCall = useCallback((destinationNumber: string, callerNumber: string) => {
    setError(null);
    if (!clientRef.current || status !== "registered") {
      setError("Browser calling isn't connected yet. Check your SIP credentials in Settings.");
      return false;
    }
    // Normalize numbers to E.164 — Telnyx WebRTC requires "+countrycode..." format.
    // Strip spaces, dashes, parens, dots; preserve a leading "+". Numbers
    // without a country code default to +1 (NANP) so agents can dial
    // "3022403311" and it goes out as "+13022403311".
    const toE164 = (raw: string) => {
      if (!raw) return raw;
      const trimmed = raw.trim();
      const hasPlus = trimmed.startsWith("+");
      const digits = trimmed.replace(/[^0-9]/g, "");
      if (hasPlus) return `+${digits}`;
      if (digits.length === 10) return `+1${digits}`;
      if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
      return digits;
    };
    const dest   = toE164(destinationNumber);
    const caller = toE164(callerNumber);   // empty string = Telnyx picks default

    try {
      callRef.current = clientRef.current.newCall({
        destinationNumber: dest,
        callerNumber:      caller || undefined, // omit if empty so Telnyx uses its default
        audio: true,
        video: false,
        remoteElement: REMOTE_AUDIO_ID,
      });
      setCallState("ringing");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the call.");
      return false;
    }
  }, [status]);

  const sendDTMF = useCallback((digit: string) => {
    try { callRef.current?.dtmf?.(digit); } catch { /* noop */ }
  }, []);

  const answerCall = useCallback(() => {
    try {
      const call = callRef.current;
      if (call) {
        // Ensure audio routes to the remote audio element for inbound calls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call as any).remoteElement = REMOTE_AUDIO_ID;
        call.answer();
      }
    } catch { /* noop */ }
    setCallState("active");
  }, []);

  const hangup = useCallback(() => {
    try {
      callRef.current?.hangup();
    } catch { /* noop */ }
    callRef.current = null;
    setCallDirection(null);
    setIncomingCallerNumber(null);
    setCallState("idle");
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    try {
      if (muted) callRef.current?.muteAudio();
      else callRef.current?.unmuteAudio();
    } catch { /* noop */ }
  }, []);

  // The client's audio. Prefer the live call's remoteStream; fall back to the
  // remote <audio> element's srcObject. Used by the recorder to mix both sides.
  const getRemoteStream = useCallback((): MediaStream | null => {
    const fromCall = callRef.current?.remoteStream;
    if (fromCall instanceof MediaStream && fromCall.getAudioTracks().length) return fromCall;
    if (typeof document === "undefined") return null;
    const el = document.getElementById(REMOTE_AUDIO_ID) as HTMLAudioElement | null;
    const src = el?.srcObject;
    return src instanceof MediaStream ? src : null;
  }, []);

  return {
    status,
    callState,
    callDirection,
    incomingCallerNumber,
    error,
    makeCall,
    answerCall,
    sendDTMF,
    hangup,
    setMuted,
    getRemoteStream,
    remoteAudioId: REMOTE_AUDIO_ID,
  };
}
