import { useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { useCallRecorder } from "@/hooks/useCallRecorder";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bot,
  Plus,
  Play,
  MessageSquare,
  Phone,
  Clock,
  Mic,
  Trash2,
  Pause,
  Zap,
  BookOpen,
  AudioWaveform,
  Square,
  Upload,
  X,
} from "lucide-react";

export default function AIAgentsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [, setTestingAgentId] = useState<number | null>(null);
  const [selectedLogAgentId, setSelectedLogAgentId] = useState<number | null>(null);

  // Form states
  const [newName, setNewName] = useState("");
  const [newVoice, setNewVoice] = useState<"alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer">("alloy");
  const [newLanguage, setNewLanguage] = useState("en");
  const [newGreeting, setNewGreeting] = useState("");
  const [newPrompt, setNewPrompt] = useState("");

  // ── Voice / TTS Provider ──
  const [newProvider, setNewProvider] = useState<"openai" | "elevenlabs" | "cartesia" | "voice_clone">("openai");
  const [newVoiceId, setNewVoiceId] = useState("");
  const [newTtsModel, setNewTtsModel] = useState("");
  const [newLatency, setNewLatency] = useState<"ultra_low" | "low" | "balanced" | "quality">("low");

  // ── Human Voice Cloning (mimicking) ──
  const voiceRecorder = useCallRecorder();
  const [cloneName, setCloneName] = useState("");
  const [cloneSampleDataUrl, setCloneSampleDataUrl] = useState<string | null>(null);

  // ── Knowledge Base ──
  const [kbEntries, setKbEntries] = useState<Array<{ id: string; title: string; content: string }>>([]);
  const [kbTitle, setKbTitle] = useState("");
  const [kbContent, setKbContent] = useState("");

  // TTS model options per provider
  const ttsModelOptions: Record<string, Array<{ value: string; label: string; latencyNote: string }>> = {
    openai: [
      { value: "tts-1", label: "OpenAI TTS-1 (fast)", latencyNote: "~300ms" },
      { value: "tts-1-hd", label: "OpenAI TTS-1-HD (quality)", latencyNote: "~500ms" },
      { value: "gpt-4o-mini-tts", label: "GPT-4o mini TTS", latencyNote: "~250ms" },
    ],
    elevenlabs: [
      { value: "eleven_flash_v2_5", label: "ElevenLabs Flash v2.5 (ultra-low latency)", latencyNote: "~75ms" },
      { value: "eleven_turbo_v2_5", label: "ElevenLabs Turbo v2.5", latencyNote: "~250ms" },
      { value: "eleven_multilingual_v2", label: "ElevenLabs Multilingual v2 (quality)", latencyNote: "~400ms" },
    ],
    cartesia: [
      { value: "sonic-2", label: "Cartesia Sonic-2 (ultra-low latency)", latencyNote: "~40ms" },
      { value: "sonic-turbo", label: "Cartesia Sonic Turbo", latencyNote: "~90ms" },
    ],
    voice_clone: [
      { value: "eleven_flash_v2_5", label: "ElevenLabs Flash v2.5 (clone playback)", latencyNote: "~75ms" },
      { value: "eleven_multilingual_v2", label: "ElevenLabs Multilingual v2 (clone quality)", latencyNote: "~400ms" },
    ],
  };

  // Test simulation state
  const [simulationResult, setSimulationResult] = useState<any>(null);

  // Queries
  const { data: agents = [], refetch: refetchAgents } = trpc.aiAgent.list.useQuery();

  // Load conversations for the selected agent
  const { data: conversations = [], refetch: refetchConversations } = trpc.aiAgent.conversations.useQuery(
    { agentId: selectedLogAgentId || 0 },
    { enabled: selectedLogAgentId !== null }
  );

  // Set default log agent
  useEffect(() => {
    if (agents.length > 0 && selectedLogAgentId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedLogAgentId(agents[0].id);
    }
  }, [agents, selectedLogAgentId]);

  // Mutations
  const createAgentMutation = trpc.aiAgent.create.useMutation({
    onSuccess: () => {
      refetchAgents();
      setShowCreate(false);
      setNewName("");
      setNewVoice("alloy");
      setNewLanguage("en");
      setNewGreeting("");
      setNewPrompt("");
      setNewProvider("openai");
      setNewVoiceId("");
      setNewTtsModel("");
      setNewLatency("low");
      setCloneName("");
      setCloneSampleDataUrl(null);
      voiceRecorder.resetRecording();
      setKbEntries([]);
      setKbTitle("");
      setKbContent("");
    },
  });

  const deleteAgentMutation = trpc.aiAgent.delete.useMutation({
    onSuccess: () => refetchAgents(),
  });

  const updateAgentMutation = trpc.aiAgent.update.useMutation({
    onSuccess: () => refetchAgents(),
  });

  const simulateMutation = trpc.aiAgent.simulate.useMutation({
    onSuccess: (data) => {
      setSimulationResult(data);
      if (selectedLogAgentId) refetchConversations();
    },
  });

  const handleCreateAgent = async () => {
    if (!newName.trim()) return;
    try {
      await createAgentMutation.mutateAsync({
        name: newName,
        voice: newVoice,
        language: newLanguage,
        greeting: newGreeting || undefined,
        systemPrompt: newPrompt || undefined,
        voiceProvider: newProvider,
        voiceId: newVoiceId || undefined,
        ttsModel: newTtsModel || undefined,
        latencyMode: newLatency,
        voiceCloneName: cloneName || undefined,
        voiceCloneSample: cloneSampleDataUrl || undefined,
        knowledgeBase: kbEntries.length > 0 ? kbEntries : undefined,
      });
    } catch (err) {
      console.error("Failed to create AI agent:", err);
    }
  };

  // ── Voice clone recording handlers ──
  const handleToggleVoiceRecording = async () => {
    if (voiceRecorder.status === "recording") {
      const result = await voiceRecorder.stopRecording();
      if (result) setCloneSampleDataUrl(result.dataUrl);
    } else {
      setCloneSampleDataUrl(null);
      await voiceRecorder.startRecording();
    }
  };

  const handleUploadVoiceSample = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      alert("Please upload an audio file (mp3, wav, webm...)");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") setCloneSampleDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // ── Knowledge base handlers ──
  const addKbEntry = () => {
    if (!kbTitle.trim() || !kbContent.trim()) return;
    setKbEntries([...kbEntries, { id: `kb_${Date.now()}`, title: kbTitle.trim(), content: kbContent.trim() }]);
    setKbTitle("");
    setKbContent("");
  };
  const removeKbEntry = (id: string) => setKbEntries(kbEntries.filter((k) => k.id !== id));

  const handleDeleteAgent = async (id: number) => {
    if (!confirm("Are you sure you want to delete this AI voice agent?")) return;
    try {
      await deleteAgentMutation.mutateAsync({ id });
    } catch (err) {
      console.error("Failed to delete AI agent:", err);
    }
  };

  const handleToggleActive = async (id: number, currentActive: boolean) => {
    try {
      await updateAgentMutation.mutateAsync({
        id,
        data: { isActive: !currentActive },
      });
    } catch (err) {
      console.error("Failed to update AI agent active status:", err);
    }
  };

  const handleStartSimulation = async (agentId: number) => {
    setTestingAgentId(agentId);
    setSimulationResult(null);
    setShowTest(true);
    try {
      await simulateMutation.mutateAsync({
        agentId,
        leadId: 1,
        leadName: "Sundar Pichai",
        leadPhone: "+1-555-1010",
      });
    } catch (err) {
      console.error("Failed to simulate AI agent call:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Voice Agents</h1>
          <p className="text-gray-400 mt-1">Manage AI-powered calling agents</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" /> New Agent
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create AI Agent</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-gray-300">Agent Name</Label>
                <Input 
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Sales Assistant" 
                  className="bg-gray-800 border-gray-700 text-white mt-1" 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-300">Voice</Label>
                  <Select value={newVoice} onValueChange={(v: any) => setNewVoice(v)}>
                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="alloy">Alloy</SelectItem>
                      <SelectItem value="echo">Echo</SelectItem>
                      <SelectItem value="fable">Fable</SelectItem>
                      <SelectItem value="onyx">Onyx</SelectItem>
                      <SelectItem value="nova">Nova</SelectItem>
                      <SelectItem value="shimmer">Shimmer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-300">Language</Label>
                  <Select value={newLanguage} onValueChange={setNewLanguage}>
                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                      <SelectItem value="fr">French</SelectItem>
                      <SelectItem value="de">German</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-gray-300">Greeting Message</Label>
                <Textarea
                  value={newGreeting}
                  onChange={(e) => setNewGreeting(e.target.value)}
                  placeholder="Hello! I'm calling from..."
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">System Prompt / Script</Label>
                <Textarea
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="You are a helpful sales assistant. Your goal is to..."
                  className="bg-gray-800 border-gray-700 text-white mt-1 min-h-[100px]"
                />
              </div>
              {/* ─── Voice / TTS Provider ─── */}
              <div className="border border-gray-800 rounded-lg p-3 space-y-3">
                <Label className="text-gray-300 flex items-center gap-1.5">
                  <AudioWaveform className="w-4 h-4 text-purple-400" /> Voice / TTS Provider
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([
                    { key: "openai", label: "OpenAI TTS" },
                    { key: "elevenlabs", label: "ElevenLabs" },
                    { key: "cartesia", label: "Cartesia" },
                    { key: "voice_clone", label: "My Voice Clone" },
                  ] as const).map((pvd) => (
                    <button
                      key={pvd.key}
                      type="button"
                      onClick={() => { setNewProvider(pvd.key); setNewTtsModel(""); }}
                      className={`px-2 py-2 rounded-md text-xs font-medium border transition-colors ${
                        newProvider === pvd.key
                          ? "bg-purple-600/20 border-purple-500 text-purple-300"
                          : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
                      }`}
                    >
                      {pvd.label}
                    </button>
                  ))}
                </div>

                {/* TTS Model per provider */}
                <div>
                  <Label className="text-gray-400 text-xs">TTS Model</Label>
                  <Select value={newTtsModel} onValueChange={setNewTtsModel}>
                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                      <SelectValue placeholder="Select TTS model..." />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      {(ttsModelOptions[newProvider] || []).map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label} — {m.latencyNote}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {(newProvider === "elevenlabs" || newProvider === "cartesia") && (
                  <div>
                    <Label className="text-gray-400 text-xs">
                      {newProvider === "elevenlabs" ? "ElevenLabs Voice ID" : "Cartesia Voice ID"}
                    </Label>
                    <Input
                      value={newVoiceId}
                      onChange={(e) => setNewVoiceId(e.target.value)}
                      placeholder={newProvider === "elevenlabs" ? "e.g., 21m00Tcm4TlvDq8ikWAM" : "e.g., a0e99841-438c-4a64..."}
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                    />
                  </div>
                )}

                {/* ─── Voice Sample: Record via Mic or Upload Audio (all providers) ─── */}
                <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
                    <Label className="text-gray-300 text-xs flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-green-400" />
                      Voice Sample — Record via Mic or Upload Audio
                    </Label>
                    <p className="text-xs text-gray-400">
                      {newProvider === "voice_clone"
                        ? "Feed your own voice — the agent will speak on calls mimicking your voice (powered by ElevenLabs voice cloning). Record at least 30–60 seconds of clear speech for best results."
                        : newProvider === "openai"
                        ? "Attach a voice sample for this agent — record with your mic or upload an audio file. It's saved with the agent as the reference voice. (Note: OpenAI TTS uses its 6 preset voices; for true voice cloning from your sample, switch to ElevenLabs or My Voice Clone.)"
                        : "Attach a reference voice sample — record with your mic or upload an audio file. It's stored with the agent and can be used to create a matching voice on this provider."}
                    </p>
                    <Input
                      value={cloneName}
                      onChange={(e) => setCloneName(e.target.value)}
                      placeholder="Voice sample name (e.g., My Sales Voice)"
                      className="bg-gray-800 border-gray-700 text-white"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={`border-gray-700 ${voiceRecorder.status === "recording" ? "text-red-400 bg-red-500/10 border-red-700 animate-pulse" : "text-gray-300"}`}
                        onClick={handleToggleVoiceRecording}
                      >
                        {voiceRecorder.status === "recording" ? (
                          <><Square className="w-3.5 h-3.5 mr-1 fill-current" /> Stop ({Math.floor(voiceRecorder.recordingTime / 60)}:{(voiceRecorder.recordingTime % 60).toString().padStart(2, "0")})</>
                        ) : (
                          <><Mic className="w-3.5 h-3.5 mr-1" /> Record My Voice</>
                        )}
                      </Button>
                      <label className="cursor-pointer">
                        <span className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium border border-gray-700 text-gray-300 hover:text-white bg-transparent">
                          <Upload className="w-3.5 h-3.5 mr-1" /> Upload Audio
                        </span>
                        <input type="file" accept="audio/*" className="hidden" onChange={handleUploadVoiceSample} />
                      </label>
                    </div>
                    {voiceRecorder.error && <p className="text-xs text-red-400">{voiceRecorder.error}</p>}
                    {cloneSampleDataUrl && (
                      <div className="space-y-1">
                        <audio controls src={cloneSampleDataUrl} className="w-full h-8" />
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-green-400">✓ Voice sample ready — it will be saved with this agent</p>
                          <button
                            type="button"
                            onClick={() => { setCloneSampleDataUrl(null); voiceRecorder.resetRecording(); }}
                            className="text-[10px] text-gray-500 hover:text-red-400 flex items-center gap-0.5"
                          >
                            <X className="w-3 h-3" /> Remove
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              </div>

              {/* ─── Latency Optimization ─── */}
              <div className="border border-gray-800 rounded-lg p-3 space-y-2">
                <Label className="text-gray-300 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-amber-400" /> Latency Mode (response speed focus)
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([
                    { key: "ultra_low", label: "Ultra Low", desc: "<100ms · best for live calls" },
                    { key: "low", label: "Low", desc: "~250ms · recommended" },
                    { key: "balanced", label: "Balanced", desc: "~400ms · good quality" },
                    { key: "quality", label: "Quality", desc: "~600ms · best audio" },
                  ] as const).map((l) => (
                    <button
                      key={l.key}
                      type="button"
                      onClick={() => setNewLatency(l.key)}
                      className={`px-2 py-2 rounded-md text-left border transition-colors ${
                        newLatency === l.key
                          ? "bg-amber-600/20 border-amber-500"
                          : "bg-gray-800 border-gray-700 hover:border-gray-600"
                      }`}
                    >
                      <p className={`text-xs font-medium ${newLatency === l.key ? "text-amber-300" : "text-gray-300"}`}>{l.label}</p>
                      <p className="text-[10px] text-gray-500">{l.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* ─── Knowledge Base ─── */}
              <div className="border border-gray-800 rounded-lg p-3 space-y-2">
                <Label className="text-gray-300 flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-cyan-400" /> Knowledge Base ({kbEntries.length} entries)
                </Label>
                <p className="text-[11px] text-gray-500">
                  Add company info, product details, FAQs, and objection handling — the AI agent uses this knowledge while talking to clients.
                </p>
                {kbEntries.length > 0 && (
                  <div className="space-y-1 max-h-[120px] overflow-y-auto">
                    {kbEntries.map((kb) => (
                      <div key={kb.id} className="flex items-start justify-between bg-gray-800/60 rounded-md px-2 py-1.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white truncate">{kb.title}</p>
                          <p className="text-[10px] text-gray-500 line-clamp-1">{kb.content}</p>
                        </div>
                        <button type="button" onClick={() => removeKbEntry(kb.id)} className="text-gray-500 hover:text-red-400 ml-2">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Input
                  value={kbTitle}
                  onChange={(e) => setKbTitle(e.target.value)}
                  placeholder="Entry title (e.g., Pricing Plans)"
                  className="bg-gray-800 border-gray-700 text-white"
                />
                <Textarea
                  value={kbContent}
                  onChange={(e) => setKbContent(e.target.value)}
                  placeholder="Knowledge content the AI should know..."
                  className="bg-gray-800 border-gray-700 text-white min-h-[60px]"
                />
                <Button type="button" size="sm" variant="outline" className="border-gray-700 text-gray-300" onClick={addKbEntry}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add to Knowledge Base
                </Button>
              </div>

              <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleCreateAgent} disabled={createAgentMutation.isPending}>
                {createAgentMutation.isPending ? "Creating..." : "Create Agent"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent: any) => (
          <Card key={agent.id} className="bg-gray-900 border-gray-800">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">{agent.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge className="bg-gray-700 text-gray-300 text-xs">
                        <Mic className="w-3 h-3 mr-1" />{agent.voice}
                      </Badge>
                      <Badge className="bg-gray-700 text-gray-300 text-xs">{agent.language}</Badge>
                      {agent.voiceProvider && (
                        <Badge className="bg-purple-500/20 text-purple-400 text-xs">
                          {agent.voiceProvider === "voice_clone" ? "Voice Clone" : agent.voiceProvider === "elevenlabs" ? "ElevenLabs" : agent.voiceProvider === "cartesia" ? "Cartesia" : "OpenAI"}
                        </Badge>
                      )}
                      {agent.latencyMode && (
                        <Badge className="bg-amber-500/20 text-amber-400 text-xs">
                          <Zap className="w-3 h-3 mr-0.5" />{agent.latencyMode.replace("_", " ")}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <Badge className={agent.isActive ? "bg-green-500/20 text-green-400" : "bg-gray-500/20 text-gray-400"}>
                  {agent.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>

              <p className="text-sm text-gray-400 mb-3 italic line-clamp-2">{agent.greeting || "No greeting message configured."}</p>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-800/50 rounded p-2 text-center">
                  <p className="text-sm font-semibold text-white">{(agent.totalCalls || 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Calls</p>
                </div>
                <div className="bg-gray-800/50 rounded p-2 text-center">
                  <p className="text-sm font-semibold text-green-400">{(agent.connectedCalls || 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Connected</p>
                </div>
                <div className="bg-gray-800/50 rounded p-2 text-center">
                  <p className="text-sm font-semibold text-white">{agent.avgDuration || "2m 15s"}</p>
                  <p className="text-xs text-gray-500">Avg</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => handleStartSimulation(agent.id)}>
                  <Play className="w-4 h-4 mr-1" /> Test
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => handleDeleteAgent(agent.id)}
                  className="text-gray-400 hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                {agent.isActive ? (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleToggleActive(agent.id, agent.isActive)}
                    className="text-amber-400 hover:text-amber-300 ml-auto"
                  >
                    <Pause className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleToggleActive(agent.id, agent.isActive)}
                    className="text-green-400 hover:text-green-300 ml-auto"
                  >
                    <Play className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {agents.length === 0 && (
          <div className="col-span-2 text-center py-12 text-gray-500">
            No AI agents configured. Click "New Agent" to set up your first AI voice agent.
          </div>
        )}
      </div>

      {/* Recent Conversations */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-purple-400" />
            Recent AI Conversations
          </CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-gray-400 text-xs">Agent filter:</Label>
            <select
              value={selectedLogAgentId || ""}
              onChange={(e) => setSelectedLogAgentId(parseInt(e.target.value) || null)}
              className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white text-xs"
            >
              <option value="">Select agent...</option>
              {agents.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Agent</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Lead ID</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Duration</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Sentiment</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conv: any) => {
                  const agentName = agents.find((a: any) => a.id === conv.agentId)?.name || "AI Agent";
                  return (
                    <tr key={conv.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-3 text-sm text-white flex items-center gap-2">
                        <Bot className="w-4 h-4 text-purple-400" />
                        {agentName}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">Lead #{conv.leadId}</td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {conv.duration}s
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={
                          conv.sentiment === "positive" ? "bg-green-500/20 text-green-400" :
                          conv.sentiment === "negative" ? "bg-red-500/20 text-red-400" :
                          "bg-gray-500/20 text-gray-400"
                        }>
                          {conv.sentiment || "neutral"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className="bg-blue-500/20 text-blue-400">{conv.outcome || "Interested"}</Badge>
                      </td>
                    </tr>
                  );
                })}
                {conversations.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-gray-500">
                      No conversations logged for this agent.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Test Dialog */}
      <Dialog open={showTest} onOpenChange={setShowTest}>
        <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Test AI Agent Simulation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            {simulateMutation.isPending ? (
              <div className="text-center py-12 space-y-3">
                <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto animate-spin border-t-2 border-purple-500" />
                <p className="text-gray-400 text-sm">Initiating simulated voice dialog...</p>
              </div>
            ) : simulationResult ? (
              <div className="space-y-4">
                <div className="bg-gray-800 rounded-lg p-4 space-y-3 max-h-[300px] overflow-y-auto">
                  {simulationResult.transcript?.map((line: any, idx: number) => (
                    <div key={idx} className={`flex items-start gap-2 ${line.speaker === "human" ? "justify-end" : ""}`}>
                      {line.speaker !== "human" && (
                        <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                          <Bot className="w-4 h-4 text-purple-400" />
                        </div>
                      )}
                      <div className={`rounded-lg px-3 py-2 text-sm ${
                        line.speaker === "human" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-200"
                      }`}>
                        {line.text}
                      </div>
                      {line.speaker === "human" && (
                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                          <Phone className="w-4 h-4 text-blue-400" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="bg-gray-800/50 p-3 rounded text-xs space-y-1">
                  <p className="text-gray-400">Call Outcome: <span className="text-white font-medium capitalize">{simulationResult.status}</span></p>
                  <p className="text-gray-400">Sentiment: <span className="text-green-400 font-medium capitalize">{simulationResult.sentiment}</span></p>
                  <p className="text-gray-400">Duration: <span className="text-white font-mono">{simulationResult.duration} seconds</span></p>
                </div>
                <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => setShowTest(false)}>
                  Close Test
                </Button>
              </div>
            ) : (
              <div className="text-center py-4 text-red-400">
                Failed to execute simulation.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
