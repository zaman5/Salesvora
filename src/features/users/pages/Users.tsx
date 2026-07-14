import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  Shield,
  UserCircle,
  Eye,
  PauseCircle,
  Trash2,
  List,
  PhoneCall,
} from "lucide-react";

type PhoneNumber = { id: number; number: string; label?: string; status: string; assignedTo?: number | null };
type LeadList   = { id: number; name: string; totalLeads?: number };

export default function UsersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const [search, setSearch] = useState("");

  // ── Create dialog state ──
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "", email: "", phone: "", role: "caller" as string,
    unionId: "", dailyCallLimit: 200, password: "",
  });
  const [createPhoneIds, setCreatePhoneIds] = useState<number[]>([]);
  const [createListIds,  setCreateListIds]  = useState<number[]>([]);

  // ── Edit dialog state ──
  const [showEdit, setShowEdit] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editUserData, setEditUserData] = useState({
    name: "", email: "", phone: "", role: "caller" as string,
    dailyCallLimit: 200, password: "",
  });
  const [editPhoneIds,      setEditPhoneIds]      = useState<number[]>([]);
  const [editListIds,       setEditListIds]        = useState<number[]>([]);
  const [editSipUsername,   setEditSipUsername]   = useState("");
  const [editSipPassword,   setEditSipPassword]   = useState("");

  // ── Data queries ──
  const { data: usersList = [], refetch } = trpc.user.list.useQuery(undefined, { enabled: isAdmin });
  const { data: phoneNumbers = [] }        = trpc.integration.listPhoneNumbers.useQuery(undefined, { enabled: isAdmin });
  const { data: allLeadLists = [] }        = trpc.lead.listLists.useQuery(undefined, { enabled: isAdmin });
  const phones    = phoneNumbers as PhoneNumber[];
  const leadLists = allLeadLists as LeadList[];

  // Fetch assigned lists for the user being edited
  const { data: editingUserLists = [] } = trpc.lead.getCallerLists.useQuery(
    { callerId: editingUser?.id ?? 0 },
    { enabled: showEdit && !!editingUser && editingUser.role === "caller" },
  );

  // Pre-populate edit selections when data loads
  useEffect(() => {
    if (!editingUser || !showEdit) return;
    // Pre-select currently assigned phones
    setEditPhoneIds(phones.filter((p) => p.assignedTo === editingUser.id).map((p) => p.id));
  }, [editingUser, showEdit, phones]);

  useEffect(() => {
    if (editingUserLists.length > 0) {
      setEditListIds((editingUserLists as LeadList[]).map((l) => l.id));
    }
  }, [editingUserLists]);

  // ── Mutations ──
  const createUserMutation  = trpc.user.create.useMutation();
  const updateUserMutation  = trpc.user.update.useMutation();
  const deleteUserMutation  = trpc.user.delete.useMutation({ onSuccess: () => refetch() });
  const provisionSipMutation = trpc.user.provisionTelnyxCredential.useMutation();
  const [provisionResult, setProvisionResult] = useState<{ ok: boolean; message: string } | null>(null);
  const assignPhoneMutation = trpc.integration.assignPhoneNumber.useMutation();
  const assignListMutation  = trpc.lead.assignList.useMutation();

  // ── Helpers ──
  const toggleId = (ids: number[], id: number) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

  // ── Create user ──
  const handleCreateUser = async () => {
    if (!newUser.name || !newUser.email) return;
    try {
      const result = await createUserMutation.mutateAsync({
        name: newUser.name, email: newUser.email,
        phone: newUser.phone || undefined,
        role: newUser.role as "admin" | "caller" | "viewer",
        unionId: newUser.unionId || undefined,
        dailyCallLimit: newUser.dailyCallLimit,
        password: newUser.password || undefined,
      });
      const newId = result.id;
      if (newUser.role === "caller" && newId) {
        for (const phoneId of createPhoneIds)
          await assignPhoneMutation.mutateAsync({ id: phoneId, callerId: newId });
        for (const listId of createListIds)
          await assignListMutation.mutateAsync({ leadListId: listId, callerId: newId });
      }
      refetch();
      setShowCreate(false);
      setNewUser({ name: "", email: "", phone: "", role: "caller", unionId: "", dailyCallLimit: 200, password: "" });
      setCreatePhoneIds([]); setCreateListIds([]);
    } catch (err) { console.error("Failed to create user:", err); }
  };

  // ── Toggle status ──
  const handleToggleStatus = async (id: number, currentStatus: string) => {
    try {
      await updateUserMutation.mutateAsync({ id, data: { status: (currentStatus === "active" ? "suspended" : "active") as any } });
      refetch();
    } catch (err) { console.error(err); }
  };

  // ── Open edit dialog ──
  const handleEditClick = (u: any) => {
    setEditingUser(u);
    setEditUserData({ name: u.name || "", email: u.email || "", phone: u.phone || "",
      role: u.role || "caller", dailyCallLimit: u.dailyCallLimit ?? 200, password: "" });
    setEditPhoneIds(phones.filter((p) => p.assignedTo === u.id).map((p) => p.id));
    setEditListIds([]);
    // Pre-fill per-caller Telnyx SIP credentials if already set
    const sip = u.sipCredentials;
    setEditSipUsername(sip?.domain === "telnyx" ? (sip.username ?? "") : "");
    setEditSipPassword("");  // never pre-fill password for security
    setProvisionResult(null);
    setShowEdit(true);
  };

  // ── Auto-assign a dedicated Telnyx SIP credential (fixes concurrent calling) ──
  const handleAutoProvisionSip = async () => {
    if (!editingUser) return;
    setProvisionResult(null);
    try {
      const res = await provisionSipMutation.mutateAsync({ id: editingUser.id });
      if (res.success && res.username) {
        setEditSipUsername(res.username);
        setEditSipPassword(""); // stored server-side already; field stays blank so Save doesn't overwrite it
        setProvisionResult({ ok: true, message: `Assigned dedicated credential "${res.username}".` });
        refetch();
      } else {
        setProvisionResult({ ok: false, message: res.error || "Could not provision a Telnyx credential." });
      }
    } catch (err) {
      setProvisionResult({ ok: false, message: err instanceof Error ? err.message : "Could not provision a Telnyx credential." });
    }
  };

  // ── Save edit ──
  const handleUpdateUser = async () => {
    if (!editingUser || !editUserData.name || !editUserData.email) return;
    try {
      await updateUserMutation.mutateAsync({
        id: editingUser.id,
        data: {
          name: editUserData.name, email: editUserData.email,
          phone: editUserData.phone || undefined,
          role: editUserData.role as any,
          dailyCallLimit: editUserData.dailyCallLimit,
          password: editUserData.password || undefined,
          // Per-caller Telnyx SIP creds (only send if filled in)
          sipUsername:        editSipUsername.trim()  || undefined,
          sipTelnyxPassword:  editSipPassword.trim()  || undefined,
        },
      });

      if (editUserData.role === "caller") {
        // Sync phone assignments: unassign removed, assign added
        const prev = phones.filter((p) => p.assignedTo === editingUser.id).map((p) => p.id);
        for (const pid of prev)
          if (!editPhoneIds.includes(pid))
            await assignPhoneMutation.mutateAsync({ id: pid, callerId: null });
        for (const pid of editPhoneIds)
          if (!prev.includes(pid))
            await assignPhoneMutation.mutateAsync({ id: pid, callerId: editingUser.id });
        // Assign new lead lists
        const prevListIds = (editingUserLists as LeadList[]).map((l) => l.id);
        for (const lid of editListIds)
          if (!prevListIds.includes(lid))
            await assignListMutation.mutateAsync({ leadListId: lid, callerId: editingUser.id });
      }

      refetch();
      setShowEdit(false);
      setEditingUser(null);
      setEditPhoneIds([]); setEditListIds([]);
      setEditSipUsername(""); setEditSipPassword("");
    } catch (err) { console.error(err); }
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    try { await deleteUserMutation.mutateAsync({ id }); } catch (err) { console.error(err); }
  };

  const filteredUsers = (usersList as any[]).filter(
    (u) => u.name.toLowerCase().includes(search.toLowerCase()) ||
           u.email.toLowerCase().includes(search.toLowerCase()),
  );

  const getRoleIcon = (role: string) => {
    if (role === "admin")  return <Shield className="w-4 h-4 text-amber-400" />;
    if (role === "caller") return <Phone  className="w-4 h-4 text-blue-400" />;
    if (role === "viewer") return <Eye    className="w-4 h-4 text-gray-400" />;
    return <UserCircle className="w-4 h-4" />;
  };

  const getStatusBadge = (status: string) => {
    if (status === "active")    return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>;
    if (status === "suspended") return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Suspended</Badge>;
    return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">Inactive</Badge>;
  };

  // ── Shared assignment UI blocks ──
  const PhoneAssignSection = ({
    role, selectedIds, onChange,
  }: { role: string; selectedIds: number[]; onChange: (ids: number[]) => void }) => {
    if (role !== "caller") return null;
    return (
      <div>
        <Label className="text-gray-300 flex items-center gap-1.5 mb-1">
          <PhoneCall className="w-3.5 h-3.5 text-blue-400" /> Assign Phone Numbers
        </Label>
        <div className="space-y-1 max-h-32 overflow-y-auto bg-gray-800 rounded-lg p-2 border border-gray-700">
          {phones.filter((p) => p.status !== "inactive").length === 0 && (
            <p className="text-xs text-gray-500 px-1">No active numbers — configure in Settings.</p>
          )}
          {phones.filter((p) => p.status !== "inactive").map((p) => (
            <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-700 cursor-pointer text-sm text-white">
              <input
                type="checkbox"
                className="accent-blue-500 w-4 h-4"
                checked={selectedIds.includes(p.id)}
                onChange={() => onChange(toggleId(selectedIds, p.id))}
              />
              <span className="font-mono text-sm">{p.number}</span>
              {p.label && <span className="text-gray-400 text-xs">({p.label})</span>}
              {p.assignedTo && !selectedIds.includes(p.id) && (
                <Badge className="ml-auto text-[10px] bg-amber-500/10 text-amber-400 border-0">In use</Badge>
              )}
            </label>
          ))}
        </div>
      </div>
    );
  };

  const ListAssignSection = ({
    role, selectedIds, onChange,
  }: { role: string; selectedIds: number[]; onChange: (ids: number[]) => void }) => {
    if (role !== "caller") return null;
    return (
      <div>
        <Label className="text-gray-300 flex items-center gap-1.5 mb-1">
          <List className="w-3.5 h-3.5 text-green-400" /> Assign Lead Lists
        </Label>
        <div className="space-y-1 max-h-32 overflow-y-auto bg-gray-800 rounded-lg p-2 border border-gray-700">
          {leadLists.length === 0 && (
            <p className="text-xs text-gray-500 px-1">No lead lists created yet.</p>
          )}
          {leadLists.map((l) => (
            <label key={l.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-700 cursor-pointer text-sm text-white">
              <input
                type="checkbox"
                className="accent-green-500 w-4 h-4"
                checked={selectedIds.includes(l.id)}
                onChange={() => onChange(toggleId(selectedIds, l.id))}
              />
              <span>{l.name}</span>
              {l.totalLeads != null && (
                <span className="ml-auto text-xs text-gray-400">{l.totalLeads} leads</span>
              )}
            </label>
          ))}
        </div>
      </div>
    );
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="text-gray-400 mt-1">Manage your team of callers and admins</p>
        </div>

        {/* ── Create dialog ── */}
        <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) { setCreatePhoneIds([]); setCreateListIds([]); } }}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" /> Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-800 text-white max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-gray-300">Full Name</Label>
                <Input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder="Enter full name" className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Email</Label>
                <Input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="Enter email" className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Phone</Label>
                <Input value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  placeholder="Enter phone number" className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Role</Label>
                <Select value={newUser.role} onValueChange={(v) => { setNewUser({ ...newUser, role: v }); setCreatePhoneIds([]); setCreateListIds([]); }}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="caller">Caller</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Daily Call Limit</Label>
                <Input type="number" value={newUser.dailyCallLimit}
                  onChange={(e) => setNewUser({ ...newUser, dailyCallLimit: parseInt(e.target.value) || 0 })}
                  className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Password</Label>
                <Input type="password" value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Enter temporary password" className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>

              {/* Phone + Lead List assignment — only for caller role */}
              <PhoneAssignSection role={newUser.role} selectedIds={createPhoneIds} onChange={setCreatePhoneIds} />
              <ListAssignSection  role={newUser.role} selectedIds={createListIds}  onChange={setCreateListIds} />

              <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleCreateUser}
                disabled={createUserMutation.isPending}>
                {createUserMutation.isPending ? "Creating…" : "Create User"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Edit dialog ── */}
        <Dialog open={showEdit} onOpenChange={(o) => { setShowEdit(o); if (!o) { setEditingUser(null); setEditPhoneIds([]); setEditListIds([]); } }}>
          <DialogContent className="bg-gray-900 border-gray-800 text-white max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit User — {editingUser?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-gray-300">Full Name</Label>
                <Input value={editUserData.name} onChange={(e) => setEditUserData({ ...editUserData, name: e.target.value })}
                  className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Email</Label>
                <Input value={editUserData.email} onChange={(e) => setEditUserData({ ...editUserData, email: e.target.value })}
                  className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Phone</Label>
                <Input value={editUserData.phone} onChange={(e) => setEditUserData({ ...editUserData, phone: e.target.value })}
                  className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Role</Label>
                <Select value={editUserData.role} onValueChange={(v) => setEditUserData({ ...editUserData, role: v })}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="caller">Caller</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Daily Call Limit</Label>
                <Input type="number" value={editUserData.dailyCallLimit}
                  onChange={(e) => setEditUserData({ ...editUserData, dailyCallLimit: parseInt(e.target.value) || 0 })}
                  className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Password (leave blank to keep)</Label>
                <Input type="password" value={editUserData.password}
                  onChange={(e) => setEditUserData({ ...editUserData, password: e.target.value })}
                  placeholder="Leave blank to keep current password"
                  className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>

              {/* ── Telnyx SIP Credentials (caller-only, for concurrent WebRTC calling) ── */}
              {editUserData.role === "caller" && (
                <div className="border border-blue-800/40 bg-blue-900/10 rounded-xl p-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-blue-400 mb-0.5">
                      Telnyx SIP Credentials — Concurrent Calling
                    </p>
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                      Assign a unique Telnyx SIP username &amp; password to each caller so they can
                      all make calls simultaneously without disconnecting each other.
                      Create these in your{" "}
                      <span className="text-blue-400">Telnyx portal → Credential Connections</span>.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full bg-blue-700 hover:bg-blue-600"
                    onClick={handleAutoProvisionSip}
                    disabled={provisionSipMutation.isPending}
                  >
                    {provisionSipMutation.isPending ? "Assigning…" : "Auto-assign dedicated SIP credential"}
                  </Button>
                  {provisionResult && (
                    <p className={`text-[11px] ${provisionResult.ok ? "text-green-400" : "text-red-400"}`}>
                      {provisionResult.ok ? "✓ " : ""}{provisionResult.message}
                    </p>
                  )}
                  <div>
                    <Label className="text-gray-300 text-xs">Telnyx SIP Username</Label>
                    <Input
                      value={editSipUsername}
                      onChange={(e) => setEditSipUsername(e.target.value)}
                      placeholder="e.g. caller1@yourcompany.sip.telnyx.com"
                      className="bg-gray-800 border-gray-700 text-white mt-1 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 text-xs">Telnyx SIP Password</Label>
                    <Input
                      type="password"
                      value={editSipPassword}
                      onChange={(e) => setEditSipPassword(e.target.value)}
                      placeholder="Leave blank to keep existing"
                      className="bg-gray-800 border-gray-700 text-white mt-1 text-sm"
                    />
                  </div>
                  {editingUser?.sipCredentials?.domain === "telnyx" && !editSipUsername && (
                    <p className="text-[11px] text-green-400">
                      ✓ Dedicated SIP credentials already set for this caller.
                    </p>
                  )}
                </div>
              )}

              {/* Phone + Lead List assignment — only for caller role */}
              <PhoneAssignSection role={editUserData.role} selectedIds={editPhoneIds} onChange={setEditPhoneIds} />
              <ListAssignSection  role={editUserData.role} selectedIds={editListIds}  onChange={setEditListIds} />

              <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleUpdateUser}
                disabled={updateUserMutation.isPending}>
                {updateUserMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { icon: Users, color: "blue", value: (usersList as any[]).length, label: "Total Users" },
          { icon: Phone, color: "green", value: (usersList as any[]).filter((u: any) => u.role === "caller").length, label: "Callers" },
          { icon: Shield, color: "amber", value: (usersList as any[]).filter((u: any) => u.role === "admin").length, label: "Admins" },
          { icon: PauseCircle, color: "green", value: (usersList as any[]).filter((u: any) => u.status === "active").length, label: "Active" },
        ].map(({ icon: Icon, color, value, label }) => (
          <Card key={label} className="bg-gray-900 border-gray-800">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg bg-${color}-500/10 flex items-center justify-center`}>
                <Icon className={`w-5 h-5 text-${color}-400`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-sm text-gray-400">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by name or email..."
          className="pl-10 bg-gray-900 border-gray-800 text-white" />
      </div>

      {/* Users Table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">User</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Role</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Assigned Numbers</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Call Limit</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Last Login</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u: any) => {
                  const assignedPhones = phones.filter((p) => p.assignedTo === u.id);
                  return (
                    <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center">
                            <UserCircle className="w-5 h-5 text-gray-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{u.name}</p>
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <Mail className="w-3 h-3" />{u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getRoleIcon(u.role)}
                          <span className="text-sm text-gray-300 capitalize">{u.role}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(u.status)}</td>
                      <td className="px-4 py-3">
                        {assignedPhones.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {assignedPhones.map((p) => (
                              <Badge key={p.id} className="bg-blue-500/10 text-blue-400 border-0 font-mono text-xs">
                                {p.number}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">{u.dailyCallLimit}</td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" onClick={() => handleEditClick(u)}
                            className="text-gray-400 hover:text-white h-8 px-2">Edit</Button>
                          {u.status === "active" ? (
                            <Button variant="ghost" size="sm" onClick={() => handleToggleStatus(u.id, u.status)}
                              className="text-amber-400 hover:text-amber-300 h-8 px-2">Suspend</Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => handleToggleStatus(u.id, u.status)}
                              className="text-green-400 hover:text-green-300 h-8 px-2">Activate</Button>
                          )}
                          {u.id !== user?.id && (
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteUser(u.id)}
                              className="text-red-400 hover:text-red-300 h-8 px-2 flex items-center gap-1">
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}