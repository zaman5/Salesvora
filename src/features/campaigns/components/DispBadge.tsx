import { DISP_COLOR } from "./campaignUtils";

export function DispBadge({ label }: { label?: string }) {
  if (!label) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <span
      className={`inline-flex text-xs px-2 py-0.5 rounded-full border font-medium ${
        DISP_COLOR[label] ?? "bg-gray-700 text-gray-300 border-gray-600"
      }`}
    >
      {label}
    </span>
  );
}
