import type { PhoneNumber } from "./phoneNumbers";
import { sameNumber } from "./telnyxWebhook";

/**
 * Who an inbound call (or SMS) to one of our numbers belongs to, and who to
 * ring for it.
 *
 *   number assigned to a user  → that user only (their browser, their Android
 *                                app, then their own cell phone, then voicemail)
 *   unassigned number          → "ring whoever is free": every user who is
 *                                online and not already on a call; if nobody
 *                                is free, every user (so a call is never
 *                                dropped just because presence is stale)
 *
 * Kept free of I/O so the policy is unit-testable; webhooks.ts feeds it the
 * company's users, numbers and the browser-dialer addresses it knows about.
 */

export type CallSettings = {
  /** E.164 cell number rung after the browser/app if nobody answers. */
  fallbackNumber?: string;
  /** Do not disturb: skip browser/app ringing, go to fallback or voicemail. */
  dnd?: boolean;
  /** Spoken before the voicemail beep for this user's number. */
  voicemailGreeting?: string;
};

export type RoutableUser = {
  id: number;
  name?: string | null;
  email?: string | null;
  role?: string;
  status?: string;
  presence?: { lastSeenAt?: string; activity?: "online" | "on-call" } | null;
  callSettings?: CallSettings | null;
  pushTokens?: Array<{ token: string; platform?: string; updatedAt?: string }> | null;
};

/** Presence heartbeats arrive every 30s; 90s survives background-tab throttling. */
export const PRESENCE_FRESH_MS = 90_000;

export function isOnline(user: RoutableUser, now = Date.now()): boolean {
  const seen = user.presence?.lastSeenAt ? Date.parse(user.presence.lastSeenAt) : NaN;
  return Number.isFinite(seen) && now - seen < PRESENCE_FRESH_MS;
}

export function isFree(user: RoutableUser, now = Date.now()): boolean {
  return isOnline(user, now) && user.presence?.activity !== "on-call";
}

/** The user a number is assigned to, if any (active numbers only). */
export function ownerOfNumber(numbers: PhoneNumber[], dialed: string): number | null {
  const entry = numbers.find((n) => n.status !== "inactive" && n.number && sameNumber(n.number, dialed));
  return entry?.assignedTo ?? null;
}

export type InboundPlan = {
  /** The number's owner, or null for an unassigned (shared) number. */
  ownerId: number | null;
  /** Users whose browser/app should ring, in no particular order. */
  ringUserIds: number[];
  /** Users who are offline but have the Android app — wake them with a push. */
  wakeUserIds: number[];
  /** Cell numbers to try after the browser/app stage times out. */
  fallbackNumbers: string[];
  /** Custom voicemail prompt (owner's), if set. */
  voicemailGreeting?: string;
  /** Human-readable reason, logged on the inbound call. */
  reason: string;
};

export function planInboundCall(opts: {
  dialed: string;
  numbers: PhoneNumber[];
  users: RoutableUser[];
  now?: number;
}): InboundPlan {
  const now = opts.now ?? Date.now();
  const active = opts.users.filter((u) => u.status !== "suspended" && u.status !== "inactive");
  const ownerId = ownerOfNumber(opts.numbers, opts.dialed);
  const owner = ownerId != null ? active.find((u) => u.id === ownerId) : undefined;
  const hasApp = (u: RoutableUser) => (u.pushTokens?.length ?? 0) > 0;

  if (owner) {
    const s = owner.callSettings ?? {};
    const fallback = s.fallbackNumber?.trim() ? [s.fallbackNumber.trim()] : [];
    if (s.dnd) {
      return {
        ownerId: owner.id, ringUserIds: [], wakeUserIds: [], fallbackNumbers: fallback,
        voicemailGreeting: s.voicemailGreeting,
        reason: `assigned to ${owner.name || owner.email || owner.id} (do not disturb)`,
      };
    }
    return {
      ownerId: owner.id,
      ringUserIds: [owner.id],
      wakeUserIds: !isOnline(owner, now) && hasApp(owner) ? [owner.id] : [],
      fallbackNumbers: fallback,
      voicemailGreeting: s.voicemailGreeting,
      reason: `assigned to ${owner.name || owner.email || owner.id}`,
    };
  }

  const reachable = active.filter((u) => !u.callSettings?.dnd);
  const free = reachable.filter((u) => isFree(u, now));
  if (free.length > 0) {
    return {
      ownerId: null, ringUserIds: free.map((u) => u.id), wakeUserIds: [], fallbackNumbers: [],
      reason: `shared number — ringing ${free.length} free agent(s)`,
    };
  }
  return {
    ownerId: null,
    ringUserIds: reachable.map((u) => u.id),
    wakeUserIds: reachable.filter((u) => hasApp(u) && !isOnline(u, now)).map((u) => u.id),
    fallbackNumbers: [],
    reason: "shared number — nobody free, ringing everyone",
  };
}
