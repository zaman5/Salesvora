import { useState, useEffect, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCallRecorder } from "@/hooks/useCallRecorder";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
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
} from "lucide-react";

export default function AutoDialerPage() {
  const { user } = useAuth();
  const companyId = user?.companyId || 1;

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "connected" | "disposition">("idle");
  const [duration, setDuration] = useState(0);
  const [callNotes, setCallNotes] = useState("");
  const [, setSelectedDisposition] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Active call ID and Campaign Lead ID
  const [activeCallId, setActiveCallId] = useState<number | null>(null);

  // ── Editable Client Details (live during call) ──
  const [isEditingLead, setIsEditingLead] = useState(false);
  const [leadEdit, setLeadEdit] = useState<Record<string, string>>({});
  const [leadSaveMsg, setLeadSaveMsg] = useState<string | null>(null);

  // ── Call Recording ──
  const recorder = useCallRecorder();
  const [isMuted, setIsMuted] = useState(false);
  const [savedRecordingDataUrl, setSavedRecordingDataUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);

  // Queries
  const { data: campaigns = [], refetch: refetchCampaigns } = trpc.campaign.list.useQuery();
  const { data: dispositions = [] } = trpc.calls.dispositions.useQuery({ companyId });

  // Get campaign progress metrics
  const campIdVal = parseInt(selectedCampaignId) || 0;
  const { data: campaignProgress, refetch: refetchProgress } = trpc.campaign.progress.useQuery(
    { id: campIdVal },
    { enabled: !!selectedCampaignId }
  );

  // Get next lead in the campaign
  const { data: nextCampaignLead, refetch: refetchNextLead } = trpc.campaign.getNextLead.useQuery(
    { campaignId: campIdVal },
    { enabled: isRunning && !isPaused && callStatus === "idle" }
  );

  // Mutations
  const startCampaignMutation = trpc.campaign.start.useMutation();
  const pauseCampaignMutation = trpc.campaign.pause.useMutation();
  const initiateCallMutation = trpc.calls.initiate.useMutation();
  const updateStatusMutation = trpc.calls.updateStatus.useMutation();
  const updateLeadStatusMutation = trpc.campaign.updateLeadStatus.useMutation();
  const endCallMutation = trpc.calls.endCall.useMutation();
  const saveRecordingMutation = trpc.calls.saveRecording.useMutation();
  const updateLeadMutation = trpc.lead.update.useMutation();

  const triggerAutoDialCall = async () => {
    if (!nextCampaignLead?.lead) return;
    setCallStatus("calling");
    try {
      const activeCall = await initiateCallMutation.mutateAsync({
        leadId: nextCampaignLead.lead.id,
        campaignId: campIdVal,
        companyId,
        toNumber: nextCampaignLead.lead.phone,
        type: "auto",
      });
      setActiveCallId(activeCall.id);

      await updateLeadStatusMutation.mutateAsync({
        campaignLeadId: nextCampaignLead.id,
        status: "in_progress",
        callerId: user?.id,
      });

      // Simulate connection
      setTimeout(async () => {
        setCallStatus("connected");
        setDuration(0);
        await updateStatusMutation.mutateAsync({
          id: activeCall.id,
          status: "connected",
        });
      }, 2000);
    } catch (err) {
      console.error("Failed to execute autodial call:", err);
      setCallStatus("idle");
    }
  };

  // Synchronize state when campaigns load
  useEffect(() => {
    const autoCamps = campaigns.filter((c: any) => c.type === "auto");
    if (autoCamps.length > 0 && !selectedCampaignId) {
      setSelectedCampaignId(autoCamps[0].id.toString());
    }
  }, [campaigns, selectedCampaignId]);

  // Call timer
  useEffect(() => {
    if (callStatus === "connected" && !isPaused) {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callStatus, isPaused]);

  // Automated dial cycle hook
  useEffect(() => {
    if (isRunning && !isPaused && callStatus === "idle" && nextCampaignLead) {
      // Initiate call to next lead
      triggerAutoDialCall();
    }
  }, [isRunning, isPaused, callStatus, nextCampaignLead]);

  // Keep recorder mic in sync with the Mute button
  useEffect(() => {
    recorder.setMicMuted(isMuted);
  }, [isMuted, recorder]);

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

  const cancelEditLead = () => {
    setIsEditingLead(false);
    setLeadEdit({});
  };

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

  const handleToggleRecording = async () => {
    if (recorder.status === "recording" || recorder.status === "paused") {
      const result = await recorder.stopRecording();
      if (result) {
        setSavedRecordingDataUrl(result.dataUrl);
        setRecordingDuration(result.duration);
      }
    } else {
      await recorder.startRecording();
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
    if (savedRecordingDataUrl) {
      return { dataUrl: savedRecordingDataUrl, duration: recordingDuration };
    }
    return null;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startDialer = async () => {
    if (!selectedCampaignId) return;
    setIsRunning(true);
    setIsPaused(false);
    setCallStatus("idle");
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
    try {
      await pauseCampaignMutation.mutateAsync({ id: campIdVal });
      refetchCampaigns();
    } catch (err) {
      console.error("Failed to pause campaign:", err);
    }
  };

  const resumeDialer = async () => {
    setIsPaused(false);
    try {
      await startCampaignMutation.mutateAsync({ id: campIdVal });
      refetchCampaigns();
      refetchNextLead();
    } catch (err) {
      console.error("Failed to resume campaign:", err);
    }
  };

  const handleEndCall = async () => {
    setCallStatus("disposition");
    if (timerRef.current) clearInterval(timerRef.current);
    // Auto-stop and keep the recording when the call ends
    await finalizeRecording();
    if (activeCallId) {
      try {
        await updateStatusMutation.mutateAsync({
          id: activeCallId,
          status: "completed",
        });
      } catch (err) {
        console.error("Failed to update status on end call:", err);
      }
    }
  };

  const handleDisposition = async (dispId: string) => {
    setSelectedDisposition(dispId);
    if (activeCallId && nextCampaignLead) {
      try {
        // Map disposition category to lead status update
        const selectedDispObj = dispositions.find((d: any) => d.id.toString() === dispId);
        let leadStatus: "completed" | "failed" | "skipped" | "callback" = "completed";
        if (selectedDispObj) {
          if (selectedDispObj.category === "no_answer" || selectedDispObj.category === "wrong_number") {
            leadStatus = "failed";
          } else if (selectedDispObj.category === "callback") {
            leadStatus = "callback";
          }
        }

        const rec = await finalizeRecording();
        await endCallMutation.mutateAsync({
          id: activeCallId,
          dispositionId: parseInt(dispId),
          duration,
          notes: callNotes,
          callDescription: callNotes,
          recordingUrl: rec?.dataUrl || undefined,
        });
        if (rec?.dataUrl) {
          await saveRecordingMutation.mutateAsync({
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

    // Reset and query next lead
    setCallStatus("idle");
    setDuration(0);
    setCallNotes("");
    setSelectedDisposition(null);
    setActiveCallId(null);
    recorder.resetRecording();
    setSavedRecordingDataUrl(null);
    setRecordingDuration(0);
    setIsMuted(false);
    setIsEditingLead(false);
    setLeadEdit({});

    // Refresh campaign metrics and next lead
    refetchProgress();
    setTimeout(() => {
      refetchNextLead();
    }, 500);
  };

  const stopDialer = async () => {
    setIsRunning(false);
    setIsPaused(false);
    setCallStatus("idle");
    setDuration(0);
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

  // Render disposition icon helper
  const getDispIcon = (category: string) => {
    switch (category) {
      case "connected":
      case "converted":
        return <CheckCircle2 className="w-4 h-4" />;
      case "no_answer":
        return <XCircle className="w-4 h-4" />;
      case "machine":
      case "voicemail":
        return <Radio className="w-4 h-4" />;
      default:
        return <Ban className="w-4 h-4" />;
    }
  };

  const progressTotal = campaignProgress?.total || 0;
  const progressCompleted = campaignProgress?.completed || 0;
  const progressPercentage = progressTotal > 0 ? Math.round((progressCompleted / progressTotal) * 100) : 0;
  const currentLead = nextCampaignLead?.lead || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Auto Dialer</h1>
          <p className="text-gray-400 mt-1">Automated calling with sequential lead processing</p>
        </div>
        {!isRunning ? (
          <div className="flex gap-2">
            <select
              value={selectedCampaignId}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
              className="bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-white text-sm"
            >
              <option value="">Select campaign...</option>
              {campaigns.filter((c: any) => c.type === "auto").map((c: any) => (
                <option key={c.id} value={c.id.toString()}>{c.name}</option>
              ))}
            </select>
            <Button 
              className="bg-green-600 hover:bg-green-700" 
              onClick={startDialer}
              disabled={!selectedCampaignId}
            >
              <Play className="w-4 h-4 mr-2" /> Start
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            {isPaused ? (
              <Button className="bg-green-600 hover:bg-green-700" onClick={resumeDialer}>
                <Play className="w-4 h-4 mr-2" /> Resume
              </Button>
            ) : (
              <Button variant="outline" className="border-amber-600/30 text-amber-400 hover:bg-amber-600/20" onClick={pauseDialer}>
                <Pause className="w-4 h-4 mr-2" /> Pause
              </Button>
            )}
            <Button variant="outline" className="border-red-600/30 text-red-400 hover:bg-red-600/20" onClick={stopDialer}>
              <PhoneOff className="w-4 h-4 mr-2" /> Stop
            </Button>
          </div>
        )}
      </div>

      {/* Progress */}
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
          {/* Lead Info */}
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
                    <Button
                      variant="outline"
                      size="sm"
                      title="Edit client details"
                      className="border-gray-700 text-gray-300 h-7 px-2"
                      onClick={startEditLead}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
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
                  {currentLead.companyName && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <Building className="w-4 h-4 text-gray-500" /> {currentLead.companyName}
                    </div>
                  )}
                  {currentLead.designation && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <Briefcase className="w-4 h-4 text-gray-500" /> {currentLead.designation}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-gray-300">
                    <Phone className="w-4 h-4 text-gray-500" /> {currentLead.phone}
                  </div>
                  {currentLead.email && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <Mail className="w-4 h-4 text-gray-500" /> {currentLead.email}
                    </div>
                  )}
                  {currentLead.city && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <MapPin className="w-4 h-4 text-gray-500" /> {currentLead.city}
                    </div>
                  )}
                  {currentLead.customFields && Object.keys(currentLead.customFields).length > 0 && (
                    <div className="pt-2 border-t border-gray-800 space-y-1">
                      <p className="text-[10px] font-medium text-gray-500 uppercase">Custom Client Details</p>
                      {Object.entries(currentLead.customFields).map(([k, v]: [string, any]) => (
                        <div key={k} className="flex justify-between text-xs">
                          <span className="text-gray-500">{k}</span>
                          <span className="text-gray-300">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {currentLead.notes && (
                    <div className="pt-2 border-t border-gray-800">
                      <p className="text-[10px] font-medium text-gray-500 uppercase mb-0.5">Client Record Notes</p>
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

          {/* Call Interface */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5">
              {callStatus === "calling" && (
                <div className="text-center py-8 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto animate-pulse">
                    <Phone className="w-8 h-8 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">Auto-dialing...</p>
                    <p className="text-gray-400">{currentLead?.phone}</p>
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
                  </div>

                  {/* Recording indicator */}
                  {recorder.isRecording && (
                    <div className="flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg py-1.5 px-3">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                      </span>
                      <span className="text-xs font-semibold text-red-400 tracking-wider">REC</span>
                      <span className="text-xs font-mono text-red-300">{formatDuration(recorder.recordingTime)}</span>
                    </div>
                  )}
                  {recorder.error && (
                    <p className="text-xs text-red-400 text-center bg-red-500/10 border border-red-500/30 rounded-md py-1.5 px-2">{recorder.error}</p>
                  )}

                  {/* Call controls: Mute + Record */}
                  <div className="flex justify-center gap-3">
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
                      title={recorder.isRecording ? "Stop recording" : "Record call"}
                      className={`border-gray-700 ${recorder.isRecording ? "text-red-400 bg-red-500/10 border-red-700 animate-pulse" : "text-gray-300"}`}
                      onClick={handleToggleRecording}
                    >
                      {recorder.isRecording ? <Square className="w-4 h-4 fill-current" /> : <Disc className="w-4 h-4" />}
                      <span className="ml-1.5 text-xs">{recorder.isRecording ? "Stop Rec" : "Record"}</span>
                    </Button>
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
                  </div>

                  {/* Recording playback */}
                  {recorder.audioUrl && (
                    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                          <Disc className="w-3.5 h-3.5 text-red-400" /> Call Recording ({formatDuration(recordingDuration)})
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
                      <p className="text-[10px] text-gray-500">Recording is saved automatically when you select a result.</p>
                    </div>
                  )}

                  <label className="text-sm font-medium text-gray-300">Select Result</label>
                  <div className="grid grid-cols-2 gap-2 max-h-[140px] overflow-y-auto pr-1">
                    {dispositions.map((disp: any) => (
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

          {/* Session Stats */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5 space-y-4">
              <div className="text-center pb-3 border-b border-gray-800">
                <Clock className="w-6 h-6 text-gray-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-white font-mono">{formatDuration(duration)}</p>
                <p className="text-xs text-gray-400">Current Call Duration</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">Campaign Queue Metrics</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Total Leads</span>
                    <span className="text-white font-medium">{progressTotal}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Completed Calls</span>
                    <span className="text-green-400 font-medium">{progressCompleted}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Pending Leads</span>
                    <span className="text-amber-400 font-medium">{campaignProgress?.pending || 0}</span>
                  </div>
                </div>
              </div>
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
            <div className="flex gap-4 justify-center text-sm text-gray-500">
              <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Auto-advance leads</span>
              <span className="flex items-center gap-1"><BarChart3 className="w-4 h-4" /> Track dispositions</span>
              <span className="flex items-center gap-1"><SkipForward className="w-4 h-4" /> Resume from last</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
