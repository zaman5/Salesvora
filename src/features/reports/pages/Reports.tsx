import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone,
  Download,
  Calendar,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  TrendingUp,
  PieChart,
} from "lucide-react";

export default function ReportsPage() {
  const { user } = useAuth();
  const companyId = user?.companyId || 1;
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const [dateRange, setDateRange] = useState("7d");

  const daysParam = 
    dateRange === "today" ? 1 :
    dateRange === "7d" ? 7 :
    dateRange === "30d" ? 30 : 90;

  // Queries
  const { data: adminStats } = trpc.report.dashboard.useQuery(
    { companyId },
    { enabled: isAdmin }
  );

  const { data: callVolume = [] } = trpc.report.callVolume.useQuery(
    { companyId, days: daysParam },
    { enabled: isAdmin }
  );

  const { data: rawDispositions = [] } = trpc.report.dispositionBreakdown.useQuery(
    { companyId },
    { enabled: isAdmin }
  );

  const { data: agentPerformance = [] } = trpc.report.agentPerformance.useQuery(
    { companyId },
    { enabled: isAdmin }
  );

  const { data: campaigns = [] } = trpc.campaign.list.useQuery(
    undefined,
    { enabled: isAdmin }
  );

  const { data: users = [] } = trpc.user.list.useQuery(
    undefined,
    { enabled: isAdmin }
  );

  const exportCallsMutation = trpc.report.exportCalls.useMutation();

  const handleExportCSV = async () => {
    try {
      const res = await exportCallsMutation.mutateAsync({
        companyId,
        format: "csv",
      });
      alert(`Export generated successfully! Download started. Generated at: ${new Date(res.generatedAt).toLocaleString()}`);
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  // Disposition metadata mapping
  const dispositionMap: Record<number, { label: string; color: string }> = {
    1: { label: "Connected", color: "bg-green-500" },
    2: { label: "No Answer", color: "bg-red-500" },
    3: { label: "Answering Machine", color: "bg-amber-500" },
    4: { label: "Voice Mail", color: "bg-purple-500" },
    5: { label: "Wrong Number", color: "bg-pink-500" },
    6: { label: "Invalid/Irrelevant", color: "bg-gray-500" },
    7: { label: "Interested", color: "bg-emerald-500" },
    8: { label: "Not Interested", color: "bg-rose-500" },
    9: { label: "Do Not Call", color: "bg-red-800" },
    10: { label: "Custom Outcome", color: "bg-blue-600" }
  };

  const totalDispCount = rawDispositions.reduce((a, b) => a + (b.count || 0), 0);
  const dispositionData = rawDispositions.map((d: any) => {
    const meta = dispositionMap[d.dispositionId] || { label: `Outcome #${d.dispositionId}`, color: "bg-gray-600" };
    const pct = totalDispCount > 0 ? Math.round((d.count / totalDispCount) * 100) : 0;
    return {
      label: meta.label,
      count: d.count,
      pct,
      color: meta.color,
    };
  });

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      running: "bg-green-500/20 text-green-400",
      paused: "bg-amber-500/20 text-amber-400",
      completed: "bg-blue-500/20 text-blue-400",
      draft: "bg-gray-500/20 text-gray-400",
    };
    return <Badge className={`${colors[status] || "bg-gray-500/20"} border-0 capitalize`}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Reports & Analytics</h1>
          <p className="text-gray-400 mt-1">Detailed call analytics and performance reports</p>
        </div>
        <div className="flex gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-36 bg-gray-900 border-gray-800 text-white">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-800">
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            onClick={handleExportCSV}
            className="border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="bg-gray-900 border border-gray-800">
          <TabsTrigger value="overview" className="data-[state=active]:bg-gray-800">Overview</TabsTrigger>
          <TabsTrigger value="agents" className="data-[state=active]:bg-gray-800">Agent Performance</TabsTrigger>
          <TabsTrigger value="campaigns" className="data-[state=active]:bg-gray-800">Campaigns</TabsTrigger>
          <TabsTrigger value="dispositions" className="data-[state=active]:bg-gray-800">Dispositions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Phone className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{(adminStats?.totalCalls || 0).toLocaleString()}</p>
                  <p className="text-sm text-gray-400">Total Calls</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{adminStats?.connectionRate || 0}%</p>
                  <p className="text-sm text-gray-400">Connection Rate</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">2m 45s</p>
                  <p className="text-sm text-gray-400">Avg Duration</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{(adminStats?.activeCampaigns || 0).toLocaleString()}</p>
                  <p className="text-sm text-gray-400">Active Campaigns</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-base">Call Volume</CardTitle>
            </CardHeader>
            <CardContent>
              {callVolume.length > 0 ? (
                <div className="h-64 flex items-end justify-around gap-3 px-4">
                  {callVolume.map((d: any, i: number) => {
                    const maxVal = Math.max(...callVolume.map((x: any) => x.total || 1));
                    const totalH = (d.total / maxVal) * 200;
                    const connH = (d.connected / maxVal) * 200;
                    const dateLabel = d.date.includes("-") ? d.date.split("-").slice(1).join("-") : d.date;

                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-2">
                        <div className="w-full flex flex-col gap-1 items-center justify-end h-52">
                          <div
                            className="w-full bg-green-500/60 rounded-t"
                            style={{ height: `${connH}px` }}
                            title={`Connected: ${d.connected}`}
                          />
                          <div
                            className="w-full bg-blue-500/40 rounded-t"
                            style={{ height: `${Math.max(0, totalH - connH)}px` }}
                            title={`Total Calls: ${d.total}`}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{dateLabel}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">
                  No call volume logs found in selected date range.
                </div>
              )}
              <div className="flex gap-4 justify-center mt-4 text-xs">
                <span className="flex items-center gap-1 text-gray-400"><div className="w-3 h-3 bg-green-500/60 rounded" /> Connected</span>
                <span className="flex items-center gap-1 text-gray-400"><div className="w-3 h-3 bg-blue-500/40 rounded" /> Total</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents" className="mt-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Agent</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Calls</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Connected</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Avg Duration</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentPerformance.map((agent: any, i: number) => {
                      const userObj = users.find((u: any) => u.id === agent.callerId);
                      const name = userObj?.name || `Caller #${agent.callerId}`;
                      const status = userObj?.status || "active";

                      return (
                        <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-sm font-medium text-white">{name}</td>
                          <td className="px-4 py-3 text-sm text-gray-400">{agent.totalCalls}</td>
                          <td className="px-4 py-3 text-sm text-green-400">{agent.connectedCalls}</td>
                          <td className="px-4 py-3 text-sm text-gray-400">{agent.avgDuration || 0}s</td>
                          <td className="px-4 py-3">
                            <Badge className={status === "active" ? "bg-green-500/20 text-green-400" : "bg-gray-500/20 text-gray-400"}>
                              {status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                    {agentPerformance.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-gray-500">
                          No agent calling performance logs found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Campaign</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Type</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Total Leads</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Completed</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Success Calls</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((camp: any, i: number) => {
                      return (
                        <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-sm font-medium text-white">{camp.name}</td>
                          <td className="px-4 py-3">
                            <Badge className="bg-gray-700 text-gray-300 capitalize">{camp.type}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400">{(camp.totalLeads || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-gray-400">{(camp.completedLeads || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-green-400">{(camp.successfulCalls || 0).toLocaleString()}</td>
                          <td className="px-4 py-3">
                            {getStatusBadge(camp.status)}
                          </td>
                        </tr>
                      );
                    })}
                    {campaigns.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-gray-500">
                          No campaign statistics found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dispositions" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Disposition Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dispositionData.map((d: any, i: number) => (
                    <div key={i}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-300">{d.label}</span>
                        <span className="text-gray-400">{(d.count || 0).toLocaleString()} ({d.pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-2">
                        <div className={`${d.color} h-2 rounded-full`} style={{ width: `${d.pct}%` }} />
                      </div>
                    </div>
                  ))}
                  {dispositionData.length === 0 && (
                    <p className="text-center py-8 text-gray-500 text-sm">No disposition breakdowns recorded.</p>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Export and Analytics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  variant="outline" 
                  onClick={handleExportCSV}
                  className="w-full justify-start border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-3 text-green-400" />
                  Export calls to CSV
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleExportCSV}
                  className="w-full justify-start border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
                >
                  <PieChart className="w-4 h-4 mr-3 text-purple-400" />
                  Generate custom PDF report
                </Button>
                <div className="pt-3 border-t border-gray-800">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">Campaign Filter List</h4>
                  <div className="space-y-2">
                    {campaigns.map((c: any) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm text-gray-400">
                        <input type="checkbox" defaultChecked className="rounded border-gray-600 bg-gray-800" />
                        {c.name}
                      </label>
                    ))}
                    {campaigns.length === 0 && (
                      <p className="text-xs text-gray-500">No campaigns created yet.</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
