import { getDb, hasDatabase } from "./connection";
import { calls, callDispositions, callRecordings } from "@db/schema";
import { eq, and, desc, count, sql, gte, lte } from "drizzle-orm";
import { readJsonDb, writeJsonDb } from "./jsonDb";

// ─── Calls ───
export async function findCallsByCompany(companyId?: number, page?: number, limit?: number) {
  try {
    const db = getDb();
    const where = companyId === undefined ? undefined : eq(calls.companyId, companyId);

    if (page && limit) {
      const offset = (page - 1) * limit;
      const items = await db.query.calls.findMany({
        where,
        orderBy: [desc(calls.createdAt)],
        limit,
        offset,
      });
      const totalQuery = db.select({ value: count() }).from(calls);
      const [totalResult] = await (where ? totalQuery.where(where) : totalQuery);
      return { items, total: totalResult.value };
    }

    return await db.query.calls.findMany({
      where,
      orderBy: [desc(calls.createdAt)],
    });
  } catch {
    console.warn("[findCallsByCompany] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const companyCalls = data.calls
      .filter((c: any) => companyId === undefined || c.companyId == companyId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (page && limit) {
      const offset = (page - 1) * limit;
      const items = companyCalls.slice(offset, offset + limit);
      return { items, total: companyCalls.length };
    }
    return companyCalls;
  }
}

export async function findCallsByCaller(callerId: number, page?: number, limit?: number) {
  try {
    const db = getDb();
    const where = eq(calls.callerId, callerId);
    
    if (page && limit) {
      const offset = (page - 1) * limit;
      const items = await db.query.calls.findMany({
        where,
        orderBy: [desc(calls.createdAt)],
        limit,
        offset,
      });
      const [totalResult] = await db.select({ value: count() }).from(calls).where(where);
      return { items, total: totalResult.value };
    }
    
    return await db.query.calls.findMany({
      where,
      orderBy: [desc(calls.createdAt)],
    });
  } catch {
    console.warn("[findCallsByCaller] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const callerCalls = data.calls
      .filter((c: any) => c.callerId == callerId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (page && limit) {
      const offset = (page - 1) * limit;
      const items = callerCalls.slice(offset, offset + limit);
      return { items, total: callerCalls.length };
    }
    return callerCalls;
  }
}

export async function findCallById(id: number) {
  try {
    return await getDb().query.calls.findFirst({
      where: eq(calls.id, id),
    });
  } catch {
    console.warn("[findCallById] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.calls.find((c: any) => c.id == id) || null;
  }
}

export async function findActiveCallByCaller(callerId: number) {
  const { sweepStaleConnectedCalls } = await import("./monitoring");
  await sweepStaleConnectedCalls();
  try {
    return await getDb().query.calls.findFirst({
      where: and(
        eq(calls.callerId, callerId),
        eq(calls.status, "connected")
      ),
      orderBy: [desc(calls.createdAt)],
    });
  } catch {
    console.warn("[findActiveCallByCaller] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const active = data.calls
      .filter((c: any) => c.callerId == callerId && c.status === "connected")
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return active.length > 0 ? active[0] : null;
  }
}

export async function createCall(data: any) {
  if (!hasDatabase()) {
    const store = readJsonDb();
    const id = Date.now();
    const newCall = {
      id,
      ...data,
      createdAt: new Date().toISOString()
    };
    store.calls.push(newCall);
    writeJsonDb(store);
    return id;
  }
  // DB is configured — let real errors (e.g. constraint violations) surface
  // instead of silently writing to the JSON store, which would make the
  // insert invisible to every other query (they all read from MySQL).
  const result = await getDb().insert(calls).values(data).$returningId();
  return result[0]?.id;
}

export async function updateCall(id: number, data: any) {
  if (!hasDatabase()) {
    const store = readJsonDb();
    const idx = store.calls.findIndex((c: any) => c.id == id);
    if (idx !== -1) {
      store.calls[idx] = {
        ...store.calls[idx],
        ...data,
        updatedAt: new Date().toISOString()
      };
      writeJsonDb(store);
    }
    return;
  }
  await getDb().update(calls).set(data).where(eq(calls.id, id));
}

export async function getCallStats(callerId: number, dateFrom?: Date, dateTo?: Date) {
  try {
    const db = getDb();
    const conditions = [eq(calls.callerId, callerId)];
    
    if (dateFrom) conditions.push(gte(calls.createdAt, dateFrom));
    if (dateTo) conditions.push(lte(calls.createdAt, dateTo));
    
    const [totalResult] = await db.select({ value: count() })
      .from(calls)
      .where(and(...conditions));
    
    const [connectedResult] = await db.select({ value: count() })
      .from(calls)
      .where(and(...conditions, eq(calls.status, "connected")));
    
    const [failedResult] = await db.select({ value: count() })
      .from(calls)
      .where(and(...conditions, eq(calls.status, "failed")));
    
    const avgDurationResult = await db.select({ 
      avg: sql<number>`AVG(${calls.duration})` 
    })
      .from(calls)
      .where(and(...conditions, eq(calls.status, "connected")));
    
    return {
      total: totalResult.value,
      connected: connectedResult.value,
      failed: failedResult.value,
      avgDuration: Math.round(avgDurationResult[0]?.avg || 0),
    };
  } catch {
    console.warn("[getCallStats] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const callerCalls = data.calls.filter((c: any) => c.callerId == callerId);
    const filtered = callerCalls.filter((c: any) => {
      const created = new Date(c.createdAt).getTime();
      if (dateFrom && created < dateFrom.getTime()) return false;
      if (dateTo && created > dateTo.getTime()) return false;
      return true;
    });

    const total = filtered.length;
    const connected = filtered.filter((c: any) => c.status === "connected" || c.status === "completed").length;
    const failed = filtered.filter((c: any) => c.status === "failed").length;
    
    const durations = filtered.filter((c: any) => (c.status === "connected" || c.status === "completed") && c.duration > 0).map((c: any) => c.duration);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;
    
    return {
      total,
      connected,
      failed,
      avgDuration,
    };
  }
}

// ─── Call Dispositions ───
export async function findDispositions(companyId?: number) {
  try {
    const db = getDb();
    if (companyId) {
      return await db.query.callDispositions.findMany({
        where: and(
          eq(callDispositions.isActive, true),
          sql`(${callDispositions.companyId} IS NULL OR ${callDispositions.companyId} = ${companyId})`
        ),
        orderBy: [callDispositions.order],
      });
    }
    return await db.query.callDispositions.findMany({
      where: eq(callDispositions.isActive, true),
      orderBy: [callDispositions.order],
    });
  } catch {
    console.warn("[findDispositions] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.callDispositions
      .filter((d: any) => d.isActive !== false && (!d.companyId || d.companyId == companyId))
      .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  }
}

export async function createDisposition(data: any) {
  try {
    const result = await getDb().insert(callDispositions).values(data).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createDisposition] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newDisp = {
      id,
      ...data,
      isActive: true,
      createdAt: new Date().toISOString()
    };
    store.callDispositions.push(newDisp);
    writeJsonDb(store);
    return id;
  }
}

export async function seedDefaultDispositions() {
  try {
    const db = getDb();
    const defaults = [
      { name: "connected", label: "Connected", category: "connected" as const, isSystem: true, color: "#10B981", order: 1 },
      { name: "no_answer", label: "No Answer", category: "no_answer" as const, isSystem: true, color: "#EF4444", order: 2 },
      { name: "machine", label: "Answering Machine", category: "machine" as const, isSystem: true, color: "#F59E0B", order: 3 },
      { name: "voicemail", label: "Voice Mail", category: "voicemail" as const, isSystem: true, color: "#8B5CF6", order: 4 },
      { name: "wrong_number", label: "Wrong Number", category: "wrong_number" as const, isSystem: true, color: "#EC4899", order: 5 },
      { name: "invalid", label: "Invalid/Irrelevant Number", category: "wrong_number" as const, isSystem: true, color: "#6B7280", order: 6 },
      { name: "interested", label: "Interested", category: "converted" as const, isSystem: true, color: "#059669", order: 7 },
      { name: "not_interested", label: "Not Interested", category: "not_interested" as const, isSystem: true, color: "#DC2626", order: 8 },
      { name: "dnc", label: "Do Not Call Again", category: "dnc" as const, isSystem: true, color: "#991B1B", order: 9 },
      { name: "custom", label: "Custom", category: "custom" as const, isSystem: true, color: "#3B82F6", order: 10 },
    ];
    
    for (const d of defaults) {
      const existing = await db.query.callDispositions.findFirst({
        where: eq(callDispositions.name, d.name),
      });
      if (!existing) {
        await db.insert(callDispositions).values(d);
      }
    }
  } catch {
    // Already seeded via readJsonDb initial data logic if offline
  }
}

// ─── Call Recordings ───
export async function createRecording(data: any) {
  try {
    const result = await getDb().insert(callRecordings).values(data).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createRecording] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newRec = {
      id,
      ...data,
      createdAt: new Date().toISOString()
    };
    store.callRecordings.push(newRec);
    writeJsonDb(store);
    return id;
  }
}

export async function findRecordingsByCall(callId: number) {
  try {
    return await getDb().query.callRecordings.findMany({
      where: eq(callRecordings.callId, callId),
      orderBy: [desc(callRecordings.createdAt)],
    });
  } catch {
    console.warn("[findRecordingsByCall] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.callRecordings
      .filter((r: any) => r.callId == callId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}
