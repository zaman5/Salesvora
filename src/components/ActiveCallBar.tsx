import { useEffect, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  callerNumber: string;
  onHangup: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
};

function formatDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function ActiveCallBar({ callerNumber, onHangup, isMuted, onToggleMute }: Props) {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 z-[9998] bg-green-800 text-white px-4 py-2 flex items-center gap-3 shadow-xl shadow-black/40 animate-in slide-in-from-top-2 duration-200">
      {/* Pulsing dot */}
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-400" />
      </span>

      <Phone className="w-4 h-4 shrink-0 text-green-200" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate leading-none">{callerNumber}</p>
        <p className="text-xs text-green-200 mt-0.5">On Call</p>
      </div>

      {/* Duration */}
      <div className="flex items-center gap-1 text-sm font-mono text-green-100 shrink-0">
        <Clock className="w-3.5 h-3.5" />
        {formatDur(duration)}
      </div>

      {/* Mute */}
      <Button
        size="sm"
        onClick={onToggleMute}
        className={`h-8 px-3 rounded-lg font-medium text-xs transition-colors ${
          isMuted
            ? "bg-red-600/80 hover:bg-red-600 text-white border-0"
            : "bg-green-700 hover:bg-green-600 text-green-100 border border-green-600/50"
        }`}
        variant="ghost"
      >
        {isMuted ? <MicOff className="w-4 h-4 mr-1" /> : <Mic className="w-4 h-4 mr-1" />}
        {isMuted ? "Muted" : "Mute"}
      </Button>

      {/* Hang up */}
      <Button
        size="sm"
        onClick={onHangup}
        className="h-8 px-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium border-0"
        variant="ghost"
      >
        <PhoneOff className="w-4 h-4 mr-1" />
        Hang Up
      </Button>
    </div>
  );
}