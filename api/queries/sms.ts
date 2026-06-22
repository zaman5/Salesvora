import { getDb } from "./connection";
import { smsCampaigns, smsLogs } from "@db/schema";
import { eq, desc, sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const dbJsonPath = path.resolve(process.cwd(), "db.json");

function readJsonDb() {
  if (!fs.existsSync(dbJsonPath)) {
    const initialData = { users: [], companies: [], leadLists: [], leads: [], leadListAssignments: [], campaigns: [], campaignLeads: [], calls: [], smsCampaigns: [], smsLogs: [], aiAgents: [] };
    fs.writeFileSync(dbJsonPath, JSON.stringify(initialData, null, 2), "utf-8");
    return initialData;
  }
  try {
    const content = fs.readFileSync(dbJsonPath, "utf-8");
    const data = JSON.parse(content);
    let modified = false;
    for (const key of ["users", "companies", "leadLists", "leads", "leadListAssignments", "campaigns", "campaignLeads", "calls", "smsCampaigns", "smsLogs", "aiAgents"]) {
      if (!data[key]) {
        data[key] = [];
        modified = true;
      }
    }
    
    // Seed initial mock SMS if empty
    if (data.smsCampaigns.length === 0) {
      data.smsCampaigns = [
        { id: 1, name: "Summer Promo Campaign", companyId: 1, leadListId: 1, createdBy: 1, messageTemplate: "Hi {{firstName}}, check out our summer sales promo!", status: "completed", totalMessages: 2, sentMessages: 2, failedMessages: 0, deliveredMessages: 2, repliedMessages: 0, createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), updatedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString() },
        { id: 2, name: "Re-engagement SMS", companyId: 1, leadListId: 2, createdBy: 1, messageTemplate: "Hello {{firstName}}, we haven't heard from you! Contact us for a free trial.", status: "draft", totalMessages: 0, sentMessages: 0, failedMessages: 0, deliveredMessages: 0, repliedMessages: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ];
      modified = true;
    }
    if (data.smsLogs.length === 0) {
      data.smsLogs = [
        { id: 1, smsCampaignId: 1, leadId: 1, toNumber: "+1-555-1010", fromNumber: "+1-855-901-2003", message: "Hi Sundar, check out our summer sales promo!", status: "delivered", twilioSid: "sm-sid-1", errorMessage: null, sentAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), deliveredAt: new Date(Date.now() - 24 * 3600 * 1000 + 20 * 1000).toISOString(), createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString() },
        { id: 2, smsCampaignId: 1, leadId: 2, toNumber: "+1-555-2020", fromNumber: "+1-855-901-2003", message: "Hi Satya, check out our summer sales promo!", status: "delivered", twilioSid: "sm-sid-2", errorMessage: null, sentAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), deliveredAt: new Date(Date.now() - 24 * 3600 * 1000 + 25 * 1000).toISOString(), createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString() }
      ];
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(dbJsonPath, JSON.stringify(data, null, 2), "utf-8");
    }
    return data;
  } catch (err) {
    console.error("Failed to parse db.json, returning empty structure:", err);
    return { users: [], companies: [], leadLists: [], leads: [], leadListAssignments: [], campaigns: [], campaignLeads: [], calls: [], smsCampaigns: [], smsLogs: [], aiAgents: [] };
  }
}

function writeJsonDb(data: any) {
  try {
    fs.writeFileSync(dbJsonPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write to db.json:", err);
  }
}

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

export async function createSMSLog(data: { smsCampaignId: number; leadId: number; toNumber: string; fromNumber?: string; message: string; status: string; twilioSid?: string; sentAt?: Date }) {
  try {
    const result = await getDb().insert(smsLogs).values({
      ...data,
      status: data.status as any,
    }).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createSMSLog] DB offline, falling back to local JSON store.");
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
