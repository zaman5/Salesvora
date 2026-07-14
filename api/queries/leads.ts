import { getDb } from "./connection";
import { leadLists, leads, leadListAssignments } from "@db/schema";
import { eq, and, or, desc, count, sql } from "drizzle-orm";
import type { InsertLeadListAssignment } from "@db/schema";
import { readJsonDb, writeJsonDb } from "./jsonDb";

// ─── Lead Lists ───
export async function findLeadListsByCompany(companyId?: number) {
  try {
    return await getDb().query.leadLists.findMany({
      where: companyId === undefined ? undefined : eq(leadLists.companyId, companyId),
      orderBy: [desc(leadLists.createdAt)],
    });
  } catch {
    console.warn("[findLeadListsByCompany] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.leadLists
      .filter((l: any) => (companyId === undefined || l.companyId == companyId) && l.status !== "archived")
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function findLeadListById(id: number) {
  try {
    return await getDb().query.leadLists.findFirst({
      where: eq(leadLists.id, id),
    });
  } catch {
    console.warn("[findLeadListById] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.leadLists.find((l: any) => l.id == id) || null;
  }
}

export async function createLeadList(data: any) {
  try {
    const result = await getDb().insert(leadLists).values(data).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createLeadList] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newList = {
      id,
      ...data,
      totalLeads: 0,
      calledLeads: 0,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.leadLists.push(newList);
    writeJsonDb(store);
    return id;
  }
}

export async function updateLeadList(id: number, data: any) {
  try {
    await getDb().update(leadLists).set(data).where(eq(leadLists.id, id));
  } catch {
    console.warn("[updateLeadList] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.leadLists.findIndex((l: any) => l.id == id);
    if (idx !== -1) {
      store.leadLists[idx] = {
        ...store.leadLists[idx],
        ...data,
        updatedAt: new Date().toISOString()
      };
      writeJsonDb(store);
    }
  }
}

export async function deleteLeadList(id: number) {
  try {
    await getDb().update(leadLists).set({ status: "archived" }).where(eq(leadLists.id, id));
  } catch {
    console.warn("[deleteLeadList] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.leadLists.findIndex((l: any) => l.id == id);
    if (idx !== -1) {
      store.leadLists[idx].status = "archived";
      store.leadLists[idx].updatedAt = new Date().toISOString();
      writeJsonDb(store);
    }
  }
}

export async function incrementLeadCount(listId: number, amount: number = 1) {
  try {
    await getDb().update(leadLists)
      .set({ totalLeads: sql`${leadLists.totalLeads} + ${amount}` })
      .where(eq(leadLists.id, listId));
  } catch {
    console.warn("[incrementLeadCount] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.leadLists.findIndex((l: any) => l.id == listId);
    if (idx !== -1) {
      store.leadLists[idx].totalLeads = (store.leadLists[idx].totalLeads || 0) + amount;
      writeJsonDb(store);
    }
  }
}

// ─── Leads ───
export async function findLeadsByList(leadListId: number, page?: number, limit?: number) {
  try {
    const db = getDb();
    const where = and(eq(leads.leadListId, leadListId), eq(leads.isDeleted, false));
    
    if (page && limit) {
      const offset = (page - 1) * limit;
      const items = await db.query.leads.findMany({
        where,
        orderBy: [desc(leads.createdAt)],
        limit,
        offset,
      });
      const [totalResult] = await db.select({ value: count() }).from(leads).where(where);
      return { items, total: totalResult.value };
    }
    
    return await db.query.leads.findMany({
      where,
      orderBy: [desc(leads.createdAt)],
    });
  } catch {
    console.warn("[findLeadsByList] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const listLeads = data.leads
      .filter((l: any) => l.leadListId == leadListId && l.isDeleted !== true)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    if (page && limit) {
      const offset = (page - 1) * limit;
      const items = listLeads.slice(offset, offset + limit);
      return { items, total: listLeads.length };
    }
    return listLeads;
  }
}

export async function findLeadsByCompany(companyId: number) {
  try {
    return await getDb().query.leads.findMany({
      where: and(eq(leads.companyId, companyId), eq(leads.isDeleted, false)),
      orderBy: [desc(leads.createdAt)],
    });
  } catch {
    console.warn("[findLeadsByCompany] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.leads
      .filter((l: any) => l.companyId == companyId && l.isDeleted !== true)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function findLeadByPhone(companyId: number, phone: string) {
  try {
    return await getDb().query.leads.findFirst({
      where: and(
        eq(leads.companyId, companyId),
        eq(leads.isDeleted, false),
        or(eq(leads.phone, phone), eq(leads.phone2, phone)),
      ),
    });
  } catch {
    console.warn("[findLeadByPhone] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.leads.find(
      (l: any) => l.companyId == companyId && l.isDeleted !== true && (l.phone === phone || l.phone2 === phone),
    ) || null;
  }
}

export async function findLeadById(id: number) {
  try {
    return await getDb().query.leads.findFirst({
      where: eq(leads.id, id),
    });
  } catch {
    console.warn("[findLeadById] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.leads.find((l: any) => l.id == id) || null;
  }
}

export async function createLead(data: any) {
  try {
    const result = await getDb().insert(leads).values(data).$returningId();
    const id = result[0]?.id;
    if (id && data.leadListId) {
      await incrementLeadCount(data.leadListId);
    }
    return id;
  } catch {
    console.warn("[createLead] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newLead = {
      id,
      ...data,
      callCount: 0,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.leads.push(newLead);
    writeJsonDb(store);
    if (data.leadListId) {
      const listIdx = store.leadLists.findIndex((l: any) => l.id == data.leadListId);
      if (listIdx !== -1) {
        store.leadLists[listIdx].totalLeads = (store.leadLists[listIdx].totalLeads || 0) + 1;
        writeJsonDb(store);
      }
    }
    return id;
  }
}

export async function createLeadsBatch(data: any[]) {
  if (data.length === 0) return [];
  try {
    const db = getDb();
    const result = await db.insert(leads).values(data).$returningId();
    
    const listId = data[0]?.leadListId;
    if (listId) {
      await db.update(leadLists)
        .set({ totalLeads: sql`${leadLists.totalLeads} + ${data.length}` })
        .where(eq(leadLists.id, listId));
    }
    
    return result.map(r => r.id);
  } catch {
    console.warn("[createLeadsBatch] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const ids = [];
    const listId = data[0]?.leadListId;
    let addedCount = 0;
    
    for (let i = 0; i < data.length; i++) {
      const id = Date.now() + i;
      const newLead = {
        id,
        ...data[i],
        callCount: 0,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.leads.push(newLead);
      ids.push(id);
      addedCount++;
    }
    
    if (listId) {
      const listIdx = store.leadLists.findIndex((l: any) => l.id == listId);
      if (listIdx !== -1) {
        store.leadLists[listIdx].totalLeads = (store.leadLists[listIdx].totalLeads || 0) + addedCount;
      }
    }
    
    writeJsonDb(store);
    return ids;
  }
}

export async function updateLead(id: number, data: any) {
  try {
    await getDb().update(leads).set(data).where(eq(leads.id, id));
  } catch {
    console.warn("[updateLead] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.leads.findIndex((l: any) => l.id == id);
    if (idx !== -1) {
      store.leads[idx] = {
        ...store.leads[idx],
        ...data,
        updatedAt: new Date().toISOString()
      };
      writeJsonDb(store);
    }
  }
}

export async function deleteLead(id: number) {
  try {
    await getDb().update(leads).set({ isDeleted: true }).where(eq(leads.id, id));
  } catch {
    console.warn("[deleteLead] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.leads.findIndex((l: any) => l.id == id);
    if (idx !== -1) {
      store.leads[idx].isDeleted = true;
      store.leads[idx].updatedAt = new Date().toISOString();
      writeJsonDb(store);
    }
  }
}

export async function searchLeads(companyId: number, query: string) {
  try {
    return await getDb().query.leads.findMany({
      where: and(
        eq(leads.companyId, companyId),
        eq(leads.isDeleted, false),
        sql`(${leads.firstName} LIKE ${`%${query}%`} OR ${leads.lastName} LIKE ${`%${query}%`} OR ${leads.phone} LIKE ${`%${query}%`} OR ${leads.email} LIKE ${`%${query}%`} OR ${leads.companyName} LIKE ${`%${query}%`})`
      ),
      limit: 50,
    });
  } catch {
    console.warn("[searchLeads] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const q = query.toLowerCase();
    return data.leads
      .filter((l: any) => 
        l.companyId == companyId && 
        l.isDeleted !== true &&
        (
          (l.firstName || "").toLowerCase().includes(q) ||
          (l.lastName || "").toLowerCase().includes(q) ||
          (l.phone || "").toLowerCase().includes(q) ||
          (l.email || "").toLowerCase().includes(q) ||
          (l.companyName || "").toLowerCase().includes(q)
        )
      )
      .slice(0, 50);
  }
}

// ─── Lead List Assignments ───
export async function assignListToCaller(data: InsertLeadListAssignment) {
  try {
    const result = await getDb().insert(leadListAssignments).values(data).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[assignListToCaller] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newAssignment = {
      id,
      ...data,
      assignedAt: new Date().toISOString()
    };
    store.leadListAssignments.push(newAssignment);
    writeJsonDb(store);
    return id;
  }
}

export async function getAssignedListsForCaller(callerId: number) {
  try {
    return await getDb().query.leadListAssignments.findMany({
      where: eq(leadListAssignments.callerId, callerId),
    });
  } catch {
    console.warn("[getAssignedListsForCaller] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.leadListAssignments.filter((a: any) => a.callerId == callerId);
  }
}

export async function removeListAssignment(listId: number, callerId: number) {
  try {
    await getDb().delete(leadListAssignments)
      .where(and(eq(leadListAssignments.leadListId, listId), eq(leadListAssignments.callerId, callerId)));
  } catch {
    console.warn("[removeListAssignment] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    store.leadListAssignments = store.leadListAssignments.filter(
      (a: any) => !(a.leadListId == listId && a.callerId == callerId)
    );
    writeJsonDb(store);
  }
}