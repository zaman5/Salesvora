import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Phone, Plus, Radio, Pause, Play, BarChart3, List, Clock,
  Users, Trash2, PhoneCall, Download, ArrowLeft, ChevronDown,
  ChevronRight, Search, X,
} from "lucide-react";

// ── CSV download helper ─────────────────────────────────────────────────────
type CsvLead = {
  customFields?: Record<string, string>;
  _lastCallDuration?: number | null;
  [key: string]: unknown;
};

function downloadCSV(data: CsvLead[], filename: string) {
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
      if (h === "lastDisposition") v = l.customFields?._lastDisposition || "";
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

function fmtDuration(s?: number | null) {
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Disposition badge colours ───────────────────────────────────────────────
const DISP_COLOR: Record<string, string> = {
  Connected:   "bg-green-600/20 text-green-300 border-green-600/30",
  Interested:  "bg-emerald-600/20 text-emerald-300 border-emerald-600/30",
  "No Answer": "bg-red-600/20 text-red-300 border-red-600/30",
  "Not Interested": "bg-orange-600/20 text-orange-300 border-orange-600/30",
  "Voice Mail":      "bg-purple-600/20 text-purple-300 border-purple-600/30",
  "Answering Machine":"bg-purple-600/20 text-purple-300 border-purple-600/30",
  "Wrong Number":    "bg-yellow-600/20 text-yellow-300 border-yellow-600/30",
  "Do Not Call Again":"bg-gray-600/20 text-gray-400 border-gray-600/30",
  Custom:      "bg-blue-600/20 text-blue-300 border-blue-600/30",
};
function DispBadge({ label }: { label?: string }) {
  if (!label) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border font-medium ${DISP_COLOR[label] ?? "bg-gray-700 text-gray-300 border-gray-600"}`}>
      {label}
    </span>
  );
}

// ── Campaign Detail View ────────────────────────────────────────────────────
function CampaignDetail({
  campaign,
  onBack,
}: {
  campaign: { id: number; name: string; leadListId?: number; companyId?: number; [key: string]: unknown };
  onBack: () => void;
}) {
  const [dispositionFilter, setDispositionFilter] = useState("all");
  const [search, setSearch]     = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: leadsRaw = [] } = trpc.lead.list.useQuery(
    { leadListId: campaign.leadListId ?? 0 },
    { enabled: !!campaign.leadListId },
  );
  const { data: dispositions = [] } = trpc.calls.dispositions.useQuery({ companyId: campaign.companyId ?? 0 });
  const { data: callsRaw }          = trpc.calls.list.useQuery({}, { retry: false });

  type LeadRow = { id: number; firstName?: string; lastName?: string; companyName?: string; phone?: string; phone2?: string; email?: string; designation?: string; address?: string; city?: string; state?: string; country?: string; zipCode?: string; website?: string; notes?: string; customFields?: Record<string, string>; [key: string]: unknown };
  type CallRow = { id: number; leadId?: number; dispositionId?: number; duration?: number; recordingUrl?: string; createdAt?: string; startedAt?: string; notes?: string; fromNumber?: string; status?: string };
  type Disposition = { id: number; label: string; category?: string };

  const leads: LeadRow[] = useMemo(
    () => Array.isArray(leadsRaw) ? (leadsRaw as LeadRow[]) : ((leadsRaw as { items?: LeadRow[] })?.items ?? []),
    [leadsRaw],
  );
  const calls: CallRow[] = useMemo(() => {
    const arr = Array.isArray(callsRaw) ? (callsRaw as CallRow[]) : ((callsRaw as { items?: CallRow[] })?.items ?? []);
    return arr;
  }, [callsRaw]);

  // Build a map: leadId → last call record
  const callByLead = useMemo(() => {
    const m = new Map<number, CallRow>();
    [...calls]
      .sort((a, b) => new Date(b.createdAt ?? b.startedAt ?? 0).getTime() - new Date(a.createdAt ?? a.startedAt ?? 0).getTime())
      .forEach((c) => { if (c.leadId && !m.has(c.leadId)) m.set(c.leadId, c); });
    return m;
  }, [calls]);

  // Build disposition lookup (id → label)
  const dispLabel = useMemo(() => {
    const m = new Map<number, string>();
    (dispositions as Disposition[]).forEach((d) => m.set(d.id, d.label));
    return m;
  }, [dispositions]);

  // Enrich leads with last call info
  const enriched = useMemo(() =>
    leads.map((l) => {
      const call = callByLead.get(l.id);
      return {
        ...l,
        _lastCall:         call,
        _lastCallDuration: call?.duration,
        _lastCallDisp:     l.customFields?._lastDisposition
                           ?? (call?.dispositionId ? dispLabel.get(call.dispositionId) : undefined),
        _recordingUrl:     call?.recordingUrl,
      };
    }), [leads, callByLead, dispLabel]);

  // Available disposition options (only those with leads)
  const dispOptions = useMemo(() => {
    const seen = new Set<string>();
    enriched.forEach((l) => { if (l._lastCallDisp) seen.add(l._lastCallDisp); });
    return Array.from(seen).sort();
  }, [enriched]);

  // Apply filters
  const filtered = useMemo(() => {
    let arr = enriched;
    if (dispositionFilter !== "all") arr = arr.filter((l) => l._lastCallDisp === dispositionFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((l) =>
        [l.firstName, l.lastName, l.companyName, l.phone, l.email].some((v) =>
          v?.toLowerCase().includes(q),
        ),
      );
    }
    return arr;
  }, [enriched, dispositionFilter, search]);

  const STANDARD_COLS = [
    { key: "firstName", label: "First Name" },
    { key: "lastName",  label: "Last Name" },
    { key: "companyName", label: "Company" },
    { key: "designation", label: "Designation" },
    { key: "phone2",   label: "Phone 2" },
    { key: "email",    label: "Email" },
    { key: "address",  label: "Address" },
    { key: "city",     label: "City" },
    { key: "state",    label: "State" },
    { key: "country",  label: "Country" },
    { key: "zipCode",  label: "Zip Code" },
    { key: "website",  label: "Website" },
    { key: "notes",    label: "Notes" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-sm font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Campaigns
        </button>
        <div className="hidden sm:block w-px h-4 bg-gray-700" />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white truncate">{campaign.name}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {leads.length} leads · {filtered.length} shown
            {dispositionFilter !== "all" && ` · filtered by "${dispositionFilter}"`}
          </p>
        </div>
        <Button
          size="sm"
          className="bg-gray-700 hover:bg-gray-600 text-white shrink-0"
          onClick={() => downloadCSV(filtered, `${campaign.name.replace(/\s+/g, "_")}_leads.csv`)}
        >
          <Download className="w-4 h-4 mr-1.5" />
          Download {dispositionFilter !== "all" ? "Filtered" : "All"} ({filtered.length})
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, company…"
            className="pl-9 bg-gray-800 border-gray-600 text-gray-100 placeholder:text-gray-500 h-9"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Disposition filter */}
        <select
          value={dispositionFilter}
          onChange={(e) => setDispositionFilter(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded-md px-3 py-2 text-white text-sm shrink-0"
        >
          <option value="all">All results ({enriched.length})</option>
          {dispOptions.map((d) => {
            const n = enriched.filter((l) => l._lastCallDisp === d).length;
            return <option key={d} value={d}>{d} ({n})</option>;
          })}
          {enriched.filter((l) => !l._lastCallDisp).length > 0 && (
            <option value="__none__">Not yet called ({enriched.filter((l) => !l._lastCallDisp).length})</option>
          )}
        </select>
      </div>

      {/* Lead table */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr_auto] gap-0 bg-gray-800 border-b border-gray-700 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          <div className="px-3 py-2.5 w-10 text-center">#</div>
          <div className="px-3 py-2.5">Name</div>
          <div className="px-3 py-2.5">Phone</div>
          <div className="px-3 py-2.5">Company</div>
          <div className="px-3 py-2.5">Last Result</div>
          <div className="px-3 py-2.5">Duration</div>
          <div className="px-3 py-2.5 w-24 text-center">Actions</div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-gray-900">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No leads match the current filter.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800 bg-gray-900 max-h-[60vh] overflow-y-auto">
            {filtered.map((lead, idx) => {
              const isOpen = expandedId === lead.id;
              return (
                <div key={lead.id}>
                  {/* Compact row */}
                  <div
                    className={`grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr_auto] gap-0 items-center hover:bg-gray-800/60 transition-colors ${isOpen ? "bg-gray-800/60" : ""}`}
                  >
                    <div className="px-3 py-3 w-10 text-center text-xs text-gray-600">{idx + 1}</div>
                    <div className="px-3 py-3 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—"}
                      </p>
                      {lead.email && <p className="text-xs text-gray-500 truncate">{lead.email}</p>}
                    </div>
                    <div className="px-3 py-3">
                      <p className="text-sm font-mono text-blue-300 truncate">{lead.phone || "—"}</p>
                    </div>
                    <div className="px-3 py-3">
                      <p className="text-sm text-gray-300 truncate">{lead.companyName || "—"}</p>
                    </div>
                    <div className="px-3 py-3">
                      <DispBadge label={lead._lastCallDisp} />
                    </div>
                    <div className="px-3 py-3 text-sm text-gray-400 font-mono">
                      {fmtDuration(lead._lastCallDuration)}
                    </div>
                    <div className="px-3 py-3 w-24 flex items-center justify-center gap-1">
                      {lead._recordingUrl && (
                        <button
                          title="Play recording"
                          className="w-7 h-7 rounded-full bg-green-700 hover:bg-green-600 flex items-center justify-center transition-colors"
                          onClick={() => setExpandedId(isOpen ? null : lead.id)}
                        >
                          <Play className="w-3.5 h-3.5 text-white fill-white" />
                        </button>
                      )}
                      <button
                        title={isOpen ? "Collapse" : "View all fields"}
                        onClick={() => setExpandedId(isOpen ? null : lead.id)}
                        className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                      >
                        {isOpen
                          ? <ChevronDown className="w-3.5 h-3.5 text-white" />
                          : <ChevronRight className="w-3.5 h-3.5 text-white" />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded row */}
                  {isOpen && (
                    <div className="bg-gray-800/50 border-t border-gray-700 px-4 py-4 space-y-4">
                      {/* Call recording */}
                      {lead._recordingUrl && (
                        <div className="rounded-xl bg-gray-900 border border-gray-700 p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                              Call Recording · {fmtDuration(lead._lastCallDuration)}
                            </p>
                            <a
                              href={lead._recordingUrl}
                              download
                              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                            >
                              <Download className="w-3 h-3" /> Download
                            </a>
                          </div>
                          <audio controls src={lead._recordingUrl} className="w-full h-9" />
                          {lead._lastCall?.notes && (
                            <p className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2">
                              <span className="font-medium text-gray-300">Notes: </span>
                              {lead._lastCall.notes}
                            </p>
                          )}
                        </div>
                      )}

                      {/* All fields grid */}
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                          All Fields
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          {STANDARD_COLS.map(({ key, label }) => {
                            const val = (lead as Record<string, unknown>)[key];
                            if (!val) return null;
                            return (
                              <div key={key} className="bg-gray-900 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
                                <p className="text-sm text-gray-100 mt-0.5 break-words">{String(val)}</p>
                              </div>
                            );
                          })}
                          {/* Custom fields */}
                          {lead.customFields && typeof lead.customFields === "object" &&
                            Object.entries(lead.customFields as Record<string, unknown>)
                              .filter(([k]) => !k.startsWith("_"))
                              .map(([k, v]) => (
                                <div key={k} className="bg-gray-900 rounded-lg px-3 py-2">
                                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">{k}</p>
                                  <p className="text-sm text-gray-100 mt-0.5 break-words">{String(v)}</p>
                                </div>
                              ))}
                          {/* Last call info */}
                          {lead._lastCall && (
                            <>
                              <div className="bg-gray-900 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Last Called</p>
                                <p className="text-sm text-gray-100 mt-0.5">
                                  {lead._lastCall.startedAt
                                    ? new Date(lead._lastCall.startedAt).toLocaleString()
                                    : "—"}
                                </p>
                              </div>
                              <div className="bg-gray-900 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Called From</p>
                                <p className="text-sm font-mono text-gray-100 mt-0.5">{lead._lastCall.fromNumber || "—"}</p>
                              </div>
                              <div className="bg-gray-900 rounded-lg px-3 py-2">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Call Status</p>
                                <p className="text-sm text-gray-100 mt-0.5 capitalize">{lead._lastCall.status || "—"}</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-600 text-right">
        Showing {filtered.length} of {leads.length} leads
        {dispositionFilter !== "all" && ` · filter: ${dispositionFilter}`}
      </p>
    </div>
  );
}

// ── Main Campaigns Page ─────────────────────────────────────────────────────
export default function CampaignsPage() {
  const navigate = useNavigate();
  const [selectedCampaign, setSelectedCampaign] = useState<{ id: number; name: string; leadListId?: number; companyId?: number; [key: string]: unknown } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"auto" | "manual" | "ai" | "sms">("auto");
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [dailyStart, setDailyStart] = useState("09:00");
  const [dailyEnd, setDailyEnd] = useState("18:00");

  const { data: campaigns = [], refetch: refetchCampaigns } = trpc.campaign.list.useQuery();
  const { data: leadLists = [] }  = trpc.lead.listLists.useQuery();

  const createCampaignMutation = trpc.campaign.create.useMutation({
    onSuccess: () => {
      refetchCampaigns();
      setShowCreate(false);
      setNewName(""); setNewType("auto"); setSelectedListId("");
      setDailyStart("09:00"); setDailyEnd("18:00");
    },
  });
  const startCampaignMutation  = trpc.campaign.start.useMutation({ onSuccess: () => refetchCampaigns() });
  const pauseCampaignMutation  = trpc.campaign.pause.useMutation({ onSuccess: () => refetchCampaigns() });
  const deleteCampaignMutation = trpc.campaign.delete.useMutation({ onSuccess: () => refetchCampaigns() });

  const handleCreateCampaign = async () => {
    if (!newName.trim() || !selectedListId) return;
    try {
      await createCampaignMutation.mutateAsync({
        name: newName, type: newType,
        leadListId: parseInt(selectedListId),
        dailyStartTime: dailyStart, dailyEndTime: dailyEnd,
      });
    } catch (err) { console.error("Failed to create campaign:", err); }
  };

  const handleDeleteCampaign = async (id: number) => {
    if (!confirm("Delete this campaign?")) return;
    try { await deleteCampaignMutation.mutateAsync({ id }); }
    catch (err) { console.error("Failed to delete campaign:", err); }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      running: "bg-green-500/20 text-green-400",
      paused: "bg-amber-500/20 text-amber-400",
      completed: "bg-blue-500/20 text-blue-400",
      draft: "bg-gray-500/20 text-gray-400",
      scheduled: "bg-purple-500/20 text-purple-400",
    };
    return <Badge className={`${colors[status] || "bg-gray-500/20"} border-0 capitalize`}>{status}</Badge>;
  };

  const getTypeBadge = (type: string) => {
    const icons: Record<string, React.ReactNode> = {
      auto: <Radio className="w-3 h-3" />, manual: <PhoneCall className="w-3 h-3" />,
      ai: <BarChart3 className="w-3 h-3" />, sms: <Phone className="w-3 h-3" />,
    };
    return (
      <span className="flex items-center gap-1 text-xs text-gray-400 capitalize">
        {icons[type]} {type}
      </span>
    );
  };

  // ── Show detail view if a campaign is selected ─────────────────────────────
  if (selectedCampaign) {
    return (
      <div className="space-y-4">
        <CampaignDetail campaign={selectedCampaign} onBack={() => setSelectedCampaign(null)} />
      </div>
    );
  }

  // ── Campaign list ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Campaigns</h1>
          <p className="text-gray-400 mt-1">Manage calling and messaging campaigns</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" /> New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Campaign</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-gray-300">Campaign Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="Enter campaign name" className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-300">Type</Label>
                  <Select value={newType} onValueChange={(v: "auto" | "manual" | "ai" | "sms") => setNewType(v)}>
                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="auto">Auto Dialer</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="ai">AI Agent</SelectItem>
                      <SelectItem value="sms">SMS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-300">Lead List</Label>
                  <Select value={selectedListId} onValueChange={setSelectedListId}>
                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                      <SelectValue placeholder="Select list" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      {(leadLists as { id: number; name: string }[]).map((l) => (
                        <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-300">Daily Start Time</Label>
                  <Input type="time" value={dailyStart} onChange={(e) => setDailyStart(e.target.value)}
                    className="bg-gray-800 border-gray-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-gray-300">Daily End Time</Label>
                  <Input type="time" value={dailyEnd} onChange={(e) => setDailyEnd(e.target.value)}
                    className="bg-gray-800 border-gray-700 text-white mt-1" />
                </div>
              </div>
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={handleCreateCampaign}>
                Create Campaign
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(campaigns as { id: number; name: string; leadListId?: number; companyId?: number; status?: string; type?: string; totalLeads?: number; completedLeads?: number; assignedCallers?: unknown[]; dailyStartTime?: string; dailyEndTime?: string; startDate?: string }[]).map((campaign) => {
          const listName = (leadLists as { id: number; name: string }[]).find((ll) => ll.id === campaign.leadListId)?.name ?? "Unknown List";
          const callersCount = Array.isArray(campaign.assignedCallers) ? campaign.assignedCallers.length : 0;
          const total = campaign.totalLeads || 0;
          const completed = campaign.completedLeads || 0;
          const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

          return (
            <Card key={campaign.id} className="bg-gray-900 border-gray-800">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Radio className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <button
                        className="text-base font-semibold text-white hover:text-blue-400 transition-colors text-left"
                        onClick={() => setSelectedCampaign(campaign)}
                      >
                        {campaign.name}
                      </button>
                      <div className="flex items-center gap-3 mt-0.5">
                        {getTypeBadge(campaign.type ?? "")}
                        <span className="text-xs text-gray-500">
                          <List className="w-3 h-3 inline mr-1" />{listName}
                        </span>
                      </div>
                    </div>
                  </div>
                  {getStatusBadge(campaign.status ?? "")}
                </div>

                <div className="flex items-center gap-4 text-sm text-gray-400 mb-3">
                  <span className="flex items-center gap-1"><Users className="w-4 h-4" />{callersCount} callers</span>
                  <span className="flex items-center gap-1"><Clock className="w-4 h-4" />{campaign.dailyStartTime ?? "09:00"} - {campaign.dailyEndTime ?? "18:00"}</span>
                  {campaign.startDate && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-4 h-4" />Started {new Date(campaign.startDate as string).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <div className="mb-2">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-400">{completed.toLocaleString()} / {total.toLocaleString()} leads</span>
                    <span className="text-white font-medium">{percentage}%</span>
                  </div>
                  <Progress value={percentage} className="h-2 bg-gray-800" />
                </div>

                <div className="flex gap-2 mt-4">
                  {/* View details */}
                  <Button
                    size="sm"
                    className="bg-gray-700 hover:bg-gray-600 text-white"
                    onClick={() => setSelectedCampaign(campaign)}
                  >
                    <List className="w-4 h-4 mr-1" /> View Leads
                  </Button>

                  {campaign.status === "running" ? (
                    <Button size="sm" className="bg-amber-600/20 text-amber-400 hover:bg-amber-600/30"
                      onClick={() => pauseCampaignMutation.mutate({ id: campaign.id })}>
                      <Pause className="w-4 h-4 mr-1" /> Pause
                    </Button>
                  ) : (campaign.status === "paused" || campaign.status === "draft") ? (
                    <Button size="sm" className="bg-green-600/20 text-green-400 hover:bg-green-600/30"
                      onClick={() => startCampaignMutation.mutate({ id: campaign.id })}>
                      <Play className="w-4 h-4 mr-1" /> Start
                    </Button>
                  ) : null}

                  {campaign.type === "auto" && campaign.status === "running" && (
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => navigate("/auto-dialer")}>
                      <PhoneCall className="w-4 h-4 mr-1" /> Launch
                    </Button>
                  )}

                  <Button size="sm" variant="ghost"
                    onClick={() => handleDeleteCampaign(campaign.id)}
                    className="text-gray-500 hover:text-red-400 ml-auto">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {campaigns.length === 0 && (
          <div className="col-span-2 text-center py-12 text-gray-500">
            No campaigns configured. Click "New Campaign" to get started.
          </div>
        )}
      </div>
    </div>
  );
}