// Generic status badge used across multiple features (calls, campaigns, leads).
import { Badge } from "@/components/ui/badge";

const STATUS_STYLES: Record<string, string> = {
  // Call statuses
  connected:   "bg-green-500/20 text-green-400",
  completed:   "bg-blue-500/20 text-blue-400",
  no_answer:   "bg-red-500/20 text-red-400",
  failed:      "bg-red-500/20 text-red-400",
  // Campaign statuses
  running:     "bg-green-500/20 text-green-400",
  paused:      "bg-amber-500/20 text-amber-400",
  draft:       "bg-gray-500/20 text-gray-400",
  scheduled:   "bg-purple-500/20 text-purple-400",
  // Lead statuses
  new:         "bg-blue-500/20 text-blue-400",
  contacted:   "bg-yellow-500/20 text-yellow-400",
  callback:    "bg-purple-500/20 text-purple-400",
  converted:   "bg-green-500/20 text-green-400",
  inactive:    "bg-gray-500/20 text-gray-400",
  active:      "bg-green-500/20 text-green-400",
  // Generic
  pending:     "bg-amber-500/20 text-amber-400",
  success:     "bg-green-500/20 text-green-400",
  error:       "bg-red-500/20 text-red-400",
};

interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className = "" }: StatusBadgeProps) {
  const style = STATUS_STYLES[status.toLowerCase()] ?? "bg-gray-500/20 text-gray-400";
  return (
    <Badge className={`${style} border-0 capitalize ${className}`}>
      {label ?? status}
    </Badge>
  );
}
