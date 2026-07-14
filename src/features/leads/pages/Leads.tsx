import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  List,
  Plus,
  Search,
  Upload,
  FileSpreadsheet,
  Users,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Trash2,
  Edit,
  Eye,
} from "lucide-react";

export default function LeadsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [activeTab, setActiveTab] = useState("lists");

  // Assign-to-caller dialog
  const [showAssign, setShowAssign] = useState(false);
  const [assigningListId, setAssigningListId] = useState<number | null>(null);
  const [assignCallerId, setAssignCallerId] = useState<string>("");

  // State for list selection
  const [selectedListId, setSelectedListId] = useState<number | null>(null);

  // States for list creation dialog
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");

  // States for file upload dialog
  const [selectedUploadListId, setSelectedUploadListId] = useState<string>("create-new");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // CSV Import States
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvLines, setCsvLines] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [mappingStep, setMappingStep] = useState<"file" | "mapping">("file");

  // Single Lead Dialog States
  const [showAddLead, setShowAddLead] = useState(false);
  const [showEditLead, setShowEditLead] = useState(false);
  const [editingLead, setEditingLead] = useState<{ id: number; [key: string]: unknown } | null>(null);

  const [leadFormData, setLeadFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    companyName: "",
    designation: "",
    city: "",
    state: "",
    country: "",
    zipCode: "",
    address: "",
    notes: "",
    priority: "medium" as "low" | "medium" | "high" | "urgent",
    status: "new" as "new" | "contacted" | "qualified" | "converted" | "unqualified" | "callback" | "dnc",
  });

  const leadFields = [
    { key: "phone", label: "Phone Number", required: true },
    { key: "firstName", label: "First Name", required: false },
    { key: "lastName", label: "Last Name", required: false },
    { key: "companyName", label: "Company Name", required: false },
    { key: "email", label: "Email Address", required: false },
    { key: "designation", label: "Designation/Role", required: false },
    { key: "address", label: "Address", required: false },
    { key: "city", label: "City", required: false },
    { key: "state", label: "State", required: false },
    { key: "country", label: "Country", required: false },
    { key: "zipCode", label: "Zip/Postal Code", required: false },
    { key: "notes", label: "Notes/Comments", required: false },
  ];

  // Load Lead Lists — admin sees all; caller sees only their assigned lists
  const { data: adminListsData = [], refetch: refetchAdminLists } = trpc.lead.listLists.useQuery(
    undefined, { enabled: isAdmin },
  );
  const { data: myListsData = [], refetch: refetchMyLists } = trpc.lead.myLists.useQuery(
    undefined, { enabled: !isAdmin },
  );
  const leadLists = (isAdmin ? adminListsData : myListsData) as any[];
  const refetchLists = isAdmin ? refetchAdminLists : refetchMyLists;

  // Callers list for assign dialog
  const { data: allUsers = [] } = trpc.user.list.useQuery(undefined, { enabled: isAdmin });
  const callerUsers = (allUsers as any[]).filter((u) => u.role === "caller");

  // Load Leads from selected list
  const { data: leadsResponse, refetch: refetchLeads } = trpc.lead.list.useQuery(
    { leadListId: selectedListId || 0 },
    { enabled: selectedListId !== null }
  );

  const leads = (Array.isArray(leadsResponse) ? leadsResponse : (leadsResponse as { items?: unknown[] })?.items || []) as any[];

  // Default selection to first list
  useEffect(() => {
    if (leadLists.length > 0 && selectedListId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedListId((leadLists[0] as any).id);
    }
  }, [leadLists, selectedListId]);

  // Callers can't create new lists (admin-only), so default the upload
  // target to one of their assigned lists instead of "create-new".
  useEffect(() => {
    if (!isAdmin && leadLists.length > 0 && selectedUploadListId === "create-new") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedUploadListId((leadLists[0] as any).id.toString());
    }
  }, [isAdmin, leadLists, selectedUploadListId]);

  // Mutations
  const assignListMutation = trpc.lead.assignList.useMutation({ onSuccess: () => refetchLists() });

  const handleAssignList = async () => {
    if (!assigningListId || !assignCallerId) return;
    try {
      await assignListMutation.mutateAsync({ leadListId: assigningListId, callerId: parseInt(assignCallerId) });
      setShowAssign(false);
      setAssigningListId(null);
      setAssignCallerId("");
    } catch (err) { console.error(err); }
  };

  const createListMutation = trpc.lead.createList.useMutation({
    onSuccess: () => {
      refetchLists();
      setShowCreateList(false);
      setNewListName("");
      setNewListDesc("");
    },
  });

  const deleteListMutation = trpc.lead.deleteList.useMutation({
    onSuccess: () => {
      refetchLists();
      if (leadLists.length > 0) {
        setSelectedListId((leadLists[0] as any).id);
      } else {
        setSelectedListId(null);
      }
    },
  });

  const createBatchMutation = trpc.lead.createBatch.useMutation({
    onSuccess: () => {
      refetchLists();
      if (selectedListId) refetchLeads();
      setShowUpload(false);
      setUploadFile(null);
    },
  });

  const deleteLeadMutation = trpc.lead.delete.useMutation({
    onSuccess: () => {
      if (selectedListId) refetchLeads();
      refetchLists();
    },
  });

  const createLeadMutation = trpc.lead.create.useMutation({
    onSuccess: () => {
      if (selectedListId) refetchLeads();
      refetchLists();
      setShowAddLead(false);
      resetLeadForm();
    },
  });

  const updateLeadMutation = trpc.lead.update.useMutation({
    onSuccess: () => {
      if (selectedListId) refetchLeads();
      refetchLists();
      setShowEditLead(false);
      setEditingLead(null);
      resetLeadForm();
    },
  });

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    try {
      await createListMutation.mutateAsync({
        name: newListName,
        description: newListDesc || undefined,
      });
    } catch (err) {
      console.error("Failed to create lead list:", err);
    }
  };

  const handleDeleteList = async (id: number) => {
    if (!confirm("Are you sure you want to delete this lead list?")) return;
    try {
      await deleteListMutation.mutateAsync({ id });
    } catch (err) {
      console.error("Failed to delete lead list:", err);
    }
  };

  const resetLeadForm = () => {
    setLeadFormData({
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      companyName: "",
      designation: "",
      city: "",
      state: "",
      country: "",
      zipCode: "",
      address: "",
      notes: "",
      priority: "medium",
      status: "new",
    });
  };

  const handleEditLeadClick = (lead: any) => {
    setEditingLead(lead);
    setLeadFormData({
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      phone: lead.phone || "",
      email: lead.email || "",
      companyName: lead.companyName || "",
      designation: lead.designation || "",
      city: lead.city || "",
      state: lead.state || "",
      country: lead.country || "",
      zipCode: lead.zipCode || "",
      address: lead.address || "",
      notes: lead.notes || "",
      priority: lead.priority || "medium",
      status: lead.status || "new",
    });
    setShowEditLead(true);
  };

  const handleAddLead = async () => {
    if (!selectedListId || !leadFormData.phone) return;
    try {
      await createLeadMutation.mutateAsync({
        leadListId: selectedListId,
        ...leadFormData,
      });
    } catch (err) {
      console.error("Failed to add lead:", err);
    }
  };

  const handleUpdateLead = async () => {
    if (!editingLead) return;
    try {
      await updateLeadMutation.mutateAsync({
        id: editingLead.id,
        data: leadFormData,
      });
    } catch (err) {
      console.error("Failed to update lead:", err);
    }
  };

  const handleDeleteLead = async (id: number) => {
    if (!confirm("Are you sure you want to delete this lead?")) return;
    try {
      await deleteLeadMutation.mutateAsync({ id });
    } catch (err) {
      console.error("Failed to delete lead:", err);
    }
  };

  const parseCsvLine = (line: string) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(cleanCsvValue(current));
        current = "";
      } else {
        current += char;
      }
    }
    result.push(cleanCsvValue(current));
    return result;
  };

  const cleanCsvValue = (val: string) => {
    let clean = val.trim();
    if (clean.startsWith('"') && clean.endsWith('"')) {
      clean = clean.slice(1, -1);
    }
    return clean.replace(/""/g, '"');
  };

  const autoMatch = (fieldName: string, headers: string[]) => {
    const matchMap: Record<string, string[]> = {
      firstName: ["first", "first name", "firstname", "first_name", "fname"],
      lastName: ["last", "last name", "lastname", "last_name", "lname"],
      companyName: ["company", "company name", "companyname", "company_name", "organization", "org", "employer"],
      phone: ["phone", "phone number", "phonenumber", "phone_number", "mobile", "tel", "cell", "contact"],
      email: ["email", "email address", "email_address", "mail"],
      designation: ["designation", "job title", "jobtitle", "title", "role", "position"],
      address: ["address", "street", "street address"],
      city: ["city", "town"],
      state: ["state", "province", "region"],
      country: ["country", "nation"],
      zipCode: ["zip", "zip code", "zipcode", "postal", "postal code", "postalcode"],
      notes: ["notes", "comment", "comments", "description", "remark", "remarks"],
    };

    const targets = matchMap[fieldName] || [];
    for (const t of targets) {
      const foundIdx = headers.findIndex((h) => h.toLowerCase() === t);
      if (foundIdx !== -1) return headers[foundIdx];
    }
    for (const t of targets) {
      const foundIdx = headers.findIndex((h) => h.toLowerCase().includes(t));
      if (foundIdx !== -1) return headers[foundIdx];
    }
    return "";
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setUploadFile(file);
    if (!file) {
      setCsvHeaders([]);
      setCsvLines([]);
      setColumnMapping({});
      setMappingStep("file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) {
        alert("Selected CSV file is empty.");
        return;
      }
      const headers = parseCsvLine(lines[0]);
      setCsvHeaders(headers);
      setCsvLines(lines);
      
      const newMapping: Record<string, string> = {};
      leadFields.forEach((field) => {
        newMapping[field.key] = autoMatch(field.key, headers);
      });
      setColumnMapping(newMapping);
      setMappingStep("mapping");
    };
    reader.readAsText(file);
  };

  const handleUploadLeads = async () => {
    try {
      let targetListId = selectedUploadListId === "create-new" ? null : parseInt(selectedUploadListId);
      if (!targetListId && !isAdmin) {
        alert("You don't have a lead list assigned yet. Ask your admin to assign one before uploading leads.");
        return;
      }
      if (!targetListId) {
        const listName = uploadFile
          ? `Imported: ${uploadFile.name.replace(/\.[^/.]+$/, "")}`
          : `Mock List ${new Date().toLocaleDateString()}`;
        const listIdResult = await createListMutation.mutateAsync({
          name: listName,
          description: uploadFile ? `Uploaded from file ${uploadFile.name}` : "Seeded mock data list",
        });
        targetListId = listIdResult.id;
      }

      if (!uploadFile || csvLines.length <= 1) {
        // Fallback simulation for easy testing if no file is chosen
        await createBatchMutation.mutateAsync({
          leadListId: targetListId!,
          leads: [
            { companyName: "Google", firstName: "Sundar", lastName: "Pichai", phone: "+1-555-1010", email: "sundar@google.com", designation: "CEO", city: "Mountain View" },
            { companyName: "Microsoft", firstName: "Satya", lastName: "Nadella", phone: "+1-555-2020", email: "satya@microsoft.com", designation: "CEO", city: "Redmond" },
            { companyName: "Apple", firstName: "Tim", lastName: "Cook", phone: "+1-555-3030", email: "tim@apple.com", designation: "CEO", city: "Cupertino" },
          ],
        });
        return;
      }

      if (!columnMapping.phone) {
        alert("You must map the Phone Number field.");
        return;
      }

      const phoneIdx = csvHeaders.indexOf(columnMapping.phone);
      if (phoneIdx === -1) {
        alert("Invalid phone column mapping.");
        return;
      }

      type LeadUpload = { phone: string; firstName?: string; lastName?: string; companyName?: string; email?: string; designation?: string; address?: string; city?: string; state?: string; country?: string; zipCode?: string; notes?: string };
      const leadsToUpload: LeadUpload[] = [];
      for (let i = 1; i < csvLines.length; i++) {
        const row = parseCsvLine(csvLines[i]);
        const leadObj: Record<string, string> = {};
        
        leadFields.forEach((field) => {
          const csvCol = columnMapping[field.key];
          if (csvCol) {
            const colIdx = csvHeaders.indexOf(csvCol);
            if (colIdx !== -1 && colIdx < row.length) {
              leadObj[field.key] = row[colIdx] || "";
            }
          }
        });

        if (leadObj.phone) {
          leadsToUpload.push(leadObj as unknown as LeadUpload);
        }
      }

      if (leadsToUpload.length === 0) {
        alert("No valid leads containing phone numbers were found in the CSV based on your mapping.");
        return;
      }

      await createBatchMutation.mutateAsync({
        leadListId: targetListId!,
        leads: leadsToUpload,
      });

      // Clear states
      setCsvHeaders([]);
      setCsvLines([]);
      setColumnMapping({});
      setMappingStep("file");
    } catch (err) {
      console.error("Failed to upload leads:", err);
    }
  };

  const filteredLeads = (leads as any[]).filter((lead: any) => {
    const q = search.toLowerCase();
    const fullName = `${lead.firstName || ""} ${lead.lastName || ""}`.toLowerCase();
    return (
      fullName.includes(q) ||
      (lead.companyName || "").toLowerCase().includes(q) ||
      (lead.phone || "").includes(q) ||
      (lead.email || "").toLowerCase().includes(q)
    );
  });

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      new: "bg-blue-500/20 text-blue-400",
      contacted: "bg-amber-500/20 text-amber-400",
      qualified: "bg-green-500/20 text-green-400",
      converted: "bg-emerald-500/20 text-emerald-400",
      unqualified: "bg-gray-500/20 text-gray-400",
      callback: "bg-purple-500/20 text-purple-400",
      dnc: "bg-red-500/20 text-red-400",
    };
    return <Badge className={`${colors[status] || "bg-gray-500/20"} border-0 capitalize`}>{status}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      low: "text-gray-400",
      medium: "text-blue-400",
      high: "text-amber-400",
      urgent: "text-red-400",
    };
    return <span className={`text-xs font-medium ${colors[priority] || "text-gray-400"}`}>{priority}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Lead Management</h1>
          <p className="text-gray-400 mt-1">Manage lead lists and individual leads</p>
        </div>
        <div className="flex gap-2">
          {/* Assign-to-caller dialog (opened programmatically from card) */}
          <Dialog open={showAssign} onOpenChange={setShowAssign}>
            <DialogContent className="bg-gray-900 border-gray-800 text-white">
              <DialogHeader><DialogTitle>Assign List to Caller</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4">
                <p className="text-sm text-gray-400">Select a caller to give them access to this lead list.</p>
                <select
                  value={assignCallerId}
                  onChange={(e) => setAssignCallerId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm"
                >
                  <option value="">— Select caller —</option>
                  {callerUsers.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  onClick={handleAssignList}
                  disabled={!assignCallerId || assignListMutation.isPending}
                >
                  {assignListMutation.isPending ? "Assigning…" : "Assign"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showUpload} onOpenChange={setShowUpload}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
                disabled={!isAdmin && leadLists.length === 0}>
                <Upload className="w-4 h-4 mr-2" />Upload
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-gray-900 border-gray-800 text-white">
              <DialogHeader><DialogTitle>Upload Leads</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4 text-left">
                {!isAdmin && leadLists.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    You don't have any lead lists assigned yet. Ask your admin to assign one before uploading leads.
                  </p>
                ) : (
                  <>
                    {mappingStep === "file" ? (
                      <div className="border-2 border-dashed border-gray-700 rounded-lg p-8 text-center">
                        <FileSpreadsheet className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                        <p className="text-gray-300 font-medium">Drop CSV file here or click to browse</p>
                        <p className="text-gray-500 text-sm mt-1">Supports CSV files up to 10MB</p>
                        <Input type="file" accept=".csv" onChange={handleFileChange}
                          className="mt-4 bg-gray-800 border-gray-700 text-white" />
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Map CSV Columns to Database Fields:</p>
                          <Button variant="ghost" size="sm"
                            onClick={() => { setUploadFile(null); setCsvHeaders([]); setCsvLines([]); setColumnMapping({}); setMappingStep("file"); }}
                            className="text-xs text-blue-400 hover:text-blue-300 h-6 px-1">
                            Change File
                          </Button>
                        </div>
                        {leadFields.map((field) => (
                          <div key={field.key} className="grid grid-cols-3 items-center gap-2">
                            <Label className="text-xs text-gray-300 col-span-1">
                              {field.label} {field.required && <span className="text-red-500">*</span>}
                            </Label>
                            <select
                              value={columnMapping[field.key] || ""}
                              onChange={(e) => setColumnMapping({ ...columnMapping, [field.key]: e.target.value })}
                              className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-white col-span-2 focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="" className="text-gray-950 bg-white">-- None / Skip --</option>
                              {csvHeaders.map((header) => (
                                <option key={header} value={header} className="text-gray-950 bg-white">{header}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                    <div>
                      <Label className="text-gray-300">Target List</Label>
                      <select value={selectedUploadListId} onChange={(e) => setSelectedUploadListId(e.target.value)}
                        className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm">
                        {isAdmin && <option value="create-new" className="text-gray-950 bg-white">Create new list</option>}
                        {leadLists.map((l: any) => <option key={l.id} value={l.id} className="text-gray-950 bg-white">{l.name}</option>)}
                      </select>
                    </div>
                    <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleUploadLeads}>
                      Upload &amp; Import
                    </Button>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {isAdmin && (
            <Dialog open={showCreateList} onOpenChange={setShowCreateList}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="w-4 h-4 mr-2" />New List
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-gray-900 border-gray-800 text-white">
                <DialogHeader><DialogTitle>Create Lead List</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-4">
                  <div>
                    <Label className="text-gray-300">List Name</Label>
                    <Input value={newListName} onChange={(e) => setNewListName(e.target.value)}
                      placeholder="Enter list name" className="bg-gray-800 border-gray-700 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Description</Label>
                    <Textarea value={newListDesc} onChange={(e) => setNewListDesc(e.target.value)}
                      placeholder="Optional description" className="bg-gray-800 border-gray-700 text-white mt-1" />
                  </div>
                  <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleCreateList}>
                    Create List
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-gray-900 border border-gray-800">
          <TabsTrigger value="lists" className="data-[state=active]:bg-gray-800">Lead Lists</TabsTrigger>
          <TabsTrigger value="leads" className="data-[state=active]:bg-gray-800">All Leads</TabsTrigger>
        </TabsList>

        <TabsContent value="lists" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {leadLists.map((list: any) => (
              <Card key={list.id} className="bg-gray-900 border-gray-800 hover:border-gray-700 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <List className="w-5 h-5 text-blue-400" />
                    </div>
                    <Badge className={list.status === "active" ? "bg-green-500/20 text-green-400 animate-pulse" : "bg-gray-500/20 text-gray-400"}>
                      {list.status}
                    </Badge>
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-1">{list.name}</h3>
                  <p className="text-xs text-gray-500 mb-4">Created {new Date(list.createdAt).toLocaleDateString()}</p>
                  <div className="flex items-center gap-4 text-sm mb-4">
                    <span className="text-gray-400">
                      <Users className="w-4 h-4 inline mr-1" />
                      {(list.totalLeads ?? 0).toLocaleString()} leads
                    </span>
                    <span className="text-gray-400">
                      <Phone className="w-4 h-4 inline mr-1" />
                      {(list.calledLeads ?? 0).toLocaleString()} called
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2 mb-4">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${(list.totalLeads ?? 0) > 0 ? ((list.calledLeads || 0) / list.totalLeads) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => { setSelectedListId(list.id); setActiveTab("leads"); }}
                      className="text-gray-400 hover:text-white h-8 px-2"
                    >
                      <Eye className="w-4 h-4 mr-1" /> View
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { setAssigningListId(list.id); setAssignCallerId(""); setShowAssign(true); }}
                        className="text-blue-400 hover:text-blue-300 h-8 px-2"
                      >
                        <Users className="w-4 h-4 mr-1" /> Assign
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => handleDeleteList(list.id)}
                        className="text-gray-400 hover:text-red-400 h-8 px-2 ml-auto"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leads" className="mt-4">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search leads..."
                className="pl-10 bg-gray-900 border-gray-800 text-white"
              />
            </div>
            <select
              value={selectedListId || ""}
              onChange={(e) => setSelectedListId(parseInt(e.target.value) || null)}
              className="bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-white text-sm animate-none"
            >
              {leadLists.map((l: any) => <option key={l.id} value={l.id} className="text-gray-950 bg-white">{l.name}</option>)}
            </select>
            {selectedListId && (
              <Button onClick={() => { resetLeadForm(); setShowAddLead(true); }} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" /> Add Lead
              </Button>
            )}
          </div>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Lead</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Contact</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Designation</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Location</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Status</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Priority</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.map((lead: any) => (
                      <tr key={lead.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium text-white">{lead.firstName} {lead.lastName}</p>
                            <p className="text-xs text-gray-500">{lead.companyName}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <p className="text-sm text-gray-300 flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {lead.phone}
                            </p>
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <Mail className="w-3 h-3" /> {lead.email}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">
                          <span className="flex items-center gap-1">
                            <Briefcase className="w-3 h-3" /> {lead.designation}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {lead.city}
                          </span>
                        </td>
                        <td className="px-4 py-3">{getStatusBadge(lead.status || "")}</td>
                        <td className="px-4 py-3">{getPriorityBadge(lead.priority || "")}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleEditLeadClick(lead)}
                              className="text-gray-400 hover:text-white h-8 px-2"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleDeleteLead(lead.id)}
                              className="text-gray-400 hover:text-red-400 h-8 px-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredLeads.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-gray-500">
                          No leads found in this list.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Manual Add Lead Dialog */}
      <Dialog open={showAddLead} onOpenChange={setShowAddLead}>
        <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Lead</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 mt-4 text-left">
            <div>
              <Label className="text-gray-300">First Name</Label>
              <Input 
                value={leadFormData.firstName}
                onChange={(e) => setLeadFormData({ ...leadFormData, firstName: e.target.value })}
                placeholder="John" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Last Name</Label>
              <Input 
                value={leadFormData.lastName}
                onChange={(e) => setLeadFormData({ ...leadFormData, lastName: e.target.value })}
                placeholder="Doe" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Phone <span className="text-red-500">*</span></Label>
              <Input 
                value={leadFormData.phone}
                onChange={(e) => setLeadFormData({ ...leadFormData, phone: e.target.value })}
                placeholder="+1-555-1234" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Email</Label>
              <Input 
                value={leadFormData.email}
                onChange={(e) => setLeadFormData({ ...leadFormData, email: e.target.value })}
                placeholder="john.doe@example.com" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Company Name</Label>
              <Input 
                value={leadFormData.companyName}
                onChange={(e) => setLeadFormData({ ...leadFormData, companyName: e.target.value })}
                placeholder="Acme Corp" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Designation</Label>
              <Input 
                value={leadFormData.designation}
                onChange={(e) => setLeadFormData({ ...leadFormData, designation: e.target.value })}
                placeholder="Sales Manager" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div className="col-span-2">
              <Label className="text-gray-300">Address</Label>
              <Input 
                value={leadFormData.address}
                onChange={(e) => setLeadFormData({ ...leadFormData, address: e.target.value })}
                placeholder="123 Main St" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">City</Label>
              <Input 
                value={leadFormData.city}
                onChange={(e) => setLeadFormData({ ...leadFormData, city: e.target.value })}
                placeholder="New York" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">State</Label>
              <Input 
                value={leadFormData.state}
                onChange={(e) => setLeadFormData({ ...leadFormData, state: e.target.value })}
                placeholder="NY" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Country</Label>
              <Input 
                value={leadFormData.country}
                onChange={(e) => setLeadFormData({ ...leadFormData, country: e.target.value })}
                placeholder="USA" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Zip Code</Label>
              <Input 
                value={leadFormData.zipCode}
                onChange={(e) => setLeadFormData({ ...leadFormData, zipCode: e.target.value })}
                placeholder="10001" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Priority</Label>
              <select
                value={leadFormData.priority}
                onChange={(e) => setLeadFormData({ ...leadFormData, priority: e.target.value as "low" | "medium" | "high" | "urgent" })}
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm"
              >
                <option value="low" className="text-gray-950 bg-white">Low</option>
                <option value="medium" className="text-gray-950 bg-white">Medium</option>
                <option value="high" className="text-gray-950 bg-white">High</option>
                <option value="urgent" className="text-gray-950 bg-white">Urgent</option>
              </select>
            </div>
            <div>
              <Label className="text-gray-300">Status</Label>
              <select
                value={leadFormData.status}
                onChange={(e) => setLeadFormData({ ...leadFormData, status: e.target.value as "new" | "contacted" | "qualified" | "converted" | "unqualified" | "callback" | "dnc" })}
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm"
              >
                <option value="new" className="text-gray-950 bg-white">New</option>
                <option value="contacted" className="text-gray-950 bg-white">Contacted</option>
                <option value="qualified" className="text-gray-950 bg-white">Qualified</option>
                <option value="converted" className="text-gray-950 bg-white">Converted</option>
                <option value="unqualified" className="text-gray-950 bg-white">Unqualified</option>
                <option value="callback" className="text-gray-950 bg-white">Callback</option>
                <option value="dnc" className="text-gray-950 bg-white">Do Not Call (DNC)</option>
              </select>
            </div>
            <div className="col-span-2">
              <Label className="text-gray-300">Notes</Label>
              <Textarea 
                value={leadFormData.notes}
                onChange={(e) => setLeadFormData({ ...leadFormData, notes: e.target.value })}
                placeholder="Enter comments about the lead" 
                className="bg-gray-800 border-gray-700 text-white mt-1 h-20" 
              />
            </div>
            <Button className="w-full col-span-2 bg-blue-600 hover:bg-blue-700 mt-2" onClick={handleAddLead}>
              Create Lead
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Edit Lead Dialog */}
      <Dialog open={showEditLead} onOpenChange={setShowEditLead}>
        <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Lead</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 mt-4 text-left">
            <div>
              <Label className="text-gray-300">First Name</Label>
              <Input 
                value={leadFormData.firstName}
                onChange={(e) => setLeadFormData({ ...leadFormData, firstName: e.target.value })}
                placeholder="John" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Last Name</Label>
              <Input 
                value={leadFormData.lastName}
                onChange={(e) => setLeadFormData({ ...leadFormData, lastName: e.target.value })}
                placeholder="Doe" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Phone <span className="text-red-500">*</span></Label>
              <Input 
                value={leadFormData.phone}
                onChange={(e) => setLeadFormData({ ...leadFormData, phone: e.target.value })}
                placeholder="+1-555-1234" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Email</Label>
              <Input 
                value={leadFormData.email}
                onChange={(e) => setLeadFormData({ ...leadFormData, email: e.target.value })}
                placeholder="john.doe@example.com" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Company Name</Label>
              <Input 
                value={leadFormData.companyName}
                onChange={(e) => setLeadFormData({ ...leadFormData, companyName: e.target.value })}
                placeholder="Acme Corp" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Designation</Label>
              <Input 
                value={leadFormData.designation}
                onChange={(e) => setLeadFormData({ ...leadFormData, designation: e.target.value })}
                placeholder="Sales Manager" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div className="col-span-2">
              <Label className="text-gray-300">Address</Label>
              <Input 
                value={leadFormData.address}
                onChange={(e) => setLeadFormData({ ...leadFormData, address: e.target.value })}
                placeholder="123 Main St" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">City</Label>
              <Input 
                value={leadFormData.city}
                onChange={(e) => setLeadFormData({ ...leadFormData, city: e.target.value })}
                placeholder="New York" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">State</Label>
              <Input 
                value={leadFormData.state}
                onChange={(e) => setLeadFormData({ ...leadFormData, state: e.target.value })}
                placeholder="NY" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Country</Label>
              <Input 
                value={leadFormData.country}
                onChange={(e) => setLeadFormData({ ...leadFormData, country: e.target.value })}
                placeholder="USA" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Zip Code</Label>
              <Input 
                value={leadFormData.zipCode}
                onChange={(e) => setLeadFormData({ ...leadFormData, zipCode: e.target.value })}
                placeholder="10001" 
                className="bg-gray-800 border-gray-700 text-white mt-1" 
              />
            </div>
            <div>
              <Label className="text-gray-300">Priority</Label>
              <select
                value={leadFormData.priority}
                onChange={(e) => setLeadFormData({ ...leadFormData, priority: e.target.value as "low" | "medium" | "high" | "urgent" })}
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm"
              >
                <option value="low" className="text-gray-950 bg-white">Low</option>
                <option value="medium" className="text-gray-950 bg-white">Medium</option>
                <option value="high" className="text-gray-950 bg-white">High</option>
                <option value="urgent" className="text-gray-950 bg-white">Urgent</option>
              </select>
            </div>
            <div>
              <Label className="text-gray-300">Status</Label>
              <select
                value={leadFormData.status}
                onChange={(e) => setLeadFormData({ ...leadFormData, status: e.target.value as "new" | "contacted" | "qualified" | "converted" | "unqualified" | "callback" | "dnc" })}
                className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm"
              >
                <option value="new" className="text-gray-950 bg-white">New</option>
                <option value="contacted" className="text-gray-950 bg-white">Contacted</option>
                <option value="qualified" className="text-gray-950 bg-white">Qualified</option>
                <option value="converted" className="text-gray-950 bg-white">Converted</option>
                <option value="unqualified" className="text-gray-950 bg-white">Unqualified</option>
                <option value="callback" className="text-gray-950 bg-white">Callback</option>
                <option value="dnc" className="text-gray-950 bg-white">Do Not Call (DNC)</option>
              </select>
            </div>
            <div className="col-span-2">
              <Label className="text-gray-300">Notes</Label>
              <Textarea 
                value={leadFormData.notes}
                onChange={(e) => setLeadFormData({ ...leadFormData, notes: e.target.value })}
                placeholder="Enter comments about the lead" 
                className="bg-gray-800 border-gray-700 text-white mt-1 h-20" 
              />
            </div>
            <Button className="w-full col-span-2 bg-blue-600 hover:bg-blue-700 mt-2" onClick={handleUpdateLead}>
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
