import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Headphones, Radio, Phone, User, Clock, Mic,
  Volume2, AlertTriangle, CalendarDays, Coffee,
  PlayCircle, Timer, Activity, Eye, EyeOff, UserX, MessageSquare,
} from "lucide-react";

// ── Live duration ticker (re-renders every second) ──────────────────────────
function useTicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

function liveDuration(startedAt: string | null): string {
  if (!startedAt) return "00:00";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const fmtSecs = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sec = secs % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

// ── Audio Wave animation for monitoring indicator ──────────────────────────
function AudioWave({ active }: { active: boolean }) {
  return (
    <div className="flex items-end gap-0.5 h-5">
      {[1, 2, 3, 4, 3, 2, 1].map((h, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all ${active ? "bg-green-400" : "bg-gray-600"}`}
          style={{
            height: active ? `${h * 4}px` : "4px",
            animationDelay: `${i * 80}ms`,
            animation: active ? `pulse 0.8s ease-in-out infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}

export default function MonitoringPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const companyId = user?.companyId || 1;

  useTicker(); // forces re-render every second for live durations

  const [listeningSessionId, setListeningSessionId] = useState<number | null>(null);
  const [listeningCallId, setListeningCallId]       = useState<number | null>(null);
  const [bargeCallId, setBargeCallId]               = useState<number | null>(null);
  const [removingCallId, setRemovingCallId]         = useState<number | null>(null);
  const [whisperCallerId, setWhisperCallerId]       = useState<string>("");
  const [whisperMessage, setWhisperMessage]         = useState("");
  const [whisperSent, setWhisperSent]               = useState(false);
  const [reportCallerId, setReportCallerId]         = useState<string>("");
  // Local calendar date — toISOString() would hand back the UTC day, which is
  // still "yesterday" for anyone east of UTC after midnight.
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const [reportDate, setReportDate] = useState<string>(todayStr);

  // ── Queries ──
  const { data: activeCalls = [], refetch: refetchCalls } = trpc.monitoring.activeCalls.useQuery(
    { companyId },
    { enabled: isAdmin, refetchInterval: 4000 },
  );
  const { data: users = [] }     = trpc.user.list.useQuery(undefined, { enabled: isAdmin });
  const { data: campaigns = [] } = trpc.campaign.list.useQuery(undefined, { enabled: isAdmin });
  const { data: dayReport, isFetching: reportLoading } = trpc.monitoring.callerDayReport.useQuery(
    { callerId: parseInt(reportCallerId) || 0, date: reportDate },
    { enabled: isAdmin && !!reportCallerId && !!reportDate },
  );
  const callerUsers = (users as any[]).filter((u: any) => u.role === "caller" || u.role === "admin");

  // ── Mutations ──
  const startListeningMutation = trpc.monitoring.startListening.useMutation();
  const stopListeningMutation  = trpc.monitoring.stopListening.useMutation();
  const bargeInMutation        = trpc.monitoring.bargeIn.useMutation();
  const whisperMutation        = trpc.monitoring.whisper.useMutation();
  const endCallerCallMutation  = trpc.monitoring.endCallerCall.useMutation({
    onSuccess: () => { refetchCalls(); setRemovingCallId(null); },
  });

  // ── Handlers ──
  const handleListen = async (callId: number, callerId: number) => {
    try {
      const res = await startListeningMutation.mutateAsync({ callId, callerId }) as any;
      setListeningSessionId(res.id as number);
      setListeningCallId(callId);
      setBargeCallId(null);
    } catch (err) { console.error(err); }
  };

  const handleStopListening = useCallback(async () => {
    if (listeningSessionId) {
      try { await stopListeningMutation.mutateAsync({ sessionId: listeningSessionId }); } catch { /* noop */ }
    }
    setListeningSessionId(null);
    setListeningCallId(null);
    setBargeCallId(null);
  }, [listeningSessionId, stopListeningMutation]);

  const handleBargeIn = async (callId: number, callerId: number) => {
    try {
      const res = await bargeInMutation.mutateAsync({ callId, callerId }) as any;
      setListeningSessionId(res.id as number);
      setListeningCallId(callId);
      setBargeCallId(callId);
    } catch (err) { console.error(err); }
  };

  const handleRemoveCaller = async (callId: number, callerId: number) => {
    if (!confirm("Remove this caller from the active call? This will immediately disconnect them.")) return;
    setRemovingCallId(callId);
    try {
      await endCallerCallMutation.mutateAsync({ callId, callerId });
      // If we were monitoring this call, stop
      if (listeningCallId === callId) handleStopListening();
    } catch (err) { console.error(err); setRemovingCallId(null); }
  };

  const handleSendWhisper = async () => {
    if (!whisperCallerId || !whisperMessage.trim()) return;
    const callerId   = parseInt(whisperCallerId);
    const targetCall = (activeCalls as any[]).find((c: any) => c.callerId === callerId);
    if (!targetCall) { alert("No active call found for this caller."); return; }
    try {
      await whisperMutation.mutateAsync({ callerId, callId: targetCall.id, message: whisperMessage });
      setWhisperMessage("");
      setWhisperSent(true);
      setTimeout(() => setWhisperSent(false), 3000);
    } catch (err) { console.error(err); }
  };

  // ── Derived state ──
  const activeListeningCall   = (activeCalls as any[]).find((c: any) => c.id === listeningCallId) as any;
  const activeListeningCaller = activeListeningCall
    ? (users as any[]).find((u: any) => u.id === (activeListeningCall as any).callerId) as any
    : null;

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <AlertTriangle className="w-8 h-8 text-amber-400 mr-3" />
        <p className="text-gray-500 dark:text-gray-400">Monitoring is only available for admin users.</p>
      </div>
    );
  }

  // Cast dayReport once so every property access is typed as any
  const rpt = dayReport as any;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Live Monitoring</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Listen to active calls, barge in, or remove a caller</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
          <Radio className={`w-4 h-4 ${(activeCalls as any[]).length > 0 ? "text-green-400 animate-pulse" : "text-gray-600"}`} />
          <span className="text-sm text-gray-600 dark:text-gray-300">{(activeCalls as any[]).length} active call{(activeCalls as any[]).length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* ── Active Monitoring Session banner ── */}
      {listeningCallId && activeListeningCall && (
        <Card className="bg-white dark:bg-gray-900 border-blue-600/40 shadow-lg shadow-blue-900/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              {/* Animated headphones icon */}
              <div className="relative shrink-0">
                <div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <Headphones className="w-7 h-7 text-blue-400" />
                </div>
                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-blue-500" />
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-gray-900 dark:text-white font-semibold">
                    {bargeCallId ? "Barged into call" : "Monitoring call"}
                  </p>
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-0 animate-pulse">● Live</Badge>
                  {bargeCallId && <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 border-0">Barge Mode</Badge>}
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  <span className="font-medium text-gray-900 dark:text-gray-200">{activeListeningCaller?.name || `Caller #${activeListeningCall.callerId}`}</span>
                  <span className="text-gray-500"> → </span>
                  <span className="font-mono text-blue-300">{activeListeningCall.toNumber}</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5 font-mono">
                  Duration: {liveDuration(activeListeningCall.startedAt)}
                </p>
              </div>

              {/* Audio wave */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <AudioWave active />
                <p className="text-[10px] text-gray-500">Audio stream</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Volume2 className="w-5 h-5 text-green-400" />
                {!bargeCallId && (
                  <Button
                    size="sm"
                    className="bg-purple-600 hover:bg-purple-700 text-white h-9"
                    onClick={() => handleBargeIn(activeListeningCall.id, activeListeningCall.callerId)}
                  >
                    <Mic className="w-4 h-4 mr-1" /> Barge In
                  </Button>
                )}
                <Button
                  size="sm"
                  className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white h-9"
                  onClick={handleStopListening}
                >
                  <EyeOff className="w-4 h-4 mr-1" /> Stop Listening
                </Button>
              </div>
            </div>

            {/* Barge-mode note */}
            {bargeCallId && (
              <div className="mt-3 flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-2">
                <Mic className="w-4 h-4 text-purple-400 shrink-0" />
                <p className="text-sm text-purple-300">
                  <span className="font-semibold">Barge active</span> — both your caller and the lead can now hear you.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Active Calls Grid ── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Active Calls</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(activeCalls as any[]).map((call: any) => {
            const caller   = (users as any[]).find((u: any) => u.id === call.callerId) as any;
            const campaign = (campaigns as any[]).find((c: any) => c.id === call.campaignId) as any;
            const isMonitoring = listeningCallId === call.id;
            const isRemoving   = removingCallId === call.id;

            return (
              <Card
                key={call.id}
                className={`bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 transition-all ${
                  isMonitoring ? "ring-2 ring-blue-500/60 border-blue-800/40" : "hover:border-gray-300 dark:hover:border-gray-700"
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Top row: caller info + status */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-11 h-11 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center">
                          <User className="w-5 h-5 text-green-400" />
                        </div>
                        {/* Live indicator */}
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                          {caller?.name || `Caller #${call.callerId}`}
                        </p>
                        <p className="text-xs text-gray-500">{caller?.email || `ID: ${call.callerId}`}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400 border-0">● Live</Badge>
                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{liveDuration(call.startedAt)}</span>
                    </div>
                  </div>

                  {/* Call details */}
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                      <span className="text-sm font-mono text-gray-900 dark:text-white">{call.toNumber || "Unknown"}</span>
                    </div>
                    {call.fromNumber && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                        <span className="text-xs text-gray-500">from {call.fromNumber}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                      <span className="text-xs text-gray-500">{campaign?.name || "Manual Dialer"}</span>
                    </div>
                  </div>

                  {/* Audio wave when monitoring */}
                  {isMonitoring && (
                    <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                      <Volume2 className="w-4 h-4 text-blue-400 shrink-0" />
                      <AudioWave active />
                      <span className="text-xs text-blue-400 ml-1">Listening live</span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    {isMonitoring ? (
                      <>
                        {!bargeCallId && (
                          <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white flex-1"
                            onClick={() => handleBargeIn(call.id, call.callerId)}>
                            <Mic className="w-3.5 h-3.5 mr-1" /> Barge In
                          </Button>
                        )}
                        <Button size="sm" className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white flex-1"
                          onClick={handleStopListening}>
                          <EyeOff className="w-3.5 h-3.5 mr-1" /> Stop
                        </Button>
                      </>
                    ) : (
                      <>
                        {/* Listen */}
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white flex-1"
                          onClick={() => handleListen(call.id, call.callerId)}
                          disabled={startListeningMutation.isPending}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> Listen
                        </Button>

                        {/* Barge */}
                        <Button
                          size="sm"
                          className="bg-purple-600 hover:bg-purple-700 text-white flex-1"
                          onClick={() => handleBargeIn(call.id, call.callerId)}
                        >
                          <Mic className="w-3.5 h-3.5 mr-1" /> Barge In
                        </Button>

                        {/* Remove caller */}
                        <Button
                          size="sm"
                          className="bg-red-700 hover:bg-red-600 text-white"
                          onClick={() => handleRemoveCaller(call.id, call.callerId)}
                          disabled={isRemoving}
                          title="Remove caller — force-end this call"
                        >
                          {isRemoving
                            ? <span className="animate-spin text-sm">⟳</span>
                            : <UserX className="w-3.5 h-3.5" />}
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Remove caller label hint */}
                  {!isMonitoring && (
                    <p className="text-[10px] text-gray-600 text-right">
                      <UserX className="w-2.5 h-2.5 inline mr-0.5" /> = Remove caller from call
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {(activeCalls as any[]).length === 0 && (
            <div className="col-span-2 text-center py-16 text-gray-600">
              <Radio className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No active calls right now.</p>
              <p className="text-xs mt-1 opacity-70">This panel refreshes automatically every 4 seconds.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Whisper Feature ── */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-gray-900 dark:text-white text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-400" /> Whisper to Caller
          </CardTitle>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Send a private text message to a caller — only they will see it, not the lead.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={whisperCallerId}
              onChange={(e) => setWhisperCallerId(e.target.value)}
              className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
            >
              <option value="">Select caller…</option>
              {(activeCalls as any[]).map((c: any) => {
                const callerObj = (users as any[]).find((u: any) => u.id === c.callerId) as any;
                return (
                  <option key={c.callerId} value={c.callerId}>
                    {callerObj?.name || `Caller ${c.callerId}`} · {c.toNumber}
                  </option>
                );
              })}
            </select>
            <input
              type="text"
              value={whisperMessage}
              onChange={(e) => setWhisperMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendWhisper()}
              placeholder="Type message to caller…"
              className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-600"
            />
            <Button
              className={`h-auto px-4 text-white ${whisperSent ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"}`}
              onClick={handleSendWhisper}
              disabled={!whisperCallerId || !whisperMessage.trim()}
            >
              <Headphones className="w-4 h-4 mr-1" />
              {whisperSent ? "Sent ✓" : "Send"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Day Report ── */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white text-lg flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-400" /> Caller Day Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={reportCallerId}
              onChange={(e) => setReportCallerId(e.target.value)}
              className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
            >
              <option value="">Select caller…</option>
              {callerUsers.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name || u.email || `User #${u.id}`}</option>
              ))}
            </select>
            <input
              type="date"
              value={reportDate}
              max={todayStr}
              onChange={(e) => setReportDate(e.target.value)}
              className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
            {reportLoading && <span className="text-sm text-gray-500 self-center animate-pulse">Loading…</span>}
          </div>

          {rpt && reportCallerId ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { icon: Clock, color: "text-blue-400", label: "Day Start", value: fmtTime(rpt.dayStartTime) },
                  { icon: Clock, color: "text-purple-400", label: "Last Activity", value: fmtTime(rpt.dayEndTime) },
                  { icon: Phone, color: "text-green-400", label: `Total (${rpt.connectedCalls} conn.)`, value: String(rpt.totalCalls) },
                  { icon: Timer, color: "text-cyan-400", label: "Talk Time", value: fmtSecs(rpt.totalTalkTime) },
                  { icon: Coffee, color: "text-amber-400", label: "Idle Time", value: fmtSecs(rpt.totalIdleTime) },
                  { icon: Activity, color: "text-rose-400", label: "Avg Duration", value: fmtSecs(rpt.avgCallDuration) },
                ].map(({ icon: Icon, color, label, value }) => (
                  <div key={label} className="bg-gray-100 dark:bg-gray-800 rounded-xl p-3 text-center">
                    <Icon className={`w-4 h-4 ${color} mx-auto mb-1`} />
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{value}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {rpt.timeline.length === 0 ? (
                <p className="text-center py-8 text-gray-500 text-sm">No calls on {reportDate}.</p>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-2">
                  {rpt.timeline.map((item: any, i: number) =>
                    item.type === "idle" ? (
                      <div key={i} className="flex items-center gap-3 pl-6 py-1">
                        <div className="w-px h-6 bg-amber-600/40 ml-3" />
                        <Coffee className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-xs text-amber-400/90">
                          Idle — {fmtSecs(item.seconds)} ({fmtTime(item.from)} → {fmtTime(item.to)})
                        </span>
                      </div>
                    ) : (
                      <div key={i} className="bg-gray-100/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center text-xs font-bold text-blue-400">
                              #{item.callNumber}
                            </div>
                            <div>
                              <p className="text-sm text-gray-900 dark:text-white font-medium">
                                {item.toNumber}
                                <Badge className={`ml-2 text-[10px] ${
                                  item.status === "completed" || item.status === "connected"
                                    ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400 border-0"
                                    : "bg-gray-600/30 text-gray-500 dark:text-gray-400 border-0"
                                }`}>{item.status}</Badge>
                                <Badge className="ml-1 text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 border-0">{item.callType}</Badge>
                              </p>
                              <p className="text-[11px] text-gray-500">
                                {fmtTime(item.startedAt)} → {fmtTime(item.endedAt)} · {fmtSecs(item.duration)}
                              </p>
                            </div>
                          </div>
                          {item.recordingUrl ? (
                            <audio controls src={item.recordingUrl} className="h-8 max-w-[220px]" />
                          ) : (
                            <span className="text-[10px] text-gray-600 flex items-center gap-1">
                              <PlayCircle className="w-3 h-3" /> No recording
                            </span>
                          )}
                        </div>
                        {item.notes && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-2 border-t border-gray-200 dark:border-gray-800 pt-2">{item.notes}</p>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 text-center py-6">
              Select a caller and date to view their full-day performance.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}