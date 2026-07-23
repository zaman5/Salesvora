// Generic status badge used across multiple features (calls, campaigns, leads).
import { Badge } from "@/components/ui/badge";

// Light-theme pair first, the original dark values behind `dark:`. The bare
// `bg-*-500/20 text-*-400` pairs were dark-only and dropped to ~1.4-2.1:1 once
// the app gained a white background, so the labels were effectively invisible.
const STATUS_STYLES: Record<string, string> = {
  // Call statuses
  connected:   "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  completed:   "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  no_answer:   "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  failed:      "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  // Campaign statuses
  running:     "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  sending:     "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  paused:      "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
  draft:       "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400",
  scheduled:   "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400",
  // Lead statuses
  new:         "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  contacted:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400",
  callback:    "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400",
  converted:   "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  inactive:    "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400",
  active:      "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  suspended:   "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  // Generic
  pending:     "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
  success:     "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  error:       "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
};

const FALLBACK_STYLE = "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400";

// Opt-in outline (`bordered`), used where a badge sits on a same-tinted row.
const STATUS_BORDERS: Record<string, string> = {
  active:    "border border-green-200 dark:border-green-500/30",
  suspended: "border border-red-200 dark:border-red-500/30",
  inactive:  "border border-gray-300 dark:border-gray-500/30",
};

const FALLBACK_BORDER = "border border-gray-300 dark:border-gray-500/30";

interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
  bordered?: boolean;
}

export function StatusBadge({ status, label, className = "", bordered = false }: StatusBadgeProps) {
  const key = status.toLowerCase();
  const style = STATUS_STYLES[key] ?? FALLBACK_STYLE;
  const border = bordered ? (STATUS_BORDERS[key] ?? FALLBACK_BORDER) : "border-0";
  return (
    <Badge className={`${style} ${border} capitalize ${className}`}>
      {label ?? status}
    </Badge>
  );
}
