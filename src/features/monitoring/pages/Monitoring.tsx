import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Headphones,
  Radio,
  Phone,
  User,
  Clock,
  Mic,
  MicOff,
  Eye,
  PhoneOff,
  Volume2,
  AlertTriangle,
  CalendarDays,
  Coffee,
  PlayCircle,
  Timer,
  Activity,
} from "lucide-react";

export default function MonitoringPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const companyId = user?.companyId || 1;

  const [listeningSessionId, setListeningSessionId] = useState<number | null>(null);
  const [listeningCallId, setListeningCallId] = useState<number | null>(null);
  const [bargeCallId, setBargeCallId] = useState<number | null>(null);

  // Whisper form states
  const [whisperCallerId, setWhisperCallerId] = useState<string>("");
  const [whisperMessage, setWhisperMessage] = useState("");

  // Queries
  const { data: activeCalls = [] } = trpc.monitoring.activeCalls.useQuery(
    { companyId },
    { 
      enabled: isAdmin,
      refetchInterval: 3000 // Poll active calls every 3 seconds
    }
  );
  
  const { data: users = [] } = trpc.user.list.useQuery(undefined, { enabled: isAdmin });
  const { data: campaigns = [] } = trpc.campaign.list.useQuery(undefined, { enabled: isAdmin });

  // ── Date-wise Caller Day Report ──
  const todayStr = new Date().toISOString().slice(0, 10);
  const [reportCallerId, setReportCallerId] = useState<string>("");
  const [reportDate, setReportDate] = useState<string>(todayStr);
  const { data: dayReport, isFetching: reportLoading } = trpc.monitoring.callerDayReport.useQuery(
    { callerId: parseInt(reportCallerId) || 0, date: reportDate },
    { enabled: isAdmin && !!reportCallerId && !!reportDate }
  );
  const callerUsers = users.filter((u: any) => u.role === "caller" || u.role === "admin");

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

  // Mutations
  const startListeningMutation = trpc.monitoring.startListening.useMutation();
  const stopListeningMutation = trpc.monitoring.stopListening.useMutation();
  const bargeInMutation = trpc.monitoring.bargeIn.useMutation();
  const whisperMutation = trpc.monitoring.whisper.useMutation();

  const handleListen = async (callId: number, callerId: number) => {
    try {
      const res = await startListeningMutation.mutateAsync({ callId, callerId });
      setListeningSessionId(res.id);
      setListeningCallId(callId);
      setBargeCallId(null);
    } catch (err) {
      console.error("Failed to start listening:", err);
    }
  };

  const handleStopListening = async () => {
    if (listeningSessionId) {
      try {
        await stopListeningMutation.mutateAsync({ sessionId: listeningSessionId });
      } catch (err) {
        console.error("Failed to stop listening:", err);
      }
    }
    setListeningSessionId(null);
    setListeningCallId(null);
    setBargeCallId(null);
  };

  const handleBargeIn = async (callId: number, callerId: number) => {
    try {
      const res = await bargeInMutation.mutateAsync({ callId, callerId });
      setListeningSessionId(res.id);
      setListeningCallId(callId);
      setBargeCallId(callId);
    } catch (err) {
      console.error("Failed to barge in:", err);
    }
  };

  const handleSendWhisper = async () => {
    if (!whisperCallerId || !whisperMessage.trim()) return;
    const callerId = parseInt(whisperCallerId);
    const targetCall = activeCalls.find((c: any) => c.callerId === callerId);
    if (!targetCall) {
      alert("No active call found for this caller.");
      return;
    }
    try {
      await whisperMutation.mutateAsync({
        callerId,
        callId: targetCall.id,
        message: whisperMessage,
      });
      setWhisperMessage("");
      alert("Whisper message sent privately to caller.");
    } catch (err) {
      console.error("Failed to whisper:", err);
    }
  };

  const formatDuration = (startedAt: string | null) => {
    if (!startedAt) return "00:00";
    // eslint-disable-next-line react-hooks/purity
    const diffMs = Date.now() - new Date(startedAt).getTime();
    const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
    const mins = Math.floor(diffSecs / 60);
    const secs = diffSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Lead details resolver matching db.json initial seed
  const getLeadDetails = (leadId: number) => {
    const leadsMap: Record<number, { name: string; company: string }> = {
      1: { name: "Sundar Pichai", company: "Google" },
      2: { name: "Satya Nadella", company: "Microsoft" },
      3: { name: "Tim Cook", company: "Apple" },
      4: { name: "Mark Zuckerberg", company: "Meta" }
    };
    return leadsMap[leadId] || { name: `Lead #${leadId}`, company: "Enterprise Target" };
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <AlertTriangle className="w-8 h-8 text-amber-400 mr-3" />
        <p className="text-gray-400">Monitoring is only available for admin users.</p>
      </div>
    );
  }

  const activeListeningCall = activeCalls.find((c: any) => c.id === listeningCallId);
  const activeListeningLead = activeListeningCall ? getLeadDetails(activeListeningCall.leadId) : null;
  const activeListeningCaller = activeListeningCall ? users.find((u: any) => u.id === activeListeningCall.callerId) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Monitoring</h1>
          <p className="text-gray-400 mt-1">Listen to active calls in real-time without permission</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 rounded-lg border border-gray-800">
          <Radio className="w-4 h-4 text-green-400 animate-pulse" />
          <span className="text-sm text-gray-300">{activeCalls.length} active calls</span>
        </div>
      </div>

      {/* Active Monitoring Sessions */}
      {listeningCallId && activeListeningCall && (
        <Card className="bg-gray-900 border-blue-800/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center animate-pulse">
                <Headphones className="w-6 h-6 text-blue-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-white font-medium">Listening to call #{listeningCallId}</p>
                  <Badge className="bg-blue-500/20 text-blue-400 animate-pulse">Live</Badge>
                </div>
                <p className="text-sm text-gray-400">
                  {activeListeningCaller?.name || `Caller ${activeListeningCall.callerId}`} → {activeListeningLead?.name} ({activeListeningLead?.company})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-green-400" />
                {!bargeCallId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-purple-600/30 text-purple-400 hover:bg-purple-600/20"
                    onClick={() => handleBargeIn(activeListeningCall.id, activeListeningCall.callerId)}
                  >
                    <Mic className="w-4 h-4 mr-1" /> Barge In
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-600/30 text-red-400 hover:bg-red-600/20"
                  onClick={handleStopListening}
                >
                  <PhoneOff className="w-4 h-4 mr-1" /> Stop
                </Button>
              </div>
            </div>
            {bargeCallId && (
              <div className="mt-3 p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-purple-400" />
                  <p className="text-sm text-purple-300 font-medium">Barge Mode Active</p>
                  <Badge className="bg-purple-500/20 text-purple-400 text-xs animate-pulse">Speaking</Badge>
                </div>
                <p className="text-xs text-purple-400/70 mt-1">Both caller and lead can hear you</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active Calls Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {activeCalls.map((call: any) => {
          const caller = users.find((u: any) => u.id === call.callerId);
          const lead = getLeadDetails(call.leadId);
          const campaign = campaigns.find((c: any) => c.id === call.campaignId);

          return (
            <Card key={call.id} className={`bg-gray-900 border-gray-800 ${listeningCallId === call.id ? "ring-1 ring-blue-600" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                      <Phone className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">{caller?.name || `Caller ${call.callerId}`}</p>
                        <Badge className="bg-gray-700 text-gray-300 text-xs">ID: {call.callerId}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDuration(call.startedAt)}
                      </p>
                    </div>
                  </div>
                  <Badge className={call.status === "connected" ? "bg-green-500/20 text-green-400 animate-pulse" : "bg-blue-500/20 text-blue-400"}>
                    {call.status}
                  </Badge>
                </div>

                <div className="bg-gray-800/50 rounded-lg p-3 mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <User className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-300">{lead.name}</span>
                    <span className="text-xs text-gray-500">| {lead.company}</span>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">{call.toNumber}</p>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{campaign?.name || "Manual Dialer"}</span>
                  <div className="flex gap-2">
                    {listeningCallId === call.id ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-600/30 text-red-400 hover:bg-red-600/20 h-8"
                        onClick={handleStopListening}
                      >
                        <MicOff className="w-4 h-4 mr-1" /> Stop
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-blue-600/30 text-blue-400 hover:bg-blue-600/20 h-8"
                          onClick={() => handleListen(call.id, call.callerId)}
                        >
                          <Eye className="w-4 h-4 mr-1" /> Listen
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-purple-600/30 text-purple-400 hover:bg-purple-600/20 h-8"
                          onClick={() => handleBargeIn(call.id, call.callerId)}
                        >
                          <Mic className="w-4 h-4 mr-1" /> Barge
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {activeCalls.length === 0 && (
          <div className="col-span-2 text-center py-12 text-gray-500">
            No active calls currently in progress.
          </div>
        )}
      </div>

      {/* Whisper Feature */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-base">Whisper to Caller</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400 mb-3">
            Send a private message to a caller that only they can hear. The lead will not hear this message.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select 
              value={whisperCallerId}
              onChange={(e) => setWhisperCallerId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white"
            >
              <option value="">Select caller...</option>
              {activeCalls.map((c: any) => {
                const callerObj = users.find((u: any) => u.id === c.callerId);
                return (
                  <option key={c.callerId} value={c.callerId}>
                    {callerObj?.name || `Caller ${c.callerId}`} (Call #{c.id})
                  </option>
                );
              })}
            </select>
            <input
              type="text"
              value={whisperMessage}
              onChange={(e) => setWhisperMessage(e.target.value)}
              placeholder="Type message..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white"
            />
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 h-auto" onClick={handleSendWhisper}>
              <Headphones className="w-4 h-4 mr-1" /> Send Whisper
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Date-wise Caller Day Report ─── */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-400" /> Caller Day Report (Date-wise)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={reportCallerId}
              onChange={(e) => setReportCallerId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white"
            >
              <option value="">Select caller...</option>
              {callerUsers.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name || u.email || `User #${u.id}`}</option>
              ))}
            </select>
            <input
              type="date"
              value={reportDate}
              max={todayStr}
              onChange={(e) => setReportDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white"
            />
            {reportLoading && <span className="text-sm text-gray-500 self-center animate-pulse">Loading report...</span>}
          </div>

          {dayReport && reportCallerId && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <Clock className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <p className="text-sm font-bold text-white">{fmtTime(dayReport.dayStartTime)}</p>
                  <p className="text-[10px] text-gray-400">Day Start (1st Call)</p>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <Clock className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                  <p className="text-sm font-bold text-white">{fmtTime(dayReport.dayEndTime)}</p>
                  <p className="text-[10px] text-gray-400">Last Activity</p>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <Phone className="w-4 h-4 text-green-400 mx-auto mb-1" />
                  <p className="text-sm font-bold text-white">{dayReport.totalCalls}</p>
                  <p className="text-[10px] text-gray-400">Total Calls ({dayReport.connectedCalls} connected)</p>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <Timer className="w-4 h-4 text-cyan-400 mx-auto mb-1" />
                  <p className="text-sm font-bold text-white">{fmtSecs(dayReport.totalTalkTime)}</p>
                  <p className="text-[10px] text-gray-400">Total Talk Time</p>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <Coffee className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                  <p className="text-sm font-bold text-white">{fmtSecs(dayReport.totalIdleTime)}</p>
                  <p className="text-[10px] text-gray-400">Free / Pause Time</p>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-3 text-center">
                  <Activity className="w-4 h-4 text-rose-400 mx-auto mb-1" />
                  <p className="text-sm font-bold text-white">{fmtSecs(dayReport.avgCallDuration)}</p>
                  <p className="text-[10px] text-gray-400">Avg Call Duration</p>
                </div>
              </div>

              {/* Timeline */}
              {dayReport.timeline.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No calls recorded on {reportDate} for this caller.
                </div>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-2">
                  {dayReport.timeline.map((item: any, i: number) =>
                    item.type === "idle" ? (
                      <div key={i} className="flex items-center gap-3 pl-6 py-1">
                        <div className="w-px h-6 bg-amber-600/40 ml-3" />
                        <Coffee className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-xs text-amber-400/90">
                          Free / Pause — {fmtSecs(item.seconds)} ({fmtTime(item.from)} → {fmtTime(item.to)})
                        </span>
                      </div>
                    ) : (
                      <div key={i} className="bg-gray-800/40 border border-gray-800 rounded-lg p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center text-xs font-bold text-blue-400">
                              #{item.callNumber}
                            </div>
                            <div>
                              <p className="text-sm text-white font-medium">
                                {item.toNumber}{" "}
                                <Badge className={`ml-1 text-[10px] ${
                                  item.status === "completed" || item.status === "connected"
                                    ? "bg-green-500/20 text-green-400"
                                    : "bg-gray-600/30 text-gray-400"
                                }`}>{item.status}</Badge>
                                <Badge className="ml-1 text-[10px] bg-purple-500/20 text-purple-400">{item.callType}</Badge>
                              </p>
                              <p className="text-[11px] text-gray-500">
                                {fmtTime(item.startedAt)} → {fmtTime(item.endedAt)} · Duration: {fmtSecs(item.duration)}
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
                          <p className="text-xs text-gray-400 italic mt-2 border-t border-gray-800 pt-2">{item.notes}</p>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          )}
          {!reportCallerId && (
            <p className="text-sm text-gray-500 text-center py-4">
              Select a caller and a date to view their complete day performance — start time, every call with duration and recording, plus all free/pause gaps.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
