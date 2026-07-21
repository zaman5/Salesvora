import { getDb, hasDatabase } from "./connection";
import { smsCampaigns, smsLogs } from "@db/schema";
import { eq, desc, sql, and, or, count } from "drizzle-orm";
import { readJsonDb, writeJsonDb } from "./jsonDb";

export async function findSMSCampaignsByCompany(companyId?: number) {
  try {
    return await getDb().query.smsCampaigns.findMany({
      where: companyId === undefined ? undefined : eq(smsCampaigns.companyId, companyId),
      orderBy: [desc(smsCampaigns.createdAt)],
    });
  } catch {
    console.warn("[findSMSCampaignsByCompany] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.smsCampaigns
      .filter((sc: any) => companyId === undefined || sc.companyId == companyId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function findSMSCampaignById(id: number) {
  try {
    return await getDb().query.smsCampaigns.findFirst({
      where: eq(smsCampaigns.id, id),
    });
  } catch {
    console.warn("[findSMSCampaignById] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.smsCampaigns.find((sc: any) => sc.id == id) || null;
  }
}

export async function createSMSCampaign(data: { name: string; companyId: number; leadListId: number; createdBy: number; messageTemplate: string; fromNumber?: string; status: string; scheduledAt?: Date; settings?: any }) {
  try {
    const result = await getDb().insert(smsCampaigns).values({
      ...data,
      status: data.status as any,
      totalMessages: 0,
      sentMessages: 0,
      failedMessages: 0,
      deliveredMessages: 0,
      repliedMessages: 0,
    }).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createSMSCampaign] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newCamp = {
      id,
      ...data,
      totalMessages: 0,
      sentMessages: 0,
      failedMessages: 0,
      deliveredMessages: 0,
      repliedMessages: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.smsCampaigns.push(newCamp);
    writeJsonDb(store);
    return id;
  }
}

export async function updateSMSCampaign(id: number, data: Partial<{ name: string; messageTemplate: string; fromNumber: string; status: string; scheduledAt: Date; settings: any; totalMessages: number }>) {
  try {
    await getDb().update(smsCampaigns).set(data as any).where(eq(smsCampaigns.id, id));
  } catch {
    console.warn("[updateSMSCampaign] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.smsCampaigns.findIndex((sc: any) => sc.id == id);
    if (idx !== -1) {
      store.smsCampaigns[idx] = {
        ...store.smsCampaigns[idx],
        ...data,
        updatedAt: new Date().toISOString()
      };
      writeJsonDb(store);
    }
  }
}

// ─── SMS Logs ───
export async function findSMSLogsByCampaign(smsCampaignId: number) {
  try {
    return await getDb().query.smsLogs.findMany({
      where: eq(smsLogs.smsCampaignId, smsCampaignId),
      orderBy: [desc(smsLogs.createdAt)],
    });
  } catch {
    console.warn("[findSMSLogsByCampaign] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.smsLogs
      .filter((sl: any) => sl.smsCampaignId == smsCampaignId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function createSMSLog(data: {
  smsCampaignId?: number | null;
  leadId?: number | null;
  companyId?: number;
  direction?: "outbound" | "inbound";
  toNumber: string;
  fromNumber?: string;
  message: string;
  status: string;
  twilioSid?: string;
  sentAt?: Date;
}) {
  if (!hasDatabase()) {
    const store = readJsonDb();
    const id = Date.now();
    const newLog = {
      id,
      ...data,
      createdAt: new Date().toISOString()
    };
    store.smsLogs.push(newLog);
    writeJsonDb(store);
    return id;
  }
  const result = await getDb().insert(smsLogs).values({
    ...data,
    status: data.status as any,
  }).$returningId();
  return result[0]?.id;
}

/** All SMS (outbound + inbound) for a company, newest first — used for the Message Logs / inbox view. */
export async function findSMSLogsByCompany(companyId: number, limit = 200) {
  try {
    return await getDb().query.smsLogs.findMany({
      where: eq(smsLogs.companyId, companyId),
      orderBy: [desc(smsLogs.createdAt)],
      limit,
    });
  } catch {
    console.warn("[findSMSLogsByCompany] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return (data.smsLogs as any[])
      .filter((sl) => sl.companyId == companyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
}

/** Full two-way thread with one phone number (matches either side of the conversation). */
/**
 * Every plausible stored spelling of a phone number. Logs written before
 * numbers were normalized may hold "3022403311", "13022403311" or
 * "+13022403311" for the same client — exact equality split one client's
 * chat into several and made threads miss messages.
 */
function numberVariants(n: string): string[] {
  const digits = (n || "").replace(/[^0-9]/g, "");
  const v = new Set<string>([n, digits, `+${digits}`]);
  if (digits.length === 10) {
    v.add(`1${digits}`);
    v.add(`+1${digits}`);
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    const ten = digits.slice(1);
    v.add(ten);
    v.add(`+${ten}`);
  }
  return [...v].filter(Boolean);
}

export async function findSMSConversation(companyId: number, otherNumber: string) {
  const variants = numberVariants(otherNumber);
  try {
    return await getDb().query.smsLogs.findMany({
      where: and(
        eq(smsLogs.companyId, companyId),
        or(...variants.flatMap((v) => [eq(smsLogs.toNumber, v), eq(smsLogs.fromNumber, v)])),
      ),
      orderBy: [smsLogs.createdAt],
    });
  } catch {
    console.warn("[findSMSConversation] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return (data.smsLogs as any[])
      .filter((sl) => sl.companyId == companyId && (variants.includes(sl.toNumber) || variants.includes(sl.fromNumber)))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
}

/**
 * Mark every unread inbound message from one client as read. Inbound logs
 * arrive with status "received" (unread); opening the conversation flips
 * them to "read" so the inbox unread badge clears. Reuses the status column
 * — no schema change, works on both the SQL and JSON stores.
 */
export async function markConversationRead(companyId: number, otherNumber: string) {
  const variants = numberVariants(otherNumber);
  try {
    await getDb().update(smsLogs)
      .set({ status: "read" as any })
      .where(and(
        eq(smsLogs.companyId, companyId),
        eq(smsLogs.direction, "inbound" as any),
        eq(smsLogs.status, "received" as any),
        or(...variants.map((v) => eq(smsLogs.fromNumber, v))),
      ));
  } catch {
    console.warn("[markConversationRead] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    let changed = false;
    for (const sl of store.smsLogs as any[]) {
      if (sl.companyId == companyId && sl.direction === "inbound" && sl.status === "received" && variants.includes(sl.fromNumber)) {
        sl.status = "read";
        changed = true;
      }
    }
    if (changed) writeJsonDb(store);
  }
}

/** Every SMS log for a company, oldest first, with no limit/slice applied. */
export async function findAllSMSLogsByCompany(companyId: number) {
  try {
    return await getDb().query.smsLogs.findMany({
      where: eq(smsLogs.companyId, companyId),
      orderBy: [smsLogs.createdAt],
    });
  } catch {
    console.warn("[findAllSMSLogsByCompany] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return (data.smsLogs as any[])
      .filter((sl) => sl.companyId == companyId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
}

/**
 * One summary row per client phone number, built from EVERY log passed in
 * (oldest first) — unlike findSMSLogsByCompany's capped feed, a client whose
 * messages have aged out of that cap still shows up here.
 */
export function groupSMSLogsIntoConversations(logs: any[]) {
  const digitsOf = (s: string) => (s || "").replace(/\D/g, "");
  const map = new Map<string, { number: string; lastMessage: string; lastDirection: string; lastAt: string; totalCount: number; unreadCount: number }>();
  for (const log of logs) {
    const contact = log.direction === "inbound" ? log.fromNumber : log.toNumber;
    if (!contact) continue;
    const key = digitsOf(contact);
    const isUnread = log.direction === "inbound" && log.status === "received" ? 1 : 0;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        number: contact,
        lastMessage: log.message,
        lastDirection: log.direction,
        lastAt: log.createdAt,
        totalCount: 1,
        unreadCount: isUnread,
      });
    } else {
      cur.totalCount++;
      cur.unreadCount += isUnread;
      // logs are ordered oldest → newest, so the latest one processed is the most recent
      cur.number = contact;
      cur.lastMessage = log.message;
      cur.lastDirection = log.direction;
      cur.lastAt = log.createdAt;
    }
  }
  return [...map.values()].sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
}

/** Company-wide sent/received/unread totals — counted over every log, not a capped window. */
export async function getSMSStats(companyId: number) {
  try {
    const [sentR] = await getDb().select({ value: count() })
      .from(smsLogs).where(and(eq(smsLogs.companyId, companyId), eq(smsLogs.direction, "outbound" as any)));
    const [receivedR] = await getDb().select({ value: count() })
      .from(smsLogs).where(and(eq(smsLogs.companyId, companyId), eq(smsLogs.direction, "inbound" as any)));
    const [unreadR] = await getDb().select({ value: count() })
      .from(smsLogs).where(and(
        eq(smsLogs.companyId, companyId),
        eq(smsLogs.direction, "inbound" as any),
        eq(smsLogs.status, "received" as any),
      ));
    return { totalSent: sentR.value, totalReceived: receivedR.value, unreadCount: unreadR.value };
  } catch {
    console.warn("[getSMSStats] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const companyLogs = (data.smsLogs as any[]).filter((sl) => sl.companyId == companyId);
    return {
      totalSent: companyLogs.filter((sl) => sl.direction === "outbound").length,
      totalReceived: companyLogs.filter((sl) => sl.direction === "inbound").length,
      unreadCount: companyLogs.filter((sl) => sl.direction === "inbound" && sl.status === "received").length,
    };
  }
}

export async function updateSMSLogStatus(id: number, status: string, twilioSid?: string, error?: string) {
  try {
    const updateData: any = { status: status as any };
    if (twilioSid) updateData.twilioSid = twilioSid;
    if (error) updateData.errorMessage = error;
    if (status === "sent") updateData.sentAt = new Date();
    if (status === "delivered") updateData.deliveredAt = new Date();
    
    await getDb().update(smsLogs).set(updateData).where(eq(smsLogs.id, id));
  } catch {
    console.warn("[updateSMSLogStatus] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.smsLogs.findIndex((sl: any) => sl.id == id);
    if (idx !== -1) {
      const updateData: any = { status: status as any };
      if (twilioSid) updateData.twilioSid = twilioSid;
      if (error) updateData.errorMessage = error;
      if (status === "sent") updateData.sentAt = new Date().toISOString();
      if (status === "delivered") updateData.deliveredAt = new Date().toISOString();
      store.smsLogs[idx] = {
        ...store.smsLogs[idx],
        ...updateData
      };
      writeJsonDb(store);
    }
  }
}

export async function incrementSMSStats(campaignId: number, field: "sentMessages" | "failedMessages" | "deliveredMessages" | "repliedMessages") {
  try {
    await getDb().update(smsCampaigns)
      .set({ [field]: sql`${smsCampaigns[field]} + 1` })
      .where(eq(smsCampaigns.id, campaignId));
  } catch {
    console.warn("[incrementSMSStats] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.smsCampaigns.findIndex((sc: any) => sc.id == campaignId);
    if (idx !== -1) {
      store.smsCampaigns[idx][field] = (store.smsCampaigns[idx][field] || 0) + 1;
      writeJsonDb(store);
    }
  }
}
