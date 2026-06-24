import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
  BarChart3, Disc, Square, Download,
  Mic, MicOff, X, Hash, Save, Plus,
  PhoneMissed, PhoneIncoming,
} from "lucide-react";

// ── Shared helpers ────────────────────────────────────────────────────────────
function TogglePill({ on, onToggle, label, activeColor = "bg-green-500" }: {
  on: boolean; onToggle: () => void; label: string; activeColor?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
        on ? "bg-white/5 border-white/10 text-white"
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
  { key: "phone", label: "Phone" }, { key: "phone2", label: "Phone 2" },
  { key: "email", label: "Email" }, { key: "address", label: "Address" },
  { key: "city", label: "City" }, { key: "state", label: "State" },
  { key: "country", label: "Country" }, { key: "zipCode", label: "Zip Code" },
  { key: "website", label: "Website" }, { key: "notes", label: "Notes" },
];

type NewContact = { phone: string; firstName: string; lastName: string; company: string; email: string; notes: string };
const EMPTY_CONTACT: NewContact = { phone: "", firstName: "", lastName: "", company: "", email: "", notes: "" };

const formatDur = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL DIAL TAB
// ─────────────────────────────────────────────────────────────────────────────
function ManualDialTab() {
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

  const { data: recentCallsRaw, refetch: refetchRecentCalls } = trpc.calls.myCalls.useQuery({ limit: 8 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentCalls: any[] = useMemo(
    () => Array.isArray(recentCallsRaw) ? recentCallsRaw : (recentCallsRaw as { items?: unknown[] })?.items ?? [],
    [recentCallsRaw],
  );

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

  // Auto-end on SIP error (487, 404, etc.)
  useEffect(() => {
    if (!webrtcOn) return;
    if (rtc.callState === "ended" && (callStatus === "connected" || callStatus === "dialing")) {
      if (rtc.error) setCallError(rtc.error);
      setCallStatus("ended");
      if (timerRef.current) clearInterval(timerRef.current);
      finalizeRecording().catch(() => {});
      if (activeCallId) updateStatusMutation.mutate({ id: activeCallId, status: "completed" });
      refetchRecentCalls();
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

  // Instant Save & Next
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
    setTimeout(() => refetchRecentCalls(), 1000);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getCallIcon = (call: any) => {
    const s = call?.status || "";
    if (s === "connected" || s === "completed") return <Phone className="w-3 h-3 text-green-400" />;
    if (s === "no_answer" || s === "failed")    return <PhoneMissed className="w-3 h-3 text-red-400" />;
    if (call?.type === "inbound")               return <PhoneIncoming className="w-3 h-3 text-blue-400" />;
    return <Phone className="w-3 h-3 text-gray-400" />;
  };

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

      {/* Controls row (idle only) */}
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

      {/* 3-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* ── Left: Last Calls + Queue ── */}
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Last Calls</p>
            {recentCalls.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-6">No recent calls</p>
            ) : (
              <div className="space-y-1">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {recentCalls.map((call: any) => (
                  <div key={call.id}
                    className="flex items-center gap-2 px-2 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 cursor-pointer transition-colors"
                    onClick={() => { if (callStatus === "idle" && call.toNumber) { setPhoneNumber(call.toNumber); setAddMode(true); } }}
                    title={callStatus === "idle" ? "Click to redial" : ""}
                  >
                    <div className="shrink-0">{getCallIcon(call)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">
                        {call.lead?.firstName
                          ? `${call.lead.firstName}${call.lead.lastName ? " " + call.lead.lastName : ""}`
                          : call.lead?.companyName || call.toNumber || "Unknown"}
                      </p>
                      <p className="text-[11px] text-gray-500 font-mono truncate">{call.toNumber}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {call.duration > 0 && <p className="text-[10px] text-gray-500 font-mono">{formatDur(call.duration)}</p>}
                      {call.disposition?.label && <p className="text-[10px] text-gray-600 truncate max-w-[56px]">{call.disposition.label}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {leads.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-800">
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

            <div className="border-t border-gray-800 pt-3 space-y-2">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Automation</p>
              <TogglePill on={autoRecord} onToggle={handleAutoRecordToggle} label={autoRecord ? "🔴 Auto Record ON" : "Auto Record OFF"} activeColor="bg-red-500" />
              {autoRecord && recorder.isRecording && <p className="text-xs text-red-400 px-1">● Recording in progress…</p>}
              <TogglePill on={autoCall} onToggle={() => setAutoCall((v) => !v)} label={autoCall ? "⚡ Auto Calling ON" : "Auto Calling OFF"} />
              {autoCall && <p className="text-xs text-green-400 px-1">After saving, the next lead dials automatically.</p>}
            </div>

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

// ─────────────────────────────────────────────────────────────────────────────
// AUTO CAMPAIGN TAB
// ─────────────────────────────────────────────────────────────────────────────
function AutoCampaignTab() {
  const { user } = useAuth();
  const companyId = user?.companyId || 1;

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused]   = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "connected" | "disposition">("idle");
  const [duration, setDuration]   = useState(0);
  const [callNotes, setCallNotes] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [activeCallId, setActiveCallId] = useState<number | null>(null);
  const [callError, setCallError]       = useState<string | null>(null);
  // Inline lead editing — tracks unsaved edits per field key (reset on disposition)
  const [editedLead, setEditedLead] = useState<Record<string, string>>({});

  const recorder = useCallRecorder();
  const [isMuted, setIsMuted]                       = useState(false);
  const [savedRecordingDataUrl, setSavedRecordingDataUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration]   = useState(0);

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
  const { data: dispositions = [] }  = trpc.calls.dispositions.useQuery({ companyId });
  const campIdVal = parseInt(selectedCampaignId) || 0;
  const { data: campaignProgress, refetch: refetchProgress } = trpc.campaign.progress.useQuery({ id: campIdVal }, { enabled: !!selectedCampaignId });
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

  // Auto-dial removed — user clicks Call to dial each lead (power-dialer style)

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

  useEffect(() => { recorder.setMicMuted(isMuted); if (webrtcOn) rtc.setMuted(isMuted); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isMuted]);

  const getLeadValue = (key: string): string => {
    if (key in editedLead) return editedLead[key];
    if (!currentLead) return "";
    if (key.startsWith("cf:")) {
      const v = (currentLead.customFields as Record<string, unknown> | undefined)?.[key.slice(3)];
      return v == null ? "" : String(v);
    }
    return String((currentLead as Record<string, unknown>)[key] ?? "");
  };
  const setLeadValue = (key: string, val: string) => setEditedLead((p) => ({ ...p, [key]: val }));
  const saveLeadField = (key: string) => {
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
    setCallStatus("idle"); setDuration(0); setCallNotes(""); setActiveCallId(null); setCallError(null);
    recorder.resetRecording(); setSavedRecordingDataUrl(null); setRecordingDuration(0); setIsMuted(false); setEditedLead({});
    refetchProgress(); setTimeout(() => refetchNextLead(), 500);
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
    if (cat === "no_answer") return <XCircle className="w-4 h-4" />;
    if (cat === "machine" || cat === "voicemail") return <Radio className="w-4 h-4" />;
    if (cat === "wrong_number") return <Hash className="w-4 h-4" />;
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
        {/* Caller ID */}
        <Select value={selectedNumber} onValueChange={setSelectedNumber}>
          <SelectTrigger className="h-9 w-40 bg-gray-800 border-gray-600 text-white text-sm [&>span]:truncate">
            <SelectValue placeholder="Caller ID" />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-600 text-white">
            {callerNumbers.length ? callerNumbers.map((n) => <SelectItem key={n.value} value={n.value} className="font-mono">{n.value}</SelectItem>) : <SelectItem value="none" disabled>Configure in Settings</SelectItem>}
          </SelectContent>
        </Select>

        {!isRunning ? (
          <>
            <select value={selectedCampaignId} onChange={(e) => setSelectedCampaignId(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-md px-3 py-2 text-white text-sm h-9">
              <option value="">Select campaign...</option>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(campaigns as any[]).filter((c) => c.type === "auto").map((c: any) => <option key={c.id} value={c.id.toString()}>{c.name}</option>)}
            </select>

            {/* Field selection — configure which lead fields to show before starting */}
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
                    <p className="text-xs font-semibold text-gray-100 px-2 py-1.5 sticky top-0 bg-gray-800 border-b border-gray-700 mb-1">
                      Lead fields to display
                    </p>
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
              ? <Button className="bg-green-600 hover:bg-green-700 h-9" onClick={resumeDialer}><Play className="w-4 h-4 mr-2" /> Resume</Button>
              : <Button variant="outline" className="border-amber-600/30 text-amber-400 hover:bg-amber-600/20 h-9" onClick={pauseDialer}><Pause className="w-4 h-4 mr-2" /> Pause</Button>}
            <Button variant="outline" className="border-red-600/30 text-red-400 hover:bg-red-600/20 h-9" onClick={stopDialer}><PhoneOff className="w-4 h-4 mr-2" /> Stop</Button>
          </>
        )}
      </div>

      {/* Progress */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400"><List className="w-4 h-4 inline mr-1" />Progress: {progressCompleted.toLocaleString()} / {progressTotal.toLocaleString()} leads</span>
            <span className="text-sm font-medium text-white">{progressPercentage}%</span>
          </div>
          <Progress value={progressPercentage} className="h-3 bg-gray-800" />
        </CardContent>
      </Card>

      {isRunning && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Lead Info — inline editable fields ── */}
          <Card className="text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm bg-gray-900 border-gray-800">
            <div className="px-6 space-y-4">
              {/* Header */}
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

              {/* Inline editable fields — saves on blur */}
              {currentLead ? (
                <div className="space-y-2 overflow-y-auto max-h-[340px]">
                  {displayFields.map((fk) => {
                    const f = allDisplayFields.find((x) => x.key === fk);
                    if (!f) return null;
                    return (
                      <div key={fk}>
                        <label className="text-xs font-medium text-gray-400">{f.label}</label>
                        {fk === "notes" ? (
                          <Textarea
                            value={getLeadValue(fk)}
                            onChange={(e) => setLeadValue(fk, e.target.value)}
                            onBlur={() => saveLeadField(fk)}
                            placeholder={f.label}
                            className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-600 mt-0.5 text-sm min-h-[55px]"
                          />
                        ) : (
                          <Input
                            value={getLeadValue(fk)}
                            onChange={(e) => setLeadValue(fk, e.target.value)}
                            onBlur={() => saveLeadField(fk)}
                            placeholder={f.label}
                            className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-600 mt-0.5 text-sm h-8"
                          />
                        )}
                      </div>
                    );
                  })}
                  {displayFields.length === 0 && (
                    <p className="text-xs text-gray-500">No fields selected. Use Fields ▾ before starting.</p>
                  )}
                  {updateLeadMutation.isPending && (
                    <p className="text-xs text-blue-400">Saving…</p>
                  )}
                </div>
              ) : (
                <p className="text-center text-gray-500 text-sm py-4">Waiting for next pending campaign lead…</p>
              )}
            </div>
          </Card>

          {/* Call Interface */}
          <Card className="text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm bg-gray-900 border-gray-800">
            <div className="px-6 space-y-3">

              {/* ── IDLE: dial pad (matches screenshot) ── */}
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

                      {/* Number display */}
                      <Input
                        value={currentLead?.phone || ""}
                        readOnly
                        className="bg-gray-950 border-gray-600 text-white text-center text-lg font-mono placeholder:text-gray-500 cursor-default"
                      />

                      {/* Dial pad */}
                      <div className="grid grid-cols-3 gap-1.5">
                        {["1","2","3","4","5","6","7","8","9","*","0","#"].map((d) => (
                          <button key={d}
                            className="h-12 rounded-lg bg-gray-800 text-white font-medium text-lg hover:bg-gray-700 active:bg-gray-600 transition-colors border border-gray-700/50">
                            {d}
                          </button>
                        ))}
                      </div>

                      {callError && (
                        <div className="text-sm rounded-lg px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20">{callError}</div>
                      )}

                      {/* Call button */}
                      <Button
                        className="w-full h-12 bg-green-600 hover:bg-green-700 text-white text-base font-semibold"
                        onClick={triggerAutoDialCall}
                        disabled={!currentLead?.phone}
                      >
                        <PhoneCall className="w-5 h-5 mr-2" /> Call
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <div className="w-14 h-14 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-3">
                        <Phone className="w-7 h-7 text-gray-600" />
                      </div>
                      <p className="text-gray-500 text-sm">All leads in this campaign have been dialed.</p>
                    </div>
                  )}
                </>
              )}

              {/* ── CALLING ── */}
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

              {/* ── CONNECTED ── */}
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
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                      </span>
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

                  <Textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="Call notes…" className="bg-gray-800 border-gray-700 text-white min-h-[60px]" />
                  <Button className="w-full bg-red-600 hover:bg-red-700 h-11 font-semibold" onClick={handleEndCall}>
                    <PhoneOff className="w-4 h-4 mr-2" /> End Call
                  </Button>
                </div>
              )}

              {/* ── DISPOSITION ── */}
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

                  {/* Recording playback */}
                  {recorder.audioUrl && (
                    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                          <Disc className="w-3.5 h-3.5 text-red-400" /> Recording ({formatDur(recordingDuration)})
                        </p>
                        <a href={recorder.audioUrl} download={`call-${activeCallId ?? "call"}.webm`} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                          <Download className="w-3 h-3" /> Download
                        </a>
                      </div>
                      <audio controls src={recorder.audioUrl} className="w-full h-9" />
                    </div>
                  )}

                  {/* Call notes */}
                  <Textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="Call notes…" className="bg-gray-800 border-gray-700 text-white min-h-[55px] text-sm" />

                  {/* Disposition buttons — all visible, no scroll */}
                  <div>
                    <p className="text-sm font-semibold text-gray-100 mb-2">Select Call Result</p>
                    <div className="grid grid-cols-2 gap-2">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(dispositions as any[]).map((disp) => (
                        <Button
                          key={disp.id}
                          size="sm"
                          onClick={() => handleDisposition(disp.id.toString())}
                          className="bg-gray-800 hover:bg-gray-700 text-white justify-start h-10 border border-gray-700 hover:border-gray-500 transition-colors"
                        >
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

          {/* Stats + Automation */}
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

      {!isRunning && (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-12 text-center">
            <Radio className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Auto Dialer Ready</h3>
            <p className="text-gray-400 mb-4 max-w-md mx-auto">Select a campaign and click Start to begin automated calling.</p>
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

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE — tabbed wrapper
// ─────────────────────────────────────────────────────────────────────────────
export default function AutoDialerPage() {
  const [mode, setMode] = useState<"manual" | "auto">("manual");

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Tab header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Dialer</h1>
          <p className="text-xs text-gray-500 mt-0.5">Manual or automated campaign calling</p>
        </div>
        <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setMode("manual")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "manual" ? "bg-blue-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            Manual Dial
          </button>
          <button
            onClick={() => setMode("auto")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "auto" ? "bg-blue-600 text-white shadow" : "text-gray-400 hover:text-white"
            }`}
          >
            Auto Campaign
          </button>
        </div>
      </div>

      {mode === "manual" ? <ManualDialTab /> : <AutoCampaignTab />}
    </div>
  );
}
