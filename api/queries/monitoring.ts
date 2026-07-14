import { getDb, hasDatabase } from "./connection";
import { liveMonitorSessions, calls } from "@db/schema";
import { eq, and, desc, lt, or, isNull } from "drizzle-orm";
import { readJsonDb, writeJsonDb } from "./jsonDb";

// A caller's browser pings calls.heartbeat every ~15s while a call is
// "connected". If no heartbeat (or start) has been seen for this long, the
// browser is assumed gone (crash, closed tab, dead network) and the call is
// force-completed so it stops showing as "Live" in the admin monitoring panel.
const STALE_CALL_MS = 45_000;

/**
 * Auto-complete any "connected" call whose last heartbeat is older than
 * STALE_CALL_MS (or that never sent one and started that long ago). Called
 * opportunistically before reads so the monitoring panel never shows a
 * caller as live past a dropped session.
 */
export async function sweepStaleConnectedCalls(companyId?: number): Promise<void> {
  if (!hasDatabase()) {
    const store = readJsonDb();
    const cutoff = Date.now() - STALE_CALL_MS;
    let changed = false;
    for (const c of store.calls as any[]) {
      if (c.status !== "connected") continue;
      if (companyId !== undefined && c.companyId != companyId) continue;
      const last = new Date(c.lastHeartbeatAt || c.startedAt || c.createdAt).getTime();
      if (last < cutoff) {
        c.status = "completed";
        c.endedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) writeJsonDb(store);
    return;
  }

  const cutoff = new Date(Date.now() - STALE_CALL_MS);
  const staleCondition = or(
    and(isNull(calls.lastHeartbeatAt), lt(calls.startedAt, cutoff)),
    lt(calls.lastHeartbeatAt, cutoff),
  );
  await getDb().update(calls)
    .set({ status: "completed", endedAt: new Date() })
    .where(
      companyId !== undefined
        ? and(eq(calls.status, "connected"), eq(calls.companyId, companyId), staleCondition)
        : and(eq(calls.status, "connected"), staleCondition),
    );
}

export async function createMonitorSession(data: { adminId: number; callerId: number; callId: number; monitorChannel: string; status: string }) {
  try {
    const result = await getDb().insert(liveMonitorSessions).values({
      ...data,
      status: data.status as any,
    }).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createMonitorSession] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newSession = {
      id,
      ...data,
      startedAt: new Date().toISOString()
    };
    store.liveMonitorSessions.push(newSession);
    writeJsonDb(store);
    return id;
  }
}

export async function findActiveMonitorSessions(adminId: number) {
  try {
    return await getDb().query.liveMonitorSessions.findMany({
      where: and(eq(liveMonitorSessions.adminId, adminId), eq(liveMonitorSessions.status, "listening")),
      orderBy: [desc(liveMonitorSessions.startedAt)],
    });
  } catch {
    console.warn("[findActiveMonitorSessions] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.liveMonitorSessions
      .filter((s: any) => s.adminId == adminId && s.status === "listening")
      .sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }
}

export async function endMonitorSession(id: number) {
  try {
    await getDb().update(liveMonitorSessions)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(liveMonitorSessions.id, id));
  } catch {
    console.warn("[endMonitorSession] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.liveMonitorSessions.findIndex((s: any) => s.id == id);
    if (idx !== -1) {
      store.liveMonitorSessions[idx].status = "ended";
      store.liveMonitorSessions[idx].endedAt = new Date().toISOString();
      writeJsonDb(store);
    }
  }
}

export async function getActiveCallsForMonitoring(companyId: number) {
  await sweepStaleConnectedCalls(companyId);
  try {
    return await getDb().query.calls.findMany({
      where: and(eq(calls.companyId, companyId), eq(calls.status, "connected")),
      orderBy: [desc(calls.createdAt)],
    });
  } catch {
    console.warn("[getActiveCallsForMonitoring] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.calls
      .filter((c: any) => c.companyId == companyId && (c.status === "connected" || c.status === "ringing"))
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function getCallerActiveCall(callerId: number) {
  await sweepStaleConnectedCalls();
  try {
    return await getDb().query.calls.findFirst({
      where: and(eq(calls.callerId, callerId), eq(calls.status, "connected")),
      orderBy: [desc(calls.createdAt)],
    });
  } catch {
    console.warn("[getCallerActiveCall] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    const active = data.calls
      .filter((c: any) => c.callerId == callerId && (c.status === "connected" || c.status === "ringing"))
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return active.length > 0 ? active[0] : null;
  }
}

// ─── Caller Day Report (date-wise performance) ───
// Builds a complete second-by-second accountable timeline of a caller's day:
// day start, every call (with duration + recording), and idle/free gaps between calls.
export async function getCallerDayReport(callerId: number, date: string) {
  const dayStart = new Date(date + "T00:00:00");
  const dayEnd = new Date(date + "T23:59:59.999");

  let dayCalls: any[] = [];
  try {
    const db = getDb();
    dayCalls = await db.query.calls.findMany({
      where: and(
        eq(calls.callerId, callerId),
        // createdAt within the selected day
        // (drizzle gte/lte imported below if available; fallback filter after fetch)
      ),
    });
    dayCalls = dayCalls.filter((c: any) => {
      const t = new Date(c.startedAt || c.createdAt).getTime();
      return t >= dayStart.getTime() && t <= dayEnd.getTime();
    });
  } catch {
    console.warn("[getCallerDayReport] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    dayCalls = (data.calls || []).filter((c: any) => {
      if (c.callerId != callerId) return false;
      const t = new Date(c.startedAt || c.createdAt).getTime();
      return t >= dayStart.getTime() && t <= dayEnd.getTime();
    });
  }

  // Sort chronologically
  dayCalls.sort(
    (a: any, b: any) =>
      new Date(a.startedAt || a.createdAt).getTime() - new Date(b.startedAt || b.createdAt).getTime()
  );

  // Build timeline: numbered calls + idle gaps between them
  const timeline: any[] = [];
  let totalTalkTime = 0;
  let totalIdleTime = 0;
  let connectedCalls = 0;

  dayCalls.forEach((call: any, i: number) => {
    const startedAt = call.startedAt || call.createdAt;
    const endedAt =
      call.endedAt ||
      (call.duration ? new Date(new Date(startedAt).getTime() + call.duration * 1000).toISOString() : startedAt);
    const callDuration = call.duration || 0;
    totalTalkTime += callDuration;
    if (call.status === "completed" || call.status === "connected") connectedCalls++;

    // Idle gap BEFORE this call (free/pause time since previous call ended)
    if (i > 0) {
      const prev = dayCalls[i - 1];
      const prevEnd = new Date(
        prev.endedAt ||
          (prev.duration
            ? new Date(new Date(prev.startedAt || prev.createdAt).getTime() + prev.duration * 1000).toISOString()
            : prev.startedAt || prev.createdAt)
      ).getTime();
      const thisStart = new Date(startedAt).getTime();
      const gapSeconds = Math.max(0, Math.round((thisStart - prevEnd) / 1000));
      if (gapSeconds > 0) {
        totalIdleTime += gapSeconds;
        timeline.push({
          type: "idle",
          from: new Date(prevEnd).toISOString(),
          to: new Date(thisStart).toISOString(),
          seconds: gapSeconds,
        });
      }
    }

    timeline.push({
      type: "call",
      callNumber: i + 1,
      id: call.id,
      startedAt,
      endedAt,
      duration: callDuration,
      status: call.status,
      toNumber: call.toNumber,
      fromNumber: call.fromNumber,
      leadId: call.leadId,
      dispositionId: call.dispositionId,
      recordingUrl: call.recordingUrl || null,
      notes: call.notes || call.callDescription || null,
      callType: call.type,
    });
  });

  const first = dayCalls[0];
  const last = dayCalls[dayCalls.length - 1];
  const dayStartTime = first ? first.startedAt || first.createdAt : null;
  const dayEndTime = last
    ? last.endedAt || last.startedAt || last.createdAt
    : null;
  const workSpanSeconds =
    dayStartTime && dayEndTime
      ? Math.max(0, Math.round((new Date(dayEndTime).getTime() - new Date(dayStartTime).getTime()) / 1000))
      : 0;

  return {
    callerId,
    date,
    dayStartTime,
    dayEndTime,
    workSpanSeconds,
    totalCalls: dayCalls.length,
    connectedCalls,
    totalTalkTime,
    totalIdleTime,
    avgCallDuration: dayCalls.length > 0 ? Math.round(totalTalkTime / dayCalls.length) : 0,
    timeline,
  };
}
