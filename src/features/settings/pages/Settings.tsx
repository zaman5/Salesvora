import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Phone,
  Save,
  Trash2,
  Edit,
  Radio,
  CheckCircle,
  XCircle,
  Loader2,
  Plus,
  X,
  PhoneCall,
  PhoneIncoming,
  Globe,
  Server,
  Zap,
  Copy,
  Check,
  HelpCircle,
  ShieldCheck,
  Layers,
} from "lucide-react";

type CredentialForm = {
  phoneNumber: string;
  sipUsername: string;
  sipPassword: string;
  apiKey: string;
  sipHost: string;
  connectionId: string;
  enabled: boolean;
};

const EMPTY_FORM: CredentialForm = {
  phoneNumber: "",
  sipUsername: "",
  sipPassword: "",
  apiKey: "",
  sipHost: "",
  connectionId: "",
  enabled: true,
};

type SignalWireForm = {
  space: string;
  projectId: string;
  apiToken: string;
  sipCredential: string;
  defaultCallerId: string;
  inboundGreeting: string;
  inboundForwardSip: string;
  inboundForwardNumber: string;
  webrtcEnabled: boolean;
  enabled: boolean;
};

const EMPTY_SIGNALWIRE_FORM: SignalWireForm = {
  space: "salesvora.signalwire.com",
  projectId: "",
  apiToken: "",
  sipCredential: "livekit-agent@salesvora-d164507f1250.sip.signalwire.com",
  defaultCallerId: "",
  inboundGreeting: "Thanks for calling SalesVora. Connecting you now.",
  inboundForwardSip: "",
  inboundForwardNumber: "",
  webrtcEnabled: true,
  enabled: false,
};

type TestState = "idle" | "loading" | "ok" | "error";
type TestResult = {
  outgoing: TestState;
  incoming: TestState;
  outgoingMessage: string;
  incomingMessage: string;
};

type DisplayEntry = {
  id: number;
  number: string;
  label?: string;
  status: "active" | "inactive";
  synthetic?: boolean;
};

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "superadmin";

  const [activeTab, setActiveTab] = useState<"signalwire" | "telnyx">("signalwire");

  // Telephony provider status & queries
  const providerQuery = trpc.integration.getTelephonyProvider.useQuery(undefined, { enabled: isAdmin });
  const setActiveProviderMutation = trpc.integration.setActiveTelephonyProvider.useMutation({
    onSuccess: () => {
      providerQuery.refetch();
    },
  });

  // Telnyx queries & mutations
  const telnyxQuery = trpc.integration.getTelnyx.useQuery(undefined, { enabled: isAdmin });
  const numbersQuery = trpc.integration.listPhoneNumbers.useQuery(undefined, { enabled: isAdmin });

  const testTelnyxMutation = trpc.integration.testTelnyx.useMutation();
  const saveTelnyxMutation = trpc.integration.saveTelnyx.useMutation({
    onSuccess: () => {
      telnyxQuery.refetch();
      numbersQuery.refetch();
      providerQuery.refetch();
    },
  });
  const addPhoneMutation = trpc.integration.addPhoneNumber.useMutation({
    onSuccess: () => numbersQuery.refetch(),
  });
  const updatePhoneNumberMutation = trpc.integration.updatePhoneNumber.useMutation({
    onSuccess: () => numbersQuery.refetch(),
  });
  const removePhoneMutation = trpc.integration.removePhoneNumber.useMutation({
    onSuccess: () => numbersQuery.refetch(),
  });

  // SignalWire queries & mutations
  const signalwireQuery = trpc.integration.getSignalWire.useQuery(undefined, { enabled: isAdmin });
  const saveSignalWireMutation = trpc.integration.saveSignalWire.useMutation({
    onSuccess: () => {
      signalwireQuery.refetch();
      providerQuery.refetch();
    },
  });
  const testSignalWireMutation = trpc.integration.testSignalWire.useMutation();

  const [swForm, setSwForm] = useState<SignalWireForm>(EMPTY_SIGNALWIRE_FORM);
  const [swStatus, setSwStatus] = useState<{ type: "idle" | "ok" | "error"; message: string }>({
    type: "idle",
    message: "",
  });
  const [swTestResult, setSwTestResult] = useState<{
    status: TestState;
    message: string;
    numbersCount?: number;
  }>({
    status: "idle",
    message: "",
  });

  // Sync SignalWire form with fetched data
  useEffect(() => {
    if (signalwireQuery.data) {
      const d = signalwireQuery.data;
      setSwForm({
        space: d.space || "salesvora.signalwire.com",
        projectId: d.projectId || "",
        apiToken: "",
        sipCredential: d.sipCredential || "livekit-agent@salesvora-d164507f1250.sip.signalwire.com",
        defaultCallerId: d.defaultCallerId || "",
        inboundGreeting: d.inboundGreeting || "Thanks for calling SalesVora. Connecting you now.",
        inboundForwardSip: d.inboundForwardSip || "",
        inboundForwardNumber: d.inboundForwardNumber || "",
        webrtcEnabled: d.webrtcEnabled ?? true,
        enabled: d.enabled ?? false,
      });
    }
  }, [signalwireQuery.data]);

  // Set default active tab according to active provider
  useEffect(() => {
    if (providerQuery.data?.activeProvider) {
      setActiveTab(providerQuery.data.activeProvider);
    }
  }, [providerQuery.data?.activeProvider]);

  // Telnyx repair actions
  const [repairResult, setRepairResult] = useState<{ ok: boolean; message: string } | null>(null);
  const repairVoiceMutation = trpc.integration.repairVoiceSetup.useMutation({
    onSuccess: (res) => {
      setRepairResult(res);
      telnyxQuery.refetch();
    },
    onError: (err) => setRepairResult({ ok: false, message: err.message }),
  });

  const [inboundResult, setInboundResult] = useState<{ ok: boolean; message: string } | null>(null);
  const repairInboundMutation = trpc.integration.repairInboundSetup.useMutation({
    onSuccess: (res) => {
      setInboundResult(res);
      telnyxQuery.refetch();
    },
    onError: (err) => setInboundResult({ ok: false, message: err.message }),
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CredentialForm>(EMPTY_FORM);
  const [testResult, setTestResult] = useState<TestResult>({
    outgoing: "idle",
    incoming: "idle",
    outgoingMessage: "",
    incomingMessage: "",
  });
  const [saveStatus, setSaveStatus] = useState<{ type: "idle" | "ok" | "error"; message: string }>({
    type: "idle",
    message: "",
  });

  // Display list of numbers
  const phoneNumbers: DisplayEntry[] = useMemo(() => {
    const real: DisplayEntry[] = (numbersQuery.data ?? []).map((n: any) => ({
      id: n.id,
      number: n.number,
      label: n.label ?? n.name,
      status: n.status as "active" | "inactive",
    }));

    const telnyxNumber = telnyxQuery.data?.defaultCallerId?.trim();
    const telnyxUsername = telnyxQuery.data?.sipUsername?.trim();

    if (telnyxNumber && !real.some((n) => n.number === telnyxNumber)) {
      real.unshift({
        id: 0,
        number: telnyxNumber,
        label: telnyxUsername || undefined,
        status: telnyxQuery.data?.enabled ? "active" : "inactive",
        synthetic: true,
      });
    }

    return real;
  }, [numbersQuery.data, telnyxQuery.data]);

  // Pre-populate Telnyx form when editing
  useEffect(() => {
    if (editingId === null || !telnyxQuery.data) return;
    const saved = telnyxQuery.data;

    if (editingId === 0) {
      setForm({
        phoneNumber: saved.defaultCallerId || "",
        sipUsername: saved.sipUsername || "",
        sipPassword: "",
        apiKey: "",
        sipHost: saved.sipHost || "",
        connectionId: saved.connectionId || "",
        enabled: saved.enabled ?? true,
      });
    } else {
      const num = (numbersQuery.data ?? []).find((n: any) => n.id === editingId) as any;
      setForm({
        phoneNumber: num?.number || saved.defaultCallerId || "",
        sipUsername: num?.label ?? num?.name ?? saved.sipUsername ?? "",
        sipPassword: "",
        apiKey: "",
        sipHost: saved.sipHost || "",
        connectionId: saved.connectionId || "",
        enabled: saved.enabled ?? true,
      });
    }
  }, [editingId, telnyxQuery.data, numbersQuery.data]);

  const isTelnyxFormComplete =
    form.phoneNumber.trim() !== "" &&
    form.sipUsername.trim() !== "" &&
    (form.sipPassword.trim() !== "" || (editingId !== null && !!telnyxQuery.data?.hasSipPassword)) &&
    (form.apiKey.trim() !== "" || !!telnyxQuery.data?.hasApiKey);

  const handleTelnyxTest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setTestResult({
      outgoing: "loading",
      incoming: "loading",
      outgoingMessage: "Connecting to Telnyx…",
      incomingMessage: "Verifying SIP registration…",
    });
    try {
      const res = await testTelnyxMutation.mutateAsync({ apiKey: form.apiKey || undefined });
      if (res.ok) {
        setTestResult({
          outgoing: "ok",
          incoming: "ok",
          outgoingMessage: `Outgoing ready — ${res.connections.length} connection(s) found`,
          incomingMessage: "Incoming verified — SIP credentials accepted",
        });
      } else {
        setTestResult({
          outgoing: "error",
          incoming: "error",
          outgoingMessage: res.message || "Outgoing test failed",
          incomingMessage: "Could not verify incoming — check SIP credentials",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setTestResult({
        outgoing: "error",
        incoming: "error",
        outgoingMessage: msg,
        incomingMessage: "Could not verify incoming",
      });
    }
  };

  const handleTelnyxSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      await saveTelnyxMutation.mutateAsync({
        apiKey: form.apiKey || undefined,
        connectionId: form.connectionId,
        connectionName: form.sipUsername,
        defaultCallerId: form.phoneNumber,
        sipUsername: form.sipUsername,
        sipPassword: form.sipPassword || undefined,
        sipHost: form.sipHost,
        webrtcEnabled: true,
        enabled: form.enabled,
      });

      if (editingId === null || editingId === 0) {
        await addPhoneMutation.mutateAsync({
          number: form.phoneNumber,
          label: form.sipUsername,
        });
      } else {
        await updatePhoneNumberMutation.mutateAsync({
          id: editingId,
          label: form.sipUsername,
        });
      }

      setSaveStatus({ type: "ok", message: "Credential saved successfully." });
      setTimeout(() => {
        closeForm();
        setSaveStatus({ type: "idle", message: "" });
      }, 1200);
    } catch (err) {
      setSaveStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to save." });
    }
  };

  const handleSignalWireTest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSwTestResult({
      status: "loading",
      message: "Testing SignalWire Space & Project authentication…",
    });
    try {
      const res = await testSignalWireMutation.mutateAsync({
        space: swForm.space,
        projectId: swForm.projectId,
        apiToken: swForm.apiToken || undefined,
      });

      if (res.ok) {
        setSwTestResult({
          status: "ok",
          message: `Connected successfully to ${res.data.space}! Found ${res.data.phoneNumbersCount} phone number(s).`,
          numbersCount: res.data.phoneNumbersCount,
        });
      } else {
        setSwTestResult({
          status: "error",
          message: res.message || "Connection failed to SignalWire.",
        });
      }
    } catch (err) {
      setSwTestResult({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to connect to SignalWire.",
      });
    }
  };

  const handleSignalWireSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      await saveSignalWireMutation.mutateAsync({
        space: swForm.space,
        projectId: swForm.projectId,
        apiToken: swForm.apiToken || undefined,
        sipCredential: swForm.sipCredential,
        defaultCallerId: swForm.defaultCallerId,
        inboundGreeting: swForm.inboundGreeting,
        inboundForwardSip: swForm.inboundForwardSip,
        inboundForwardNumber: swForm.inboundForwardNumber,
        webrtcEnabled: swForm.webrtcEnabled,
        enabled: swForm.enabled,
      });

      if (swForm.defaultCallerId && !phoneNumbers.some((p) => p.number === swForm.defaultCallerId)) {
        await addPhoneMutation.mutateAsync({
          number: swForm.defaultCallerId,
          label: `SignalWire (${swForm.space})`,
        });
      }

      setSwStatus({ type: "ok", message: "SignalWire configuration saved successfully." });
      setTimeout(() => setSwStatus({ type: "idle", message: "" }), 2500);
    } catch (err) {
      setSwStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to save SignalWire settings." });
    }
  };

  const openEdit = (id: number) => {
    setEditingId(id);
    setShowForm(true);
    setTestResult({ outgoing: "idle", incoming: "idle", outgoingMessage: "", incomingMessage: "" });
    setSaveStatus({ type: "idle", message: "" });
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTestResult({ outgoing: "idle", incoming: "idle", outgoingMessage: "", incomingMessage: "" });
  };

  const activeProvider = providerQuery.data?.activeProvider || "telnyx";
  const isSwActive = activeProvider === "signalwire";
  const isTelnyxActive = activeProvider === "telnyx";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Layers className="w-6 h-6 text-blue-500" />
          Telephony & Phone Service Settings
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          Manage your cloud telephony providers (<span className="font-semibold text-blue-600 dark:text-blue-400">SignalWire</span> and <span className="font-semibold text-green-600 dark:text-green-400">Telnyx</span>), configure SIP trunks, and switch active engines.
        </p>
      </div>

      {user && (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm">
          <div className="w-9 h-9 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-400 font-semibold">
            {(user.name || user.email || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-gray-900 dark:text-white truncate">
              Signed in as <span className="font-semibold">{user.name || user.email}</span>
            </p>
            <p className="text-xs text-gray-500 truncate">
              {user.email}{user.email ? " · " : ""}
              <span className="uppercase tracking-wide text-gray-500 dark:text-gray-400">{user.role}</span>
            </p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Active Session
          </span>
        </div>
      )}

      {/* ── Active Telephony Provider Switcher Banner ── */}
      {isAdmin && (
        <Card className="border-blue-500/30 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2 text-gray-900 dark:text-white">
                  <Zap className="w-4 h-4 text-blue-500" />
                  Active Telephony Engine
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Select which provider powers live outbound calls, inbound routing, and SMS messaging.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Current Engine:</span>
                <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-blue-600 text-white shadow-sm">
                  {activeProvider}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* SignalWire Engine Option */}
              <div
                onClick={() => setActiveProviderMutation.mutate({ provider: "signalwire" })}
                className={`relative flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  isSwActive
                    ? "border-blue-600 bg-white dark:bg-gray-900 shadow-md ring-2 ring-blue-500/20"
                    : "border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isSwActive ? "bg-blue-600 text-white" : "bg-blue-600/10 text-blue-500"
                  }`}>
                    <Globe className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-gray-900 dark:text-white">SignalWire</p>
                      {isSwActive && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 px-2 py-0.5 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {signalwireQuery.data?.space || "salesvora.signalwire.com"}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    isSwActive ? "border-blue-600 bg-blue-600" : "border-gray-400"
                  }`}>
                    {isSwActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                </div>
              </div>

              {/* Telnyx Engine Option */}
              <div
                onClick={() => setActiveProviderMutation.mutate({ provider: "telnyx" })}
                className={`relative flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  isTelnyxActive
                    ? "border-green-600 bg-white dark:bg-gray-900 shadow-md ring-2 ring-green-500/20"
                    : "border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isTelnyxActive ? "bg-green-600 text-white" : "bg-green-600/10 text-green-500"
                  }`}>
                    <Server className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-gray-900 dark:text-white">Telnyx</p>
                      {isTelnyxActive && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400 px-2 py-0.5 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {telnyxQuery.data?.connectionName || "SIP Trunking & WebRTC"}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    isTelnyxActive ? "border-green-600 bg-green-600" : "border-gray-400"
                  }`}>
                    {isTelnyxActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Navigation Tabs between SignalWire and Telnyx ── */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("signalwire")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === "signalwire"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          <Globe className="w-4 h-4" />
          SignalWire Settings
          {signalwireQuery.data?.enabled && (
            <span className="w-2 h-2 rounded-full bg-emerald-300" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("telnyx")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === "telnyx"
              ? "bg-green-600 text-white shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          <Server className="w-4 h-4" />
          Telnyx SIP Trunk
          {telnyxQuery.data?.enabled && (
            <span className="w-2 h-2 rounded-full bg-emerald-300" />
          )}
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────
          SIGNALWIRE TAB
      ────────────────────────────────────────────────────────────────────── */}
      {activeTab === "signalwire" && (
        <div className="space-y-6">
          {!isAdmin ? (
            <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
              <CardContent className="py-10 text-center text-gray-500">
                <Globe className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Superadmin access required to configure SignalWire telephony settings.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2 text-gray-900 dark:text-white">
                        <Globe className="w-5 h-5 text-blue-500" />
                        SignalWire Credentials & Calling Setup
                        {signalwireQuery.data?.enabled && (
                          <span className="ml-2 px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-500/20">
                            Enabled
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        Connect SalesVora to your SignalWire Space (<code className="font-mono text-blue-600 dark:text-blue-400">salesvora.signalwire.com</code>) for PSTN calling, WebRTC, and SMS.
                      </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleSignalWireTest}
                        disabled={testSignalWireMutation.isPending || !swForm.projectId}
                        className="border-gray-300 dark:border-gray-700 text-xs font-medium"
                      >
                        {testSignalWireMutation.isPending ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing…</>
                        ) : (
                          <><Radio className="w-3.5 h-3.5 mr-1.5 text-blue-500" /> Test Connection</>
                        )}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleSignalWireSave}
                        disabled={saveSignalWireMutation.isPending}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                      >
                        {saveSignalWireMutation.isPending ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</>
                        ) : (
                          <><Save className="w-3.5 h-3.5 mr-1.5" /> Save Settings</>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <form onSubmit={handleSignalWireSave} className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Space URL */}
                      <div>
                        <Label className="text-gray-700 dark:text-gray-300 text-sm font-medium">
                          SignalWire Space <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          value={swForm.space}
                          onChange={(e) => setSwForm({ ...swForm, space: e.target.value })}
                          autoComplete="off"
                          placeholder="salesvora.signalwire.com"
                          className="bg-gray-50 dark:bg-gray-800/60 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1 text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">Your Space domain (e.g. salesvora.signalwire.com)</p>
                      </div>

                      {/* Project ID */}
                      <div>
                        <Label className="text-gray-700 dark:text-gray-300 text-sm font-medium">
                          Project ID <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          value={swForm.projectId}
                          onChange={(e) => setSwForm({ ...swForm, projectId: e.target.value })}
                          autoComplete="username"
                          placeholder="6e1caf1e-238f-4ab3-b618-d164507f1250"
                          className="bg-gray-50 dark:bg-gray-800/60 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1 text-sm font-mono"
                        />
                        <p className="text-xs text-gray-500 mt-1">From SignalWire dashboard → API Credentials → Project ID</p>
                      </div>

                      {/* API Token */}
                      <div>
                        <Label className="text-gray-700 dark:text-gray-300 text-sm font-medium">
                          API Token <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          value={swForm.apiToken}
                          onChange={(e) => setSwForm({ ...swForm, apiToken: e.target.value })}
                          placeholder={
                            signalwireQuery.data?.hasApiToken
                              ? `Saved: ${signalwireQuery.data.apiTokenPreview} (type to change)`
                              : "PTxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          }
                          className="bg-gray-50 dark:bg-gray-800/60 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1 text-sm font-mono"
                        />
                        {signalwireQuery.data?.hasApiToken && (
                          <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Token stored securely server-side. Leave blank to keep existing.
                          </p>
                        )}
                      </div>

                      {/* Default Caller ID */}
                      <div>
                        <Label className="text-gray-700 dark:text-gray-300 text-sm font-medium">
                          Default Caller ID (Phone Number)
                        </Label>
                        <Input
                          value={swForm.defaultCallerId}
                          onChange={(e) => setSwForm({ ...swForm, defaultCallerId: e.target.value })}
                          autoComplete="tel"
                          placeholder="+15550002222"
                          className="bg-gray-50 dark:bg-gray-800/60 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1 text-sm font-mono"
                        />
                        <p className="text-xs text-gray-500 mt-1">Purchased SignalWire number (E.164 format) for caller ID</p>
                      </div>

                      {/* SIP Credential URI */}
                      <div>
                        <Label className="text-gray-700 dark:text-gray-300 text-sm font-medium">
                          SIP Credential URI (LiveKit / Agent Bridge)
                        </Label>
                        <Input
                          value={swForm.sipCredential}
                          onChange={(e) => setSwForm({ ...swForm, sipCredential: e.target.value })}
                          placeholder="livekit-agent@salesvora-d164507f1250.sip.signalwire.com"
                          className="bg-gray-50 dark:bg-gray-800/60 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1 text-sm font-mono"
                        />
                        <p className="text-xs text-gray-500 mt-1">SIP endpoint for routing calls to agent session</p>
                      </div>

                      {/* Inbound Call Greeting */}
                      <div>
                        <Label className="text-gray-700 dark:text-gray-300 text-sm font-medium">
                          Inbound Call Greeting (Text-to-Speech)
                        </Label>
                        <Input
                          value={swForm.inboundGreeting}
                          onChange={(e) => setSwForm({ ...swForm, inboundGreeting: e.target.value })}
                          placeholder="Thanks for calling SalesVora. Connecting you now."
                          className="bg-gray-50 dark:bg-gray-800/60 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1 text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">Spoken via cXML &lt;Say&gt; when a customer dials in</p>
                      </div>
                    </div>

                    {/* Toggles */}
                    <div className="border-t border-gray-200 dark:border-gray-800 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                        <div>
                          <Label className="text-gray-800 dark:text-gray-200 text-sm font-medium">Enable SignalWire Telephony</Label>
                          <p className="text-xs text-gray-500">Allow placing & receiving calls via SignalWire</p>
                        </div>
                        <Switch
                          checked={swForm.enabled}
                          onCheckedChange={(v) => setSwForm({ ...swForm, enabled: v })}
                        />
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                        <div>
                          <Label className="text-gray-800 dark:text-gray-200 text-sm font-medium">In-App Browser Calling (WebRTC)</Label>
                          <p className="text-xs text-gray-500">Enable agents to dial directly in the CRM tab</p>
                        </div>
                        <Switch
                          checked={swForm.webrtcEnabled}
                          onCheckedChange={(v) => setSwForm({ ...swForm, webrtcEnabled: v })}
                        />
                      </div>
                    </div>

                    {/* Live Test Results */}
                    {swTestResult.status !== "idle" && (
                      <div className={`p-3.5 rounded-xl border text-sm flex items-start gap-3 ${
                        swTestResult.status === "ok"
                          ? "bg-green-500/10 border-green-500/20 text-green-500"
                          : swTestResult.status === "error"
                          ? "bg-red-500/10 border-red-500/20 text-red-500"
                          : "bg-blue-500/10 border-blue-500/20 text-blue-500"
                      }`}>
                        {swTestResult.status === "loading" && <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />}
                        {swTestResult.status === "ok" && <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                        {swTestResult.status === "error" && <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-xs uppercase tracking-wide">
                            {swTestResult.status === "ok" ? "Connection Verified" : swTestResult.status === "error" ? "Connection Failed" : "Testing…"}
                          </p>
                          <p className="text-xs mt-0.5 opacity-90">{swTestResult.message}</p>
                        </div>
                      </div>
                    )}

                    {/* Save Status Message */}
                    {swStatus.type !== "idle" && (
                      <div className={`p-3 rounded-lg border text-xs font-medium ${
                        swStatus.type === "ok"
                          ? "bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400 border-green-500/20"
                          : "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400 border-red-500/20"
                      }`}>
                        {swStatus.message}
                      </div>
                    )}
                  </form>
                </CardContent>
              </Card>

              {/* SignalWire Webhooks & Configuration Guide Card */}
              <SignalWireWebhookEndpointsCard />
            </>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────
          TELNYX TAB
      ────────────────────────────────────────────────────────────────────── */}
      {activeTab === "telnyx" && (
        <div className="space-y-6">
          {/* SIP 480 repair */}
          {isAdmin && telnyxQuery.data?.hasApiKey && (
            <Card className="bg-white dark:bg-gray-900 border-amber-800/40">
              <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Calls failing with SIP 480 "Destination temporarily unavailable"?</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    This usually means a connection has no Outbound Voice Profile. Click to check and fix all Salesvora connections automatically.
                  </p>
                  {repairResult && (
                    <p className={`text-xs mt-2 ${repairResult.ok ? "text-green-400" : "text-red-400"}`}>
                      {repairResult.ok ? "✓ " : "✗ "}{repairResult.message}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                  onClick={() => { setRepairResult(null); repairVoiceMutation.mutate(); }}
                  disabled={repairVoiceMutation.isPending}
                >
                  {repairVoiceMutation.isPending
                    ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Checking…</>
                    : "Fix Outbound Calling"}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Inbound repair */}
          {isAdmin && telnyxQuery.data?.hasApiKey && (
            <Card className="bg-white dark:bg-gray-900 border-sky-800/40">
              <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Not receiving client texts or incoming calls?</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Telnyx numbers don't route inbound traffic to Salesvora by default. Click to point every
                    number's SMS webhook and voice connection at this app automatically.
                  </p>
                  {inboundResult && (
                    <p className={`text-xs mt-2 ${inboundResult.ok ? "text-green-400" : "text-red-400"}`}>
                      {inboundResult.ok ? "✓ " : "✗ "}{inboundResult.message}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  className="bg-sky-600 hover:bg-sky-700 text-white shrink-0"
                  onClick={() => { setInboundResult(null); repairInboundMutation.mutate({ origin: window.location.origin }); }}
                  disabled={repairInboundMutation.isPending}
                >
                  {repairInboundMutation.isPending
                    ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Fixing…</>
                    : "Fix Inbound (SMS + Calls)"}
                </Button>
              </CardContent>
            </Card>
          )}

          {!isAdmin ? (
            <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
              <CardContent className="py-10 text-center text-gray-500">
                <Radio className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Superadmin access required to manage SIP trunk settings.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-gray-900 dark:text-white text-base flex items-center gap-2">
                  <Server className="w-5 h-5 text-green-400" />
                  Telnyx SIP Trunk Configuration
                  {telnyxQuery.data?.enabled && telnyxQuery.data?.connectionId && (
                    <span className="ml-2 px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-500/20">
                      Connected
                    </span>
                  )}
                </CardTitle>
                {!showForm && (
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                    onClick={() => {
                      setShowForm(true);
                      setEditingId(null);
                      setForm(EMPTY_FORM);
                      setSaveStatus({ type: "idle", message: "" });
                      setTestResult({ outgoing: "idle", incoming: "idle", outgoingMessage: "", incomingMessage: "" });
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add Telnyx Number
                  </Button>
                )}
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Saved credentials list */}
                {!showForm && (
                  <>
                    {numbersQuery.isLoading || telnyxQuery.isLoading ? (
                      <div className="flex items-center justify-center py-8 text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
                      </div>
                    ) : phoneNumbers.length === 0 ? (
                      <div className="text-center py-10 text-gray-500">
                        <Phone className="w-9 h-9 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No phone credentials yet.</p>
                        <p className="text-xs mt-1">Click "Add Telnyx Number" to configure your first SIP trunk line.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {phoneNumbers.map((n) => (
                          <div
                            key={n.id}
                            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100/30 dark:bg-gray-800/30"
                          >
                            <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0">
                              <Phone className="w-4 h-4 text-blue-400" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-gray-900 dark:text-white font-medium">{n.number}</p>
                              {n.label && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{n.label}</p>
                              )}
                            </div>

                            <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${
                              n.status === "active"
                                ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                                : "bg-gray-200 dark:bg-gray-700 text-gray-500"
                            }`}>
                              {n.status === "active" ? "Active" : "Inactive"}
                            </span>

                            <Button
                              variant="ghost" size="sm"
                              onClick={() => openEdit(n.id)}
                              className="h-8 w-8 p-0 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white shrink-0"
                              title="Edit"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>

                            {!n.synthetic && (
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => removePhoneMutation.mutate({ id: n.id })}
                                disabled={removePhoneMutation.isPending}
                                className="h-8 w-8 p-0 text-gray-500 dark:text-gray-400 hover:text-red-400 shrink-0"
                                title="Remove"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Add / Edit form */}
                {showForm && (
                  <form onSubmit={handleTelnyxSave} className="space-y-5 border border-gray-300 dark:border-gray-700 rounded-xl p-5 bg-gray-100/20 dark:bg-gray-800/20">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {editingId === null ? "New Phone Credential" : "Edit Phone Credential"}
                      </p>
                      <Button type="button" variant="ghost" size="sm" onClick={closeForm} className="h-7 w-7 p-0 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-gray-600 dark:text-gray-300 text-sm">
                          Phone Number <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          value={form.phoneNumber}
                          onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                          autoComplete="tel"
                          placeholder="+15550001111"
                          disabled={editingId !== null && editingId > 0}
                          className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1 disabled:opacity-60"
                        />
                        <p className="text-xs text-gray-500 mt-1">E.164 format — e.g. +15550001111</p>
                      </div>

                      <div>
                        <Label className="text-gray-600 dark:text-gray-300 text-sm">
                          SIP Username <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          value={form.sipUsername}
                          onChange={(e) => setForm({ ...form, sipUsername: e.target.value })}
                          autoComplete="username"
                          placeholder="e.g. salesvora_agent"
                          className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1"
                        />
                        <p className="text-xs text-gray-500 mt-1">From your Telnyx Credential Connection</p>
                      </div>

                      <div>
                        <Label className="text-gray-600 dark:text-gray-300 text-sm">
                          SIP Password <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          value={form.sipPassword}
                          onChange={(e) => setForm({ ...form, sipPassword: e.target.value })}
                          placeholder={
                            editingId !== null && telnyxQuery.data?.hasSipPassword
                              ? "saved — type to change"
                              : "SIP credential password"
                          }
                          className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1"
                        />
                        {editingId !== null && telnyxQuery.data?.hasSipPassword && (
                          <p className="text-xs text-green-400 mt-1">Password saved. Leave blank to keep it.</p>
                        )}
                      </div>

                      <div>
                        <Label className="text-gray-600 dark:text-gray-300 text-sm">
                          Telnyx API Key <span className="text-red-400">*</span>
                        </Label>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          value={form.apiKey}
                          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                          placeholder={
                            telnyxQuery.data?.hasApiKey
                              ? `Saved: ${telnyxQuery.data.apiKeyPreview}`
                              : "KEYxxxxxxxxxxxxxxxxxxxxxxxx"
                          }
                          className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1"
                        />
                        {telnyxQuery.data?.hasApiKey && (
                          <p className="text-xs text-green-400 mt-1">API key saved. Leave blank to keep it.</p>
                        )}
                      </div>

                      <div>
                        <Label className="text-gray-600 dark:text-gray-300 text-sm">SIP Host</Label>
                        <Input
                          value={form.sipHost}
                          onChange={(e) => setForm({ ...form, sipHost: e.target.value })}
                          autoComplete="off"
                          placeholder="yourname.sip.telnyx.com"
                          className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1"
                        />
                      </div>

                      <div>
                        <Label className="text-gray-600 dark:text-gray-300 text-sm">Connection ID</Label>
                        <Input
                          value={form.connectionId}
                          onChange={(e) => setForm({ ...form, connectionId: e.target.value })}
                          autoComplete="off"
                          placeholder="e.g. 2985974513046390685"
                          className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1"
                        />
                        <p className="text-xs text-gray-500 mt-1">From Telnyx → Voice → SIP Connections</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-gray-600 dark:text-gray-300 text-sm">Enable for outbound calls</Label>
                        <p className="text-xs text-gray-500">Routes real calls through this SIP connection</p>
                      </div>
                      <Switch
                        checked={form.enabled}
                        onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                      />
                    </div>

                    {/* Test section */}
                    {isTelnyxFormComplete && (
                      <div className="border-t border-gray-300 dark:border-gray-700 pt-5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">Test Phone Number</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Verify outgoing and incoming connectivity before saving
                            </p>
                          </div>
                          <Button
                            type="button"
                            onClick={handleTelnyxTest}
                            disabled={testTelnyxMutation.isPending}
                            className="bg-green-600 hover:bg-green-700 shrink-0"
                            size="sm"
                          >
                            {testTelnyxMutation.isPending ? (
                              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Testing…</>
                            ) : "Test Connection"}
                          </Button>
                        </div>

                        {(testResult.outgoing !== "idle" || testResult.incoming !== "idle") && (
                          <div className="space-y-2">
                            <TestResultRow state={testResult.outgoing} label="Outgoing Call"
                              message={testResult.outgoingMessage}
                              icon={<PhoneCall className="w-4 h-4 shrink-0" />} />
                            <TestResultRow state={testResult.incoming} label="Incoming Call"
                              message={testResult.incomingMessage}
                              icon={<PhoneIncoming className="w-4 h-4 shrink-0" />} />
                          </div>
                        )}
                      </div>
                    )}

                    {saveStatus.type !== "idle" && (
                      <div className={`text-sm rounded-md px-3 py-2 border ${
                        saveStatus.type === "ok"
                          ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400 border-green-500/20"
                          : "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400 border-red-500/20"
                      }`}>
                        {saveStatus.message}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button
                        type="submit"
                        disabled={
                          saveTelnyxMutation.isPending ||
                          addPhoneMutation.isPending ||
                          updatePhoneNumberMutation.isPending
                        }
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Save className="w-4 h-4 mr-1" />
                        {saveTelnyxMutation.isPending || addPhoneMutation.isPending || updatePhoneNumberMutation.isPending
                          ? "Saving…"
                          : "Save Credential"}
                      </Button>
                      <Button type="button" variant="outline" onClick={closeForm} className="border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          {isAdmin && <InboundSmsWebhookCard telnyxData={telnyxQuery.data} onSaved={() => telnyxQuery.refetch()} />}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SignalWire Webhooks & Setup Guide Card
// ─────────────────────────────────────────────────────────────────────────────
function SignalWireWebhookEndpointsCard() {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://api.salesvora.com";
  const voiceWebhookUrl = `${origin}/api/webhooks/signalwire/voice`;
  const statusCallbackUrl = `${origin}/api/webhooks/signalwire/status`;
  const smsWebhookUrl = `${origin}/api/webhooks/signalwire/sms`;

  const [copiedVoice, setCopiedVoice] = useState(false);
  const [copiedStatus, setCopiedStatus] = useState(false);
  const [copiedSms, setCopiedSms] = useState(false);

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 text-gray-900 dark:text-white">
          <ShieldCheck className="w-5 h-5 text-indigo-500" />
          SignalWire Webhook URLs & Setup Checklist
        </CardTitle>
        <CardDescription className="text-xs">
          Configure these endpoints in your SignalWire Dashboard under <strong>Phone Numbers → Edit Number → Voice & Fax</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Webhooks Box */}
        <div className="space-y-3">
          {/* 1. Voice Inbound Webhook */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <PhoneIncoming className="w-3.5 h-3.5 text-blue-500" />
                Inbound Voice Webhook (cXML Script URL)
              </Label>
              <span className="text-[10px] font-mono bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 px-1.5 py-0.5 rounded">
                POST · cXML Script
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={voiceWebhookUrl}
                className="bg-gray-50 dark:bg-gray-800/80 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(voiceWebhookUrl, setCopiedVoice)}
                className="shrink-0 text-xs border-gray-300 dark:border-gray-700"
              >
                {copiedVoice ? <Check className="w-3.5 h-3.5 text-green-500 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                {copiedVoice ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Set in SignalWire: <em>When a Call Comes In</em> → choose <strong>cXML Script</strong> → <strong>POST</strong> → paste this URL.
            </p>
          </div>

          {/* 2. Status Callback Webhook */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-indigo-500" />
                Call Status Callback URL
              </Label>
              <span className="text-[10px] font-mono bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 px-1.5 py-0.5 rounded">
                POST · Call Log & Recording
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={statusCallbackUrl}
                className="bg-gray-50 dark:bg-gray-800/80 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(statusCallbackUrl, setCopiedStatus)}
                className="shrink-0 text-xs border-gray-300 dark:border-gray-700"
              >
                {copiedStatus ? <Check className="w-3.5 h-3.5 text-green-500 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                {copiedStatus ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Set in SignalWire: <em>Call Status Changes</em> → <strong>POST</strong> → paste this URL to sync duration & recording.
            </p>
          </div>

          {/* 3. Inbound SMS Webhook */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-emerald-500" />
                Inbound SMS Webhook URL
              </Label>
              <span className="text-[10px] font-mono bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 px-1.5 py-0.5 rounded">
                POST · Inbound SMS
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={smsWebhookUrl}
                className="bg-gray-50 dark:bg-gray-800/80 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(smsWebhookUrl, setCopiedSms)}
                className="shrink-0 text-xs border-gray-300 dark:border-gray-700"
              >
                {copiedSms ? <Check className="w-3.5 h-3.5 text-green-500 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                {copiedSms ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Set in SignalWire: <em>Messaging Settings → When a Message Comes In</em> → <strong>POST</strong>.
            </p>
          </div>
        </div>

        {/* Quick Reference Checklist based on setup guide */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5" /> SignalWire Go-Live Checklist
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
            <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">1. Exit Trial Mode</p>
                <p className="text-[11px] mt-0.5 text-gray-500">Verify mobile number and add card in SignalWire dashboard banner.</p>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">2. Buy Phone Number</p>
                <p className="text-[11px] mt-0.5 text-gray-500">Local ($0.50/mo) or Toll-Free ($0.80/mo) in Phone Numbers → Buy.</p>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">3. Configure Inbound cXML</p>
                <p className="text-[11px] mt-0.5 text-gray-500">Paste the Voice Inbound URL above into number settings.</p>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">4. In-App WebRTC</p>
                <p className="text-[11px] mt-0.5 text-gray-500">Browser dialer issues subscriber tokens automatically for calling.</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InboundSmsWebhookCard({
  telnyxData,
  onSaved,
}: {
  telnyxData: { connectionId?: string; enabled?: boolean; webhookPublicKey?: string } | undefined;
  onSaved: () => void;
}) {
  const saveMutation = trpc.integration.saveTelnyx.useMutation({ onSuccess: onSaved });
  const [publicKey, setPublicKey] = useState("");
  const [status, setStatus] = useState<{ type: "idle" | "ok" | "error"; message: string }>({ type: "idle", message: "" });

  useEffect(() => {
    if (telnyxData?.webhookPublicKey) setPublicKey(telnyxData.webhookPublicKey);
  }, [telnyxData?.webhookPublicKey]);

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/telnyx` : "/api/webhooks/telnyx";

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      await saveMutation.mutateAsync({
        connectionId: telnyxData?.connectionId || "",
        enabled: telnyxData?.enabled ?? false,
        webhookPublicKey: publicKey.trim(),
      });
      setStatus({ type: "ok", message: "Webhook public key saved." });
      setTimeout(() => setStatus({ type: "idle", message: "" }), 2000);
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to save." });
    }
  };

  return (
    <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white text-base flex items-center gap-2">
          <PhoneIncoming className="w-5 h-5 text-blue-400" />
          Telnyx Inbound SMS Webhook
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            To receive replies from clients, add this URL as the webhook for your Telnyx Messaging Profile
            (Telnyx portal → Messaging → your profile → Inbound Settings → Webhook URL):
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={webhookUrl} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 shrink-0"
              onClick={() => navigator.clipboard?.writeText(webhookUrl)}
            >
              Copy
            </Button>
          </div>
          <div>
            <Label className="text-gray-600 dark:text-gray-300 text-xs">Telnyx Public Key (optional, verifies webhook signatures)</Label>
            <Input
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="From Telnyx portal → Account Settings → Public Key"
              className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white mt-1 text-xs font-mono"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Without this, inbound messages are still accepted but not signature-verified. Set it once you've
              copied your account's public key from the Telnyx portal.
            </p>
          </div>
          <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-700" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
          {status.type !== "idle" && (
            <p className={`text-xs ${status.type === "ok" ? "text-green-400" : "text-red-400"}`}>{status.message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function TestResultRow({
  state, label, message, icon,
}: {
  state: TestState; label: string; message: string; icon: React.ReactElement;
}) {
  const colorClass =
    state === "ok"    ? "bg-green-500/10 border-green-500/20 text-green-400" :
    state === "error" ? "bg-red-500/10 border-red-500/20 text-red-400" :
                        "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300";
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-md border text-sm ${colorClass}`}>
      <span className="mt-0.5">{icon}</span>
      <span className="mt-0.5">
        {state === "loading" && <Loader2 className="w-4 h-4 animate-spin" />}
        {state === "ok"      && <CheckCircle className="w-4 h-4" />}
        {state === "error"   && <XCircle className="w-4 h-4" />}
      </span>
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs opacity-80 mt-0.5">{message}</p>
      </div>
    </div>
  );
}
