import { getDb } from "./connection";
import { campaigns, campaignLeads } from "@db/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";
import type { InsertCampaignLead } from "@db/schema";
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
    
    // Seed initial mock campaigns if empty
    if (data.campaigns.length === 0) {
      data.campaigns = [
        { id: 1, name: "Summer Sales Blitz", description: "Outreach for summer sales leads", type: "manual", status: "running", companyId: 1, leadListId: 1, createdBy: 1, assignedCallers: [2], startDate: new Date().toISOString(), totalLeads: 3, completedLeads: 1, successfulCalls: 1, failedCalls: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 2, name: "Enterprise Targets Campaign", description: "Fortune 500 tech targets prospect list", type: "auto", status: "draft", companyId: 1, leadListId: 2, createdBy: 1, assignedCallers: [2], startDate: null, totalLeads: 1, completedLeads: 0, successfulCalls: 0, failedCalls: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ];
      modified = true;
    }
    if (data.campaignLeads.length === 0) {
      data.campaignLeads = [
        { id: 1, campaignId: 1, leadId: 1, callerId: 2, status: "completed", attemptCount: 1, sequenceOrder: 1, createdAt: new Date().toISOString() },
        { id: 2, campaignId: 1, leadId: 2, callerId: 2, status: "pending", attemptCount: 0, sequenceOrder: 2, createdAt: new Date().toISOString() },
        { id: 3, campaignId: 1, leadId: 3, callerId: 2, status: "pending", attemptCount: 0, sequenceOrder: 3, createdAt: new Date().toISOString() },
        { id: 4, campaignId: 2, leadId: 4, callerId: 2, status: "pending", attemptCount: 0, sequenceOrder: 1, createdAt: new Date().toISOString() }
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

export async function findCampaignsByCompany(companyId?: number) {
  try {
    return await getDb().query.campaigns.findMany({
      where: companyId === undefined ? undefined : eq(campaigns.companyId, companyId),
      orderBy: [desc(campaigns.createdAt)],
    });
  } catch {
    console.warn("[findCampaignsByCompany] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.campaigns
      .filter((c: any) => companyId === undefined || c.companyId == companyId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function findCampaignById(id: number) {
  try {
    return await getDb().query.campaigns.findFirst({
      where: eq(campaigns.id, id),
    });
  } catch {
    console.warn("[findCampaignById] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.campaigns.find((c: any) => c.id == id) || null;
  }
}

export async function findCampaignsByStatus(companyId: number, status: string) {
  try {
    return await getDb().query.campaigns.findMany({
      where: and(eq(campaigns.companyId, companyId), eq(campaigns.status, status as any)),
      orderBy: [desc(campaigns.createdAt)],
    });
  } catch {
    console.warn("[findCampaignsByStatus] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.campaigns
      .filter((c: any) => c.companyId == companyId && c.status === status)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function createCampaign(data: any) {
  try {
    const result = await getDb().insert(campaigns).values(data).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createCampaign] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newCampaign = {
      id,
      ...data,
      totalLeads: 0,
      completedLeads: 0,
      successfulCalls: 0,
      failedCalls: 0,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.campaigns.push(newCampaign);
    writeJsonDb(store);
    return id;
  }
}

export async function updateCampaign(id: number, data: any) {
  try {
    await getDb().update(campaigns).set(data).where(eq(campaigns.id, id));
  } catch {
    console.warn("[updateCampaign] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.campaigns.findIndex((c: any) => c.id == id);
    if (idx !== -1) {
      store.campaigns[idx] = {
        ...store.campaigns[idx],
        ...data,
        updatedAt: new Date().toISOString()
      };
      writeJsonDb(store);
    }
  }
}

export async function deleteCampaign(id: number) {
  try {
    await getDb().update(campaigns).set({ status: "completed" }).where(eq(campaigns.id, id));
  } catch {
    console.warn("[deleteCampaign] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.campaigns.findIndex((c: any) => c.id == id);
    if (idx !== -1) {
      store.campaigns[idx].status = "completed";
      store.campaigns[idx].updatedAt = new Date().toISOString();
      writeJsonDb(store);
    }
  }
}

// ─── Campaign Leads ───
export async function addLeadsToCampaign(data: InsertCampaignLead[]) {
  if (data.length === 0) return [];
  try {
    const result = await getDb().insert(campaignLeads).values(data).$returningId();
    
    // Update campaign total
    const campaignId = data[0]?.campaignId;
    if (campaignId) {
      await getDb().update(campaigns)
        .set({ totalLeads: sql`${campaigns.totalLeads} + ${data.length}` })
        .where(eq(campaigns.id, campaignId));
    }
    
    return result.map(r => r.id);
  } catch {
    console.warn("[addLeadsToCampaign] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const ids = [];
    const campaignId = data[0]?.campaignId;
    
    for (let i = 0; i < data.length; i++) {
      const id = Date.now() + i;
      const newCL = {
        id,
        ...data[i],
        status: "pending",
        attemptCount: 0,
        createdAt: new Date().toISOString()
      };
      store.campaignLeads.push(newCL);
      ids.push(id);
    }
    
    if (campaignId) {
      const campIdx = store.campaigns.findIndex((c: any) => c.id == campaignId);
      if (campIdx !== -1) {
        store.campaigns[campIdx].totalLeads = (store.campaigns[campIdx].totalLeads || 0) + data.length;
      }
    }
    
    writeJsonDb(store);
    return ids;
  }
}

export async function getCampaignLeads(campaignId: number, status?: string) {
  try {
    const db = getDb();
    if (status) {
      return await db.query.campaignLeads.findMany({
        where: and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.status, status as any)),
        with: { lead: true },
        orderBy: [campaignLeads.sequenceOrder],
      });
    }
    return await db.query.campaignLeads.findMany({
      where: eq(campaignLeads.campaignId, campaignId),
      with: { lead: true },
      orderBy: [campaignLeads.sequenceOrder],
    });
  } catch {
    console.warn("[getCampaignLeads] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const clList = data.campaignLeads.filter((cl: any) => cl.campaignId == campaignId);
    const filtered = status ? clList.filter((cl: any) => cl.status === status) : clList;
    
    // Join with leads
    return filtered.map((cl: any) => {
      const lead = data.leads.find((l: any) => l.id == cl.leadId);
      return {
        ...cl,
        lead: lead || null
      };
    }).sort((a: any, b: any) => (a.sequenceOrder || 0) - (b.sequenceOrder || 0));
  }
}

export async function getNextCampaignLead(campaignId: number, callerId?: number) {
  try {
    const db = getDb();
    const conditions = [
      eq(campaignLeads.campaignId, campaignId),
      eq(campaignLeads.status, "pending"),
    ];
    if (callerId) {
      conditions.push(eq(campaignLeads.callerId, callerId));
    }
    
    return await db.query.campaignLeads.findFirst({
      where: and(...conditions),
      with: { lead: true },
      orderBy: [campaignLeads.sequenceOrder],
    });
  } catch {
    console.warn("[getNextCampaignLead] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    let clList = data.campaignLeads.filter((cl: any) => cl.campaignId == campaignId && cl.status === "pending");
    if (callerId) {
      clList = clList.filter((cl: any) => cl.callerId == callerId);
    }
    clList.sort((a: any, b: any) => (a.sequenceOrder || 0) - (b.sequenceOrder || 0));
    
    if (clList.length === 0) return null;
    const firstCl = clList[0];
    const lead = data.leads.find((l: any) => l.id == firstCl.leadId);
    return {
      ...firstCl,
      lead: lead || null
    };
  }
}

export async function updateCampaignLeadStatus(id: number, status: string, data?: Partial<InsertCampaignLead>) {
  try {
    await getDb().update(campaignLeads).set({ status: status as any, ...data }).where(eq(campaignLeads.id, id));
  } catch {
    console.warn("[updateCampaignLeadStatus] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.campaignLeads.findIndex((cl: any) => cl.id == id);
    if (idx !== -1) {
      store.campaignLeads[idx] = {
        ...store.campaignLeads[idx],
        status: status as any,
        ...data
      };
      writeJsonDb(store);
    }
  }
}

export async function getCampaignProgress(campaignId: number) {
  try {
    const db = getDb();
    const [totalResult] = await db.select({ value: count() })
      .from(campaignLeads)
      .where(eq(campaignLeads.campaignId, campaignId));
    
    const [completedResult] = await db.select({ value: count() })
      .from(campaignLeads)
      .where(and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.status, "completed")));
    
    const [pendingResult] = await db.select({ value: count() })
      .from(campaignLeads)
      .where(and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.status, "pending")));
    
    return {
      total: totalResult.value,
      completed: completedResult.value,
      pending: pendingResult.value,
      progress: totalResult.value > 0 ? Math.round((completedResult.value / totalResult.value) * 100) : 0,
    };
  } catch {
    console.warn("[getCampaignProgress] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const clList = data.campaignLeads.filter((cl: any) => cl.campaignId == campaignId);
    const total = clList.length;
    const completed = clList.filter((cl: any) => cl.status === "completed").length;
    const pending = clList.filter((cl: any) => cl.status === "pending").length;
    return {
      total,
      completed,
      pending,
      progress: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }
}
