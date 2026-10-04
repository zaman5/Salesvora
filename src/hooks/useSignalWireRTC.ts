import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";

export type RtcStatus = "off" | "connecting" | "registered" | "error";
export type RtcCallState = "idle" | "ringing" | "active" | "ended";

type Options = { enabled: boolean };

const REMOTE_AUDIO_ID = "signalwire-remote-audio";

function getOrCreateAudioSink(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(REMOTE_AUDIO_ID) as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement("audio");
    el.id = REMOTE_AUDIO_ID;
    el.autoplay = true;
    el.playsInline = true;
    el.style.position = "fixed";
    el.style.top = "-9999px";
    el.style.left = "-9999px";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    document.body.appendChild(el);
  }
  return el;
}

function attachRemoteAudio(stream: MediaStream | null | undefined) {
  if (!stream || typeof document === "undefined") return;
  const el = getOrCreateAudioSink();
  if (!el) return;

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) return;
  audioTracks.forEach((t) => {
    t.enabled = true;
  });

  if (el.srcObject !== stream) {
    el.srcObject = stream;
  }
  el.muted = false;
  el.volume = 1.0;
  const playPromise = el.play();
  if (playPromise !== undefined) {
    playPromise.catch((err) => {
      console.warn("[SignalWire WebRTC] Auto-play prevented by browser policy:", err);
    });
  }
}

export function useSignalWireRTC({ enabled }: Options) {
  const [status, setStatus] = useState<RtcStatus>("off");
  const [callState, setCallState] = useState<RtcCallState>("idle");
  const [callDirection, setCallDirection] = useState<"inbound" | "outbound" | null>(null);
  const [incomingCallerNumber, setIncomingCallerNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subsRef = useRef<any[]>([]);

  const getTokenMutation = trpc.integration.getSignalWireSubscriberToken.useMutation();

  const cleanup = useCallback(() => {
    subsRef.current.forEach((sub) => {
      try {
        sub?.unsubscribe?.();
      } catch {
        /* noop */
      }
    });
    subsRef.current = [];

    if (callRef.current) {
      try {
        callRef.current.hangup?.();
      } catch {
        /* noop */
      }
      callRef.current = null;
    }

    if (clientRef.current) {
      try {
        clientRef.current.disconnect?.();
      } catch {
        /* noop */
      }
      clientRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      setStatus("off");
      setCallState("idle");
      setError(null);
      return;
    }

    let isMounted = true;
    setStatus("connecting");
    setError(null);

    async function initClient() {
      try {
        const tokenRes = await getTokenMutation.mutateAsync();
        if (!isMounted) return;

        if (!tokenRes.ok || !tokenRes.data?.token) {
          throw new Error(tokenRes.ok === false ? tokenRes.message : "Failed to obtain SignalWire WebRTC token");
        }

        const { SignalWire, StaticCredentialProvider } = await import("@signalwire/js");
        if (!isMounted) return;

        const provider = new StaticCredentialProvider({ token: tokenRes.data.token });
        const client = new SignalWire(provider);
        clientRef.current = client;

        // Listen for errors
        if (client.errors$) {
          const errSub = client.errors$.subscribe((err: Error) => {
            console.error("[SignalWire WebRTC Error]", err);
            if (isMounted) {
              setError(err.message || "SignalWire connection error");
              setStatus("error");
            }
          });
          subsRef.current.push(errSub);
        }

        const markReady = () => {
          if (!isMounted) return;
          setStatus("registered");
          setError(null);
        };

        // Listen for connection states
        if (client.isConnected$) {
          const connSub = client.isConnected$.subscribe((conn: boolean) => {
            if (conn) markReady();
          });
          subsRef.current.push(connSub);
        }

        if (client.isRegistered$) {
          const regSub = client.isRegistered$.subscribe((reg: boolean) => {
            if (reg) markReady();
          });
          subsRef.current.push(regSub);
        }

        if (client.ready$) {
          const readySub = client.ready$.subscribe((isReady: boolean) => {
            if (isReady) markReady();
          });
          subsRef.current.push(readySub);
        }

        if (client.isConnected || client.isRegistered) {
          markReady();
        }

        // Listen for incoming calls once session is available
        const setupCallsListener = () => {
          const session = client.session;
          if (session?.calls$) {
            const callsSub = session.calls$.subscribe((callsMap: Record<string, any>) => {
              if (!isMounted || !callsMap) return;
              const calls = Object.values(callsMap);
              const inbound = calls.find(
                (c) => c && (c.displayDirection === "inbound" || (c.from && c !== callRef.current))
              );
              if (inbound && callState === "idle") {
                callRef.current = inbound;
                setCallDirection("inbound");
                setIncomingCallerNumber(inbound.from || inbound.caller_id_number || "Incoming Caller");
                setCallState("ringing");

                if (inbound.remoteStream$) {
                  const streamSub = inbound.remoteStream$.subscribe((stream: MediaStream) => {
                    attachRemoteAudio(stream);
                  });
                  subsRef.current.push(streamSub);
                }

                if (inbound.status$) {
                  const statusSub = inbound.status$.subscribe((st: string) => {
                    if (st === "connected" || st === "active") {
                      setCallState("active");
                      if (inbound.remoteStream) attachRemoteAudio(inbound.remoteStream);
                    } else if (st === "destroyed" || st === "disconnecting" || st === "ended") {
                      setCallState("ended");
                      setCallDirection(null);
                      setIncomingCallerNumber(null);
                      callRef.current = null;
                    }
                  });
                  subsRef.current.push(statusSub);
                }
              }
            });
            subsRef.current.push(callsSub);
          }
        };

        setupCallsListener();
      } catch (err) {
        if (!isMounted) return;
        console.error("[SignalWire WebRTC Init Failed]", err);
        setStatus("error");
        setError(err instanceof Error ? err.message : "Failed to connect SignalWire WebRTC.");
      }
    }

    initClient();

    return () => {
      isMounted = false;
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const makeCall = useCallback(async (destinationNumber: string, callerNumber?: string) => {
    if (!clientRef.current) {
      const msg = "SignalWire browser calling client is not initialized.";
      setError(msg);
      return { ok: false, error: msg };
    }

    const toE164 = (raw: string) => {
      if (!raw) return raw;
      const trimmed = raw.trim();
      const hasPlus = trimmed.startsWith("+");
      const digits = trimmed.replace(/[^0-9]/g, "");
      if (hasPlus) return `+${digits}`;
      if (digits.length === 10) return `+1${digits}`;
      if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
      return `+${digits}`;
    };

    const dest = toE164(destinationNumber);
    if (!dest || dest.length < 4) {
      const msg = "Please enter a valid phone number to dial.";
      setError(msg);
      return { ok: false, error: msg };
    }

    try {
      // Check microphone permission first for clear user feedback
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
        try {
          const testStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          testStream.getTracks().forEach((t) => t.stop());
        } catch (micErr) {
          const micMsg = micErr instanceof Error ? micErr.message : "Microphone permission denied";
          const friendly = `Microphone access required: ${micMsg}. Please click the lock icon in your address bar and allow microphone access.`;
          setError(friendly);
          return { ok: false, error: friendly };
        }
      }

      getOrCreateAudioSink()?.play().catch(() => {});

      const client = clientRef.current;
      setCallDirection("outbound");
      setCallState("ringing");

      const call = await client.dial(dest, {
        audio: true,
        video: false,
      });

      callRef.current = call;

      if (call.remoteStream) {
        attachRemoteAudio(call.remoteStream);
      }

      if (call.remoteStream$) {
        const streamSub = call.remoteStream$.subscribe((stream: MediaStream) => {
          attachRemoteAudio(stream);
        });
        subsRef.current.push(streamSub);
      }

      if (call.status$) {
        const statusSub = call.status$.subscribe((st: string) => {
          if (st === "connected" || st === "active") {
            setCallState("active");
            if (call.remoteStream) attachRemoteAudio(call.remoteStream);
          } else if (st === "destroyed" || st === "disconnecting" || st === "ended") {
            setCallState("ended");
            setCallDirection(null);
            setIncomingCallerNumber(null);
            callRef.current = null;
          }
        });
        subsRef.current.push(statusSub);
      }

      return { ok: true };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Could not start call.";
      console.error("[SignalWire dial error]", e);
      setError(errMsg);
      setCallState("idle");
      return { ok: false, error: errMsg };
    }
  }, []);

  const sendDTMF = useCallback((digit: string) => {
    try {
      callRef.current?.sendDigits?.(digit);
    } catch {
      /* noop */
    }
  }, []);

  const answerCall = useCallback(() => {
    try {
      getOrCreateAudioSink()?.play().catch(() => {});
      const call = callRef.current;
      if (call) {
        call.answer?.({ audio: true, video: false });
        if (call.remoteStream) attachRemoteAudio(call.remoteStream);
      }
    } catch {
      /* noop */
    }
    setCallState("active");
  }, []);

  const hangup = useCallback(() => {
    try {
      callRef.current?.hangup?.();
    } catch {
      /* noop */
    }
    callRef.current = null;
    setCallDirection(null);
    setIncomingCallerNumber(null);
    setCallState("idle");
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    try {
      const client = clientRef.current;
      if (client) {
        if (muted) client.disableAudioInput?.();
        else client.enableAudioInput?.();
      }
    } catch {
      /* noop */
    }
  }, []);

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
