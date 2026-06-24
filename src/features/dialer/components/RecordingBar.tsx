// Pulsing REC / AUTO REC indicator shown during active recording.
import { formatDur } from "./shared";

interface RecordingBarProps {
  isRecording: boolean;
  recordingTime: number;
  isAuto?: boolean;
  error?: string | null;
}

export function RecordingBar({ isRecording, recordingTime, isAuto, error }: RecordingBarProps) {
  if (error) {
    return (
      <p className="text-xs text-red-400 text-center bg-red-500/10 border border-red-500/20 rounded-lg py-1.5 px-3">
        {error}
      </p>
    );
  }
  if (!isRecording) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg py-1.5 px-3">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
      </span>
      <span className="text-xs font-semibold text-red-400 tracking-wider">
        {isAuto ? "AUTO REC" : "REC"}
      </span>
      <span className="text-xs font-mono text-red-300">{formatDur(recordingTime)}</span>
    </div>
  );
}
