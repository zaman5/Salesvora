import { useEffect, useState } from "react";
import { Phone, PhoneOff, PhoneIncoming } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  callerNumber: string;
  onAnswer: () => void;
  onDecline: () => void;
};

export function IncomingCallBanner({ callerNumber, onAnswer, onDecline }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed top-4 right-4 z-[9999] w-80 animate-in slide-in-from-top-4 duration-300">
      <div className="bg-gray-900 border border-green-500/40 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
        {/* Top accent bar */}
        <div className="h-1 bg-gradient-to-r from-green-500 to-emerald-400 animate-pulse" />

        <div className="p-4">
          <div className="flex items-start gap-3">
            {/* Pulsing phone icon */}
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <PhoneIncoming className="w-6 h-6 text-green-400" />
              </div>
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center">
                <span className="absolute w-full h-full rounded-full bg-green-400 animate-ping opacity-75" />
                <span className="relative w-2 h-2 rounded-full bg-green-500" />
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-green-400 uppercase tracking-wider">
                Incoming Call
              </p>
              <p className="text-white font-semibold text-base truncate mt-0.5">
                {callerNumber}
              </p>
              <p className="text-gray-500 text-xs mt-0.5">
                Ringing… {elapsed}s
              </p>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Button
              onClick={onDecline}
              className="flex-1 bg-red-600/20 hover:bg-red-600 border border-red-600/40 text-red-400 hover:text-white transition-colors"
              variant="outline"
              size="sm"
            >
              <PhoneOff className="w-4 h-4 mr-1.5" />
              Decline
            </Button>
            <Button
              onClick={onAnswer}
              className="flex-1 bg-green-600 hover:bg-green-500 text-white"
              size="sm"
            >
              <Phone className="w-4 h-4 mr-1.5" />
              Answer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}