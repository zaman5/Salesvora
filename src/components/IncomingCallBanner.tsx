import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, PhoneIncoming } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  callerNumber: string;
  onAnswer: () => void;
  onDecline: () => void;
};

// Generate a dual-tone phone ringtone using the Web Audio API.
function startRingtone(): () => void {
  let active = true;
  let ctx: AudioContext | null = null;

  try {
    ctx = new AudioContext();

    const burst = (when: number) => {
      if (!ctx || !active) return;
      // Two tones played together (like a POTS ring: 440 + 480 Hz)
      [440, 480].forEach((freq) => {
        const osc  = ctx!.createOscillator();
        const gain = ctx!.createGain();
        osc.connect(gain);
        gain.connect(ctx!.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(0.18, when + 0.02);
        gain.gain.setValueAtTime(0.18, when + 0.38);
        gain.gain.linearRampToValueAtTime(0, when + 0.42);
        osc.start(when);
        osc.stop(when + 0.45);
      });
    };

    const ring = () => {
      if (!ctx || !active) return;
      const t = ctx.currentTime;
      burst(t);          // first ring
      burst(t + 0.5);    // second ring
      if (active) setTimeout(ring, 3200);
    };

    // Chrome/Safari require resuming after first user gesture; try anyway.
    const tryStart = () => {
      if (ctx?.state === "suspended") ctx.resume().then(ring).catch(() => {});
      else ring();
    };
    tryStart();
  } catch { /* browser blocked audio — silent fallback */ }

  return () => {
    active = false;
    try { ctx?.close(); } catch { /* noop */ }
  };
}

// Show a browser system notification so the user sees it even if tab is not focused.
function showBrowserNotification(callerNumber: string) {
  if (!("Notification" in window)) return;
  const show = () => {
    try {
      new Notification("Incoming Call", {
        body: `Call from ${callerNumber}`,
        icon: "/favicon.ico",
        tag: "incoming-call",
        requireInteraction: true,
      });
    } catch { /* noop */ }
  };
  if (Notification.permission === "granted") {
    show();
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((p) => { if (p === "granted") show(); });
  }
}

export function IncomingCallBanner({ callerNumber, onAnswer, onDecline }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const stopRingtoneRef = useRef<(() => void) | null>(null);

  // Start ringtone + notification on mount, clean up on unmount.
  useEffect(() => {
    stopRingtoneRef.current = startRingtone();
    showBrowserNotification(callerNumber);

    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(timer);
      stopRingtoneRef.current?.();
      // Dismiss the system notification if it's still showing.
      try { new Notification(""); } catch { /* noop */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnswer = () => {
    stopRingtoneRef.current?.();
    onAnswer();
  };

  const handleDecline = () => {
    stopRingtoneRef.current?.();
    onDecline();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pointer-events-none">
      {/* Dim backdrop */}
      <div className="absolute inset-0 bg-black/40 pointer-events-auto" onClick={handleDecline} />

      {/* Card */}
      <div className="relative pointer-events-auto mt-16 w-80 animate-in slide-in-from-top-8 duration-300">
        <div className="bg-gray-950 border border-green-500/50 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden">
          {/* Animated top bar */}
          <div className="h-1.5 bg-gradient-to-r from-green-500 via-emerald-400 to-green-500 animate-pulse" />

          <div className="p-5">
            {/* Icon + caller info */}
            <div className="flex flex-col items-center gap-3 mb-6">
              {/* Pulsing ring circles */}
              <div className="relative flex items-center justify-center">
                <span className="absolute w-24 h-24 rounded-full border-2 border-green-500/20 animate-ping" />
                <span className="absolute w-20 h-20 rounded-full border-2 border-green-500/30 animate-ping [animation-delay:200ms]" />
                <div className="relative w-16 h-16 rounded-full bg-green-500/20 border-2 border-green-500/60 flex items-center justify-center">
                  <PhoneIncoming className="w-7 h-7 text-green-400 animate-bounce" />
                </div>
              </div>

              <div className="text-center">
                <p className="text-[11px] font-bold text-green-400 uppercase tracking-widest mb-1">
                  Incoming Call
                </p>
                <p className="text-white font-bold text-xl tracking-wide">
                  {callerNumber}
                </p>
                <p className="text-gray-500 text-sm mt-1">
                  Ringing… {elapsed}s
                </p>
              </div>
            </div>

            {/* Answer / Decline buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={handleDecline}
                className="h-14 flex-col gap-1 bg-red-700 hover:bg-red-600 text-white transition-all rounded-xl border-0"
              >
                <PhoneOff className="w-5 h-5" />
                <span className="text-xs font-semibold">Decline</span>
              </Button>
              <Button
                onClick={handleAnswer}
                className="h-14 flex-col gap-1 bg-green-600 hover:bg-green-500 text-white rounded-xl shadow-lg shadow-green-900/40"
              >
                <Phone className="w-5 h-5" />
                <span className="text-xs font-semibold">Answer</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}