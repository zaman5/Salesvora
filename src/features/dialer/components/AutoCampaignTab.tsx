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
  Radio, Play, Pause, SkipForward, PhoneOff, Clock, List,
  Phone, PhoneCall, CheckCircle2, XCircle, Ban, User,
  BarChart3, Disc, Square, Download, Mic, MicOff, Hash,
} from "lucide-react";
import { TogglePill, STANDARD_FIELDS, formatDur } from "./shared";

export function AutoCampaignTab() {
  const { user } = useAuth();
  const companyId = user?.companyId || 1;

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [isRunning, setIsRunning]   = useState(false);
  const [isPaused, setIsPaused]     = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "connected" | "disposition">("idle");
  const [duration, setDuration]     = useState(0);
  const [callNotes, setCallNotes]   = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [activeCallId, setActiveCallId] = useState<number | null>(null);
  const [callError, setCallError]       = useState<string | null>(null);
  const [editedLead, setEditedLead]     = useState<Record<string, string>>({});

  const recorder = useCallRecorder();
  const [isMuted, setIsMuted]                                   = useState(false);
  const [savedRecordingDataUrl, setSavedRecordingDataUrl]       = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration]               = useState(0);

  const [autoRecord, setAutoRecord] = useState(() => {
    try { return localStorage.getItem("autodialer.autoRecord") === "true"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("autodialer.autoRecord", String(autoRecord)); } catch { /* ignore */ } }, [autoRecord]);

  const [displayFields, setDisplayFields] = useState<string[]>(() => {
    try { const s = localStorage.getItem("autodialer.displayFields"); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return ["companyName", "designation", "phone", "email", "city"];
  });
  useEffect(() => { try { localStorage.setItem("autodialer.displayFields", JSON.stringify(displayFields)); } catch { /* ignore */ } }, [displayFields]);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const toggleField = (key: string) => setDisplayFields((p) => p.includes(key) ? p.filter((k) => k !== key) : [...p, key]);

  const { data: dialerConfig } = trpc.integration.getDialerConfig.useQuery();
  const rtc      = useWebRTC();
  const webrtcOn = Boolean(dialerConfig?.webrtc?.enabled);

  const callerNumbers = (dialerConfig?.fromNumbers ?? []).filter((n: string) => !!n).map((n: string) => ({ value: n }));
  const [selectedNumber, setSelectedNumber] = useState("");
  useEffect(() => {
    const pref = dialerConfig?.defaultCallerId || callerNumbers[0]?.value || "";
    if (pref && !selectedNumber) setSelectedNumber(pref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialerConfig]);

  const { data: campaigns = [], refetch: refetchCampaigns } = trpc.campaign.list.useQuery();
  const { data: dispositions = [] }   = trpc.calls.dispositions.useQuery({ companyId });
  const campIdVal = parseInt(selectedCampaignId) || 0;
  const { data: campaignProgress, refetch: refetchProgress } = trpc.campaign.progress.useQuery(
    { id: campIdVal }, { enabled: !!selectedCampaignId },
  );
  const { data: nextCampaignLead, refetch: refetchNextLead } = trpc.campaign.getNextLead.useQuery(
    { campaignId: campIdVal },
    { enabled: isRunning && !isPaused && callStatus === "idle", staleTime: 0, refetchOnMount: true },
  );

  const startCampaignMutation    = trpc.campaign.start.useMutation();
  const pauseCampaignMutation    = trpc.campaign.pause.useMutation();
  const initiateCallMutation     = trpc.calls.initiate.useMutation();
  const updateStatusMutation     = trpc.calls.updateStatus.useMutation();
  const updateLeadStatusMutation = trpc.campaign.updateLeadStatus.useMutation();
  const endCallMutation          = trpc.calls.endCall.useMutation();
  const saveRecordingMutation    = trpc.calls.saveRecording.useMutation();
  const updateLeadMutation       = trpc.lead.update.useMutation();

  const currentLead = nextCampaignLead?.lead || null;

  const customFieldKeys = useMemo(() => {
    const cf = currentLead?.customFields;
    if (!cf || typeof cf !== "object") return [];
    return Object.keys(cf as object).filter((k) => !k.startsWith("_"));
  }, [currentLead]);
  const allDisplayFields = useMemo(
    () => [...STANDARD_FIELDS, ...customFieldKeys.map((k) => ({ key: `cf:${k}`, label: k }))],
    [customFieldKeys],
  );

  const triggerAutoDialCall = async () => {
    if (!nextCampaignLead?.lead) return;
    setCallStatus("calling"); setCallError(null);
    try {
      const activeCall = await initiateCallMutation.mutateAsync({
        leadId: nextCampaignLead.lead.id, campaignId: campIdVal, companyId,
        toNumber: nextCampaignLead.lead.phone, fromNumber: selectedNumber || undefined, type: "auto",
      });
      setActiveCallId(activeCall.id);
      await updateLeadStatusMutation.mutateAsync({ campaignLeadId: nextCampaignLead.id, status: "in_progress" });
      if (webrtcOn) {
        if (rtc.status !== "registered") { setCallError("Browser calling not connected."); setCallStatus("idle"); return; }
        const ok = rtc.makeCall(nextCampaignLead.lead.phone, selectedNumber || dialerConfig?.defaultCallerId || "");
        if (!ok) { setCallError(rtc.error || "Could not start browser call."); setCallStatus("idle"); return; }
        setCallStatus("connected"); setDuration(0);
        await updateStatusMutation.mutateAsync({ id: activeCall.id, status: "connected" });
      } else {
        setTimeout(async () => {
          setCallStatus("connected"); setDuration(0);
          await updateStatusMutation.mutateAsync({ id: activeCall.id, status: "connected" });
        }, 2000);
      }
    } catch (err) {
      console.error("Failed to execute autodial call:", err);
      setCallStatus("idle");
    }
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const autoCamps = (campaigns as any[]).filter((c) => c.type === "auto");
    if (autoCamps.length > 0 && !selectedCampaignId) setSelectedCampaignId(autoCamps[0].id.toString());
  }, [campaigns, selectedCampaignId]);

  useEffect(() => {
    if (callStatus === "connected" && !isPaused) {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else { if (timerRef.current) clearInterval(timerRef.current); }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callStatus, isPaused]);

  // Auto-dial after disposition
  const autoDialNextRef = useRef(false);
  useEffect(() => {
    if (autoDialNextRef.current && isRunning && !isPaused && callStatus === "idle" && nextCampaignLead?.lead) {
      autoDialNextRef.current = false;
      const t = setTimeout(() => triggerAutoDialCall(), 800);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callStatus, nextCampaignLead, isRunning, isPaused]);

  // Auto-end on SIP error
  useEffect(() => {
    if (!webrtcOn) return;
    if (rtc.callState === "ended" && (callStatus === "connected" || callStatus === "calling")) {
      if (rtc.error) setCallError(rtc.error);
      setCallStatus("disposition");
      if (timerRef.current) clearInterval(timerRef.current);
      finalizeRecording().catch(() => {});
      if (activeCallId) updateStatusMutation.mutate({ id: activeCallId, status: "completed" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtc.callState, webrtcOn]);

  useEffect(() => {
    if (!autoRecord) return;
    if (callStatus === "connected" && recorder.status === "inactive") {
      const t = setTimeout(() => recorder.startRecording(webrtcOn ? rtc.getRemoteStream : undefined), 400);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callStatus, autoRecord, webrtcOn]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recorder.setMicMuted(isMuted); if (webrtcOn) rtc.setMuted(isMuted); }, [isMuted]);

  const getLeadValue = (key: string): string => {
    if (key in editedLead) return editedLead[key];
    if (!currentLead) return "";
    if (key.startsWith("cf:")) {
      const v = (currentLead.customFields as Record<string, unknown> | undefined)?.[key.slice(3)];
      return v == null ? "" : String(v);
    }
    return String((currentLead as Record<string, unknown>)[key] ?? "");
  };
  const setLeadValue   = (key: string, val: string) => setEditedLead((p) => ({ ...p, [key]: val }));
  const saveLeadField  = (key: string) => {
    if (!currentLead || !(key in editedLead)) return;
    const val = editedLead[key];
    if (key.startsWith("cf:")) {
      updateLeadMutation.mutate({ id: currentLead.id, data: { customFields: { ...(currentLead.customFields || {}), [key.slice(3)]: val } } });
    } else {
      updateLeadMutation.mutate({ id: currentLead.id, data: { [key]: val || undefined } });
    }
    setTimeout(() => refetchNextLead(), 600);
  };

  const handleToggleRecording = async () => {
    if (recorder.status === "recording" || recorder.status === "paused") {
      const r = await recorder.stopRecording();
      if (r) { setSavedRecordingDataUrl(r.dataUrl); setRecordingDuration(r.duration); }
    } else { await recorder.startRecording(webrtcOn ? rtc.getRemoteStream : undefined); }
  };

  const handleAutoRecordToggle = async () => {
    const next = !autoRecord; setAutoRecord(next);
    if (!next && (recorder.status === "recording" || recorder.status === "paused")) {
      const r = await recorder.stopRecording();
      if (r) { setSavedRecordingDataUrl(r.dataUrl); setRecordingDuration(r.duration); }
    }
  };

  const finalizeRecording = async (): Promise<{ dataUrl: string; duration: number } | null> => {
    if (recorder.status === "recording" || recorder.status === "paused") {
      const r = await recorder.stopRecording();
      if (r) { setSavedRecordingDataUrl(r.dataUrl); setRecordingDuration(r.duration); return { dataUrl: r.dataUrl, duration: r.duration }; }
      return null;
    }
    return savedRecordingDataUrl ? { dataUrl: savedRecordingDataUrl, duration: recordingDuration } : null;
  };

  const startDialer = async () => {
    if (!selectedCampaignId) return;
    setIsRunning(true); setIsPaused(false); setCallStatus("idle"); setCallError(null);
    try { await startCampaignMutation.mutateAsync({ id: campIdVal }); refetchCampaigns(); refetchProgress(); refetchNextLead(); }
    catch (err) { console.error("Failed to start:", err); }
  };
  const pauseDialer = async () => {
    setIsPaused(true);
    if (webrtcOn && (callStatus === "connected" || callStatus === "calling")) rtc.hangup();
    try { await pauseCampaignMutation.mutateAsync({ id: campIdVal }); refetchCampaigns(); } catch { /* ignore */ }
  };
  const resumeDialer = async () => {
    setIsPaused(false); setCallError(null);
    try { await startCampaignMutation.mutateAsync({ id: campIdVal }); refetchCampaigns(); refetchNextLead(); } catch { /* ignore */ }
  };
  const handleEndCall = async () => {
    if (webrtcOn) rtc.hangup();
    setCallStatus("disposition");
    if (timerRef.current) clearInterval(timerRef.current);
    await finalizeRecording();
    if (activeCallId) try { await updateStatusMutation.mutateAsync({ id: activeCallId, status: "completed" }); } catch { /* ignore */ }
  };

  const handleDisposition = async (dispId: string) => {
    const lead = currentLead;

    // 1. Save any inline edits the user made to the lead fields
    if (lead && Object.keys(editedLead).length > 0) {
      try {
        const standardUpdates: Record<string, unknown> = {};
        const cfUpdates: Record<string, unknown> = { ...(lead.customFields || {}) };
        let hasCf = false;
        for (const [key, val] of Object.entries(editedLead)) {
          if (key.startsWith("cf:")) { cfUpdates[key.slice(3)] = val; hasCf = true; }
          else { standardUpdates[key] = val || undefined; }
        }
        const patch: Record<string, unknown> = { ...standardUpdates };
        if (hasCf) patch.customFields = cfUpdates;
        if (Object.keys(patch).length > 0) await updateLeadMutation.mutateAsync({ id: lead.id, data: patch });
      } catch (err) { console.error("Failed to save lead edits:", err); }
    }

    // 2. Save call record + recording + update campaign lead status
    if (activeCallId && nextCampaignLead) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dispObj = (dispositions as any[]).find((d) => d.id.toString() === dispId);
        let leadStatus: "completed" | "failed" | "skipped" | "callback" = "completed";
        if (dispObj?.category === "no_answer" || dispObj?.category === "wrong_number") leadStatus = "failed";
        else if (dispObj?.category === "callback") leadStatus = "callback";

        const rec = await finalizeRecording();
        endCallMutation.mutate({ id: activeCallId, dispositionId: parseInt(dispId), duration, notes: callNotes, callDescription: callNotes, recordingUrl: rec?.dataUrl || undefined });
        if (rec?.dataUrl) saveRecordingMutation.mutate({ callId: activeCallId, recordingUrl: rec.dataUrl, duration: rec.duration, fileSize: recorder.audioBlob?.size, format: "webm" });
        await updateLeadStatusMutation.mutateAsync({ campaignLeadId: nextCampaignLead.id, status: leadStatus, callerId: user?.id });
      } catch (err) { console.error("Failed to submit disposition:", err); }
    }

    // 3. Reset UI and schedule auto-dial of the next lead
    autoDialNextRef.current = true;
    setCallStatus("idle"); setDuration(0); setCallNotes(""); setActiveCallId(null); setCallError(null);
    recorder.resetRecording(); setSavedRecordingDataUrl(null); setRecordingDuration(0); setIsMuted(false); setEditedLead({});
    refetchProgress();
    setTimeout(() => refetchNextLead(), 300);
  };

  const stopDialer = async () => {
    if (webrtcOn && (callStatus === "connected" || callStatus === "calling")) rtc.hangup();
    setIsRunning(false); setIsPaused(false); setCallStatus("idle"); setDuration(0); setCallError(null);
    if (timerRef.current) clearInterval(timerRef.current);
    recorder.resetRecording(); setSavedRecordingDataUrl(null); setRecordingDuration(0); setIsMuted(false);
    try { await pauseCampaignMutation.mutateAsync({ id: campIdVal }); refetchCampaigns(); } catch { /* ignore */ }
  };

  const getDispIcon = (cat: string) => {
    if (cat === "connected" || cat === "converted") return <CheckCircle2 className="w-4 h-4" />;
    if (cat === "no_answer")                         return <XCircle className="w-4 h-4" />;
    if (cat === "machine" || cat === "voicemail")    return <Radio className="w-4 h-4" />;
    if (cat === "wrong_number")                      return <Hash className="w-4 h-4" />;
    return <Ban className="w-4 h-4" />;
  };

  const progressTotal     = campaignProgress?.total     || 0;
  const progressCompleted = campaignProgress?.completed || 0;
  const progressPercentage = progressTotal > 0 ? Math.round((progressCompleted / progressTotal) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* WebRTC status */}
      {webrtcOn && (
        <p className="text-xs">
          <span className={rtc.status === "registered" ? "text-green-400" : rtc.status === "connecting" ? "text-yellow-400" : "text-red-400"}>
            ● {rtc.status === "registered" ? "Browser calling ready" : rtc.status === "connecting" ? "Connecting…" : "Not connected"}
          </span>
          {rtc.error && <span className="text-red-400"> — {rtc.error}</span>}
        </p>
      )}

      {/* Campaign controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={selectedNumber} onValueChange={setSelectedNumber}>
          <SelectTrigger className="h-9 w-40 bg-gray-800 border-gray-600 text-white text-sm [&>span]:truncate">
            <SelectValue placeholder="Caller ID" />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-600 text-white">
            {callerNumbers.length
              ? callerNumbers.map((n) => <SelectItem key={n.value} value={n.value} className="font-mono">{n.value}</SelectItem>)
              : <SelectItem value="none" disabled>Configure in Settings</SelectItem>}
          </SelectContent>
        </Select>

        {!isRunning ? (
          <>
            <select value={selectedCampaignId} onChange={(e) => setSelectedCampaignId(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded-md px-3 py-2 text-white text-sm h-9">
              <option value="">Select campaign...</option>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(campaigns as any[]).filter((c) => c.type === "auto").map((c: any) => (
                <option key={c.id} value={c.id.toString()}>{c.name}</option>
              ))}
            </select>

            {/* Field selection */}
            <div className="relative">
              <Button
                variant="outline"
                className={`border-gray-600 text-gray-300 h-9 px-3 text-sm ${fieldMenuOpen ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 hover:bg-gray-700"}`}
                onClick={() => setFieldMenuOpen((o) => !o)}
              >
                Fields ▾
              </Button>
              {fieldMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setFieldMenuOpen(false)} />
                  <div className="absolute left-0 mt-1 z-20 w-60 max-h-72 overflow-auto bg-gray-800 border border-gray-600 rounded-xl p-2 shadow-2xl">
                    <p className="text-xs font-semibold text-gray-100 px-2 py-1.5 sticky top-0 bg-gray-800 border-b border-gray-700 mb-1">Lead fields to display</p>
                    {STANDARD_FIELDS.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-100 hover:bg-gray-700 rounded-lg cursor-pointer">
                        <input type="checkbox" className="accent-blue-500 w-4 h-4" checked={displayFields.includes(f.key)} onChange={() => toggleField(f.key)} />
                        <span className="truncate">{f.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            <Button className="bg-green-600 hover:bg-green-700 h-9" onClick={startDialer} disabled={!selectedCampaignId}>
              <Play className="w-4 h-4 mr-2" /> Start
            </Button>
          </>
        ) : (
          <>
            {isPaused
              ? <Button className="bg-green-600 hover:bg-green-700 text-white h-9" onClick={resumeDialer}><Play className="w-4 h-4 mr-2" /> Resume</Button>
              : <Button className="bg-amber-500 hover:bg-amber-600 text-white h-9" onClick={pauseDialer}><Pause className="w-4 h-4 mr-2" /> Pause</Button>}
            <Button className="bg-red-600 hover:bg-red-700 text-white h-9" onClick={stopDialer}>
              <PhoneOff className="w-4 h-4 mr-2" /> Stop
            </Button>
          </>
        )}
      </div>

      {/* Progress bar */}
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

      {/* ── Running state: 3-column grid ── */}
      {isRunning && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* LEFT — Lead Info (inline editable) */}
          <Card className="text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm bg-gray-900 border-gray-800">
            <div className="px-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-blue-400" />
                  </div>
                  {currentLead ? (
                    <div>
                      <h3 className="text-base font-semibold text-white">
                        {getLeadValue("firstName")} {getLeadValue("lastName") || getLeadValue("companyName") || "Lead"}
                      </h3>
                      <p className="text-xs text-gray-500">Lead #{currentLead.id}</p>
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-base font-semibold text-white">Searching…</h3>
                      <p className="text-xs text-gray-500">Finding next pending lead</p>
                    </div>
                  )}
                </div>
                <Badge className="bg-blue-500/20 text-blue-400 shrink-0">Current</Badge>
              </div>
              {currentLead ? (
                <div className="space-y-2 overflow-y-auto max-h-[340px]">
                  {displayFields.map((fk) => {
                    const f = allDisplayFields.find((x) => x.key === fk);
                    if (!f) return null;
                    return (
                      <div key={fk}>
                        <label className="text-xs font-medium text-gray-400">{f.label}</label>
                        {fk === "notes" ? (
                          <Textarea value={getLeadValue(fk)} onChange={(e) => setLeadValue(fk, e.target.value)} onBlur={() => saveLeadField(fk)} placeholder={f.label} className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-600 mt-0.5 text-sm min-h-[55px]" />
                        ) : (
                          <Input value={getLeadValue(fk)} onChange={(e) => setLeadValue(fk, e.target.value)} onBlur={() => saveLeadField(fk)} placeholder={f.label} className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-600 mt-0.5 text-sm h-8" />
                        )}
                      </div>
                    );
                  })}
                  {displayFields.length === 0 && <p className="text-xs text-gray-500">No fields selected. Use Fields ▾ before starting.</p>}
                  {updateLeadMutation.isPending && <p className="text-xs text-blue-400">Saving…</p>}
                </div>
              ) : (
                <p className="text-center text-gray-500 text-sm py-4">Waiting for next pending campaign lead…</p>
              )}
            </div>
          </Card>

          {/* CENTER — Call Interface */}
          <Card className="text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm bg-gray-900 border-gray-800">
            <div className="px-6 space-y-3">

              {/* IDLE — dial pad */}
              {callStatus === "idle" && (
                <>
                  {nextCampaignLead ? (
                    <div className="space-y-3">
                      <div className="text-center pt-2">
                        <div className="w-14 h-14 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-2">
                          <Phone className="w-7 h-7 text-gray-400" />
                        </div>
                        <p className="text-gray-400 text-sm">Ready to call</p>
                      </div>
                      <Input value={currentLead?.phone || ""} readOnly className="bg-gray-950 border-gray-600 text-white text-center text-lg font-mono cursor-default" />
                      <div className="grid grid-cols-3 gap-1.5">
                        {["1","2","3","4","5","6","7","8","9","*","0","#"].map((d) => (
                          <button key={d} className="h-12 rounded-lg bg-gray-800 text-white font-medium text-lg hover:bg-gray-700 active:bg-gray-600 transition-colors border border-gray-700/50">{d}</button>
                        ))}
                      </div>
                      {callError && <div className="text-sm rounded-lg px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20">{callError}</div>}
                      <Button className="w-full h-12 bg-green-600 hover:bg-green-700 text-white text-base font-semibold" onClick={triggerAutoDialCall} disabled={!currentLead?.phone}>
                        <PhoneCall className="w-5 h-5 mr-2" /> Call
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <Phone className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                      <p className="text-gray-500 text-sm">All leads in this campaign have been dialed.</p>
                    </div>
                  )}
                </>
              )}

              {/* CALLING */}
              {callStatus === "calling" && (
                <div className="text-center py-8 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto animate-pulse">
                    <Phone className="w-8 h-8 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">Dialing…</p>
                    <p className="text-gray-400 font-mono mt-1">{currentLead?.phone}</p>
                    {selectedNumber && <p className="text-xs text-gray-500 mt-1">From: {selectedNumber}</p>}
                  </div>
                </div>
              )}

              {/* CONNECTED */}
              {callStatus === "connected" && (
                <div className="space-y-3">
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto animate-pulse">
                      <Phone className="w-7 h-7 text-green-400" />
                    </div>
                    <p className="text-2xl font-bold text-white font-mono mt-2">{formatDur(duration)}</p>
                    <Badge className="bg-green-500/20 text-green-400 mt-1">On Call</Badge>
                    {selectedNumber && <p className="text-xs text-gray-500 mt-1 font-mono">{selectedNumber}</p>}
                  </div>
                  {callError && <div className="text-xs rounded-lg px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20">{callError}</div>}
                  {recorder.isRecording && (
                    <div className="flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg py-1.5 px-3">
                      <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" /></span>
                      <span className="text-xs font-semibold text-red-400">{autoRecord ? "AUTO REC" : "REC"}</span>
                      <span className="text-xs font-mono text-red-300">{formatDur(recorder.recordingTime)}</span>
                    </div>
                  )}
                  <div className="flex justify-center gap-2 flex-wrap">
                    <Button variant="outline" size="sm" className={`border-gray-700 ${isMuted ? "text-red-400 bg-red-500/10" : "text-gray-300"}`} onClick={() => setIsMuted(!isMuted)}>
                      {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </Button>
                    <Button variant="outline" size="sm" className={`border-gray-700 text-xs gap-1 ${autoRecord ? "text-red-400 bg-red-500/10 border-red-700" : "text-gray-300"}`} onClick={handleAutoRecordToggle}>
                      <Radio className="w-3.5 h-3.5" /> Auto
                    </Button>
                    {!autoRecord && (
                      <Button variant="outline" size="sm" className={`border-gray-700 ${recorder.isRecording ? "text-red-400 bg-red-500/10 border-red-700 animate-pulse" : "text-gray-300"}`} onClick={handleToggleRecording}>
                        {recorder.isRecording ? <Square className="w-4 h-4 fill-current" /> : <Disc className="w-4 h-4" />}
                        <span className="ml-1.5 text-xs">{recorder.isRecording ? "Stop" : "Record"}</span>
                      </Button>
                    )}
                  </div>
                  {/* DTMF keypad */}
                  <div className="rounded-xl bg-gray-800 border border-gray-700 p-3">
                    <p className="text-xs font-medium text-gray-400 text-center mb-2">Keypad — IVR navigation</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {["1","2","3","4","5","6","7","8","9","*","0","#"].map((d) => (
                        <button key={d} onClick={() => { if (webrtcOn) rtc.sendDTMF(d); }}
                          className="h-11 rounded-lg bg-gray-700 text-white font-semibold text-lg hover:bg-gray-600 active:bg-gray-500 active:scale-95 transition-all border border-gray-600">{d}</button>
                      ))}
                    </div>
                  </div>
                  <Textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="Call notes…" className="bg-gray-800 border-gray-700 text-white min-h-[55px]" />
                  <Button className="w-full bg-red-600 hover:bg-red-700 h-11 font-semibold" onClick={handleEndCall}>
                    <PhoneOff className="w-4 h-4 mr-2" /> End Call
                  </Button>
                </div>
              )}

              {/* DISPOSITION */}
              {callStatus === "disposition" && (
                <div className="space-y-3">
                  <div className="text-center py-1">
                    <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center mx-auto mb-2">
                      <Phone className="w-6 h-6 text-gray-400" />
                    </div>
                    <p className="text-base font-semibold text-white">Call Ended</p>
                    <p className="text-gray-400 text-sm font-mono">{formatDur(duration)}</p>
                    {callError && <p className="text-xs text-red-400 mt-1">{callError}</p>}
                  </div>
                  {recorder.audioUrl && (
                    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5"><Disc className="w-3.5 h-3.5 text-red-400" /> Recording ({formatDur(recordingDuration)})</p>
                        <a href={recorder.audioUrl} download={`call-${activeCallId ?? "call"}.webm`} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"><Download className="w-3 h-3" /> Download</a>
                      </div>
                      <audio controls src={recorder.audioUrl} className="w-full h-9" />
                    </div>
                  )}
                  <Textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="Call notes…" className="bg-gray-800 border-gray-700 text-white min-h-[55px] text-sm" />
                  <div>
                    <p className="text-sm font-semibold text-gray-100 mb-2">Select Call Result</p>
                    <div className="grid grid-cols-2 gap-2">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(dispositions as any[]).map((disp) => (
                        <Button key={disp.id} size="sm" onClick={() => handleDisposition(disp.id.toString())}
                          className="bg-gray-700 hover:bg-gray-600 text-white justify-start h-10 border border-gray-500 transition-colors">
                          {getDispIcon(disp.category)}
                          <span className="ml-2 truncate text-sm">{disp.label}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* RIGHT — Stats + Automation */}
          <Card className="text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm bg-gray-900 border-gray-800">
            <div className="px-6 space-y-4">
              <div className="text-center pb-3 border-b border-gray-700">
                <Clock className="w-6 h-6 text-gray-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-white font-mono">{formatDur(duration)}</p>
                <p className="text-xs text-gray-400">Current Call Duration</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">Campaign Metrics</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-gray-400">Total Leads</span><span className="text-white font-medium">{progressTotal}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-400">Completed</span><span className="text-green-400 font-medium">{progressCompleted}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-400">Pending</span><span className="text-amber-400 font-medium">{campaignProgress?.pending || 0}</span></div>
                </div>
              </div>
              <div className="border-t border-gray-800 pt-3 space-y-2">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Automation</p>
                <TogglePill on={autoRecord} onToggle={handleAutoRecordToggle} label={autoRecord ? "🔴 Auto Record ON" : "Auto Record OFF"} activeColor="bg-red-500" />
                {autoRecord && recorder.isRecording && <p className="text-xs text-red-400 px-1">● Recording in progress…</p>}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Not running ── */}
      {!isRunning && (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-12 text-center">
            <Radio className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Auto Dialer Ready</h3>
            <p className="text-gray-400 mb-4 max-w-md mx-auto">
              Select a campaign and click Start to begin automated calling.
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
