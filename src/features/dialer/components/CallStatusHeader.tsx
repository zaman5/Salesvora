// Call status display used in both tabs: timer + badge + from-number.
import { Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDur } from "./shared";

interface CallStatusHeaderProps {
  status: "connected" | "ended" | "calling";
  duration: number;
  fromNumber?: string;
  label?: string;
}

export function CallStatusHeader({ status, duration, fromNumber, label }: CallStatusHeaderProps) {
  const isConnected = status === "connected";
  const isCalling   = status === "calling";

  return (
    <div className="text-center">
      <div
        className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-1 ${
          isConnected ? "bg-green-500/20 animate-pulse" :
          isCalling   ? "bg-blue-500/20 animate-pulse"  : "bg-gray-700"
        }`}
      >
        <Phone
          className={`w-7 h-7 ${
            isConnected ? "text-green-400" :
            isCalling   ? "text-blue-400"  : "text-gray-400"
          }`}
        />
      </div>
      <p className="text-2xl font-bold text-white font-mono mt-1">{formatDur(duration)}</p>
      <Badge
        className={
          isConnected ? "bg-green-500/20 text-green-400 mt-1" :
          isCalling   ? "bg-blue-500/20 text-blue-400 mt-1"   :
                        "bg-gray-500/20 text-gray-400 mt-1"
        }
      >
        {label ?? (isConnected ? "On Call" : isCalling ? "Dialing…" : "Call Ended")}
      </Badge>
      {fromNumber && (
        <p className="text-xs text-gray-500 mt-1 font-mono">{fromNumber}</p>
      )}
    </div>
  );
}
