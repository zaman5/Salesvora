import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCallRecorder } from "@/hooks/useCallRecorder";
import { useWebRTC } from "@/providers/WebRTCProvider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Radio, PhoneOff, Phone, PhoneCall, CheckCircle2, XCircle, Ban,
  Disc, Square, Download, Mic, MicOff, Hash, Save, SkipForward,
  PhoneIncoming, PhoneMissed, ChevronLeft,
} from "lucide-react";
import { formatDur } from "./shared";

type CallRecord = {
  id: number;
  toNumber?: string;
  fromNumber?: string;
  status: string;
  type?: string;
  duration?: number;
  dispositionId?: number | null;
  createdAt?: string;
};

export function ManualDialTab() {
  const { user } = useAuth();
  const companyId = user?.companyId || 1;

  const [callStatus, setCallStatus] = useState<"idle" | "dialing" | "connected" | "ended">("idle");
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedDisposition, setSelectedDisposition] = useState<string | null>(null);
  const [callNotes, setCallNotes] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [activeCallId, setActiveCallId] = useState<number | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [autoRecord, setAutoRecord] = useState(() => {
    try { return localStorage.getItem("dialer.autoRecord") === "true"; } catch { return false; }
  });

  const recorder = useCallRecorder();
  const [savedRecordingDataUrl, setSavedRecordingDataUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const { data: dispositions = [] } = trpc.calls.dispositions.useQuery({ companyId });
  const { data: dialerConfig } = trpc.integration.getDialerConfig.useQuery();
  const rtc = useWebRTC();
  const webrtcOn = Boolean(dialerConfig?.webrtc?.enabled);

  const callerNumbers = (dialerConfig?.fromNumbers ?? []).filter((n: string) => !!n).map((n: string) => ({ value: n }));
  const [selectedNumber, setSelectedNumber] = useState("");
  useEffect(() => {
    const pref = dialerConfig?.defaultCallerId || callerNumbers[0]?.value || "";
    if (pref && !selectedNumber) setSelectedNumber(pref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialerConfig]);

  // Call records
  const { data: callLogsData, refetch: refetchCallLogs } = trpc.calls.myCalls.useQuery({});
  const callLogs: CallRecord[] = Array.isArray(callLogsData)
    ? callLogsData as CallRecord[]
    : ((callLogsData as { items?: CallRecord[] })?.items ?? []);

  const initiateCallMutation = trpc.calls.initiate.useMutation();
  const updateStatusMutation = trpc.calls.updateStatus.useMutation();
  const endCallMutation = trpc.calls.endCall.useMutation();
  const saveRecordingMutation = trpc.calls.saveRecording.useMutation();

  // Timer
  useEffect(() => {
    if (callStatus === "connected") {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callStatus]);

  // Mute sync
  useEffect(() => {
    recorder.setMicMuted(isMuted);
    if (webrtcOn) rtc.setMuted(isMuted);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted]);

  useEffect(() => {
    try { localStorage.setItem("dialer.autoRecord", String(autoRecord)); } catch { /* ignore */ }
  }, [autoRecord]);

  useEffect(() => {
    if (webrtcOn && rtc.callState === "active" && recorder.status === "inactive" && autoRecord) {
      const t = setTimeout(() => recorder.startRecording(rtc.getRemoteStream), 400);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webrtcOn, rtc.callState, autoRecord]);

  useEffect(() => {
    if (!webrtcOn && callStatus === "connected" && recorder.status === "inactive" && autoRecord) {
      const t = setTimeout(() => recorder.startRecording(undefined), 400);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callStatus, autoRecord, webrtcOn, recorder.status]);

  // Auto-end on SIP error
  useEffect(() => {
    if (!webrtcOn) return;
    if (rtc.callState === "ended" && (callStatus === "connected" || callStatus === "dialing")) {
      if (rtc.error) setCallError(rtc.error);
      setCallStatus("ended");
      if (timerRef.current) clearInterval(timerRef.current);
      finalizeRecording().catch(() => {});
      if (activeCallId) updateStatusMutation.mutate({ id: activeCallId, status: "completed" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtc.callState, webrtcOn]);

  // Handle answered inbound call
  useEffect(() => {
    if (!webrtcOn) return;
    if (rtc.callState === "active" && rtc.callDirection === "inbound" && callStatus === "idle") {
      setCallStatus("connected");
      setDuration(0);
      setCallError(null);
      initiateCallMutation.mutateAsync({
        companyId, toNumber: rtc.incomingCallerNumber || "unknown",
        fromNumber: selectedNumber || undefined, type: "inbound",
      }).then((call) => {
        if (call?.id) { setActiveCallId(call.id); updateStatusMutation.mutate({ id: call.id, status: "connected" }); }
      }).catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtc.callState, rtc.callDirection, webrtcOn]);

  const finalizeRecording = async (): Promise<{ dataUrl: string; duration: number } | null> => {
    if (recorder.status === "recording" || recorder.status === "paused") {
      const r = await recorder.stopRecording();
      if (r) { setSavedRecordingDataUrl(r.dataUrl); setRecordingDuration(r.duration); return { dataUrl: r.dataUrl, duration: r.duration }; }
      return null;
    }
    return savedRecordingDataUrl ? { dataUrl: savedRecordingDataUrl, duration: recordingDuration } : null;
  };

  const handleToggleRecording = async () => {
    if (recorder.status === "recording" || recorder.status === "paused") {
      const r = await recorder.stopRecording();
      if (r) { setSavedRecordingDataUrl(r.dataUrl); setRecordingDuration(r.duration); }
    } else {
      await recorder.startRecording(webrtcOn ? rtc.getRemoteStream : undefined);
    }
  };

  const handleAutoRecordToggle = async () => {
    const next = !autoRecord;
    setAutoRecord(next);
    if (!next && (recorder.status === "recording" || recorder.status === "paused")) {
      const r = await recorder.stopRecording();
      if (r) { setSavedRecordingDataUrl(r.dataUrl); setRecordingDuration(r.duration); }
    }
  };

  const doCallFlow = useCallback(async (toNumber: string) => {
    setCallError(null);
    setCallStatus("dialing");
    try {
      const activeCall = await initiateCallMutation.mutateAsync({
        companyId, toNumber, fromNumber: selectedNumber || undefined, type: "manual",
      });
      if ((activeCall as { success?: boolean }).success === false) {
        setCallError((activeCall as { error?: string }).error || "Call could not be placed.");
        setCallStatus("idle");
        return;
      }
      setActiveCallId(activeCall.id);
      if (webrtcOn) {
        if (rtc.status !== "registered") { setCallError(rtc.error || "Browser calling still connecting."); setCallStatus("idle"); return; }
        const ok = rtc.makeCall(toNumber, selectedNumber || dialerConfig?.defaultCallerId || "");
        if (!ok) { setCallError(rtc.error || "Could not start browser call."); setCallStatus("idle"); return; }
        setCallStatus("connected"); setDuration(0);
        await updateStatusMutation.mutateAsync({ id: activeCall.id, status: "connected" });
        return;
      }
      setTimeout(async () => {
        setCallStatus("connected"); setDuration(0);
        await updateStatusMutation.mutateAsync({ id: activeCall.id, status: "connected" });
      }, 1500);
    } catch (err) {
      setCallError(err instanceof Error ? err.message : "Failed to initiate call.");
      setCallStatus("idle");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedNumber, webrtcOn, dialerConfig]);

  const startCall = () => { if (!phoneNumber) return; doCallFlow(phoneNumber); };

  const handleEndCall = async () => {
    if (webrtcOn) rtc.hangup();
    setCallStatus("ended");
    if (timerRef.current) clearInterval(timerRef.current);
    await finalizeRecording();
    if (activeCallId) {
      try { await updateStatusMutation.mutateAsync({ id: activeCallId, status: "completed" }); }
      catch (err) { console.error("Failed to update call status:", err); }
    }
  };

  const resetCall = () => {
    setCallStatus("idle"); setDuration(0); setSelectedDisposition(null); setCallNotes("");
    setIsMuted(false); setActiveCallId(null); recorder.resetRecording();
    setSavedRecordingDataUrl(null); setRecordingDuration(0);
  };

  const handleSaveCall = async () => {
    const rec = await finalizeRecording();
    const callId = activeCallId;
    const dispId = selectedDisposition;
    const dur = duration;
    const notes = callNotes;
    const blobSize = recorder.audioBlob?.size;

    resetCall();

    if (callId) {
      endCallMutation.mutate({
        id: callId,
        dispositionId: dispId ? parseInt(dispId) : undefined,
        duration: dur, notes, callDescription: notes,
        recordingUrl: rec?.dataUrl || undefined,
      });
      if (rec?.dataUrl) saveRecordingMutation.mutate({
        callId, recordingUrl: rec.dataUrl,
        duration: rec.duration, fileSize: blobSize, format: "webm",
      });
    }
    setTimeout(() => refetchCallLogs(), 800);
  };

  const getDispIcon = (cat: string) => {
    if (cat === "connected" || cat === "converted") return <CheckCircle2 className="w-4 h-4" />;
    if (cat === "no_answer") return <XCircle className="w-4 h-4" />;
    if (cat === "machine" || cat === "voicemail") return <Radio className="w-4 h-4" />;
    if (cat === "wrong_number") return <Hash className="w-4 h-4" />;
    return <Ban className="w-4 h-4" />;
  };

  const formatTimeAgo = (createdAt?: string) => {
    if (!createdAt) return "";
    const diff = Date.now() - new Date(createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (mins > 0) return `${mins}m ago`;
    return "Just now";
  };

  const getCallRowStyle = (status: string) => {
    if (status === "completed" || status === "connected") return { bg: "bg-green-500/10", icon: <Phone className="w-4 h-4 text-green-400" />, label: "Connected", labelClass: "text-green-400" };
    if (status === "no_answer") return { bg: "bg-amber-500/10", icon: <PhoneMissed className="w-4 h-4 text-amber-400" />, label: "No Answer", labelClass: "text-amber-400" };
    return { bg: "bg-red-500/10", icon: <PhoneOff className="w-4 h-4 text-red-400" />, label: "Failed", labelClass: "text-red-400" };
  };

  const dialPadDigits = ["1","2","3","4","5","6","7","8","9","*","0","#"];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">

      {/* ── LEFT: Dial Pad ── */}
      <div className="space-y-3">
        {webrtcOn && (
          <p className="text-xs">
            <span className={rtc.status === "registered" ? "text-green-400" : rtc.status === "connecting" ? "text-yellow-400" : "text-red-400"}>
              ● {rtc.status === "registered" ? "Ready" : rtc.status === "connecting" ? "Connecting…" : "Not connected"}
            </span>
            {rtc.error && <span className="text-red-400"> — {rtc.error}</span>}
          </p>
        )}

        <Card className="bg-gray-900 border-gray-800 p-5">

          {/* IDLE: dial pad */}
          {callStatus === "idle" && (
            <div className="space-y-3">
              {callerNumbers.length > 0 && (
                <Select value={selectedNumber} onValueChange={setSelectedNumber}>
                  <SelectTrigger className="h-8 w-full bg-gray-800 border-gray-600 text-white text-xs [&>span]:truncate">
                    <SelectValue placeholder="Caller ID" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-600 text-white">
                    {callerNumbers.map((n) => (
                      <SelectItem key={n.value} value={n.value} className="font-mono text-xs">{n.value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Number display */}
              <div className="relative">
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Enter number"
                  className="w-full h-14 bg-gray-950 border border-gray-700 rounded-xl text-white text-2xl text-center font-mono placeholder:text-gray-600 focus:outline-none focus:border-blue-500 pr-12"
                />
                {phoneNumber && (
                  <button
                    onClick={() => setPhoneNumber((p) => p.slice(0, -1))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Dial pad */}
              <div className="grid grid-cols-3 gap-2">
                {dialPadDigits.map((d) => (
                  <button
                    key={d}
                    onClick={() => setPhoneNumber((p) => p + d)}
                    className="h-14 rounded-xl bg-gray-800 text-white font-medium text-xl hover:bg-gray-700 active:bg-gray-600 active:scale-95 transition-all border border-gray-700/50"
                  >
                    {d}
                  </button>
                ))}
              </div>

              {callError && (
                <div className="text-sm rounded-xl px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20">
                  {callError}
                </div>
              )}

              <Button
                className="w-full h-14 bg-green-600 hover:bg-green-700 text-white text-lg font-semibold rounded-xl"
                onClick={startCall}
                disabled={!phoneNumber}
              >
                <PhoneCall className="w-6 h-6 mr-2" /> Call
              </Button>

              {/* Auto-record toggle */}
              <button
                onClick={handleAutoRecordToggle}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                  autoRecord
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5" />
                  {autoRecord ? "Auto Record ON" : "Auto Record OFF"}
                </span>
                <div className={`relative w-8 h-4 rounded-full transition-colors ${autoRecord ? "bg-red-500" : "bg-gray-600"}`}>
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${autoRecord ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
              </button>
            </div>
          )}

          {/* DIALING */}
          {callStatus === "dialing" && (
            <div className="text-center py-10 space-y-4">
              <div className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto animate-pulse">
                <Phone className="w-10 h-10 text-blue-400" />
              </div>
              <div>
                <p className="text-xl font-semibold text-white">Dialing…</p>
                <p className="text-gray-400 font-mono mt-1 text-lg">{phoneNumber}</p>
                {selectedNumber && <p className="text-xs text-gray-500 mt-1">From: {selectedNumber}</p>}
              </div>
              <Button className="bg-red-600 hover:bg-red-700 text-white rounded-xl" onClick={resetCall}>
                <PhoneOff className="w-4 h-4 mr-2" /> Cancel
              </Button>
            </div>
          )}

          {/* CONNECTED */}
          {callStatus === "connected" && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-2 animate-pulse">
                  {rtc.callDirection === "inbound"
                    ? <PhoneIncoming className="w-10 h-10 text-green-400" />
                    : <Phone className="w-10 h-10 text-green-400" />}
                </div>
                <p className="text-3xl font-bold text-white font-mono">{formatDur(duration)}</p>
                <p className="text-sm text-gray-400 font-mono mt-1">{phoneNumber}</p>
                <Badge className="bg-green-500/20 text-green-400 border-0 mt-2">
                  {rtc.callDirection === "inbound" ? "Incoming Call" : "Connected"}
                </Badge>
              </div>

              {recorder.isRecording && (
                <div className="flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl py-2 px-3">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                  </span>
                  <span className="text-xs font-semibold text-red-400">{autoRecord ? "AUTO REC" : "REC"}</span>
                  <span className="text-xs font-mono text-red-300">{formatDur(recorder.recordingTime)}</span>
                </div>
              )}

              {/* Call control buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-colors ${
                    isMuted ? "bg-red-600/20 border-red-500/30 text-red-400" : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  <span className="text-xs">{isMuted ? "Unmute" : "Mute"}</span>
                </button>
                <button
                  onClick={handleAutoRecordToggle}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-colors ${
                    autoRecord ? "bg-red-600/20 border-red-500/30 text-red-400" : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  <Radio className="w-5 h-5" />
                  <span className="text-xs">{autoRecord ? "Auto Rec" : "Record"}</span>
                </button>
                {!autoRecord && (
                  <button
                    onClick={handleToggleRecording}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-colors ${
                      recorder.isRecording
                        ? "bg-red-600/20 border-red-500/30 text-red-400 animate-pulse"
                        : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {recorder.isRecording ? <Square className="w-5 h-5 fill-current" /> : <Disc className="w-5 h-5" />}
                    <span className="text-xs">{recorder.isRecording ? "Stop" : "Record"}</span>
                  </button>
                )}
              </div>

              {/* DTMF keypad */}
              <div className="rounded-xl bg-gray-800 border border-gray-700 p-3">
                <p className="text-xs text-center text-gray-500 mb-2">Keypad</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {dialPadDigits.map((d) => (
                    <button
                      key={d}
                      onClick={() => { if (webrtcOn) rtc.sendDTMF(d); }}
                      className="h-10 rounded-lg bg-gray-700 text-white font-semibold hover:bg-gray-600 active:scale-95 transition-all border border-gray-600"
                    >{d}</button>
                  ))}
                </div>
              </div>

              <Textarea
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                placeholder="Call notes…"
                className="bg-gray-800 border-gray-700 text-white min-h-[60px] text-sm rounded-xl"
              />

              <Button
                className="w-full h-14 bg-red-600 hover:bg-red-700 text-white text-lg font-semibold rounded-xl"
                onClick={handleEndCall}
              >
                <PhoneOff className="w-6 h-6 mr-2" /> End Call
              </Button>
            </div>
          )}

          {/* ENDED: disposition + save */}
          {callStatus === "ended" && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center mx-auto mb-2">
                  <Phone className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-xl font-semibold text-white">Call Ended</p>
                <p className="text-3xl font-bold font-mono text-white mt-1">{formatDur(duration)}</p>
                {callError && <p className="text-xs text-red-400 mt-1">{callError}</p>}
              </div>

              {recorder.audioUrl && (
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                      <Disc className="w-3.5 h-3.5 text-red-400" /> Recording ({formatDur(recordingDuration)})
                    </p>
                    <a
                      href={recorder.audioUrl}
                      download={`recording-${activeCallId ?? "call"}.webm`}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" /> Download
                    </a>
                  </div>
                  <audio controls src={recorder.audioUrl} className="w-full h-9" />
                </div>
              )}

              <Textarea
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                placeholder="Call notes…"
                className="bg-gray-800 border-gray-700 text-white min-h-[60px] text-sm rounded-xl"
              />

              <div>
                <p className="text-sm font-semibold text-gray-100 mb-2">Call Result</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(dispositions as Array<{ id: number; label?: string; category: string }>).map((disp) => (
                    <Button
                      key={disp.id}
                      size="sm"
                      onClick={() => setSelectedDisposition(disp.id.toString())}
                      className={`justify-start text-white text-xs ${
                        selectedDisposition === disp.id.toString()
                          ? "bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-400"
                          : "bg-gray-700 hover:bg-gray-600"
                      }`}
                    >
                      {getDispIcon(disp.category)}
                      <span className="ml-1 truncate">{disp.label}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded-xl"
                  onClick={resetCall}
                >
                  <SkipForward className="w-4 h-4 mr-1" /> Skip
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
                  onClick={handleSaveCall}
                >
                  <Save className="w-4 h-4 mr-1" /> Save
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── RIGHT: Call Records ── */}
      <Card className="bg-gray-900 border-gray-800 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-white">Recent Calls</h3>
          <span className="text-xs text-gray-500">{callLogs.length} calls</span>
        </div>
        <div className="divide-y divide-gray-800/50 overflow-y-auto flex-1">
          {callLogs.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <Phone className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No call records yet</p>
              <p className="text-xs mt-1 opacity-60">Your calls will appear here</p>
            </div>
          )}
          {callLogs.map((log) => {
            const rowStyle = getCallRowStyle(log.status);
            return (
              <div
                key={log.id}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-800/40 cursor-pointer group transition-colors"
                onClick={() => {
                  if (callStatus === "idle" && log.toNumber) setPhoneNumber(log.toNumber);
                }}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${rowStyle.bg}`}>
                  {rowStyle.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white font-mono truncate">
                    {log.toNumber || "Unknown"}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-xs font-medium ${rowStyle.labelClass}`}>
                      {rowStyle.label}
                    </span>
                    <span className="text-gray-600 text-xs">·</span>
                    <span className="text-xs text-gray-500">{formatTimeAgo(log.createdAt)}</span>
                    {log.type && (
                      <>
                        <span className="text-gray-600 text-xs">·</span>
                        <span className="text-xs text-gray-600 capitalize">{log.type}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  {log.duration ? (
                    <p className="text-xs font-mono text-gray-400">{formatDur(log.duration)}</p>
                  ) : null}
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 ml-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (callStatus === "idle" && log.toNumber) {
                        setPhoneNumber(log.toNumber);
                        doCallFlow(log.toNumber);
                      }
                    }}
                  >
                    <PhoneCall className="w-3 h-3" /> Redial
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}