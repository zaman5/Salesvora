import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router";
import {
  Phone,
  Users,
  List,
  Radio,
  BarChart3,
  PhoneCall,
  TrendingUp,
  Headphones,
  ArrowRight,
  CalendarDays,
} from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const companyId = user?.companyId || 1;

  // ── Date Range Filter (Today / 7d / 30d / Custom) ──
  const [rangePreset, setRangePreset] = useState<"today" | "7d" | "30d" | "custom">("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { dateFrom, dateTo, chartDays } = useMemo(() => {
    const now = new Date();
    const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
    if (rangePreset === "today") {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      return { dateFrom: start.toISOString(), dateTo: endOfToday.toISOString(), chartDays: 1 };
    }
    if (rangePreset === "7d") {
      const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
      return { dateFrom: start.toISOString(), dateTo: endOfToday.toISOString(), chartDays: 7 };
    }
    if (rangePreset === "30d") {
      const start = new Date(now); start.setDate(start.getDate() - 29); start.setHours(0, 0, 0, 0);
      return { dateFrom: start.toISOString(), dateTo: endOfToday.toISOString(), chartDays: 30 };
    }
    // custom
    const from = customFrom ? new Date(customFrom + "T00:00:00") : undefined;
    const to = customTo ? new Date(customTo + "T23:59:59.999") : undefined;
    const days = from && to ? Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000)) : 7;
    return {
      dateFrom: from?.toISOString(),
      dateTo: to?.toISOString(),
      chartDays: Math.min(days, 90),
    };
  }, [rangePreset, customFrom, customTo]);

  // Retrieve dashboard statistics for Admin (filtered by selected date range)
  const { data: adminStats } = trpc.report.dashboard.useQuery(
    { companyId, dateFrom, dateTo },
    { enabled: isAdmin }
  );

  // Retrieve call statistics for Callers
  const { data: callerStats } = trpc.calls.stats.useQuery(
    {},
    { enabled: !isAdmin }
  );

  // Retrieve call volume for Chart
  const { data: callVolume = [] } = trpc.report.callVolume.useQuery(
    { companyId, days: chartDays },
    { enabled: isAdmin }
  );

  const displayVolume = callVolume.length > 0 ? callVolume : [
    { date: "Mon", total: 45, connected: 32 },
    { date: "Tue", total: 52, connected: 38 },
    { date: "Wed", total: 38, connected: 25 },
    { date: "Thu", total: 61, connected: 48 },
    { date: "Fri", total: 55, connected: 41 },
    { date: "Sat", total: 28, connected: 18 },
    { date: "Sun", total: 35, connected: 24 },
  ];

  // Stats display mapping
  const stats = [
    { label: rangePreset === "today" ? "Calls Today" : "Total Calls (Range)", value: isAdmin ? (adminStats?.totalCalls?.toLocaleString() ?? "0") : (callerStats?.total?.toLocaleString() ?? "0"), change: "+12%", icon: Phone, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Connected", value: isAdmin ? (adminStats?.connectedCalls?.toLocaleString() ?? "0") : (callerStats?.connected?.toLocaleString() ?? "0"), change: "+8%", icon: PhoneCall, color: "text-green-400", bg: "bg-green-500/10" },
    { label: "Total Leads", value: isAdmin ? (adminStats?.totalLeads?.toLocaleString() ?? "0") : "-", change: "+24%", icon: List, color: "text-purple-400", bg: "bg-purple-500/10" },
    { label: "Active Campaigns", value: isAdmin ? (adminStats?.activeCampaigns?.toLocaleString() ?? "0") : "-", change: "+2", icon: Radio, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Callers", value: isAdmin ? (adminStats?.totalCallers?.toLocaleString() ?? "0") : "-", change: "+3", icon: Users, color: "text-cyan-400", bg: "bg-cyan-500/10" },
    { label: "Today's Calls", value: isAdmin ? (adminStats?.todayCalls?.toLocaleString() ?? "0") : (callerStats?.total?.toLocaleString() ?? "0"), change: "+18%", icon: TrendingUp, color: "text-rose-400", bg: "bg-rose-500/10" },
  ];

  const quickActions = [
    { label: "Make a Call", icon: PhoneCall, path: "/dialer", desc: "Start manual calling" },
    { label: "Auto Dialer", icon: Radio, path: "/auto-dialer", desc: "Launch campaign calls" },
    { label: "Upload Leads", icon: List, path: "/leads", desc: "Import new lead lists" },
    { label: "Live Monitor", icon: Headphones, path: "/monitoring", desc: "Listen to active calls" },
  ];

  const recentActivity = [
    { type: "call", message: "Call completed - John Smith (Connected)", time: "2 min ago", status: "success" },
    { type: "call", message: "Call ended - Sarah Johnson (Not Interested)", time: "5 min ago", status: "neutral" },
    { type: "lead", message: "New leads uploaded - Tech Companies List (500)", time: "15 min ago", status: "info" },
    { type: "campaign", message: "Campaign 'Summer Promo' started", time: "1 hr ago", status: "info" },
    { type: "call", message: "Call completed - Mike Davis (Interested)", time: "1 hr ago", status: "success" },
    { type: "call", message: "Call failed - Lisa Wilson (No Answer)", time: "2 hrs ago", status: "warning" },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Welcome back, {user?.name || "Admin"}</h1>
          <p className="text-gray-400 mt-1">
            {isAdmin
              ? "Here's what's happening with your dialer today"
              : "Ready to make some calls today?"}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          {isAdmin && (
            <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
              <CalendarDays className="w-4 h-4 text-gray-500 ml-2 mr-1" />
              {([
                { key: "today", label: "Today" },
                { key: "7d", label: "7 Days" },
                { key: "30d", label: "1 Month" },
                { key: "custom", label: "Custom" },
              ] as const).map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRangePreset(r.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    rangePreset === r.key ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <Button
            onClick={() => navigate("/dialer")}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <PhoneCall className="w-4 h-4 mr-2" />
            Start Calling
          </Button>
        </div>
      </div>

      {/* Custom range pickers */}
      {isAdmin && rangePreset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-sm text-white"
          />
          <span className="text-gray-500 text-sm">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-sm text-white"
          />
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="bg-gray-900 border-gray-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center`}>
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <span className="text-xs font-medium text-green-400">{stat.change}</span>
              </div>
              <p className="text-2xl font-bold text-white mt-3">{stat.value}</p>
              <p className="text-sm text-gray-400">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <Card className="bg-gray-900 border-gray-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-white text-lg">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {quickActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  onClick={() => navigate(action.path)}
                  className="h-auto p-4 bg-gray-800 border-gray-600 hover:bg-gray-700 hover:border-gray-500 justify-start text-left"
                >
                  <div className={`w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center mr-3 flex-shrink-0`}>
                    <action.icon className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">{action.label}</p>
                    <p className="text-gray-400 text-xs">{action.desc}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-500 ml-auto" />
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity.map((activity, i) => (
                <div key={i} className="flex items-start gap-3 pb-3 border-b border-gray-800 last:border-0">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    activity.status === "success" ? "bg-green-500" :
                    activity.status === "warning" ? "bg-amber-500" :
                    activity.status === "neutral" ? "bg-gray-500" :
                    "bg-blue-500"
                  }`} />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-300 truncate">{activity.message}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Chart Placeholder */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-white text-lg">Call Performance</CardTitle>
          <Button variant="outline" size="sm" className="border-gray-700 text-gray-300 hover:text-white" onClick={() => navigate("/reports")}>
            <BarChart3 className="w-4 h-4 mr-2" />
            View Reports
          </Button>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-end justify-around gap-2 px-4">
            {displayVolume.map((item: any, i: number) => {
              const total = item.total || 0;
              const connected = item.connected || 0;
              const maxVal = Math.max(...displayVolume.map((d: any) => d.total || 1));
              const heightTotal = (total / maxVal) * 200;
              const heightConnected = (connected / maxVal) * 200;
              const label = item.date.includes("-") ? item.date.split("-").slice(1).join("-") : item.date;

              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <div className="w-full flex flex-col gap-1 items-center justify-end h-52">
                    <div
                      className="w-full bg-green-500/60 rounded-t hover:bg-green-500/80 transition-colors"
                      style={{ height: `${heightConnected}px` }}
                      title={`Connected: ${connected}`}
                    />
                    <div
                      className="w-full bg-blue-600/40 rounded-t hover:bg-blue-600/60 transition-colors"
                      style={{ height: `${Math.max(0, heightTotal - heightConnected)}px` }}
                      title={`Unconnected: ${total - connected}`}
                    />
                  </div>
                  <span className="text-xs text-gray-500">
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
