import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PhoneForwarded, Smartphone, BellOff } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Where a user's inbound calls go when they are not answered in Salesvora:
 * their own cell phone, then voicemail. Also shows whether the Android app is
 * registered for this account. With no userId it edits the signed-in user.
 */
export function CallRoutingSettings({ userId, compact = false }: { userId?: number; compact?: boolean }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.user.getCallSettings.useQuery(userId ? { userId } : undefined);
  const save = trpc.user.updateCallSettings.useMutation({
    onSuccess: () => {
      toast.success("Call routing saved");
      utils.user.getCallSettings.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [fallbackNumber, setFallbackNumber] = useState("");
  const [voicemailGreeting, setVoicemailGreeting] = useState("");
  const [dnd, setDnd] = useState(false);
  useEffect(() => {
    if (!data) return;
    setFallbackNumber(data.fallbackNumber);
    setVoicemailGreeting(data.voicemailGreeting);
    setDnd(data.dnd);
  }, [data]);

  if (isLoading) return <div className="text-sm text-gray-500">Loading call routing…</div>;

  return (
    <div className={`space-y-4 ${compact ? "" : "rounded-xl border border-gray-200 dark:border-gray-800 p-4"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <PhoneForwarded className="w-4 h-4" /> Call routing
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Calls to this user's numbers ring their browser and Android app first, then the cell below, then voicemail.
          </p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
          data?.androidDevices ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400" : "bg-gray-100 text-gray-500 dark:bg-gray-800"
        }`}>
          <Smartphone className="w-3.5 h-3.5" />
          {data?.androidDevices ? `App on ${data.androidDevices} device${data.androidDevices > 1 ? "s" : ""}` : "No app yet"}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
        <Label htmlFor={`dnd-${userId ?? "me"}`} className="flex items-center gap-2 text-sm cursor-pointer">
          <BellOff className="w-4 h-4" /> Do not disturb
          <span className="text-xs text-gray-500 font-normal hidden sm:inline">— skip browser and app</span>
        </Label>
        <Switch id={`dnd-${userId ?? "me"}`} checked={dnd} onCheckedChange={setDnd} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`fb-${userId ?? "me"}`} className="text-xs">Forward unanswered calls to (cell)</Label>
          <Input
            id={`fb-${userId ?? "me"}`}
            inputMode="tel"
            placeholder="+15551234567"
            value={fallbackNumber}
            onChange={(e) => setFallbackNumber(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`vm-${userId ?? "me"}`} className="text-xs">Voicemail greeting</Label>
          <Input
            id={`vm-${userId ?? "me"}`}
            placeholder="Sorry I missed you, leave a message…"
            value={voicemailGreeting}
            onChange={(e) => setVoicemailGreeting(e.target.value)}
          />
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        disabled={save.isPending}
        onClick={() => save.mutate({ userId, fallbackNumber, voicemailGreeting, dnd })}
      >
        {save.isPending ? "Saving…" : "Save call routing"}
      </Button>
    </div>
  );
}
