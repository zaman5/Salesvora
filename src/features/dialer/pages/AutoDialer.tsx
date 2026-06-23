import { useState, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCallRecorder } from "@/hooks/useCallRecorder";
import { useWebRTC } from "@/providers/WebRTCProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Radio,
  Play,
  Pause,
  SkipForward,
  PhoneOff,
  Clock,
  List,
  Phone,
  CheckCircle2,
  XCircle,
  Ban,
  User,
  Building,
  Briefcase,
  MapPin,
  Mail,
  BarChart3,
  Disc,
  Square,
  Download,
  Mic,
  MicOff,
  Pencil,
  Check,
  X,
  Hash,
} from "lucide-react";

function TogglePill({ on, onToggle, label, activeColor = "bg-green-500" }: {
  on: boolean; onToggle: () => void; label: string; activeColor?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
        on
          ? "bg-white/5 border-white/10 text-white"
          : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
      }`}
    >
      <span>{label}</span>
      <div className={`relative w-9 h-5 rounded-full transition-colors ${on ? activeColor : "bg-gray-600"}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
      </div>
    </button>
  );
}

const STANDARD_FIELDS = [
  { key: "firstName", label: "First Name" }, { key: "lastName", label: "Last Name" },
  { key: "companyName", label: "Company" }, { key: "designation", label: "Designation" },
  { key: "phone", label: "Phone" }, { key: "email", label: "Email" },
  { key: "city", label: "City" }, { key: "state", label: "State" },
  { key: "country", label: "Country" }, { key: "notes", label: "Notes" },
];

export default function AutoDialerPage() {
  const { user } = useAuth();
  const companyId = user?.companyId || 1;

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "connected" | "disposition">("idle");
  const [duration, setDuration] = useState(0);
  const [callNotes, setCallNotes] = useState("");
  const [selectedDisposition, setSelectedDisposition] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [activeCallId, setActiveCallId] = useState<number | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  // ── Lead editing ──────────────────────────────────────────────────────────────
  const [isEditingLead, setIsEditingLead] = useState(false);
  const [leadEdit, setLeadEdit] = useState<Record<string, string>>({});
  const [leadSaveMsg, setLeadSaveMsg] = useState<string | null>(null);

  // ── Recording ─────────────────────────────────────────────────────────────────
  const recorder = useCallRecorder();
  const [isMuted, setIsMuted] = useState(false);
  const [savedRecordingDataUrl, setSavedRecordingDataUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);

  // ── Auto-record toggle (persisted) ───────────────────────────────────────────
  const [autoRecord, setAutoRecord] = useState(() => {
    try { return localStorage.getItem("autodialer.autoRecord") === "true"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("autodialer.autoRecord", String(autoRecord)); } catch { /* ignore */ }
  }, [autoRecord]);

  // ── Field display customization ───────────────────────────────────────────────
  const [displayFields, setDisplayFields] = useState<string[]>(() => {
    try { const s = localStorage.getItem("autodialer.displayFields"); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return ["companyName", "designation", "phone", "email", "city"];
  });
  useEffect(() => {
    try { localStorage.setItem("autodialer.displayFields", JSON.stringify(displayFields)); } catch { /* ignore */ }
  }, [displayFields]);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const toggleField = (key: string) =>
    setDisplayFields((p) => p.includes(key) ? p.filter((k) => k !== key) : [...p, key]);

  // ── Dialer config + WebRTC ────────────────────────────────────────────────────
  const { data: dialerConfig } = trpc.integration.getDialerConfig.useQuery();
  const rtc = useWebRTC();
  const webrtcOn = Boolean(dialerConfig?.webrtc?.enabled);

  const callerNumbers = (dialerConfig?.fromNumbers ?? [])
    .filter((n: string) => !!n)
    .map((n: string) => ({ value: n }));

  const [selectedNumber, setSelectedNumber] = useState("");
  useEffect(() => {
    const pref = dialerConfig?.defaultCallerId || callerNumbers[0]?.value || "";
    if (pref && !selectedNumber) setSelectedNumber(pref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialerConfig]);

  // ── Queries ───────────────────────────────────────────────────────────────────
  const { data: campaigns = [], refetch: refetchCampaigns } = trpc.campaign.list.useQuery();
  const { data: dispositions = [] } = trpc.calls.dispositions.useQuery({ companyId });

  const campIdVal = parseInt(selectedCampaignId) || 0;
  const { data: campaignProgress, refetch: refetchProgress } = trpc.campaign.progress.useQuery(
    { id: campIdVal },
    { enabled: !!selectedCampaignId },
  );
  const { data: nextCampaignLead, refetch: refetchNextLead } = trpc.campaign.getNextLead.useQuery(
    { campaignId: campIdVal },
    { enabled: isRunning && !isPaused && callStatus === "idle" },
  );

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const startCampaignMutation = trpc.campaign.start.useMutation();
  const pauseCampaignMutation = trpc.campaign.pause.useMutation();
  const initiateCallMutation = trpc.calls.initiate.useMutation();
  const updateStatusMutation = trpc.calls.updateStatus.useMutation();
  const updateLeadStatusMutation = trpc.campaign.updateLeadStatus.useMutation();
  const endCallMutation = trpc.calls.endCall.useMutation();
  const saveRecordingMutation = trpc.calls.saveRecording.useMutation();
  const updateLeadMutation = trpc.lead.update.useMutation();

  const currentLead = nextCampaignLead?.lead || null;

  // ── Custom fields from current lead ───────────────────────────────────────────
  const customFieldKeys = useMemo(() => {
    const cf = currentLead?.customFields;
    if (!cf || typeof cf !== "object") return [];
    return Object.keys(cf as object).filter((k) => !k.startsWith("_"));
  }, [currentLead]);
  const allDisplayFields = useMemo(
    () => [...STANDARD_FIELDS, ...customFieldKeys.map((k) => ({ key: `cf:${k}`, label: k }))],
    [customFieldKeys],
  );

  // ── Trigger auto-dial ─────────────────────────────────────────────────────────
  const triggerAutoDialCall = async () => {
    if (!nextCampaignLead?.lead) return;
    setCallStatus("calling");
    setCallError(null);
    try {
      const activeCall = await initiateCallMutation.mutateAsync({
        leadId: nextCampaignLead.lead.id,
        campaignId: campIdVal,
        companyId,
        toNumber: nextCampaignLead.lead.phone,
        fromNumber: selectedNumber || undefined,
        type: "auto",
      });
      setActiveCallId(activeCall.id);

      await updateLeadStatusMutation.mutateAsync({
        campaignLeadId: nextCampaignLead.id,
        status: "in_progress",
        callerId: user?.id,
      });

      if (webrtcOn) {
        // Real WebRTC call
        if (rtc.status !== "registered") {
          setCallError("Browser calling not connected. Check SIP credentials in Settings.");
          setCallStatus("idle");
          return;
        }
        const ok = rtc.makeCall(
          nextCampaignLead.lead.phone,
          selectedNumber || dialerConfig?.defaultCallerId || "",
        );
        if (!ok) {
          setCallError(rtc.error || "Could not start browser call.");
          setCallStatus("idle");
          return;
        }
        setCallStatus("connected");
        setDuration(0);
        await updateStatusMutation.mutateAsync({ id: activeCall.id, status: "connected" });
      } else {
        // Simulated connection (no WebRTC)
        setTimeout(async () => {
          setCallStatus("connected");
          setDuration(0);
          await updateStatusMutation.mutateAsync({ id: activeCall.id, status: "connected" });
        }, 2000);
      }
    } catch (err) {
      console.error("Failed to execute autodial call:", err);
      setCallStatus("idle");
    }
  };

  // ── Effects ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const autoCamps = (campaigns as any[]).filter((c) => c.type === "auto");
    if (autoCamps.length > 0 && !selectedCampaignId) {
      setSelectedCampaignId(autoCamps[0].id.toString());
    }
  }, [campaigns, selectedCampaignId]);

  // Timer
  useEffect(() => {
    if (callStatus === "connected" && !isPaused) {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callStatus, isPaused]);

  // Auto-dial cycle
  useEffect(() => {
    if (isRunning && !isPaused && callStatus === "idle" && nextCampaignLead) {
      triggerAutoDialCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, isPaused, callStatus, nextCampaignLead]);

  // ── Fix: Auto-end on SIP error (487, 404, etc.) ───────────────────────────────
  useEffect(() => {
    if (!webrtcOn) return;
    if (rtc.callState === "ended" && (callStatus === "connected" || callStatus === "calling")) {
      if (rtc.error) setCallError(rtc.error);
      setCallStatus("disposition");
      if (timerRef.current) clearInterval(timerRef.current);
      finalizeRecording().catch(() => {});
      if (activeCallId) {
        updateStatusMutation.mutate({ id: activeCallId, status: "completed" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtc.callState, webrtcOn]);

  // Auto-record when connected
  useEffect(() => {
    if (!autoRecord) return;
    if (callStatus === "connected" && recorder.status === "inactive") {
      const t = setTimeout(() => {
        recorder.startRecording(webrtcOn ? rtc.getRemoteStream : undefined);
      }, 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callStatus, autoRecord, webrtcOn]);

  // Mute sync
  useEffect(() => {
    recorder.setMicMuted(isMuted);
    if (webrtcOn) rtc.setMuted(isMuted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted]);

  // ── Lead editing ──────────────────────────────────────────────────────────────
  const startEditLead = () => {
    if (!currentLead) return;
    setLeadEdit({
      firstName: currentLead.firstName || "",
      lastName: currentLead.lastName || "",
      phone: currentLead.phone || "",
      email: currentLead.email || "",
      companyName: currentLead.companyName || "",
      designation: currentLead.designation || "",
      city: currentLead.city || "",
      notes: currentLead.notes || "",
    });
    setIsEditingLead(true);
    setLeadSaveMsg(null);
  };

  const cancelEditLead = () => { setIsEditingLead(false); setLeadEdit({}); };

  const saveEditLead = async () => {
    if (!currentLead) return;
    try {
      await updateLeadMutation.mutateAsync({
        id: currentLead.id,
        data: {
          firstName: leadEdit.firstName || undefined,
          lastName: leadEdit.lastName || undefined,
          phone: leadEdit.phone || undefined,
          email: leadEdit.email || undefined,
          companyName: leadEdit.companyName || undefined,
          designation: leadEdit.designation || undefined,
          city: leadEdit.city || undefined,
          notes: leadEdit.notes || undefined,
        },
      });
      setLeadSaveMsg("Client details updated ✓");
      setIsEditingLead(false);
      refetchNextLead();
      setTimeout(() => setLeadSaveMsg(null), 3000);
    } catch (err) {
      console.error("Failed to update lead:", err);
      setLeadSaveMsg("Failed to save changes");
    }
  };

  // ── Recording helpers ─────────────────────────────────────────────────────────
  const handleToggleRecording = async () => {
    if (recorder.status === "recording" || recorder.status === "paused") {
      const result = await recorder.stopRecording();
      if (result) { setSavedRecordingDataUrl(result.dataUrl); setRecordingDuration(result.duration); }
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

  const finalizeRecording = async (): Promise<{ dataUrl: string; duration: number } | null> => {
    if (recorder.status === "recording" || recorder.status === "paused") {
      const result = await recorder.stopRecording();
      if (result) {
        setSavedRecordingDataUrl(result.dataUrl);
        setRecordingDuration(result.duration);
        return { dataUrl: result.dataUrl, duration: result.duration };
      }
      return null;
    }
    return savedRecordingDataUrl ? { dataUrl: savedRecordingDataUrl, duration: recordingDuration } : null;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // ── Campaign controls ─────────────────────────────────────────────────────────
  const startDialer = async () => {
    if (!selectedCampaignId) return;
    setIsRunning(true);
    setIsPaused(false);
    setCallStatus("idle");
    setCallError(null);
    try {
      await startCampaignMutation.mutateAsync({ id: campIdVal });
      refetchCampaigns();
      refetchProgress();
      refetchNextLead();
    } catch (err) {
      console.error("Failed to start auto-dialer campaign:", err);
    }
  };

  const pauseDialer = async () => {
    setIsPaused(true);
    if (webrtcOn && (callStatus === "connected" || callStatus === "calling")) rtc.hangup();
    try {
      await pauseCampaignMutation.mutateAsync({ id: campIdVal });
      refetchCampaigns();
    } catch (err) {
      console.error("Failed to pause campaign:", err);
    }
  };

  const resumeDialer = async () => {
    setIsPaused(false);
    setCallError(null);
    try {
      await startCampaignMutation.mutateAsync({ id: campIdVal });
      refetchCampaigns();
      refetchNextLead();
    } catch (err) {
      console.error("Failed to resume campaign:", err);
    }
  };

  const handleEndCall = async () => {
    if (webrtcOn) rtc.hangup();
    setCallStatus("disposition");
    if (timerRef.current) clearInterval(timerRef.current);
    await finalizeRecording();
    if (activeCallId) {
      try { await updateStatusMutation.mutateAsync({ id: activeCallId, status: "completed" }); }
      catch (err) { console.error("Failed to update status on end call:", err); }
    }
  };

  const handleDisposition = async (dispId: string) => {
    setSelectedDisposition(dispId);
    if (activeCallId && nextCampaignLead) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const selectedDispObj = (dispositions as any[]).find((d) => d.id.toString() === dispId);
        let leadStatus: "completed" | "failed" | "skipped" | "callback" = "completed";
        if (selectedDispObj) {
          if (selectedDispObj.category === "no_answer" || selectedDispObj.category === "wrong_number") {
            leadStatus = "failed";
          } else if (selectedDispObj.category === "callback") {
            leadStatus = "callback";
          }
        }

        const rec = await finalizeRecording();

        // Fire mutations in background for instant advance
        endCallMutation.mutate({
          id: activeCallId,
          dispositionId: parseInt(dispId),
          duration,
          notes: callNotes,
          callDescription: callNotes,
          recordingUrl: rec?.dataUrl || undefined,
        });

        if (rec?.dataUrl) {
          saveRecordingMutation.mutate({
            callId: activeCallId,
            recordingUrl: rec.dataUrl,
            duration: rec.duration,
            fileSize: recorder.audioBlob?.size,
            format: "webm",
          });
        }

        await updateLeadStatusMutation.mutateAsync({
          campaignLeadId: nextCampaignLead.id,
          status: leadStatus,
          callerId: user?.id,
        });
      } catch (err) {
        console.error("Failed to submit call disposition:", err);
      }
    }

    // Reset state immediately
    setCallStatus("idle");
    setDuration(0);
    setCallNotes("");
    setSelectedDisposition(null);
    setActiveCallId(null);
    setCallError(null);
    recorder.resetRecording();
    setSavedRecordingDataUrl(null);
    setRecordingDuration(0);
    setIsMuted(false);
    setIsEditingLead(false);
    setLeadEdit({});

    refetchProgress();
    setTimeout(() => refetchNextLead(), 500);
  };

  const stopDialer = async () => {
    if (webrtcOn && (callStatus === "connected" || callStatus === "calling")) rtc.hangup();
    setIsRunning(false);
    setIsPaused(false);
    setCallStatus("idle");
    setDuration(0);
    setCallError(null);
    if (timerRef.current) clearInterval(timerRef.current);
    recorder.resetRecording();
    setSavedRecordingDataUrl(null);
    setRecordingDuration(0);
    setIsMuted(false);
    try {
      await pauseCampaignMutation.mutateAsync({ id: campIdVal });
      refetchCampaigns();
    } catch (err) {
      console.error("Failed to stop campaign:", err);
    }
  };

  const getDispIcon = (category: string) => {
    switch (category) {
      case "connected": case "converted": return <CheckCircle2 className="w-4 h-4" />;
      case "no_answer": return <XCircle className="w-4 h-4" />;
      case "machine": case "voicemail": return <Radio className="w-4 h-4" />;
      case "wrong_number": return <Hash className="w-4 h-4" />;
      default: return <Ban className="w-4 h-4" />;
    }
  };

  const progressTotal = campaignProgress?.total || 0;
  const progressCompleted = campaignProgress?.completed || 0;
  const progressPercentage = progressTotal > 0 ? Math.round((progressCompleted / progressTotal) * 100) : 0;

  // ── Helper: get field value from current lead ─────────────────────────────────
  const getLeadFieldValue = (key: string): string => {
    if (!currentLead) return "";
    if (key.startsWith("cf:")) {
      const v = (currentLead.customFields as Record<string, unknown> | undefined)?.[key.slice(3)];
      return v == null ? "" : String(v);
    }
    const v = (currentLead as Record<string, unknown>)[key];
    return v == null ? "" : String(v);
  };

  const fieldIcon = (key: string) => {
    if (key === "companyName" || key === "cf:company") return <Building className="w-4 h-4 text-gray-500" />;
    if (key === "designation") return <Briefcase className="w-4 h-4 text-gray-500" />;
    if (key === "phone" || key === "phone2") return <Phone className="w-4 h-4 text-gray-500" />;
    if (key === "email") return <Mail className="w-4 h-4 text-gray-500" />;
    if (key === "city" || key === "state" || key === "country") return <MapPin className="w-4 h-4 text-gray-500" />;
    return null;
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Auto Dialer</h1>
          <p className="text-gray-400 mt-1">Automated calling with sequential lead processing</p>
          {webrtcOn && (
            <p className="text-xs mt-0.5">
              <span className={
                rtc.status === "registered" ? "text-green-400" :
                rtc.status === "connecting" ? "text-yellow-400" : "text-red-400"
              }>
                ● {rtc.status === "registered" ? "Browser calling ready" :
                   rtc.status === "connecting" ? "Connecting…" : "Not connected"}
              </span>
              {rtc.error && <span className="text-red-400"> — {rtc.error}</span>}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* Caller ID */}
          {!isRunning && (
            <Select value={selectedNumber} onValueChange={setSelectedNumber}>
              <SelectTrigger className="h-9 w-40 bg-gray-800 border-gray-600 text-white text-sm overflow-hidden [&>span]:truncate">
                <SelectValue placeholder="Caller ID" />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-600 text-white">
                {callerNumbers.length ? (
                  callerNumbers.map((n) => (
                    <SelectItem key={n.value} value={n.value} className="font-mono">{n.value}</SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>Configure in Settings</SelectItem>
                )}
              </SelectContent>
            </Select>
          )}

          {!isRunning ? (
            <>
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                className="bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-white text-sm h-9"
              >
                <option value="">Select campaign...</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(campaigns as any[]).filter((c) => c.type === "auto").map((c: any) => (
                  <option key={c.id} value={c.id.toString()}>{c.name}</option>
                ))}
              </select>
              <Button
                className="bg-green-600 hover:bg-green-700 h-9"
                onClick={startDialer}
                disabled={!selectedCampaignId}
              >
                <Play className="w-4 h-4 mr-2" /> Start
              </Button>
            </>
          ) : (
            <>
              {isPaused ? (
                <Button className="bg-green-600 hover:bg-green-700 h-9" onClick={resumeDialer}>
                  <Play className="w-4 h-4 mr-2" /> Resume
                </Button>
              ) : (
                <Button variant="outline" className="border-amber-600/30 text-amber-400 hover:bg-amber-600/20 h-9" onClick={pauseDialer}>
                  <Pause className="w-4 h-4 mr-2" /> Pause
                </Button>
              )}
              <Button variant="outline" className="border-red-600/30 text-red-400 hover:bg-red-600/20 h-9" onClick={stopDialer}>
                <PhoneOff className="w-4 h-4 mr-2" /> Stop
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Progress ── */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">
              <List className="w-4 h-4 inline mr-1" />
              Progress: {progressCompleted.toLocaleString()} / {progressTotal.toLocaleString()} leads
            </span>
            <span className="text-sm font-medium text-white">{progressPercentage}%</span>
          </div>
          <Progress value={progressPercentage} className="h-3 bg-gray-800" />
        </CardContent>
      </Card>

      {isRunning && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Left: Lead Info ── */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center">
                    <User className="w-5 h-5 text-blue-400" />
                  </div>
                  {currentLead ? (
                    <div>
                      <h3 className="text-base font-semibold text-white">{currentLead.firstName || ""} {currentLead.lastName || "Lead"}</h3>
                      <p className="text-xs text-gray-500">Lead ID: #{currentLead.id}</p>
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-base font-semibold text-white">Searching...</h3>
                      <p className="text-xs text-gray-500">Finding next pending lead</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {currentLead && !isEditingLead && (
                    <>
                      {/* Field selector */}
                      <div className="relative">
                        <Button
                          variant="outline"
                          size="sm"
                          className={`border-gray-700 text-gray-300 h-7 px-2 text-xs ${fieldMenuOpen ? "bg-blue-600 border-blue-500 text-white" : ""}`}
                          onClick={() => setFieldMenuOpen((o) => !o)}
                        >
                          Fields ▾
                        </Button>
                        {fieldMenuOpen && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setFieldMenuOpen(false)} />
                            <div className="absolute right-0 mt-1 z-20 w-56 max-h-64 overflow-auto bg-gray-800 border border-gray-600 rounded-xl p-2 shadow-2xl">
                              <p className="text-xs font-semibold text-gray-100 px-2 py-1.5 sticky top-0 bg-gray-800 border-b border-gray-700 mb-1">Show fields</p>
                              {allDisplayFields.map((f) => (
                                <label key={f.key} className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-100 hover:bg-gray-700 rounded-lg cursor-pointer">
                                  <input type="checkbox" className="accent-blue-500 w-4 h-4"
                                    checked={displayFields.includes(f.key)} onChange={() => toggleField(f.key)} />
                                  <span className="truncate">{f.label}</span>
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        title="Edit client details"
                        className="border-gray-700 text-gray-300 h-7 px-2"
                        onClick={startEditLead}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                  <Badge className="bg-blue-500/20 text-blue-400">Current</Badge>
                </div>
              </div>

              {leadSaveMsg && (
                <p className={`text-xs text-center rounded-md py-1 ${leadSaveMsg.includes("Failed") ? "text-red-400 bg-red-500/10" : "text-green-400 bg-green-500/10"}`}>{leadSaveMsg}</p>
              )}

              {currentLead && isEditingLead ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={leadEdit.firstName} onChange={(e) => setLeadEdit({ ...leadEdit, firstName: e.target.value })} placeholder="First name" className="bg-gray-800 border-gray-700 text-white h-8 text-xs" />
                    <Input value={leadEdit.lastName} onChange={(e) => setLeadEdit({ ...leadEdit, lastName: e.target.value })} placeholder="Last name" className="bg-gray-800 border-gray-700 text-white h-8 text-xs" />
                  </div>
                  <Input value={leadEdit.phone} onChange={(e) => setLeadEdit({ ...leadEdit, phone: e.target.value })} placeholder="Phone" className="bg-gray-800 border-gray-700 text-white h-8 text-xs" />
                  <Input value={leadEdit.email} onChange={(e) => setLeadEdit({ ...leadEdit, email: e.target.value })} placeholder="Email" className="bg-gray-800 border-gray-700 text-white h-8 text-xs" />
                  <Input value={leadEdit.companyName} onChange={(e) => setLeadEdit({ ...leadEdit, companyName: e.target.value })} placeholder="Company" className="bg-gray-800 border-gray-700 text-white h-8 text-xs" />
                  <Input value={leadEdit.designation} onChange={(e) => setLeadEdit({ ...leadEdit, designation: e.target.value })} placeholder="Designation" className="bg-gray-800 border-gray-700 text-white h-8 text-xs" />
                  <Input value={leadEdit.city} onChange={(e) => setLeadEdit({ ...leadEdit, city: e.target.value })} placeholder="City" className="bg-gray-800 border-gray-700 text-white h-8 text-xs" />
                  <Textarea value={leadEdit.notes} onChange={(e) => setLeadEdit({ ...leadEdit, notes: e.target.value })} placeholder="Client record notes..." className="bg-gray-800 border-gray-700 text-white text-xs min-h-[50px]" />
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 h-7" onClick={saveEditLead} disabled={updateLeadMutation.isPending}>
                      <Check className="w-3.5 h-3.5 mr-1" /> Save
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 border-gray-700 text-gray-300 h-7" onClick={cancelEditLead}>
                      <X className="w-3.5 h-3.5 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : currentLead ? (
                <div className="space-y-2 text-sm">
                  {displayFields.map((fk) => {
                    const f = allDisplayFields.find((x) => x.key === fk);
                    if (!f) return null;
                    const val = getLeadFieldValue(fk);
                    if (!val) return null;
                    return (
                      <div key={fk} className="flex items-center gap-2 text-gray-300">
                        {fieldIcon(fk) || <span className="w-4 h-4 shrink-0" />}
                        <span className="truncate">{val}</span>
                      </div>
                    );
                  })}
                  {/* Always show phone */}
                  {!displayFields.includes("phone") && currentLead.phone && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <Phone className="w-4 h-4 text-gray-500" /> {currentLead.phone}
                    </div>
                  )}
                  {currentLead.customFields && Object.keys(currentLead.customFields).filter(k => !k.startsWith("_")).length > 0 && displayFields.some(f => f.startsWith("cf:")) && (
                    <div className="pt-2 border-t border-gray-800 space-y-1">
                      <p className="text-[10px] font-medium text-gray-500 uppercase">Custom Fields</p>
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {Object.entries(currentLead.customFields as Record<string, any>).filter(([k]) => !k.startsWith("_") && displayFields.includes(`cf:${k}`)).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-xs">
                          <span className="text-gray-500">{k}</span>
                          <span className="text-gray-300">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {currentLead.notes && displayFields.includes("notes") && (
                    <div className="pt-2 border-t border-gray-800">
                      <p className="text-[10px] font-medium text-gray-500 uppercase mb-0.5">Notes</p>
                      <p className="text-xs text-gray-400 italic">{currentLead.notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500 text-sm">
                  Waiting for next pending campaign lead...
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Center: Call Interface ── */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5">

              {callStatus === "calling" && (
                <div className="text-center py-8 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto animate-pulse">
                    <Phone className="w-8 h-8 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">Auto-dialing...</p>
                    <p className="text-gray-400 font-mono">{currentLead?.phone}</p>
                    {selectedNumber && <p className="text-xs text-gray-500 mt-1">From: {selectedNumber}</p>}
                  </div>
                </div>
              )}

              {callStatus === "connected" && (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto animate-pulse">
                      <Phone className="w-7 h-7 text-green-400" />
                    </div>
                    <p className="text-2xl font-bold text-white font-mono mt-2">{formatDuration(duration)}</p>
                    <Badge className="bg-green-500/20 text-green-400 mt-1">Connected</Badge>
                    {selectedNumber && <p className="text-xs text-gray-500 mt-1 font-mono">{selectedNumber}</p>}
                  </div>

                  {/* Error display */}
                  {callError && (
                    <div className="text-xs rounded-lg px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20">{callError}</div>
                  )}

                  {/* Recording indicator */}
                  {recorder.isRecording && (
                    <div className="flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg py-1.5 px-3">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                      </span>
                      <span className="text-xs font-semibold text-red-400 tracking-wider">{autoRecord ? "AUTO REC" : "REC"}</span>
                      <span className="text-xs font-mono text-red-300">{formatDuration(recorder.recordingTime)}</span>
                    </div>
                  )}
                  {recorder.error && (
                    <p className="text-xs text-red-400 text-center bg-red-500/10 border border-red-500/30 rounded-md py-1.5 px-2">{recorder.error}</p>
                  )}

                  {/* Controls */}
                  <div className="flex justify-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      title={isMuted ? "Unmute" : "Mute"}
                      className={`border-gray-700 ${isMuted ? "text-red-400 bg-red-500/10" : "text-gray-300"}`}
                      onClick={() => setIsMuted(!isMuted)}
                    >
                      {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      title="Toggle auto-record"
                      className={`border-gray-700 text-xs gap-1 ${autoRecord ? "text-red-400 bg-red-500/10 border-red-700" : "text-gray-300"}`}
                      onClick={handleAutoRecordToggle}
                    >
                      <Radio className="w-3.5 h-3.5" /> Auto
                    </Button>
                    {!autoRecord && (
                      <Button
                        variant="outline"
                        size="sm"
                        title={recorder.isRecording ? "Stop recording" : "Record call"}
                        className={`border-gray-700 ${recorder.isRecording ? "text-red-400 bg-red-500/10 border-red-700 animate-pulse" : "text-gray-300"}`}
                        onClick={handleToggleRecording}
                      >
                        {recorder.isRecording ? <Square className="w-4 h-4 fill-current" /> : <Disc className="w-4 h-4" />}
                        <span className="ml-1.5 text-xs">{recorder.isRecording ? "Stop" : "Record"}</span>
                      </Button>
                    )}
                  </div>

                  <Textarea
                    value={callNotes}
                    onChange={(e) => setCallNotes(e.target.value)}
                    placeholder="Call notes..."
                    className="bg-gray-800 border-gray-700 text-white min-h-[60px]"
                  />
                  <Button className="w-full bg-red-600 hover:bg-red-700" onClick={handleEndCall}>
                    <PhoneOff className="w-4 h-4 mr-2" /> End Call
                  </Button>
                </div>
              )}

              {callStatus === "disposition" && (
                <div className="space-y-3">
                  <div className="text-center py-2">
                    <p className="text-lg font-semibold text-white">Call Ended</p>
                    <p className="text-gray-400 font-mono">{formatDuration(duration)}</p>
                    {callError && (
                      <p className="text-xs text-red-400 mt-1">{callError}</p>
                    )}
                  </div>

                  {/* Recording playback */}
                  {recorder.audioUrl && (
                    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                          <Disc className="w-3.5 h-3.5 text-red-400" /> Recording ({formatDuration(recordingDuration)})
                        </p>
                        <a
                          href={recorder.audioUrl}
                          download={`call-recording-${activeCallId ?? "call"}.webm`}
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" /> Download
                        </a>
                      </div>
                      <audio controls src={recorder.audioUrl} className="w-full h-9" />
                    </div>
                  )}

                  <label className="text-sm font-medium text-gray-300 block">Select Result</label>
                  <div className="grid grid-cols-2 gap-2 max-h-[140px] overflow-y-auto pr-1">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(dispositions as any[]).map((disp) => (
                      <Button
                        key={disp.id}
                        size="sm"
                        onClick={() => handleDisposition(disp.id.toString())}
                        className="bg-gray-800 text-white hover:bg-gray-700 justify-start"
                      >
                        {getDispIcon(disp.category)}
                        <span className="ml-1 truncate">{disp.label}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {callStatus === "idle" && (
                <div className="text-center py-8">
                  {nextCampaignLead ? (
                    <p className="text-gray-400 animate-pulse">Preparing next call...</p>
                  ) : (
                    <p className="text-gray-500 text-sm">All leads in this campaign queue have been dialed.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Right: Stats + Automation ── */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5 space-y-4">
              <div className="text-center pb-3 border-b border-gray-800">
                <Clock className="w-6 h-6 text-gray-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-white font-mono">{formatDuration(duration)}</p>
                <p className="text-xs text-gray-400">Current Call Duration</p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">Campaign Metrics</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Total Leads</span>
                    <span className="text-white font-medium">{progressTotal}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Completed</span>
                    <span className="text-green-400 font-medium">{progressCompleted}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Pending</span>
                    <span className="text-amber-400 font-medium">{campaignProgress?.pending || 0}</span>
                  </div>
                </div>
              </div>

              {/* Automation */}
              <div className="border-t border-gray-800 pt-3 space-y-2">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Automation</p>
                <TogglePill
                  on={autoRecord}
                  onToggle={handleAutoRecordToggle}
                  label={autoRecord ? "🔴 Auto Record ON" : "Auto Record OFF"}
                  activeColor="bg-red-500"
                />
                {autoRecord && recorder.isRecording && (
                  <p className="text-xs text-red-400 px-1">● Recording in progress…</p>
                )}
              </div>

              {/* Caller ID (when running) */}
              {isRunning && (
                <div className="border-t border-gray-800 pt-3 space-y-2">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Caller ID</p>
                  <Select value={selectedNumber} onValueChange={setSelectedNumber}>
                    <SelectTrigger className="h-9 w-full bg-gray-800 border-gray-600 text-white text-sm overflow-hidden [&>span]:truncate">
                      <SelectValue placeholder="Select number" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-600 text-white">
                      {callerNumbers.length ? (
                        callerNumbers.map((n) => (
                          <SelectItem key={n.value} value={n.value} className="font-mono">{n.value}</SelectItem>
                        ))
                      ) : (
                        <SelectItem value="none" disabled>Configure in Settings</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!isRunning && (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-12 text-center">
            <Radio className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Auto Dialer Ready</h3>
            <p className="text-gray-400 mb-4 max-w-md mx-auto">
              Select a campaign and click Start to begin automated calling. The dialer will sequentially process leads and automatically move to the next after each call.
            </p>
            <div className="flex gap-4 justify-center text-sm text-gray-500 flex-wrap">
              <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Auto-advance leads</span>
              <span className="flex items-center gap-1"><BarChart3 className="w-4 h-4" /> Track dispositions</span>
              <span className="flex items-center gap-1"><SkipForward className="w-4 h-4" /> Resume from last</span>
              <span className="flex items-center gap-1"><Radio className="w-4 h-4" /> Auto-record calls</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
