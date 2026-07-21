import {
  findSMSCampaignsByCompany, updateSMSCampaign, findSMSLogsByCampaign,
  createSMSLog, incrementSMSStats,
} from "../queries/sms";
import { findLeadsByList } from "../queries/leads";
import { getTelnyxConfig } from "./telnyxConfig";
import { sendSMS, toE164 } from "./telnyx";

const TICK_MS = 20_000;
const MAX_BATCH_NO_DELAY = 10;

// Per-campaign "last sent at" for the randomDelay throttle. In-memory only —
// a process restart just means one skipped tick before the next send, which
// self-heals; not worth persisting.
const lastSentAt = new Map<number, number>();

let running = false;

const digitsOf = (s: unknown) => String(s || "").replace(/\D/g, "");

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toMinutesOfDay(hhmm: string | undefined): number {
  const [h, m] = (hhmm || "00:00").split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** "HH:MM"-"HH:MM" compare against server-local time, with overnight wraparound support. */
function withinSendWindow(now: Date, startStr?: string, endStr?: string): boolean {
  if (!startStr && !endStr) return true;
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = toMinutesOfDay(startStr);
  const end = toMinutesOfDay(endStr);
  if (start <= end) return cur >= start && cur <= end;
  return cur >= start || cur <= end;
}

function personalize(template: string, lead: any): string {
  return String(template || "")
    .replace(/\{firstName\}/gi, lead.firstName || "")
    .replace(/\{lastName\}/gi, lead.lastName || "")
    .replace(/\{companyName\}/gi, lead.companyName || "");
}

async function processCampaign(campaignIn: any) {
  const now = new Date();
  let campaign = campaignIn;

  // Promote a due "scheduled" campaign to "sending".
  if (campaign.status === "scheduled") {
    if (!campaign.scheduledAt || new Date(campaign.scheduledAt) > now) return;
    await updateSMSCampaign(campaign.id, { status: "sending" });
    campaign = { ...campaign, status: "sending" };
  }
  if (campaign.status !== "sending") return;

  const allLeads = await findLeadsByList(campaign.leadListId) as any[];
  const targetLeads = allLeads.filter((l) => !l.isDeleted && l.status !== "dnc" && l.phone);

  const pastLogs = await findSMSLogsByCampaign(campaign.id) as any[];
  const contactedLeadIds = new Set(pastLogs.filter((l) => l.leadId != null).map((l) => Number(l.leadId)));
  const contactedNumbers = new Set(
    pastLogs.filter((l) => l.direction === "outbound").map((l) => digitsOf(l.toNumber)),
  );

  const eligible = targetLeads.filter(
    (l) => !contactedLeadIds.has(Number(l.id)) && !contactedNumbers.has(digitsOf(l.phone)),
  );

  if (eligible.length === 0) {
    await updateSMSCampaign(campaign.id, { status: "completed" });
    return;
  }

  if (!campaign.totalMessages) {
    await updateSMSCampaign(campaign.id, { totalMessages: targetLeads.length });
  }

  const settings = campaign.settings || {};
  if (!withinSendWindow(now, settings.sendWindowStart, settings.sendWindowEnd)) return;

  const dailyLimit = Number(settings.dailyLimit) || 500;
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const sentToday = pastLogs.filter(
    (l) => l.direction === "outbound" && new Date(l.createdAt).getTime() >= todayStart.getTime(),
  ).length;
  if (sentToday >= dailyLimit) return;

  const randomizeOrder = !!settings.randomizeOrder;
  const pool = randomizeOrder ? shuffle(eligible) : eligible;

  const randomDelay = !!settings.randomDelay;
  let batch: any[];
  if (randomDelay) {
    const last = lastSentAt.get(campaign.id) || 0;
    const min = Number(settings.randomDelayMin) || 1;
    const max = Math.max(Number(settings.randomDelayMax) || min, min);
    const waitMs = (min + Math.random() * (max - min)) * 60_000;
    if (Date.now() - last < waitMs) return;
    batch = pool.slice(0, 1);
  } else {
    const n = Math.min(MAX_BATCH_NO_DELAY, dailyLimit - sentToday, pool.length);
    batch = pool.slice(0, n);
  }

  const companyId = campaign.companyId;
  const cfg = companyId ? await getTelnyxConfig(companyId) : null;

  for (const lead of batch) {
    const to = toE164(lead.phone);
    const fromRaw = campaign.fromNumber || cfg?.defaultCallerId || "";
    const text = personalize(campaign.messageTemplate, lead);

    let success = true;
    let error: string | undefined;
    let providerMsgId: string | undefined;

    try {
      if (cfg?.apiKey && cfg?.enabled && fromRaw) {
        const result = await sendSMS(cfg.apiKey, { from: toE164(fromRaw), to, text });
        if (result.ok) {
          providerMsgId = result.data.id;
        } else {
          success = false;
          error = result.message;
        }
      }
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : "Failed to send SMS";
    }

    try {
      await createSMSLog({
        smsCampaignId: campaign.id,
        leadId: lead.id,
        companyId,
        direction: "outbound",
        toNumber: to,
        fromNumber: fromRaw ? toE164(fromRaw) : fromRaw,
        message: text,
        status: success ? "sent" : "failed",
        twilioSid: providerMsgId,
        sentAt: new Date(),
      });
      await incrementSMSStats(campaign.id, success ? "sentMessages" : "failedMessages");
    } catch (err) {
      console.error("[smsCampaignWorker] failed to log/increment stats:", error, err);
    }

    if (randomDelay) lastSentAt.set(campaign.id, Date.now());
  }
}

export async function tick() {
  if (running) return;
  running = true;
  try {
    const campaigns = await findSMSCampaignsByCompany(undefined) as any[];
    for (const campaign of campaigns) {
      if (campaign.status !== "sending" && campaign.status !== "scheduled") continue;
      try {
        await processCampaign(campaign);
      } catch (err) {
        console.error(`[smsCampaignWorker] campaign ${campaign.id} failed:`, err);
      }
    }
  } catch (err) {
    console.error("[smsCampaignWorker] tick failed:", err);
  } finally {
    running = false;
  }
}

/** Fire-and-forget an extra tick right after a user clicks Send/Resume. */
export function triggerSMSCampaignTick() {
  void tick();
}

export function startSMSCampaignWorker() {
  const g = globalThis as any;
  if (g.__smsCampaignWorkerStarted) return;
  g.__smsCampaignWorkerStarted = true;
  setInterval(() => void tick(), TICK_MS);
  console.log("[smsCampaignWorker] started");
}
