import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Search,
  Download,
  Clock,
  Mic,
  Filter,
} from "lucide-react";

type CallLog = {
  id: number;
  toNumber?: string;
  fromNumber?: string;
  status: string;
  type?: string;
  callerId?: number;
  leadId?: number;
  duration?: number;
  recordingUrl?: string;
  dispositionId?: number | null;
  createdAt?: string;
};
type CallUser = { id: number; name?: string };
type Disposition = { id: number; label?: string; category?: string };

export default function CallLogsPage() {
  const { user } = useAuth();
  const companyId = user?.companyId || 1;
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Load Calls Logs
  const { data: adminLogsData } = trpc.calls.list.useQuery(
    { companyId },
    { enabled: isAdmin }
  );

  const { data: callerLogsData } = trpc.calls.myCalls.useQuery(
    {},
    { enabled: !isAdmin }
  );

  const rawLogs: CallLog[] = isAdmin
    ? (Array.isArray(adminLogsData) ? adminLogsData : ((adminLogsData as { items?: CallLog[] })?.items ?? []))
    : (Array.isArray(callerLogsData) ? callerLogsData : ((callerLogsData as { items?: CallLog[] })?.items ?? []));

  // Load supporting lists to resolve names
  const { data: users = [] } = trpc.user.list.useQuery(undefined, { enabled: isAdmin });
  const { data: dispositions = [] } = trpc.calls.dispositions.useQuery({ companyId });

  const filtered = rawLogs.filter((log) => {
    if (statusFilter !== "all" && log.status !== statusFilter) return false;
    if (typeFilter !== "all" && log.type !== typeFilter) return false;

    const caller = (users as CallUser[]).find((u) => u.id === log.callerId);
    const callerName = caller?.name || `Caller #${log.callerId}`;

    if (search) {
      const q = search.toLowerCase();
      return (
        (log.toNumber || "").includes(q) ||
        (log.fromNumber || "").includes(q) ||
        callerName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const formatDuration = (seconds: number) => {
    if (!seconds) return "-";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
      case "completed":
        return <PhoneCall className="w-4 h-4 text-green-400" />;
      case "no_answer":
        return <PhoneOff className="w-4 h-4 text-amber-400" />;
      case "failed":
        return <PhoneOff className="w-4 h-4 text-red-400" />;
      default:
        return <Phone className="w-4 h-4 text-gray-500 dark:text-gray-400" />;
    }
  };

  const getDispositionBadge = (dispId: number | null) => {
    if (!dispId) return <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400 border-0">No Outcome</Badge>;
    const dispObj = (dispositions as Disposition[]).find((d) => d.id === dispId);
    const label = dispObj?.label || `Outcome #${dispId}`;
    const category = dispObj?.category || "custom";

    // Keyed by disposition CATEGORY, which is a different vocabulary from the
    // shared StatusBadge's statuses (here no_answer is amber, not red), so this
    // map stays local. Light pair first, original dark values behind `dark:`.
    const colors: Record<string, string> = {
      connected: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
      not_interested: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
      no_answer: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
      callback: "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400",
      machine: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
      converted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
      wrong_number: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-400",
      dnc: "bg-red-100 text-red-800 dark:bg-red-800/20 dark:text-red-400",
    };

    return <Badge className={`${colors[category] || "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400"} border-0`}>{label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Call Logs</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Complete history of all calls with recordings</p>
        </div>
        <Button variant="outline" className="border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800">
          <Download className="w-4 h-4 mr-2" /> Export
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by lead, company, or phone..."
            className="pl-10 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="connected">Connected</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="no_answer">No Answer</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white">
            <Phone className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="ai">AI</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Lead</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Caller</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Type</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Disposition</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Duration</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Recording</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => {
                  const caller = (users as CallUser[]).find((u) => u.id === log.callerId);
                  const callerName = caller?.name || `Caller #${log.callerId}`;

                  return (
                    <tr key={log.id} className="border-b border-gray-200/50 dark:border-gray-800/50 hover:bg-gray-100/30 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-white font-mono">{log.toNumber || "—"}</span>
                            {getStatusIcon(log.status)}
                          </div>
                          {log.fromNumber && (
                            <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                              <Phone className="w-3 h-3" /> from {log.fromNumber}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{callerName}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 capitalize text-xs">{log.type}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={
                          (log.status === "connected" || log.status === "completed") ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400" :
                          log.status === "no_answer" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" :
                          "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
                        }>
                          {log.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{getDispositionBadge(log.dispositionId)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {formatDuration(log.duration)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {log.recordingUrl ? (
                          <div className="flex items-center gap-1.5">
                            <Mic className="w-3.5 h-3.5 text-green-400 shrink-0" />
                            <audio
                              controls
                              src={log.recordingUrl}
                              className="h-7"
                              style={{ minWidth: 160 }}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-gray-600 dark:text-gray-400">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 font-mono">
                        {log.createdAt ? new Date(log.createdAt).toLocaleString() : "Never"}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-gray-500">
                      No call logs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
