import { DISP_COLOR } from "./campaignUtils";

export function DispBadge({ label }: { label?: string }) {
  if (!label) return <span className="text-gray-600 dark:text-gray-400 text-xs">—</span>;
  return (
    <span
      className={`inline-flex text-xs px-2 py-0.5 rounded-full border font-medium ${
        DISP_COLOR[label] ?? "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600"
      }`}
    >
      {label}
    </span>
  );
}
