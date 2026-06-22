import { useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  MessageSquare,
  Plus,
  Send,
  Pause,
  Play,
  Phone,
  Clock,
  List,
} from "lucide-react";

export default function SMSCampaignsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedLogCampaignId, setSelectedLogCampaignId] = useState<number | null>(null);

  // Form states
  const [newName, setNewName] = useState("");
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [fromNum, setFromNum] = useState("+1-555-0199");
  const [template, setTemplate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  // ── Sending Settings ──
  const [sendWindowStart, setSendWindowStart] = useState("09:00");
  const [sendWindowEnd, setSendWindowEnd] = useState("18:00");
  const [dailyLimit, setDailyLimit] = useState("500");
  const [randomizeOrder, setRandomizeOrder] = useState(false);
  const [randomDelay, setRandomDelay] = useState(false);
  const [randomDelayMin, setRandomDelayMin] = useState("5");
  const [randomDelayMax, setRandomDelayMax] = useState("45");

  // Queries
  const { data: campaigns = [], refetch: refetchCampaigns } = trpc.sms.list.useQuery();
  const { data: leadLists = [] } = trpc.lead.listLists.useQuery();

  // Load logs for the selected campaign
  const { data: logs = [] } = trpc.sms.logs.useQuery(
    { campaignId: selectedLogCampaignId || 0 },
    { enabled: selectedLogCampaignId !== null }
  );

  // Set default log campaign
  useEffect(() => {
    if (campaigns.length > 0 && selectedLogCampaignId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedLogCampaignId(campaigns[0].id);
    }
  }, [campaigns, selectedLogCampaignId]);

  // Mutations
  const createSMSMutation = trpc.sms.create.useMutation({
    onSuccess: () => {
      refetchCampaigns();
      setShowCreate(false);
      setNewName("");
      setSelectedListId("");
      setFromNum("+1-555-0199");
      setTemplate("");
      setScheduleTime("");
      setSendWindowStart("09:00");
      setSendWindowEnd("18:00");
      setDailyLimit("500");
      setRandomizeOrder(false);
      setRandomDelay(false);
      setRandomDelayMin("5");
      setRandomDelayMax("45");
    },
  });

  const sendSMSMutation = trpc.sms.send.useMutation({
    onSuccess: () => refetchCampaigns(),
  });

  const pauseSMSMutation = trpc.sms.pause.useMutation({
    onSuccess: () => refetchCampaigns(),
  });

  const resumeSMSMutation = trpc.sms.resume.useMutation({
    onSuccess: () => refetchCampaigns(),
  });

  const handleCreateSMS = async () => {
    if (!newName.trim() || !selectedListId || !template.trim()) return;
    // Validate sending window + limits
    if (sendWindowStart >= sendWindowEnd) {
      alert("Send window start time must be earlier than end time.");
      return;
    }
    const limit = parseInt(dailyLimit) || 0;
    if (limit <= 0) {
      alert("Daily message limit must be greater than 0.");
      return;
    }
    const dMin = parseInt(randomDelayMin) || 0;
    const dMax = parseInt(randomDelayMax) || 0;
    if (randomDelay && dMin >= dMax) {
      alert("Random delay minimum must be smaller than maximum.");
      return;
    }
    try {
      await createSMSMutation.mutateAsync({
        name: newName,
        leadListId: parseInt(selectedListId),
        messageTemplate: template,
        fromNumber: fromNum || undefined,
        scheduledAt: scheduleTime || undefined,
        settings: {
          sendWindowStart,
          sendWindowEnd,
          dailyLimit: limit,
          randomizeOrder,
          randomDelay,
          randomDelayMinSec: randomDelay ? dMin : undefined,
          randomDelayMaxSec: randomDelay ? dMax : undefined,
        },
      });
    } catch (err) {
      console.error("Failed to create SMS campaign:", err);
    }
  };

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">SMS Campaigns</h1>
          <p className="text-gray-400 mt-1">Create and manage SMS messaging campaigns</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" /> New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create SMS Campaign</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-gray-300">Campaign Name</Label>
                <Input 
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Enter campaign name" 
                  className="bg-gray-800 border-gray-700 text-white mt-1" 
                />
              </div>
              <div>
                <Label className="text-gray-300">Lead List</Label>
                <Select value={selectedListId} onValueChange={setSelectedListId}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                    <SelectValue placeholder="Select list" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {leadLists.map((l: any) => (
                      <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">From Number</Label>
                <Input 
                  value={fromNum}
                  onChange={(e) => setFromNum(e.target.value)}
                  placeholder="+1-555-0199" 
                  className="bg-gray-800 border-gray-700 text-white mt-1" 
                />
              </div>
              <div>
                <Label className="text-gray-300">Message Template</Label>
                <Textarea
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  placeholder="Hi {firstName}, ..."
                  className="bg-gray-800 border-gray-700 text-white mt-1 min-h-[100px]"
                />
                <p className="text-xs text-gray-500 mt-1">Use {'{firstName}'}, {'{lastName}'}, {'{companyName}'} as variables</p>
              </div>
              <div>
                <Label className="text-gray-300">Schedule (optional)</Label>
                <Input 
                  type="datetime-local" 
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white mt-1" 
                />
              </div>
              {/* ─── Sending Settings ─── */}
              <div className="border border-gray-800 rounded-lg p-3 space-y-3">
                <Label className="text-gray-300 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-blue-400" /> Sending Settings
                </Label>

                {/* Time window */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-gray-400 text-xs">Send Window Start</Label>
                    <Input
                      type="time"
                      value={sendWindowStart}
                      onChange={(e) => setSendWindowStart(e.target.value)}
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-400 text-xs">Send Window End</Label>
                    <Input
                      type="time"
                      value={sendWindowEnd}
                      onChange={(e) => setSendWindowEnd(e.target.value)}
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">Messages are only sent inside this time window each day.</p>

                {/* Daily limit */}
                <div>
                  <Label className="text-gray-400 text-xs">Daily Message Limit</Label>
                  <Input
                    type="number"
                    min={1}
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    placeholder="500"
                    className="bg-gray-800 border-gray-700 text-white mt-1"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">Maximum messages this campaign can send per day.</p>
                </div>

                {/* Randomization */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={randomizeOrder}
                      onChange={(e) => setRandomizeOrder(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-800 accent-blue-600"
                    />
                    <span className="text-xs text-gray-300">Randomize sending order (shuffle leads)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={randomDelay}
                      onChange={(e) => setRandomDelay(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-800 accent-blue-600"
                    />
                    <span className="text-xs text-gray-300">Random delay between messages (more natural, avoids spam flags)</span>
                  </label>
                  {randomDelay && (
                    <div className="grid grid-cols-2 gap-3 pl-6">
                      <div>
                        <Label className="text-gray-400 text-xs">Min delay (sec)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={randomDelayMin}
                          onChange={(e) => setRandomDelayMin(e.target.value)}
                          className="bg-gray-800 border-gray-700 text-white mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-gray-400 text-xs">Max delay (sec)</Label>
                        <Input
                          type="number"
                          min={2}
                          value={randomDelayMax}
                          onChange={(e) => setRandomDelayMax(e.target.value)}
                          className="bg-gray-800 border-gray-700 text-white mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleCreateSMS} disabled={createSMSMutation.isPending}>
                {createSMSMutation.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="campaigns">
        <TabsList className="bg-gray-900 border border-gray-800">
          <TabsTrigger value="campaigns" className="data-[state=active]:bg-gray-800">Campaigns</TabsTrigger>
          <TabsTrigger value="logs" className="data-[state=active]:bg-gray-800">Message Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="mt-4 space-y-4">
          {campaigns.map((campaign: any) => {
            const listName = leadLists.find((ll: any) => ll.id === campaign.leadListId)?.name || "Unknown List";
            const total = campaign.totalMessages || 0;
            const sent = campaign.sentMessages || 0;
            const delivered = campaign.deliveredMessages || 0;
            const failed = campaign.failedMessages || 0;
            const replied = campaign.repliedMessages || 0;
            const percentage = total > 0 ? Math.round((sent / total) * 100) : 0;

            return (
              <Card key={campaign.id} className="bg-gray-900 border-gray-800">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-green-400" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-white">{campaign.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          {getStatusBadge(campaign.status)}
                          <span className="text-xs text-gray-500">
                            <List className="w-3 h-3 inline mr-1" />
                            {listName}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {campaign.status === "sending" && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => pauseSMSMutation.mutate({ id: campaign.id })}
                          className="text-amber-400 hover:text-amber-300 h-8 px-2"
                        >
                          <Pause className="w-4 h-4" />
                        </Button>
                      )}
                      {campaign.status === "paused" && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => resumeSMSMutation.mutate({ id: campaign.id })}
                          className="text-green-400 hover:text-green-300 h-8 px-2"
                        >
                          <Play className="w-4 h-4" />
                        </Button>
                      )}
                      {(campaign.status === "draft" || campaign.status === "scheduled") && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => sendSMSMutation.mutate({ id: campaign.id })}
                          className="text-blue-400 hover:text-blue-300 h-8 px-2"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-gray-400 mb-3 line-clamp-2 bg-gray-800/50 rounded p-2">{campaign.messageTemplate}</p>

                  <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" /> From: {campaign.fromNumber || "+1-555-0199"}
                    </span>
                    {campaign.scheduledAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Scheduled: {new Date(campaign.scheduledAt).toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="mb-2">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-400">{sent.toLocaleString()} / {total.toLocaleString()} sent</span>
                      <span className="text-white font-medium">
                        {percentage}%
                      </span>
                    </div>
                    <Progress
                      value={percentage}
                      className="h-2 bg-gray-800"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-2 mt-3">
                    <div className="bg-gray-800/50 rounded p-2 text-center">
                      <p className="text-sm font-semibold text-green-400">{delivered.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">Delivered</p>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2 text-center">
                      <p className="text-sm font-semibold text-blue-400">{sent.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">Sent</p>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2 text-center">
                      <p className="text-sm font-semibold text-red-400">{failed.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">Failed</p>
                    </div>
                    <div className="bg-gray-800/50 rounded p-2 text-center">
                      <p className="text-sm font-semibold text-purple-400">{replied.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">Replies</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {campaigns.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              No SMS campaigns configured. Click "New Campaign" to create one.
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <div className="flex items-center gap-3 mb-4">
            <Label className="text-gray-300 text-sm whitespace-nowrap">Select Campaign:</Label>
            <select
              value={selectedLogCampaignId || ""}
              onChange={(e) => setSelectedLogCampaignId(parseInt(e.target.value) || null)}
              className="bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-white text-sm"
            >
              <option value="">Choose campaign...</option>
              {campaigns.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-white text-base">Message Logs</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">To</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Message</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Status</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Sent At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log: any) => (
                      <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-3 text-sm text-gray-300">{log.toNumber}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate">{log.message}</td>
                        <td className="px-4 py-3">
                          <Badge className={
                            log.status === "delivered" ? "bg-green-500/20 text-green-400" :
                            log.status === "replied" ? "bg-purple-500/20 text-purple-400" :
                            log.status === "sent" ? "bg-blue-500/20 text-blue-400" :
                            "bg-red-500/20 text-red-400"
                          }>
                            {log.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">{log.sentAt ? new Date(log.sentAt).toLocaleString() : "Never"}</td>
                      </tr>
                    ))}
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-gray-500">
                          No logs found for this campaign.
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
    </div>
  );
}
