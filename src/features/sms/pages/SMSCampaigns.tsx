import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare, Plus, Send, Pause, Play, Phone, Clock, List,
  CheckCircle2, XCircle, AlertCircle, Hash, Inbox, PhoneIncoming, PhoneOutgoing, Pencil,
} from "lucide-react";

const MAX_SMS_CHARS = 160;

export default function SMSCampaignsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const isSuper = user?.role === "superadmin";

  // ── Campaign creation state ──
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [fromNum, setFromNum] = useState("");
  const [template, setTemplate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [sendWindowStart, setSendWindowStart] = useState("09:00");
  const [sendWindowEnd, setSendWindowEnd] = useState("18:00");
  const [dailyLimit, setDailyLimit] = useState("500");
  const [randomizeOrder, setRandomizeOrder] = useState(false);
  const [randomDelay, setRandomDelay] = useState(false);
  const [randomDelayMin, setRandomDelayMin] = useState("5");
  const [randomDelayMax, setRandomDelayMax] = useState("45");

  // ── Single SMS state ──
  const [singleTo, setSingleTo]         = useState("");
  const [singleFrom, setSingleFrom]     = useState("");
  const [singleMsg, setSingleMsg]       = useState("");
  const [sendResult, setSendResult]     = useState<{ success: boolean; error?: string } | null>(null);
  const [selectedLogCampaignId, setSelectedLogCampaignId] = useState<number | null>(null);

  // ── Queries ──
  const { data: campaigns = [], refetch: refetchCampaigns } = trpc.sms.list.useQuery();

  const { data: adminListsData = [] } = trpc.lead.listLists.useQuery(undefined, { enabled: isAdmin });
  const { data: myListsData = [] }    = trpc.lead.myLists.useQuery(undefined, { enabled: !isAdmin });
  const leadLists = (isAdmin ? adminListsData : myListsData) as any[];

  const { data: dialerConfig } = trpc.integration.getDialerConfig.useQuery();
  const fromNumbers = (dialerConfig?.fromNumbers ?? []).filter(Boolean);

  const { data: logs = [] } = trpc.sms.logs.useQuery(
    { campaignId: selectedLogCampaignId || 0 },
    { enabled: selectedLogCampaignId !== null },
  );

  // Superadmin-only oversight: every message in the company, read-only.
  const { data: allRecords = [] } = trpc.sms.allRecords.useQuery(undefined, {
    enabled: isSuper,
    refetchInterval: 10000,
  });

  // ── Contact names: label a client's number with a real name ──
  const { data: contacts = [], refetch: refetchContacts } = trpc.sms.contacts.useQuery();
  const digitsOf = (s: string) => (s || "").replace(/\D/g, "");
  const contactName = (num: string | null | undefined): string | undefined => {
    if (!num) return undefined;
    const d = digitsOf(num);
    const hit = (contacts as any[]).find((c) => digitsOf(c.number) === d);
    return hit?.name;
  };
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft]     = useState("");
  const setNameMutation = trpc.sms.setContactName.useMutation({
    onSuccess: () => { refetchContacts(); setEditingName(false); },
  });

  // ── One conversation per client number, built server-side from EVERY
  // message the company has (not a capped recent-message window), so a
  // client with older history never drops off this list. Polled every 5s —
  // there's no push channel from the server, so this is how new replies
  // show up. "unread" = inbound messages still in status "received";
  // opening the chat marks them "read" server-side, which clears the badge.
  const { data: conversationRows = [], refetch: refetchInbox } = trpc.sms.conversations.useQuery(undefined, { refetchInterval: 5000 });
  const conversations = (conversationRows as any[]).map((c) => ({
    contact: c.number,
    last: { message: c.lastMessage, createdAt: c.lastAt, direction: c.lastDirection },
    count: c.totalCount,
    unread: c.unreadCount,
  }));
  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0);
  const totalMessages = conversations.reduce((s, c) => s + c.count, 0);

  // Short chat-style timestamp: time for today, date otherwise.
  const fmtWhen = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  // ── Conversation viewer: full two-way thread with one number ──
  const [threadWith, setThreadWith] = useState<string | null>(null);
  const [replyMsg, setReplyMsg]     = useState("");

  const { data: thread = [], refetch: refetchThread } = trpc.sms.conversation.useQuery(
    { number: threadWith || "" },
    { enabled: !!threadWith, refetchInterval: 5000 },
  );

  const replyMutation = trpc.sms.sendDirect.useMutation({
    onSuccess: () => { setReplyMsg(""); refetchThread(); },
  });

  // Clear the unread badge: opening a chat (and any new inbound message that
  // arrives while it is open) marks that client's messages read server-side.
  const markReadMutation = trpc.sms.markConversationRead.useMutation({
    onSuccess: () => refetchInbox(),
  });
  const threadInboundCount = (thread as any[]).filter((m) => m.direction === "inbound").length;
  useEffect(() => {
    if (threadWith) markReadMutation.mutate({ number: threadWith });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadWith, threadInboundCount]);

  // The company-side number of the thread (used as the reply "from") — taken
  // from the most recent message, falling back to the first available number.
  const threadOwnNumber = (() => {
    const t = thread as any[];
    for (let i = t.length - 1; i >= 0; i--) {
      const own = t[i].direction === "inbound" ? t[i].toNumber : t[i].fromNumber;
      if (own) return own as string;
    }
    return fromNumbers[0] || "";
  })();

  const handleSendReply = () => {
    if (!threadWith || !replyMsg.trim()) return;
    replyMutation.mutate({
      toNumber: threadWith,
      message: replyMsg,
      fromNumber: threadOwnNumber || undefined,
    });
  };

  // Pre-select defaults
  useEffect(() => {
    const list = campaigns as any[];
    if (list.length > 0 && selectedLogCampaignId === null)
      setSelectedLogCampaignId(list[0].id as number);
  }, [campaigns, selectedLogCampaignId]);

  useEffect(() => {
    if (fromNumbers.length > 0 && !fromNum) {
      setFromNum(fromNumbers[0]);
      setSingleFrom(fromNumbers[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialerConfig]);

  // ── Mutations ──
  const createSMSMutation = trpc.sms.create.useMutation({
    onSuccess: () => {
      refetchCampaigns();
      setShowCreate(false);
      setNewName(""); setSelectedListId(""); setTemplate(""); setScheduleTime("");
      setSendWindowStart("09:00"); setSendWindowEnd("18:00");
      setDailyLimit("500"); setRandomizeOrder(false); setRandomDelay(false);
      setRandomDelayMin("5"); setRandomDelayMax("45");
    },
  });

  const sendCampaignMutation  = trpc.sms.send.useMutation({ onSuccess: () => refetchCampaigns() });
  const pauseSMSMutation      = trpc.sms.pause.useMutation({ onSuccess: () => refetchCampaigns() });
  const resumeSMSMutation     = trpc.sms.resume.useMutation({ onSuccess: () => refetchCampaigns() });
  const sendDirectMutation    = trpc.sms.sendDirect.useMutation({
    onSuccess: (data) => {
      setSendResult(data);
      if (data.success) { setSingleTo(""); setSingleMsg(""); }
    },
    onError: (err) => setSendResult({ success: false, error: err.message }),
  });

  const handleCreateSMS = async () => {
    if (!newName.trim() || !selectedListId || !template.trim()) return;
    if (sendWindowStart >= sendWindowEnd) { alert("Send window start must be earlier than end."); return; }
    const limit = parseInt(dailyLimit) || 0;
    if (limit <= 0) { alert("Daily message limit must be greater than 0."); return; }
    try {
      await createSMSMutation.mutateAsync({
        name: newName, leadListId: parseInt(selectedListId),
        messageTemplate: template, fromNumber: fromNum || undefined,
        scheduledAt: scheduleTime || undefined,
        settings: {
          sendWindowStart, sendWindowEnd, dailyLimit: limit,
          randomizeOrder, randomDelay,
          randomDelayMinSec: randomDelay ? parseInt(randomDelayMin) : undefined,
          randomDelayMaxSec: randomDelay ? parseInt(randomDelayMax) : undefined,
        },
      });
    } catch (err) { console.error(err); }
  };

  const handleSendDirect = async () => {
    if (!singleTo.trim() || !singleMsg.trim()) return;
    setSendResult(null);
    await sendDirectMutation.mutateAsync({
      toNumber: singleTo,
      message: singleMsg,
      fromNumber: singleFrom || undefined,
    });
  };

  // SMS segment count
  const smsSegments = Math.ceil(singleMsg.length / MAX_SMS_CHARS) || 0;
  const charsLeft   = singleMsg.length === 0 ? MAX_SMS_CHARS : MAX_SMS_CHARS - (singleMsg.length % MAX_SMS_CHARS || MAX_SMS_CHARS);

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      sending: "bg-green-500/20 text-green-400 animate-pulse",
      paused: "bg-amber-500/20 text-amber-400",
      completed: "bg-blue-500/20 text-blue-400",
      scheduled: "bg-purple-500/20 text-purple-400",
      draft: "bg-gray-500/20 text-gray-400",
    };
    return <Badge className={`${colors[status] || "bg-gray-500/20"} border-0 capitalize`}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">SMS Campaigns</h1>
          <p className="text-gray-400 mt-1">Create campaigns and send direct messages</p>
        </div>

        {/* New Campaign dialog */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="w-4 h-4 mr-2" /> New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create SMS Campaign</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-gray-300">Campaign Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="Enter campaign name" className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Lead List</Label>
                <Select value={selectedListId} onValueChange={setSelectedListId}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                    <SelectValue placeholder="Select list" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700 text-white">
                    {leadLists.map((l: any) => (
                      <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">From Number</Label>
                {fromNumbers.length > 0 ? (
                  <Select value={fromNum} onValueChange={setFromNum}>
                    <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                      <SelectValue placeholder="Select number" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700 text-white">
                      {fromNumbers.map((n: string) => (
                        <SelectItem key={n} value={n} className="font-mono">{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={fromNum} onChange={(e) => setFromNum(e.target.value)}
                    placeholder="+15550001234" className="bg-gray-800 border-gray-700 text-white mt-1" />
                )}
              </div>
              <div>
                <Label className="text-gray-300">Message Template</Label>
                <Textarea value={template} onChange={(e) => setTemplate(e.target.value)}
                  placeholder={`Hi {firstName}, this is {companyName}...`}
                  className="bg-gray-800 border-gray-700 text-white mt-1 min-h-[100px]" />
                <p className="text-xs text-gray-500 mt-1">
                  Variables: {"{firstName}"}, {"{lastName}"}, {"{companyName}"}
                  {template.length > 0 && ` · ${template.length} chars`}
                </p>
              </div>
              <div>
                <Label className="text-gray-300">Schedule (optional)</Label>
                <Input type="datetime-local" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white mt-1" />
              </div>

              {/* Sending Settings */}
              <div className="border border-gray-700 rounded-lg p-3 space-y-3">
                <Label className="text-gray-300 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-blue-400" /> Sending Settings
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-gray-400 text-xs">Window Start</Label>
                    <Input type="time" value={sendWindowStart} onChange={(e) => setSendWindowStart(e.target.value)}
                      className="bg-gray-800 border-gray-700 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-400 text-xs">Window End</Label>
                    <Input type="time" value={sendWindowEnd} onChange={(e) => setSendWindowEnd(e.target.value)}
                      className="bg-gray-800 border-gray-700 text-white mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Daily Message Limit</Label>
                  <Input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)}
                    className="bg-gray-800 border-gray-700 text-white mt-1" />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={randomizeOrder} onChange={(e) => setRandomizeOrder(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-800 accent-blue-600" />
                    <span className="text-xs text-gray-300">Randomize sending order</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={randomDelay} onChange={(e) => setRandomDelay(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-800 accent-blue-600" />
                    <span className="text-xs text-gray-300">Random delay between messages</span>
                  </label>
                  {randomDelay && (
                    <div className="grid grid-cols-2 gap-3 pl-6">
                      <div>
                        <Label className="text-gray-400 text-xs">Min delay (sec)</Label>
                        <Input type="number" min={1} value={randomDelayMin} onChange={(e) => setRandomDelayMin(e.target.value)}
                          className="bg-gray-800 border-gray-700 text-white mt-1" />
                      </div>
                      <div>
                        <Label className="text-gray-400 text-xs">Max delay (sec)</Label>
                        <Input type="number" min={2} value={randomDelayMax} onChange={(e) => setRandomDelayMax(e.target.value)}
                          className="bg-gray-800 border-gray-700 text-white mt-1" />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={handleCreateSMS}
                disabled={createSMSMutation.isPending || !newName.trim() || !selectedListId || !template.trim()}>
                {createSMSMutation.isPending ? "Creating…" : "Create Campaign"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="campaigns">
        <TabsList className="bg-gray-900 border border-gray-800">
          <TabsTrigger value="campaigns" className="data-[state=active]:bg-gray-800 text-white">
            <MessageSquare className="w-4 h-4 mr-1.5" /> Campaigns
          </TabsTrigger>
          <TabsTrigger value="send" className="data-[state=active]:bg-gray-800 text-white">
            <Send className="w-4 h-4 mr-1.5" /> Send SMS
          </TabsTrigger>
          <TabsTrigger value="logs" className="data-[state=active]:bg-gray-800 text-white">
            <List className="w-4 h-4 mr-1.5" /> Message Logs
          </TabsTrigger>
          <TabsTrigger value="inbox" className="data-[state=active]:bg-gray-800 text-white">
            <Inbox className="w-4 h-4 mr-1.5" /> Inbox
            {totalUnread > 0 && (
              <span className="ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-green-500 text-white text-[10px] font-bold flex items-center justify-center">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </TabsTrigger>
          {isSuper && (
            <TabsTrigger value="records" className="data-[state=active]:bg-gray-800 text-white">
              <List className="w-4 h-4 mr-1.5" /> All Records
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Campaigns tab ── */}
        <TabsContent value="campaigns" className="mt-4 space-y-4">
          {campaigns.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No SMS campaigns yet.</p>
              <p className="text-xs mt-1">Click "New Campaign" to get started.</p>
            </div>
          ) : (
            (campaigns as any[]).map((campaign) => {
              const listName = (leadLists.find((ll: any) => ll.id === campaign.leadListId) as any)?.name || "Unknown List";
              const total = campaign.totalMessages || 0;
              const sent = campaign.sentMessages || 0;
              const delivered = campaign.deliveredMessages || 0;
              const failed = campaign.failedMessages || 0;
              const replied = campaign.repliedMessages || 0;
              const pct = total > 0 ? Math.round((sent / total) * 100) : 0;

              return (
                <Card key={campaign.id} className="bg-gray-900 border-gray-800">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                          <MessageSquare className="w-5 h-5 text-green-400" />
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-white">{campaign.name}</h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            {getStatusBadge(campaign.status)}
                            <span className="text-xs text-gray-500">
                              <List className="w-3 h-3 inline mr-1" />{listName}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        {campaign.status === "sending" && (
                          <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white h-8 px-3"
                            onClick={() => pauseSMSMutation.mutate({ id: campaign.id })}>
                            <Pause className="w-3.5 h-3.5 mr-1" /> Pause
                          </Button>
                        )}
                        {campaign.status === "paused" && (
                          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-8 px-3"
                            onClick={() => resumeSMSMutation.mutate({ id: campaign.id })}>
                            <Play className="w-3.5 h-3.5 mr-1" /> Resume
                          </Button>
                        )}
                        {(campaign.status === "draft" || campaign.status === "scheduled") && (
                          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-8 px-3"
                            onClick={() => sendCampaignMutation.mutate({ id: campaign.id })}>
                            <Send className="w-3.5 h-3.5 mr-1" /> Send
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Message preview */}
                    <p className="text-sm text-gray-300 mb-3 bg-gray-800 rounded-lg px-3 py-2 line-clamp-2 border border-gray-700">
                      {campaign.messageTemplate}
                    </p>

                    <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {campaign.fromNumber || "Not set"}
                      </span>
                      {campaign.scheduledAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {new Date(campaign.scheduledAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* Progress */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">{sent.toLocaleString()} / {total.toLocaleString()} sent</span>
                        <span className="text-white font-medium">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5 bg-gray-800" />
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "Delivered", value: delivered, color: "text-green-400" },
                        { label: "Sent", value: sent, color: "text-blue-400" },
                        { label: "Failed", value: failed, color: "text-red-400" },
                        { label: "Replies", value: replied, color: "text-purple-400" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-gray-800 rounded-lg p-2 text-center">
                          <p className={`text-sm font-semibold ${color}`}>{value.toLocaleString()}</p>
                          <p className="text-xs text-gray-500">{label}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* ── Send SMS tab ── */}
        <TabsContent value="send" className="mt-4">
          <div className="max-w-lg mx-auto space-y-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Send className="w-5 h-5 text-blue-400" /> Send a Single SMS
                </CardTitle>
                <p className="text-sm text-gray-400 mt-1">
                  Send a one-off message directly to any phone number.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">

                {/* From number */}
                <div>
                  <Label className="text-gray-300">From Number</Label>
                  {fromNumbers.length > 0 ? (
                    <Select value={singleFrom} onValueChange={setSingleFrom}>
                      <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                        <SelectValue placeholder="Select number" />
                      </SelectTrigger>
                      <SelectContent className="bg-gray-800 border-gray-700 text-white">
                        {fromNumbers.map((n: string) => (
                          <SelectItem key={n} value={n} className="font-mono">{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={singleFrom} onChange={(e) => setSingleFrom(e.target.value)}
                      placeholder="+15550001234"
                      className="bg-gray-800 border-gray-700 text-white mt-1" />
                  )}
                  {fromNumbers.length === 0 && (
                    <p className="text-xs text-amber-400 mt-1">
                      No numbers configured — add them in Settings → Integration.
                    </p>
                  )}
                </div>

                {/* To number */}
                <div>
                  <Label className="text-gray-300">To Number</Label>
                  <Input
                    value={singleTo}
                    onChange={(e) => setSingleTo(e.target.value)}
                    placeholder="+15550009876"
                    className="bg-gray-800 border-gray-700 text-white mt-1 font-mono"
                  />
                </div>

                {/* Message */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-gray-300">Message</Label>
                    <div className="flex items-center gap-2 text-xs">
                      {singleMsg.length > 0 && (
                        <>
                          <span className={charsLeft < 20 ? "text-amber-400" : "text-gray-500"}>
                            {charsLeft} chars left
                          </span>
                          {smsSegments > 1 && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-0 text-[10px]">
                              <Hash className="w-3 h-3 mr-0.5" /> {smsSegments} SMS
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <Textarea
                    value={singleMsg}
                    onChange={(e) => setSingleMsg(e.target.value)}
                    placeholder="Type your message here…"
                    className="bg-gray-800 border-gray-700 text-white min-h-[120px] resize-none"
                    maxLength={MAX_SMS_CHARS * 5}
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Standard SMS = 160 characters · Unicode characters reduce limit to 70.
                  </p>
                </div>

                {/* Result banner */}
                {sendResult && (
                  <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${
                    sendResult.success
                      ? "bg-green-500/10 border-green-500/30"
                      : "bg-red-500/10 border-red-500/30"
                  }`}>
                    {sendResult.success
                      ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                      : <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />}
                    <div>
                      <p className={`text-sm font-semibold ${sendResult.success ? "text-green-300" : "text-red-300"}`}>
                        {sendResult.success ? "Message sent successfully!" : "Failed to send"}
                      </p>
                      {sendResult.error && (
                        <p className="text-xs text-red-400 mt-0.5">{sendResult.error}</p>
                      )}
                      {sendResult.success && !dialerConfig?.enabled && (
                        <p className="text-xs text-amber-400 mt-0.5 flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Telnyx not fully configured — message was logged but may not have been delivered.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <Button
                  className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-semibold"
                  onClick={handleSendDirect}
                  disabled={!singleTo.trim() || !singleMsg.trim() || sendDirectMutation.isPending}
                >
                  {sendDirectMutation.isPending
                    ? <><span className="animate-spin mr-2">⟳</span> Sending…</>
                    : <><Send className="w-4 h-4 mr-2" /> Send Message</>}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Message Logs tab ── */}
        <TabsContent value="logs" className="mt-4">
          {campaigns.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <Label className="text-gray-300 text-sm whitespace-nowrap">Campaign:</Label>
              <select
                value={selectedLogCampaignId || ""}
                onChange={(e) => setSelectedLogCampaignId(parseInt(e.target.value) || null)}
                className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-white text-sm flex-1 max-w-xs"
              >
                <option value="">Choose campaign…</option>
                {(campaigns as any[]).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-white text-base">Message Logs</CardTitle>
              <span className="text-xs text-gray-500">{(logs as any[]).length} records</span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">To</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">From</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Message</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Sent At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(logs as any[]).map((log) => (
                      <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-3 text-sm text-white font-mono">{log.toNumber}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 font-mono">{log.fromNumber || "—"}</td>
                        <td className="px-4 py-3 text-sm text-gray-300 max-w-xs truncate">{log.message}</td>
                        <td className="px-4 py-3">
                          <Badge className={
                            log.status === "delivered" ? "bg-green-500/20 text-green-400 border-0" :
                            log.status === "replied"   ? "bg-purple-500/20 text-purple-400 border-0" :
                            log.status === "sent"      ? "bg-blue-500/20 text-blue-400 border-0" :
                            "bg-red-500/20 text-red-400 border-0"
                          }>
                            {log.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {log.sentAt ? new Date(log.sentAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                    {(logs as any[]).length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-gray-500">
                          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          {selectedLogCampaignId ? "No logs for this campaign." : "Select a campaign above."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Inbox tab: one conversation per client, like a chat app ── */}
        <TabsContent value="inbox" className="mt-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-white text-base">Conversations</CardTitle>
              <span className="text-xs text-gray-500">
                {conversations.length} chat{conversations.length === 1 ? "" : "s"} · {totalMessages} messages
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-800/70">
                {conversations.map((c) => {
                  const name = contactName(c.contact);
                  const inbound = c.last.direction === "inbound";
                  const initials = name
                    ? name.split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
                    : null;
                  return (
                    <button
                      key={digitsOf(c.contact)}
                      onClick={() => setThreadWith(c.contact)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-800/40 transition-colors flex items-center gap-3"
                    >
                      {/* Avatar */}
                      <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold ${
                        name ? "bg-blue-500/20 text-blue-300" : "bg-gray-800 text-gray-400"
                      }`}>
                        {initials || <MessageSquare className="w-4 h-4" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-sm ${c.unread > 0 ? "font-bold text-white" : "font-semibold text-white"} ${name ? "" : "font-mono"}`}>
                            {name || c.contact}
                          </span>
                          <span className={`text-[11px] shrink-0 ${c.unread > 0 ? "text-green-400 font-semibold" : "text-gray-500"}`}>
                            {fmtWhen(c.last.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {inbound
                            ? <PhoneIncoming className={`w-3 h-3 shrink-0 ${c.unread > 0 ? "text-green-400" : "text-blue-400"}`} />
                            : <PhoneOutgoing className="w-3 h-3 text-gray-500 shrink-0" />}
                          <span className={`text-xs truncate ${c.unread > 0 ? "text-gray-200 font-medium" : "text-gray-400"}`}>
                            {c.last.message}
                          </span>
                        </div>
                        {name && (
                          <span className="text-[10px] text-gray-600 font-mono">{c.contact}</span>
                        )}
                      </div>

                      {c.unread > 0 ? (
                        <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-green-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      ) : (
                        <Badge className="bg-gray-800 text-gray-400 border-0 shrink-0 text-[10px]">{c.count}</Badge>
                      )}
                    </button>
                  );
                })}
                {conversations.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No conversations yet.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Conversation dialog: full thread + reply ── */}
          <Dialog open={!!threadWith} onOpenChange={(o) => { if (!o) { setThreadWith(null); setReplyMsg(""); setEditingName(false); } }}>
            <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-blue-400 shrink-0" />
                  {editingName ? (
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      <Input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        placeholder="Client name"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && threadWith) setNameMutation.mutate({ number: threadWith, name: nameDraft });
                          if (e.key === "Escape") setEditingName(false);
                        }}
                        className="bg-gray-800 border-gray-700 text-white h-8 text-sm flex-1"
                      />
                      <Button
                        size="sm" className="bg-green-600 hover:bg-green-700 text-white h-8 px-2 shrink-0"
                        disabled={setNameMutation.isPending}
                        onClick={() => threadWith && setNameMutation.mutate({ number: threadWith, name: nameDraft })}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>
                    </span>
                  ) : (
                    <span className="flex items-baseline gap-2 flex-1 min-w-0">
                      {contactName(threadWith) ? (
                        <>
                          <span className="truncate">{contactName(threadWith)}</span>
                          <span className="font-mono text-xs text-gray-500 shrink-0">{threadWith}</span>
                        </>
                      ) : (
                        <span className="font-mono truncate">{threadWith}</span>
                      )}
                      <Button
                        variant="ghost" size="sm"
                        className="text-gray-400 hover:text-white h-7 px-2 shrink-0 text-xs"
                        title="Name this client"
                        onClick={() => { setNameDraft(contactName(threadWith) || ""); setEditingName(true); }}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" /> {contactName(threadWith) ? "Rename" : "Add name"}
                      </Button>
                    </span>
                  )}
                </DialogTitle>
              </DialogHeader>

              {/* Full message history — complete text, both directions */}
              <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1 mt-2">
                {(thread as any[]).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-6">No messages with this number yet.</p>
                )}
                {(thread as any[]).map((m) => {
                  const inbound = m.direction === "inbound";
                  return (
                    <div key={m.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${inbound ? "bg-gray-800 text-gray-100" : "bg-blue-600 text-white"}`}>
                        <p className="text-sm whitespace-pre-wrap break-words">{m.message}</p>
                        <p className={`text-[10px] mt-1 ${inbound ? "text-gray-500" : "text-blue-200"}`}>
                          {inbound ? "Received" : "Sent"}
                          {m.createdAt ? ` · ${new Date(m.createdAt).toLocaleString()}` : ""}
                          {!inbound && m.status ? ` · ${m.status}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reply box */}
              <div className="flex items-end gap-2 pt-3 border-t border-gray-800">
                <Textarea
                  value={replyMsg}
                  onChange={(e) => setReplyMsg(e.target.value)}
                  placeholder={threadOwnNumber ? `Reply from ${threadOwnNumber}…` : "Type a reply…"}
                  className="bg-gray-800 border-gray-700 text-white min-h-[44px] max-h-28 flex-1 resize-none"
                />
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white shrink-0 h-10"
                  onClick={handleSendReply}
                  disabled={!replyMsg.trim() || replyMutation.isPending}
                >
                  {replyMutation.isPending ? <span className="animate-spin">⟳</span> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ── All Records tab (superadmin only): read-only audit of every
            message in the company — chats stay private to their owners. ── */}
        {isSuper && (
          <TabsContent value="records" className="mt-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-white text-base">All Message Records</CardTitle>
                <span className="text-xs text-gray-500">{(allRecords as any[]).length} records</span>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Direction</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Client</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Our Number</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Message</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(allRecords as any[]).map((log) => {
                        const inbound = log.direction === "inbound";
                        const client = inbound ? log.fromNumber : log.toNumber;
                        const ours   = inbound ? log.toNumber : log.fromNumber;
                        return (
                          <tr key={log.id} className={`border-b border-gray-800/50 ${inbound ? "bg-blue-500/5" : ""}`}>
                            <td className="px-4 py-3">
                              {inbound ? (
                                <span className="flex items-center gap-1 text-xs text-blue-400">
                                  <PhoneIncoming className="w-3.5 h-3.5" /> Received
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs text-gray-400">
                                  <PhoneOutgoing className="w-3.5 h-3.5" /> Sent
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-white">
                              {contactName(client) ? (
                                <>
                                  <span>{contactName(client)}</span>
                                  <span className="block text-[10px] text-gray-600 font-mono">{client}</span>
                                </>
                              ) : (
                                <span className="font-mono">{client || "—"}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-400 font-mono">{ours || "—"}</td>
                            <td className="px-4 py-3 text-sm text-gray-300 max-w-sm truncate" title={log.message}>{log.message}</td>
                            <td className="px-4 py-3">
                              <Badge className={
                                log.status === "delivered" || log.status === "received" || log.status === "read"
                                  ? "bg-green-500/20 text-green-400 border-0" :
                                log.status === "replied" ? "bg-purple-500/20 text-purple-400 border-0" :
                                log.status === "sent"    ? "bg-blue-500/20 text-blue-400 border-0" :
                                "bg-red-500/20 text-red-400 border-0"
                              }>
                                {log.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                              {new Date(log.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                      {(allRecords as any[]).length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center py-10 text-gray-500">
                            <List className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            No message records yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}