import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type TestState = "idle" | "loading" | "ok" | "error";
type TestResult = {
  outgoing: TestState;
  incoming: TestState;
  outgoingMessage: string;
  incomingMessage: string;
};

// id = 0 is the sentinel for the Telnyx-config-derived synthetic entry
type DisplayEntry = {
  id: number;
  number: string;
  label?: string;
  status: "active" | "inactive";
  synthetic?: boolean;
};

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const telnyxQuery   = trpc.integration.getTelnyx.useQuery(undefined, { enabled: isAdmin });
  const numbersQuery  = trpc.integration.listPhoneNumbers.useQuery(undefined, { enabled: isAdmin });

  const testTelnyxMutation        = trpc.integration.testTelnyx.useMutation();
  const saveTelnyxMutation        = trpc.integration.saveTelnyx.useMutation({
    onSuccess: () => { telnyxQuery.refetch(); numbersQuery.refetch(); },
  });
  const addPhoneMutation          = trpc.integration.addPhoneNumber.useMutation({
    onSuccess: () => numbersQuery.refetch(),
  });
  const updatePhoneNumberMutation = trpc.integration.updatePhoneNumber.useMutation({
    onSuccess: () => numbersQuery.refetch(),
  });
  const removePhoneMutation       = trpc.integration.removePhoneNumber.useMutation({
    onSuccess: () => numbersQuery.refetch(),
  });

  const [showForm,   setShowForm]   = useState(false);
  // null = new entry | 0 = editing synthetic Telnyx entry | >0 = editing real phoneNumber
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [form,       setForm]       = useState<CredentialForm>(EMPTY_FORM);
  const [testResult, setTestResult] = useState<TestResult>({
    outgoing: "idle", incoming: "idle", outgoingMessage: "", incomingMessage: "",
  });
  const [saveStatus, setSaveStatus] = useState<{ type: "idle" | "ok" | "error"; message: string }>({
    type: "idle", message: "",
  });

  // ── Build display list ─────────────────────────────────────────────────────
  // If the Telnyx config has a defaultCallerId that is not yet stored in the
  // phoneNumbers array (legacy save path), show it as a synthetic row so the
  // user can always see and edit what they configured.
  const phoneNumbers: DisplayEntry[] = useMemo(() => {
    const real: DisplayEntry[] = (numbersQuery.data ?? []).map((n: any) => ({
      id: n.id,
      number: n.number,
      label: n.label ?? n.name,   // backward-compat with old "name" field
      status: n.status as "active" | "inactive",
    }));

    const telnyxNumber   = telnyxQuery.data?.defaultCallerId?.trim();
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

  // ── Pre-populate form when editing ────────────────────────────────────────
  useEffect(() => {
    if (editingId === null || !telnyxQuery.data) return;
    const saved = telnyxQuery.data;

    if (editingId === 0) {
      // Synthetic entry — load straight from Telnyx config
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // Real phoneNumbers entry
      const num = (numbersQuery.data ?? []).find((n: any) => n.id === editingId) as any;
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // ── Form completeness (controls whether Test button appears) ───────────────
  const isFormComplete =
    form.phoneNumber.trim() !== "" &&
    form.sipUsername.trim() !== "" &&
    (form.sipPassword.trim() !== "" || (editingId !== null && !!telnyxQuery.data?.hasSipPassword)) &&
    (form.apiKey.trim() !== "" || !!telnyxQuery.data?.hasApiKey);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleTest = async () => {
    setTestResult({
      outgoing: "loading", incoming: "loading",
      outgoingMessage: "Connecting to Telnyx…",
      incomingMessage: "Verifying SIP registration…",
    });
    try {
      const res = await testTelnyxMutation.mutateAsync({ apiKey: form.apiKey || undefined });
      if (res.ok) {
        setTestResult({
          outgoing: "ok", incoming: "ok",
          outgoingMessage: `Outgoing ready — ${res.connections.length} connection(s) found`,
          incomingMessage: "Incoming verified — SIP credentials accepted",
        });
      } else {
        setTestResult({
          outgoing: "error", incoming: "error",
          outgoingMessage: res.message || "Outgoing test failed",
          incomingMessage: "Could not verify incoming — check SIP credentials",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connection failed";
      setTestResult({
        outgoing: "error", incoming: "error",
        outgoingMessage: msg, incomingMessage: "Could not verify incoming",
      });
    }
  };

  const handleSave = async () => {
    try {
      // 1. Always update the global Telnyx config (API key, SIP creds, connection)
      await saveTelnyxMutation.mutateAsync({
        apiKey:         form.apiKey || undefined,
        connectionId:   form.connectionId,
        connectionName: form.sipUsername,
        defaultCallerId: form.phoneNumber,
        sipUsername:    form.sipUsername,
        sipPassword:    form.sipPassword || undefined,
        sipHost:        form.sipHost,
        webrtcEnabled:  true,
        enabled:        form.enabled,
      });

      // 2a. New credential → create a phoneNumbers entry
      if (editingId === null) {
        await addPhoneMutation.mutateAsync({
          number: form.phoneNumber,
          label:  form.sipUsername,
        });
      }
      // 2b. Synthetic (Telnyx defaultCallerId not yet in phoneNumbers) → create it now
      else if (editingId === 0) {
        await addPhoneMutation.mutateAsync({
          number: form.phoneNumber,
          label:  form.sipUsername,
        });
      }
      // 2c. Real entry → update its label (number is read-only in edit mode)
      else {
        await updatePhoneNumberMutation.mutateAsync({
          id:    editingId,
          label: form.sipUsername,
        });
      }

      setSaveStatus({ type: "ok", message: "Credential saved successfully." });
      setTimeout(() => {
        closeForm();
        setSaveStatus({ type: "idle", message: "" });
      }, 1200);
    } catch (e) {
      setSaveStatus({ type: "error", message: e instanceof Error ? e.message : "Failed to save." });
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 mt-1">Manage your Telnyx SIP Trunk configuration</p>
      </div>

      {user && (
        <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
          <div className="w-9 h-9 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-300 font-semibold">
            {(user.name || user.email || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-white truncate">
              Signed in as <span className="font-semibold">{user.name || user.email}</span>
            </p>
            <p className="text-xs text-gray-500 truncate">
              {user.email}{user.email ? " · " : ""}
              <span className="uppercase tracking-wide text-gray-400">{user.role}</span>
            </p>
          </div>
          <span className="ml-auto flex items-center gap-1 text-xs text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400" /> Active
          </span>
        </div>
      )}

      {!isAdmin ? (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="py-10 text-center text-gray-500">
            <Radio className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Admin access required to manage SIP trunk settings.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Radio className="w-5 h-5 text-green-400" />
              Telnyx SIP Trunk
              {telnyxQuery.data?.enabled && telnyxQuery.data?.connectionId && (
                <span className="ml-2 px-2 py-0.5 rounded text-xs font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
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
                <Plus className="w-4 h-4 mr-1" /> Add Phone Number
              </Button>
            )}
          </CardHeader>

          <CardContent className="space-y-4">

            {/* ── Saved credentials list ── */}
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
                    <p className="text-xs mt-1">Click "Add Phone Number" to configure your first SIP trunk line.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {phoneNumbers.map((n) => (
                      <div
                        key={n.id}
                        className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-800 bg-gray-800/30"
                      >
                        <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0">
                          <Phone className="w-4 h-4 text-blue-400" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium">{n.number}</p>
                          {n.label && (
                            <p className="text-xs text-gray-400 mt-0.5">{n.label}</p>
                          )}
                        </div>

                        <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${
                          n.status === "active"
                            ? "bg-green-500/10 text-green-400"
                            : "bg-gray-700 text-gray-500"
                        }`}>
                          {n.status === "active" ? "Active" : "Inactive"}
                        </span>

                        <Button
                          variant="ghost" size="sm"
                          onClick={() => openEdit(n.id)}
                          className="h-8 w-8 p-0 text-gray-400 hover:text-white shrink-0"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>

                        {/* Don't show delete for synthetic entry — it lives in the Telnyx config */}
                        {!n.synthetic && (
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => removePhoneMutation.mutate({ id: n.id })}
                            disabled={removePhoneMutation.isPending}
                            className="h-8 w-8 p-0 text-gray-400 hover:text-red-400 shrink-0"
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

            {/* ── Add / Edit form ── */}
            {showForm && (
              <div className="space-y-5 border border-gray-700 rounded-xl p-5 bg-gray-800/20">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">
                    {editingId === null ? "New Phone Credential"
                      : editingId === 0 ? "Edit Phone Credential"
                      : "Edit Phone Credential"}
                  </p>
                  <Button variant="ghost" size="sm" onClick={closeForm} className="h-7 w-7 p-0 text-gray-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Phone number — read-only when editing a real entry */}
                  <div>
                    <Label className="text-gray-300 text-sm">
                      Phone Number <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={form.phoneNumber}
                      onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                      placeholder="+15550001111"
                      disabled={editingId !== null && editingId > 0}
                      className="bg-gray-800 border-gray-700 text-white mt-1 disabled:opacity-60"
                    />
                    <p className="text-xs text-gray-500 mt-1">E.164 format — e.g. +15550001111</p>
                  </div>

                  <div>
                    <Label className="text-gray-300 text-sm">
                      SIP Username <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={form.sipUsername}
                      onChange={(e) => setForm({ ...form, sipUsername: e.target.value })}
                      placeholder="e.g. salesvora_agent"
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                    />
                    <p className="text-xs text-gray-500 mt-1">From your Telnyx Credential Connection</p>
                  </div>

                  <div>
                    <Label className="text-gray-300 text-sm">
                      SIP Password <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="password"
                      value={form.sipPassword}
                      onChange={(e) => setForm({ ...form, sipPassword: e.target.value })}
                      placeholder={
                        editingId !== null && telnyxQuery.data?.hasSipPassword
                          ? "saved — type to change"
                          : "SIP credential password"
                      }
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                    />
                    {editingId !== null && telnyxQuery.data?.hasSipPassword && (
                      <p className="text-xs text-green-400 mt-1">Password saved. Leave blank to keep it.</p>
                    )}
                  </div>

                  <div>
                    <Label className="text-gray-300 text-sm">
                      Telnyx API Key <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="password"
                      value={form.apiKey}
                      onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                      placeholder={
                        telnyxQuery.data?.hasApiKey
                          ? `Saved: ${telnyxQuery.data.apiKeyPreview}`
                          : "KEYxxxxxxxxxxxxxxxxxxxxxxxx"
                      }
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                    />
                    {telnyxQuery.data?.hasApiKey && (
                      <p className="text-xs text-green-400 mt-1">API key saved. Leave blank to keep it.</p>
                    )}
                  </div>

                  <div>
                    <Label className="text-gray-300 text-sm">SIP Host</Label>
                    <Input
                      value={form.sipHost}
                      onChange={(e) => setForm({ ...form, sipHost: e.target.value })}
                      placeholder="yourname.sip.telnyx.com"
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-gray-300 text-sm">Connection ID</Label>
                    <Input
                      value={form.connectionId}
                      onChange={(e) => setForm({ ...form, connectionId: e.target.value })}
                      placeholder="e.g. 2985974513046390685"
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                    />
                    <p className="text-xs text-gray-500 mt-1">From Telnyx → Voice → SIP Connections</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-gray-300 text-sm">Enable for outbound calls</Label>
                    <p className="text-xs text-gray-500">Routes real calls through this SIP connection</p>
                  </div>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                  />
                </div>

                {/* Test section — only shown when all required fields are filled */}
                {isFormComplete && (
                  <div className="border-t border-gray-700 pt-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">Test Phone Number</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Verify outgoing and incoming connectivity before saving
                        </p>
                      </div>
                      <Button
                        onClick={handleTest}
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
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : "bg-red-500/10 text-red-400 border-red-500/20"
                  }`}>
                    {saveStatus.message}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={handleSave}
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
                  <Button variant="outline" onClick={closeForm} className="border-gray-700 text-gray-300 hover:text-white">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
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
                        "bg-gray-800 border-gray-700 text-gray-300";
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