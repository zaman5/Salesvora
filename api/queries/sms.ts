import { getDb, hasDatabase } from "./connection";
import { smsCampaigns, smsLogs } from "@db/schema";
import { eq, desc, sql, and, or } from "drizzle-orm";
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

export async function updateSMSCampaign(id: number, data: Partial<{ name: string; messageTemplate: string; fromNumber: string; status: string; scheduledAt: Date; settings: any }>) {
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
export async function findSMSConversation(companyId: number, otherNumber: string) {
  try {
    return await getDb().query.smsLogs.findMany({
      where: and(
        eq(smsLogs.companyId, companyId),
        or(eq(smsLogs.toNumber, otherNumber), eq(smsLogs.fromNumber, otherNumber)),
      ),
      orderBy: [smsLogs.createdAt],
    });
  } catch {
    console.warn("[findSMSConversation] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return (data.smsLogs as any[])
      .filter((sl) => sl.companyId == companyId && (sl.toNumber === otherNumber || sl.fromNumber === otherNumber))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
