import { getDb } from "./connection";
import { calls, leads, campaigns, users, smsLogs } from "@db/schema";
import { eq, and, count, sql, gte, lte } from "drizzle-orm";
import { readJsonDb } from "./jsonDb";

export async function getDashboardStats(companyId: number, dateFrom?: Date, dateTo?: Date) {
  const inRange = (d: any) => {
    const t = new Date(d).getTime();
    if (dateFrom && t < dateFrom.getTime()) return false;
    if (dateTo && t > dateTo.getTime()) return false;
    return true;
  };
  // When a date range is given, compute from raw call rows (works for both DB and JSON store)
  if (dateFrom || dateTo) {
    let allCalls: any[] = [];
    try {
      const db = getDb();
      allCalls = await db.query.calls.findMany({ where: eq(calls.companyId, companyId) });
    } catch {
      const data = readJsonDb();
      allCalls = (data.calls || []).filter((c: any) => c.companyId == companyId);
    }
    const rangeCalls = allCalls.filter((c: any) => inRange(c.createdAt));
    const connected = rangeCalls.filter((c: any) => c.status === "connected" || c.status === "completed").length;
    const totalDuration = rangeCalls.reduce((sum: number, c: any) => sum + (c.duration || 0), 0);

    let allSms: any[] = [];
    try {
      const db = getDb();
      allSms = await db.query.smsLogs.findMany({ where: eq(smsLogs.companyId, companyId) });
    } catch {
      const data = readJsonDb();
      allSms = (data.smsLogs || []).filter((s: any) => s.companyId == companyId);
    }
    const rangeSms = allSms.filter((s: any) => inRange(s.createdAt));
    const smsSent = rangeSms.filter((s: any) => s.direction === "outbound").length;
    const smsReceived = rangeSms.filter((s: any) => s.direction === "inbound").length;
    const smsUnread = allSms.filter((s: any) => s.direction === "inbound" && s.status === "received").length;

    let totalLeads = 0, activeCampaigns = 0, totalCallers = 0;
    try {
      const db = getDb();
      const [leadsR] = await db.select({ value: count() }).from(leads).where(and(eq(leads.companyId, companyId), eq(leads.isDeleted, false)));
      const [campR] = await db.select({ value: count() }).from(campaigns).where(and(eq(campaigns.companyId, companyId), eq(campaigns.status, "running")));
      const [callersR] = await db.select({ value: count() }).from(users).where(and(eq(users.companyId, companyId), eq(users.role, "caller")));
      totalLeads = leadsR.value; activeCampaigns = campR.value; totalCallers = callersR.value;
    } catch {
      const data = readJsonDb();
      totalLeads = (data.leads || []).filter((l: any) => l.companyId == companyId && l.isDeleted !== true).length;
      activeCampaigns = (data.campaigns || []).filter((c: any) => c.companyId == companyId && c.status === "running").length;
      totalCallers = (data.users || []).filter((u: any) => u.companyId == companyId && u.role === "caller").length;
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCalls = allCalls.filter((c: any) => new Date(c.createdAt).getTime() >= today.getTime()).length;

    return {
      totalCalls: rangeCalls.length,
      connectedCalls: connected,
      totalLeads,
      activeCampaigns,
      totalCallers,
      todayCalls,
      totalTalkTime: totalDuration,
      connectionRate: rangeCalls.length > 0 ? Math.round((connected / rangeCalls.length) * 100) : 0,
      smsSent,
      smsReceived,
      smsUnread,
    };
  }

  try {
    const db = getDb();
    
    const [totalCallsResult] = await db.select({ value: count() })
      .from(calls).where(eq(calls.companyId, companyId));
    
    const [connectedCallsResult] = await db.select({ value: count() })
      .from(calls).where(and(eq(calls.companyId, companyId), eq(calls.status, "connected")));
    
    const [totalLeadsResult] = await db.select({ value: count() })
      .from(leads).where(and(eq(leads.companyId, companyId), eq(leads.isDeleted, false)));
    
    const [activeCampaignsResult] = await db.select({ value: count() })
      .from(campaigns).where(and(eq(campaigns.companyId, companyId), eq(campaigns.status, "running")));
    
    const [totalCallersResult] = await db.select({ value: count() })
      .from(users).where(and(eq(users.companyId, companyId), eq(users.role, "caller")));
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [todayCallsResult] = await db.select({ value: count() })
      .from(calls).where(and(eq(calls.companyId, companyId), gte(calls.createdAt, today)));

    const [smsSentResult] = await db.select({ value: count() })
      .from(smsLogs).where(and(eq(smsLogs.companyId, companyId), eq(smsLogs.direction, "outbound" as any)));

    const [smsReceivedResult] = await db.select({ value: count() })
      .from(smsLogs).where(and(eq(smsLogs.companyId, companyId), eq(smsLogs.direction, "inbound" as any)));

    const [smsUnreadResult] = await db.select({ value: count() })
      .from(smsLogs).where(and(
        eq(smsLogs.companyId, companyId),
        eq(smsLogs.direction, "inbound" as any),
        eq(smsLogs.status, "received" as any),
      ));

    return {
      totalCalls: totalCallsResult.value,
      connectedCalls: connectedCallsResult.value,
      totalLeads: totalLeadsResult.value,
      activeCampaigns: activeCampaignsResult.value,
      totalCallers: totalCallersResult.value,
      todayCalls: todayCallsResult.value,
      connectionRate: totalCallsResult.value > 0
        ? Math.round((connectedCallsResult.value / totalCallsResult.value) * 100)
        : 0,
      smsSent: smsSentResult.value,
      smsReceived: smsReceivedResult.value,
      smsUnread: smsUnreadResult.value,
    };
  } catch {
    console.warn("[getDashboardStats] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const companyCalls = data.calls.filter((c: any) => c.companyId == companyId);
    const totalCalls = companyCalls.length;
    const connectedCalls = companyCalls.filter((c: any) => c.status === "connected" || c.status === "completed").length;

    const totalLeads = data.leads.filter((l: any) => l.companyId == companyId && l.isDeleted !== true).length;
    const activeCampaigns = data.campaigns.filter((c: any) => c.companyId == companyId && c.status === "running").length;
    const totalCallers = data.users.filter((u: any) => u.companyId == companyId && u.role === "caller").length;

    const companySms = (data.smsLogs || []).filter((s: any) => s.companyId == companyId);
    const smsSent = companySms.filter((s: any) => s.direction === "outbound").length;
    const smsReceived = companySms.filter((s: any) => s.direction === "inbound").length;
    const smsUnread = companySms.filter((s: any) => s.direction === "inbound" && s.status === "received").length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCalls = companyCalls.filter((c: any) => new Date(c.createdAt).getTime() >= today.getTime()).length;

    return {
      totalCalls,
      connectedCalls,
      totalLeads,
      activeCampaigns,
      totalCallers,
      todayCalls,
      smsSent,
      smsReceived,
      smsUnread,
      connectionRate: totalCalls > 0 ? Math.round((connectedCalls / totalCalls) * 100) : 0,
    };
  }
}

export async function getCallVolumeByDate(companyId: number, days: number = 7) {
  try {
    const db = getDb();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0);
    
    const results = await db.select({
      date: sql<string>`DATE(${calls.createdAt})`,
      total: count(),
      connected: sql<number>`SUM(CASE WHEN ${calls.status} = 'connected' THEN 1 ELSE 0 END)`,
    })
      .from(calls)
      .where(and(eq(calls.companyId, companyId), gte(calls.createdAt, fromDate)))
      .groupBy(sql`DATE(${calls.createdAt})`)
      .orderBy(sql`DATE(${calls.createdAt})`);
    
    return results;
  } catch {
    console.warn("[getCallVolumeByDate] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0);
    
    const companyCalls = data.calls.filter(
      (c: any) => c.companyId == companyId && new Date(c.createdAt).getTime() >= fromDate.getTime()
    );
    
    // Group by Date YYYY-MM-DD
    const groups: Record<string, { date: string; total: number; connected: number }> = {};
    for (const c of companyCalls) {
      const dateStr = new Date(c.createdAt).toISOString().split("T")[0];
      if (!groups[dateStr]) {
        groups[dateStr] = { date: dateStr, total: 0, connected: 0 };
      }
      groups[dateStr].total++;
      if (c.status === "connected" || c.status === "completed") {
        groups[dateStr].connected++;
      }
    }
    
    return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
  }
}

export async function getDispositionBreakdown(companyId: number, dateFrom?: Date, dateTo?: Date) {
  try {
    const db = getDb();
    const conditions = [eq(calls.companyId, companyId), sql`${calls.dispositionId} IS NOT NULL`];
    
    if (dateFrom) conditions.push(gte(calls.createdAt, dateFrom));
    if (dateTo) conditions.push(lte(calls.createdAt, dateTo));
    
    const results = await db.select({
      dispositionId: calls.dispositionId,
      count: count(),
    })
      .from(calls)
      .where(and(...conditions))
      .groupBy(calls.dispositionId);
    
    return results;
  } catch {
    console.warn("[getDispositionBreakdown] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const companyCalls = data.calls.filter((c: any) => c.companyId == companyId && c.dispositionId);
    const filtered = companyCalls.filter((c: any) => {
      const time = new Date(c.createdAt).getTime();
      if (dateFrom && time < dateFrom.getTime()) return false;
      if (dateTo && time > dateTo.getTime()) return false;
      return true;
    });
    
    const groups: Record<number, number> = {};
    for (const c of filtered) {
      const dId = Number(c.dispositionId);
      groups[dId] = (groups[dId] || 0) + 1;
    }
    
    return Object.entries(groups).map(([dispositionId, val]) => ({
      dispositionId: Number(dispositionId),
      count: val
    }));
  }
}

export async function getAgentPerformance(companyId: number, dateFrom?: Date, dateTo?: Date) {
  try {
    const db = getDb();
    const conditions = [eq(calls.companyId, companyId)];
    
    if (dateFrom) conditions.push(gte(calls.createdAt, dateFrom));
    if (dateTo) conditions.push(lte(calls.createdAt, dateTo));
    
    const results = await db.select({
      callerId: calls.callerId,
      totalCalls: count(),
      connectedCalls: sql<number>`SUM(CASE WHEN ${calls.status} = 'connected' THEN 1 ELSE 0 END)`,
      avgDuration: sql<number>`AVG(${calls.duration})`,
    })
      .from(calls)
      .where(and(...conditions))
      .groupBy(calls.callerId);
    
    return results;
  } catch {
    console.warn("[getAgentPerformance] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const companyCalls = data.calls.filter((c: any) => c.companyId == companyId);
    const filtered = companyCalls.filter((c: any) => {
      const time = new Date(c.createdAt).getTime();
      if (dateFrom && time < dateFrom.getTime()) return false;
      if (dateTo && time > dateTo.getTime()) return false;
      return true;
    });
    
    const groups: Record<number, { callerId: number; totalCalls: number; connectedCalls: number; totalDuration: number }> = {};
    for (const c of filtered) {
      const cId = Number(c.callerId);
      if (!groups[cId]) {
        groups[cId] = { callerId: cId, totalCalls: 0, connectedCalls: 0, totalDuration: 0 };
      }
      groups[cId].totalCalls++;
      if (c.status === "connected" || c.status === "completed") {
        groups[cId].connectedCalls++;
        groups[cId].totalDuration += (c.duration || 0);
      }
    }
    
    return Object.values(groups).map((g) => ({
      callerId: g.callerId,
      totalCalls: g.totalCalls,
      connectedCalls: g.connectedCalls,
      avgDuration: g.connectedCalls > 0 ? Math.round(g.totalDuration / g.connectedCalls) : 0
    }));
  }
}

export async function getCampaignReport(campaignId: number) {
  try {
    const db = getDb();
    
    const campaign = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, campaignId),
    });
    
    const [totalCallsResult] = await db.select({ value: count() })
      .from(calls).where(eq(calls.campaignId, campaignId));
    
    const [connectedResult] = await db.select({ value: count() })
      .from(calls).where(and(eq(calls.campaignId, campaignId), eq(calls.status, "connected")));
    
    const dispositionResults = await db.select({
      dispositionId: calls.dispositionId,
      count: count(),
    })
      .from(calls)
      .where(and(eq(calls.campaignId, campaignId), sql`${calls.dispositionId} IS NOT NULL`))
      .groupBy(calls.dispositionId);
    
    return {
      campaign,
      totalCalls: totalCallsResult.value,
      connectedCalls: connectedResult.value,
      dispositions: dispositionResults,
    };
  } catch {
    console.warn("[getCampaignReport] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const campaign = data.campaigns.find((c: any) => c.id == campaignId) || null;
    const campCalls = data.calls.filter((c: any) => c.campaignId == campaignId);
    const totalCalls = campCalls.length;
    const connectedCalls = campCalls.filter((c: any) => c.status === "connected" || c.status === "completed").length;
    
    const dispositionGroups: Record<number, number> = {};
    for (const c of campCalls) {
      if (c.dispositionId) {
        const dId = Number(c.dispositionId);
        dispositionGroups[dId] = (dispositionGroups[dId] || 0) + 1;
      }
    }
    const dispositions = Object.entries(dispositionGroups).map(([dispositionId, val]) => ({
      dispositionId: Number(dispositionId),
      count: val
    }));
    
    return {
      campaign,
      totalCalls,
      connectedCalls,
      dispositions
    };
  }
}
