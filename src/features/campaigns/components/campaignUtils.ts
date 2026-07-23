// Shared utilities for the Campaigns feature

export type CsvLead = {
  customFields?: Record<string, string>;
  _lastCallDuration?: number | null;
  [key: string]: unknown;
};

export function downloadCSV(data: CsvLead[], filename: string) {
  if (!data.length) return;
  const STANDARD = [
    "firstName","lastName","companyName","phone","phone2","email",
    "designation","address","city","state","country","zipCode","website","notes",
  ];
  const SYSTEM = ["_lastDisposition","_lastDispositionId"];
  const customKeys = new Set<string>();
  data.forEach((l) => {
    if (l.customFields && typeof l.customFields === "object") {
      Object.keys(l.customFields).forEach((k) => { if (!SYSTEM.includes(k)) customKeys.add(k); });
    }
  });
  const headers = [...STANDARD, "lastDisposition", "lastCallDuration", ...Array.from(customKeys)];
  const rows = data.map((l) =>
    headers.map((h) => {
      let v = "";
      if (h === "lastDisposition")    v = l.customFields?._lastDisposition || "";
      else if (h === "lastCallDuration") v = l._lastCallDuration != null ? String(l._lastCallDuration) : "";
      else if (STANDARD.includes(h)) v = String(l[h] ?? "");
      else v = l.customFields?.[h] ?? "";
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(","),
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

export function fmtDuration(s?: number | null) {
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Light pair first, original dark values behind `dark:`. The `text-*-300` on a
// `bg-*-600/20` tint was dark-only and fell to ~1.1-1.3:1 on a white page.
export const DISP_COLOR: Record<string, string> = {
  Connected:            "bg-green-100 text-green-700 border-green-200 dark:bg-green-600/20 dark:text-green-300 dark:border-green-600/30",
  Interested:           "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-600/20 dark:text-emerald-300 dark:border-emerald-600/30",
  "No Answer":          "bg-red-100 text-red-700 border-red-200 dark:bg-red-600/20 dark:text-red-300 dark:border-red-600/30",
  "Not Interested":     "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-600/20 dark:text-orange-300 dark:border-orange-600/30",
  "Voice Mail":         "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-600/20 dark:text-purple-300 dark:border-purple-600/30",
  "Answering Machine":  "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-600/20 dark:text-purple-300 dark:border-purple-600/30",
  "Wrong Number":       "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-600/20 dark:text-yellow-300 dark:border-yellow-600/30",
  "Do Not Call Again":  "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-600/20 dark:text-gray-400 dark:border-gray-600/30",
  Custom:               "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-600/20 dark:text-blue-300 dark:border-blue-600/30",
};
