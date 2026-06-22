import { useState } from "react";
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
} from "lucide-react";

export default function UsersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    phone: "",
    role: "caller" as string,
    unionId: "",
    dailyCallLimit: 200,
    password: "",
  });
  const [showEdit, setShowEdit] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editUserData, setEditUserData] = useState({
    name: "",
    email: "",
    phone: "",
    role: "caller" as string,
    dailyCallLimit: 200,
    password: "",
  });

  const { data: usersList = [], refetch } = trpc.user.list.useQuery(undefined, {
    enabled: isAdmin,
  });

  const createUserMutation = trpc.user.create.useMutation({
    onSuccess: () => {
      refetch();
      setShowCreate(false);
      setNewUser({
        name: "",
        email: "",
        phone: "",
        role: "caller",
        unionId: "",
        dailyCallLimit: 200,
        password: "",
      });
    },
  });

  const updateUserMutation = trpc.user.update.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const handleCreateUser = async () => {
    if (!newUser.name || !newUser.email) return;
    try {
      await createUserMutation.mutateAsync({
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone || undefined,
        role: newUser.role as "admin" | "caller" | "viewer",
        unionId: newUser.unionId || undefined,
        dailyCallLimit: newUser.dailyCallLimit,
        password: newUser.password || undefined,
      });
    } catch (err) {
      console.error("Failed to create user:", err);
    }
  };

  const handleToggleStatus = async (id: number, currentStatus: string) => {
    try {
      const newStatus = currentStatus === "active" ? "suspended" : "active";
      await updateUserMutation.mutateAsync({
        id,
        data: { status: newStatus as any },
      });
    } catch (err) {
      console.error("Failed to update user status:", err);
    }
  };

  const handleEditClick = (u: any) => {
    setEditingUser(u);
    setEditUserData({
      name: u.name || "",
      email: u.email || "",
      phone: u.phone || "",
      role: u.role || "caller",
      dailyCallLimit: u.dailyCallLimit ?? 200,
      password: "",
    });
    setShowEdit(true);
  };

  const handleUpdateUser = async () => {
    if (!editingUser || !editUserData.name || !editUserData.email) return;
    try {
      await updateUserMutation.mutateAsync({
        id: editingUser.id,
        data: {
          name: editUserData.name,
          email: editUserData.email,
          phone: editUserData.phone || undefined,
          role: editUserData.role as "admin" | "caller" | "viewer" | "superadmin",
          dailyCallLimit: editUserData.dailyCallLimit,
          password: editUserData.password || undefined,
        },
      });
      setShowEdit(false);
      setEditingUser(null);
    } catch (err) {
      console.error("Failed to update user:", err);
    }
  };

  const deleteUserMutation = trpc.user.delete.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const handleDeleteUser = async (id: number) => {
    if (confirm("Are you sure you want to delete this user? This action cannot be undone.")) {
      try {
        await deleteUserMutation.mutateAsync({ id });
      } catch (err) {
        console.error("Failed to delete user:", err);
      }
    }
  };

  const filteredUsers = usersList.filter(
    (u: any) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "admin": return <Shield className="w-4 h-4 text-amber-400" />;
      case "caller": return <Phone className="w-4 h-4 text-blue-400" />;
      case "viewer": return <Eye className="w-4 h-4 text-gray-400" />;
      default: return <UserCircle className="w-4 h-4" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>;
      case "inactive": return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">Inactive</Badge>;
      case "suspended": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Suspended</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
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
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-800 text-white">
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-gray-300">Full Name</Label>
                <Input
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder="Enter full name"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">Email</Label>
                <Input
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="Enter email"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">Phone</Label>
                <Input
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  placeholder="Enter phone number"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">Role</Label>
                <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="caller">Caller</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Daily Call Limit</Label>
                <Input
                  type="number"
                  value={newUser.dailyCallLimit}
                  onChange={(e) => setNewUser({ ...newUser, dailyCallLimit: parseInt(e.target.value) || 0 })}
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">Password</Label>
                <Input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Enter temporary password"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleCreateUser}>
                Create User
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showEdit} onOpenChange={setShowEdit}>
          <DialogContent className="bg-gray-900 border-gray-800 text-white">
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-gray-300">Full Name</Label>
                <Input
                  value={editUserData.name}
                  onChange={(e) => setEditUserData({ ...editUserData, name: e.target.value })}
                  placeholder="Enter full name"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">Email</Label>
                <Input
                  value={editUserData.email}
                  onChange={(e) => setEditUserData({ ...editUserData, email: e.target.value })}
                  placeholder="Enter email"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">Phone</Label>
                <Input
                  value={editUserData.phone}
                  onChange={(e) => setEditUserData({ ...editUserData, phone: e.target.value })}
                  placeholder="Enter phone number"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">Role</Label>
                <Select value={editUserData.role} onValueChange={(v) => setEditUserData({ ...editUserData, role: v })}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="caller">Caller</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Daily Call Limit</Label>
                <Input
                  type="number"
                  value={editUserData.dailyCallLimit}
                  onChange={(e) => setEditUserData({ ...editUserData, dailyCallLimit: parseInt(e.target.value) || 0 })}
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">Password</Label>
                <Input
                  type="password"
                  value={editUserData.password}
                  onChange={(e) => setEditUserData({ ...editUserData, password: e.target.value })}
                  placeholder="Leave blank to keep current password"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                />
              </div>
              <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleUpdateUser}>
                Save Changes
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{usersList.length}</p>
              <p className="text-sm text-gray-400">Total Users</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Phone className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{usersList.filter((u: any) => u.role === "caller").length}</p>
              <p className="text-sm text-gray-400">Callers</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{usersList.filter((u: any) => u.role === "admin").length}</p>
              <p className="text-sm text-gray-400">Admins</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <PauseCircle className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{usersList.filter((u: any) => u.status === "active").length}</p>
              <p className="text-sm text-gray-400">Active</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by name or email..."
          className="pl-10 bg-gray-900 border-gray-800 text-white"
        />
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
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Phone</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Call Limit</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Last Login</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u: any) => (
                  <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center">
                          <UserCircle className="w-5 h-5 text-gray-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{u.name}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {u.email}
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
                    <td className="px-4 py-3 text-sm text-gray-400">{u.phone}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">{u.dailyCallLimit}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleEditClick(u)}
                          className="text-gray-400 hover:text-white h-8 px-2"
                        >
                          Edit
                        </Button>
                        {u.status === "active" ? (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleToggleStatus(u.id, u.status)}
                            className="text-amber-400 hover:text-amber-300 h-8 px-2"
                          >
                            Suspend
                          </Button>
                        ) : (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleToggleStatus(u.id, u.status)}
                            className="text-green-400 hover:text-green-300 h-8 px-2"
                          >
                            Activate
                          </Button>
                        )}
                        {u.id !== user?.id && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleDeleteUser(u.id)}
                            className="text-red-400 hover:text-red-300 h-8 px-2 flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
