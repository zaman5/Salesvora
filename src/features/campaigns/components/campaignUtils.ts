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

export const DISP_COLOR: Record<string, string> = {
  Connected:            "bg-green-600/20 text-green-300 border-green-600/30",
  Interested:           "bg-emerald-600/20 text-emerald-300 border-emerald-600/30",
  "No Answer":          "bg-red-600/20 text-red-300 border-red-600/30",
  "Not Interested":     "bg-orange-600/20 text-orange-300 border-orange-600/30",
  "Voice Mail":         "bg-purple-600/20 text-purple-300 border-purple-600/30",
  "Answering Machine":  "bg-purple-600/20 text-purple-300 border-purple-600/30",
  "Wrong Number":       "bg-yellow-600/20 text-yellow-300 border-yellow-600/30",
  "Do Not Call Again":  "bg-gray-600/20 text-gray-400 border-gray-600/30",
  Custom:               "bg-blue-600/20 text-blue-300 border-blue-600/30",
};
