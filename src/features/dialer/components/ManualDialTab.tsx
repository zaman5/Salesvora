import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCallRecorder } from "@/hooks/useCallRecorder";
import { useWebRTC } from "@/providers/WebRTCProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Radio, Play, Pause, SkipForward, PhoneOff, Clock,
  Phone, PhoneCall, CheckCircle2, XCircle, Ban, User,
  Disc, Square, Download, Mic, MicOff, X, Hash, Save, Plus,
  PhoneIncoming,
} from "lucide-react";
import {
  TogglePill, STANDARD_FIELDS, EMPTY_CONTACT, formatDur,
  type NewContact,
} from "./shared";

export function ManualDialTab() {
  const { user } = useAuth();
  const companyId = user?.companyId || 1;

  const [callStatus, setCallStatus] = useState<"idle" | "dialing" | "connected" | "ended">("idle");
  const [duration, setDuration]   = useState(0);
  const [isMuted, setIsMuted]     = useState(false);
  const [isPaused, setIsPaused]   = useState(false);
  const [selectedDisposition, setSelectedDisposition] = useState<string | null>(null);
  const [callNotes, setCallNotes]   = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [customField, setCustomField] = useState("");
  const [showCustomField, setShowCustomField] = useState(false);
  const [activeCallId, setActiveCallId] = useState<number | null>(null);
  const [callError, setCallError]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [addMode, setAddMode]       = useState(false);
  const [newContact, setNewContact] = useState<NewContact>(EMPTY_CONTACT);

  const [autoRecord, setAutoRecord] = useState(() => {
    try { return localStorage.getItem("dialer.autoRecord") === "true"; } catch { return false; }
  });
  const [autoCall, setAutoCall] = useState(() => {
    try { return localStorage.getItem("dialer.autoCall") === "true"; } catch { return false; }
  });
  const pendingAutoCallRef = useRef<(() => void) | null>(null);

  const recorder = useCallRecorder();
  const [savedRecordingDataUrl, setSavedRecordingDataUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const [selectedListId, setSelectedListId] = useState<string>("");
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0);

  const { data: leadLists = [] } = trpc.lead.listLists.useQuery();
  const { data: leadsResponse }  = trpc.lead.list.useQuery(
    { leadListId: parseInt(selectedListId) || 0 },
    { enabled: !!selectedListId },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leads: any[] = useMemo(
    () => Array.isArray(leadsResponse) ? leadsResponse : (leadsResponse as { items?: unknown[] })?.items ?? [],
    [leadsResponse],
  );
  const currentLead = leads[currentLeadIndex] || null;
  const nextLeadIdx = currentLeadIndex + 1 < leads.length ? currentLeadIndex + 1 : 0;
  const nextLead    = leads.length > 1 ? leads[nextLeadIdx] : null;

  const customFieldKeys = useMemo(() => {
    const s = new Set<string>();
    for (const l of leads) {
      const cf = l?.customFields;
      if (cf && typeof cf === "object") Object.keys(cf).forEach((k) => s.add(k));
    }
    return Array.from(s);
  }, [leads]);
  const allFields = useMemo(
    () => [...STANDARD_FIELDS, ...customFieldKeys.map((k) => ({ key: `cf:${k}`, label: k }))],
    [customFieldKeys],
  );
  const [displayFields, setDisplayFields] = useState<string[]>(() => {
    try { const s = localStorage.getItem("dialer.displayFields"); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return ["firstName", "lastName", "companyName", "phone", "email", "city", "state"];
  });
  useEffect(() => {
    try { localStorage.setItem("dialer.displayFields", JSON.stringify(displayFields)); } catch { /* ignore */ }
  }, [displayFields]);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [edited, setEdited] = useState<Record<string, string>>({});
  useEffect(() => { setEdited({}); }, [currentLead?.id]);

  const utils = trpc.useUtils();
  const updateLeadMutation = trpc.lead.update.useMutation({ onSuccess: () => utils.lead.list.invalidate() });

  const toggleField = (key: string) =>
    setDisplayFields((p) => p.includes(key) ? p.filter((k) => k !== key) : [...p, key]);

  const getFieldValue = (fieldKey: string): string => {
    if (fieldKey in edited) return edited[fieldKey];
    if (!currentLead) return "";
    if (fieldKey.startsWith("cf:")) {
      const v = (currentLead.customFields as Record<string, unknown> | undefined)?.[fieldKey.slice(3)];
      return v == null ? "" : String(v);
    }
    return String((currentLead as Record<string, unknown>)[fieldKey] ?? "");
  };
  const setFieldValue = (k: string, val: string) => setEdited((p) => ({ ...p, [k]: val }));
  const saveField = (fieldKey: string) => {
    if (!currentLead || !(fieldKey in edited)) return;
    const val = edited[fieldKey];
    if (fieldKey.startsWith("cf:")) {
      updateLeadMutation.mutate({ id: currentLead.id, data: { customFields: { ...(currentLead.customFields || {}), [fieldKey.slice(3)]: val } } });
    } else {
      updateLeadMutation.mutate({ id: currentLead.id, data: { [fieldKey]: val } });
    }
  };

  const { data: dispositions = [] } = trpc.calls.dispositions.useQuery({ companyId });
  const { data: dialerConfig }      = trpc.integration.getDialerConfig.useQuery();
  const rtc      = useWebRTC();
  const webrtcOn = Boolean(dialerConfig?.webrtc?.enabled);

  const callerNumbers = (dialerConfig?.fromNumbers ?? []).filter((n: string) => !!n).map((n: string) => ({ value: n }));
  const [selectedNumber, setSelectedNumber] = useState("");
  useEffect(() => {
    const pref = dialerConfig?.defaultCallerId || callerNumbers[0]?.value || "";
    if (pref && !selectedNumber) setSelectedNumber(pref);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialerConfig]);

  const initiateCallMutation  = trpc.calls.initiate.useMutation();
  const updateStatusMutation  = trpc.calls.updateStatus.useMutation();
  const endCallMutation       = trpc.calls.endCall.useMutation();
  const saveRecordingMutation = trpc.calls.saveRecording.useMutation();

  useEffect(() => {
    if (leadLists.length > 0 && !selectedListId)
      setSelectedListId((leadLists[0] as { id: number }).id.toString());
  }, [leadLists, selectedListId]);

  useEffect(() => {
    if (currentLead && !addMode) setPhoneNumber(currentLead.phone);
  }, [currentLead, addMode]);

  useEffect(() => {
    if (callStatus === "connected" && !isPaused) {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callStatus, isPaused]);

  useEffect(() => {
    recorder.setMicMuted(isMuted);
    if (webrtcOn) rtc.setMuted(isMuted);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted]);

  useEffect(() => { try { localStorage.setItem("dialer.autoRecord", String(autoRecord)); } catch { /* ignore */ } }, [autoRecord]);
  useEffect(() => { try { localStorage.setItem("dialer.autoCall",   String(autoCall));   } catch { /* ignore */ } }, [autoCall]);

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

  // Auto-call trigger
  useEffect(() => {
    if (callStatus === "idle" && pendingAutoCallRef.current) {
      const action = pendingAutoCallRef.current;
      pendingAutoCallRef.current = null;
      const t = setTimeout(action, 700);
      return () => clearTimeout(t);
    }
  }, [callStatus]);

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

  const finalizeRecording = async (): Promise<{ dataUrl: string; duration: number } | null> => {
    if (recorder.status === "recording" || recorder.status === "paused") {
      const r = await recorder.stopRecording();
      if (r) { setSavedRecordingDataUrl(r.dataUrl); setRecordingDuration(r.duration); return { dataUrl: r.dataUrl, duration: r.duration }; }
      return null;
    }
    return savedRecordingDataUrl ? { dataUrl: savedRecordingDataUrl, duration: recordingDuration } : null;
  };

  const doCallFlow = useCallback(async (toNumber: string, leadId?: number) => {
    setCallError(null);
    setCallStatus("dialing");
    try {
      const activeCall = await initiateCallMutation.mutateAsync({
        leadId, companyId, toNumber, fromNumber: selectedNumber || undefined, type: "manual",
      });
      if (activeCall.success === false) { setCallError(activeCall.error || "Call could not be placed."); setCallStatus("idle"); return; }
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

  const startCall = () => { if (!phoneNumber) return; doCallFlow(phoneNumber, addMode ? undefined : currentLead?.id); };

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
    setIsMuted(false); setIsPaused(false); setShowCustomField(false); setActiveCallId(null);
    setAddMode(false); setNewContact(EMPTY_CONTACT); recorder.resetRecording();
    setSavedRecordingDataUrl(null); setRecordingDuration(0);
  };

  const handleSaveAndNext = async () => {
    const rec      = await finalizeRecording();
    const callId   = activeCallId;
    const dispId   = selectedDisposition;
    const dur      = duration;
    const notes    = callNotes;
    const lead     = currentLead;
    const blobSize = recorder.audioBlob?.size;

    if (autoCall && !addMode) {
      const nextIdx = currentLeadIndex < leads.length - 1 ? currentLeadIndex + 1 : 0;
      const nextLd  = leads[nextIdx];
      if (nextLd) { const phone = nextLd.phone; const leadId = nextLd.id; pendingAutoCallRef.current = () => doCallFlow(phone, leadId); }
    }

    if (currentLeadIndex < leads.length - 1) setCurrentLeadIndex((p) => p + 1);
    else setCurrentLeadIndex(0);
    resetCall();

    if (callId) {
      endCallMutation.mutate({ id: callId, dispositionId: dispId ? parseInt(dispId) : undefined, duration: dur, notes, callDescription: notes, recordingUrl: rec?.dataUrl || undefined });
      if (rec?.dataUrl) saveRecordingMutation.mutate({ callId, recordingUrl: rec.dataUrl, duration: rec.duration, fileSize: blobSize, format: "webm" });
    }
    if (lead && dispId) {
      const disp = (dispositions as Array<{ id: number; label: string; category: string }>).find((d) => d.id.toString() === dispId);
      if (disp) updateLeadMutation.mutate({ id: lead.id, data: { customFields: { ...((lead.customFields as Record<string, unknown>) ?? {}), _lastDisposition: disp.label } } });
    }
  };

  const dialPadDigits = ["1","2","3","4","5","6","7","8","9","*","0","#"];
  const handleDTMF = (digit: string) => { if (webrtcOn) rtc.sendDTMF(digit); };

  const getDispIcon = (cat: string) => {
    if (cat === "connected" || cat === "converted") return <CheckCircle2 className="w-4 h-4" />;
    if (cat === "no_answer") return <XCircle className="w-4 h-4" />;
    if (cat === "machine" || cat === "voicemail") return <Radio className="w-4 h-4" />;
    if (cat === "wrong_number") return <Hash className="w-4 h-4" />;
    return <Ban className="w-4 h-4" />;
  };

  return (
    <div className="space-y-4">
      {webrtcOn && (
        <p className="text-xs">
          <span className={rtc.status === "registered" ? "text-green-400" : rtc.status === "connecting" ? "text-yellow-400" : "text-red-400"}>
            ● {rtc.status === "registered" ? "Browser calling ready" : rtc.status === "connecting" ? "Connecting…" : "Not connected"}
          </span>
          {rtc.error && <span className="text-red-400"> — {rtc.error}</span>}
        </p>
      )}

      {callStatus === "idle" && (
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

          <select value={selectedListId} onChange={(e) => { setSelectedListId(e.target.value); setCurrentLeadIndex(0); }}
            className="h-9 bg-gray-800 border border-gray-600 rounded-md px-3 text-white text-sm">
            <option value="">Select Lead List…</option>
            {(leadLists as Array<{ id: number; name: string }>).map((ll) => (
              <option key={ll.id} value={ll.id.toString()}>{ll.name}</option>
            ))}
          </select>

          <button
            className={`h-9 px-3 flex items-center gap-1.5 rounded-md border text-sm font-medium transition-colors ${
              addMode ? "bg-blue-600 border-blue-500 text-white hover:bg-blue-700" : "bg-gray-800 border-gray-600 text-white hover:bg-gray-700"
            }`}
            onClick={() => {
              if (addMode) { setAddMode(false); setNewContact(EMPTY_CONTACT); if (currentLead) setPhoneNumber(currentLead.phone); }
              else          { setAddMode(true);  setNewContact(EMPTY_CONTACT); setPhoneNumber(""); }
            }}
          >
            {addMode ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {addMode ? "Cancel" : "Add Number"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* ── Left: Queue + Automation ── */}
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 space-y-0">
            {leads.length > 0 && (
              <div className="pt-3 border-t border-gray-800">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Queue</p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="bg-gray-800 rounded-lg p-2 text-center">
                    <p className="text-base font-bold text-white">{leads.length}</p>
                    <p className="text-[10px] text-gray-500">Total</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-2 text-center">
                    <p className="text-base font-bold text-blue-400">{currentLeadIndex + 1}</p>
                    <p className="text-[10px] text-gray-500">Position</p>
                  </div>
                </div>
                {nextLead && (
                  <div className="p-2 rounded-lg bg-gray-800">
                    <p className="text-[10px] text-gray-500 mb-0.5">Next in queue</p>
                    <p className="text-xs text-white truncate">{nextLead.firstName || nextLead.companyName || `Lead #${nextLead.id}`}{nextLead.lastName ? ` ${nextLead.lastName}` : ""}</p>
                    <p className="text-[11px] text-blue-400 font-mono truncate">{nextLead.phone}</p>
                    <button disabled={callStatus !== "idle"}
                      onClick={() => { setCurrentLeadIndex(nextLeadIdx); setPhoneNumber(nextLead.phone || ""); }}
                      className="w-full mt-1 flex items-center justify-center gap-1 h-7 rounded-md bg-gray-700 text-white text-[11px] font-medium hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <SkipForward className="w-3 h-3" /> Skip to Next
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Automation — moved below Queue ── */}
            <div className="border-t border-gray-800 pt-3 mt-3 space-y-2">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Automation</p>
              <TogglePill on={autoRecord} onToggle={handleAutoRecordToggle} label={autoRecord ? "🔴 Auto Record ON" : "Auto Record OFF"} activeColor="bg-red-500" />
              {autoRecord && recorder.isRecording && <p className="text-xs text-red-400 px-1">● Recording in progress…</p>}
              <TogglePill on={autoCall} onToggle={() => setAutoCall((v) => !v)} label={autoCall ? "⚡ Auto Calling ON" : "Auto Calling OFF"} />
              {autoCall && <p className="text-xs text-green-400 px-1">After saving, the next lead dials automatically.</p>}
            </div>
          </CardContent>
        </Card>

        {/* ── Center: Dial Interface ── */}
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4">
            {callStatus === "idle" && (
              <div className="space-y-3">
                <div className="text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-2">
                    <Phone className="w-6 h-6 text-gray-400" />
                  </div>
                  <p className="text-gray-400 text-sm">{autoCall ? "⚡ Auto Call ON" : addMode ? "Quick call — no lead linked" : "Ready to call"}</p>
                </div>
                <Input value={phoneNumber}
                  onChange={(e) => { setPhoneNumber(e.target.value); if (addMode) setNewContact((p) => ({ ...p, phone: e.target.value })); }}
                  placeholder="Phone number" className="bg-gray-950 border-gray-600 text-white text-center text-lg placeholder:text-gray-500" />
                <div className="grid grid-cols-3 gap-1.5">
                  {dialPadDigits.map((d) => (
                    <button key={d}
                      onClick={() => { setPhoneNumber((p) => p + d); if (addMode) setNewContact((c) => ({ ...c, phone: c.phone + d })); }}
                      className="h-11 rounded-lg bg-gray-800 text-white font-medium text-lg hover:bg-gray-700 active:bg-gray-600 transition-colors">{d}</button>
                  ))}
                </div>
                {callError && <div className="text-sm rounded-lg px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20">{callError}</div>}
                <Button className="w-full h-12 bg-green-600 hover:bg-green-700 text-white text-base font-semibold" onClick={startCall} disabled={!phoneNumber}>
                  <PhoneCall className="w-5 h-5 mr-2" />
                  {addMode ? `Call ${phoneNumber || "…"}` : "Call"}
                </Button>
              </div>
            )}

            {callStatus === "dialing" && (
              <div className="text-center py-10 space-y-4">
                <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto animate-pulse">
                  <Phone className="w-8 h-8 text-blue-400 animate-bounce" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-white">Dialing…</p>
                  <p className="text-gray-400 mt-1 font-mono">{phoneNumber}</p>
                  <p className="text-xs text-gray-500 mt-1">From: {selectedNumber}</p>
                </div>
                <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={resetCall}>
                  <PhoneOff className="w-4 h-4 mr-2" /> Cancel
                </Button>
              </div>
            )}

            {(callStatus === "connected" || callStatus === "ended") && (
              <div className="space-y-3">
                <div className="text-center">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-1 ${callStatus === "connected" ? "bg-green-500/20 animate-pulse" : "bg-gray-700"}`}>
                    {rtc.callDirection === "inbound" && callStatus === "connected"
                      ? <PhoneIncoming className="w-7 h-7 text-green-400" />
                      : <Phone className={`w-7 h-7 ${callStatus === "connected" ? "text-green-400" : "text-gray-400"}`} />}
                  </div>
                  <p className="text-2xl font-bold text-white font-mono">{formatDur(duration)}</p>
                  <Badge className={callStatus === "connected" ? "bg-green-500/20 text-green-400 mt-1" : "bg-gray-500/20 text-gray-400 mt-1"}>
                    {callStatus === "connected" ? (rtc.callDirection === "inbound" ? "Incoming Call" : "On Call") : "Call Ended"}
                  </Badge>
                </div>

                {callError && callStatus === "ended" && (
                  <div className="text-xs rounded-lg px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20">{callError}</div>
                )}

                {recorder.isRecording && (
                  <div className="flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg py-1.5 px-3">
                    <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>
                    <span className="text-xs font-semibold text-red-400">{autoRecord ? "AUTO REC" : "REC"}</span>
                    <span className="text-xs font-mono text-red-300">{formatDur(recorder.recordingTime)}</span>
                  </div>
                )}

                {callStatus === "connected" && (
                  <>
                    <div className="flex justify-center flex-wrap gap-2">
                      <Button size="sm" className={isMuted ? "bg-red-600 hover:bg-red-700 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"} onClick={() => setIsMuted(!isMuted)}>
                        {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </Button>
                      <Button size="sm" className={`gap-1 text-xs ${autoRecord ? "bg-red-600 hover:bg-red-700 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"}`} onClick={handleAutoRecordToggle}>
                        <Radio className="w-3.5 h-3.5" /> Auto
                      </Button>
                      {!autoRecord && (
                        <Button size="sm" className={recorder.isRecording ? "bg-red-600 hover:bg-red-700 text-white animate-pulse" : "bg-gray-700 hover:bg-gray-600 text-white"} onClick={handleToggleRecording}>
                          {recorder.isRecording ? <Square className="w-4 h-4 fill-current" /> : <Disc className="w-4 h-4" />}
                        </Button>
                      )}
                      <Button size="sm" className={isPaused ? "bg-amber-500 hover:bg-amber-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white"} onClick={() => setIsPaused(!isPaused)}>
                        {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                      </Button>
                      <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleEndCall}>
                        <PhoneOff className="w-4 h-4 mr-1" /> End
                      </Button>
                    </div>
                    <div className="rounded-xl p-3 bg-gray-800 border border-gray-700">
                      <p className="text-xs text-gray-300 font-medium text-center mb-2">Keypad</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {dialPadDigits.map((d) => (
                          <button key={d} onClick={() => handleDTMF(d)} className="h-10 rounded-lg bg-gray-700 text-white font-semibold hover:bg-gray-600 active:bg-gray-500 transition-colors border border-gray-600">{d}</button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {callStatus === "ended" && recorder.audioUrl && (
                  <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5"><Disc className="w-3.5 h-3.5 text-red-400" /> Recording ({formatDur(recordingDuration)})</p>
                      <a href={recorder.audioUrl} download={`recording-${activeCallId ?? "call"}.webm`} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"><Download className="w-3 h-3" /> Download</a>
                    </div>
                    <audio controls src={recorder.audioUrl} className="w-full h-9" />
                  </div>
                )}

                <div>
                  <label className="text-sm font-semibold text-gray-100 mb-1 block">Call Notes</label>
                  <Textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="Enter call notes…" className="bg-gray-800 border-gray-600 text-gray-100 placeholder:text-gray-500 min-h-[65px]" />
                </div>

                {callStatus === "ended" && (
                  <div>
                    <label className="text-sm font-semibold text-gray-100 mb-2 block">Call Result</label>
                    <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                      {(dispositions as Array<{ id: number; label?: string; category: string }>).map((disp) => (
                        <Button key={disp.id} size="sm"
                          onClick={() => { setSelectedDisposition(disp.id.toString()); if (disp.id.toString() === "10") setShowCustomField(true); }}
                          className={`justify-start text-white text-xs ${selectedDisposition === disp.id.toString() ? "bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-400" : "bg-gray-700 hover:bg-gray-600"}`}>
                          {getDispIcon(disp.category)}<span className="ml-1 truncate">{disp.label}</span>
                        </Button>
                      ))}
                    </div>
                    {showCustomField && (
                      <Input value={customField} onChange={(e) => setCustomField(e.target.value)} placeholder="Enter custom result…" className="mt-2 bg-gray-800 border-gray-600 text-gray-100 placeholder:text-gray-500" />
                    )}
                    <div className="flex gap-2 mt-3">
                      <Button className="flex-1 bg-gray-700 hover:bg-gray-600 text-white"
                        onClick={() => { if (currentLeadIndex < leads.length - 1) setCurrentLeadIndex((p) => p + 1); else setCurrentLeadIndex(0); resetCall(); }}>
                        <SkipForward className="w-4 h-4 mr-1" /> Skip
                      </Button>
                      <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSaveAndNext}>
                        <Save className="w-4 h-4 mr-1" />{autoCall ? "Save + Auto Call" : "Save & Next"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Right: Lead Details + Automation ── */}
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 space-y-4">
            {addMode ? (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">New Contact</p>
                {([
                  { key: "firstName", label: "First Name", placeholder: "First name" },
                  { key: "lastName",  label: "Last Name",  placeholder: "Last name" },
                  { key: "company",   label: "Company",    placeholder: "Company name" },
                  { key: "email",     label: "Email",      placeholder: "email@company.com" },
                ] as const).map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-300 mb-0.5">{label}</label>
                    <Input value={newContact[key]} onChange={(e) => setNewContact((p) => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className="h-8 bg-gray-800 border-gray-700 text-gray-100 placeholder:text-gray-600 text-sm" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-0.5">Notes</label>
                  <Textarea value={newContact.notes} onChange={(e) => setNewContact((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes…" className="bg-gray-800 border-gray-700 text-gray-100 placeholder:text-gray-600 text-sm min-h-[60px]" />
                </div>
              </div>
            ) : currentLead ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{getFieldValue("firstName")} {getFieldValue("lastName") || getFieldValue("companyName") || "Lead"}</p>
                      <p className="text-xs text-gray-500">Lead #{currentLead.id}</p>
                    </div>
                  </div>
                  <div className="relative shrink-0">
                    <Button size="sm" className={`h-7 text-xs font-semibold px-2 ${fieldMenuOpen ? "bg-blue-600 text-white" : "bg-gray-700 text-white hover:bg-gray-600"}`} onClick={() => setFieldMenuOpen((o) => !o)}>Fields ▾</Button>
                    {fieldMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setFieldMenuOpen(false)} />
                        <div className="absolute right-0 mt-1 z-20 w-60 max-h-72 overflow-auto bg-gray-800 border border-gray-600 rounded-xl p-2 shadow-2xl">
                          <p className="text-xs font-semibold text-gray-100 px-2 py-1.5 sticky top-0 bg-gray-800 border-b border-gray-700 mb-1">Show these fields</p>
                          {allFields.map((f) => (
                            <label key={f.key} className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-100 hover:bg-gray-700 rounded-lg cursor-pointer">
                              <input type="checkbox" className="accent-blue-500 w-4 h-4" checked={displayFields.includes(f.key)} onChange={() => toggleField(f.key)} />
                              <span className="truncate">{f.label}</span>
                              {f.key.startsWith("cf:") && <span className="text-[10px] bg-blue-600/20 text-blue-300 px-1.5 py-0.5 rounded ml-auto shrink-0">Excel</span>}
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="space-y-2 overflow-y-auto max-h-[220px]">
                  {displayFields.length === 0 && <p className="text-xs text-gray-500">No fields selected. Click "Fields".</p>}
                  {displayFields.map((fk) => {
                    const f = allFields.find((x) => x.key === fk);
                    if (!f) return null;
                    return (
                      <div key={fk}>
                        <label className="text-xs font-medium text-gray-300">{f.label}</label>
                        {fk === "notes"
                          ? <Textarea value={getFieldValue(fk)} onChange={(e) => setFieldValue(fk, e.target.value)} onBlur={() => saveField(fk)} className="bg-gray-800 border-gray-600 text-gray-100 mt-0.5 text-sm min-h-[55px]" />
                          : <Input   value={getFieldValue(fk)} onChange={(e) => setFieldValue(fk, e.target.value)} onBlur={() => saveField(fk)} className="bg-gray-800 border-gray-600 text-gray-100 mt-0.5 text-sm h-8" />}
                      </div>
                    );
                  })}
                  {updateLeadMutation.isPending && <p className="text-xs text-gray-500">Saving…</p>}
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500">
                <p className="text-sm">Select a lead list above.</p>
                <p className="text-xs mt-1">Or click <strong>Add Number</strong> to dial any number.</p>
              </div>
            )}

            {callStatus !== "idle" && (
              <div className="border-t border-gray-800 pt-3 text-center">
                <Clock className="w-5 h-5 text-gray-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-white font-mono">{formatDur(duration)}</p>
                <p className="text-xs text-gray-400">Duration</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
