import { describe, it, expect } from "vitest";
import { planInboundCall, ownerOfNumber, isFree, type RoutableUser } from "./lib/callRouting";
import { generateInboundSwml } from "./lib/signalwire";
import type { PhoneNumber } from "./lib/phoneNumbers";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const seen = (secondsAgo: number, activity: "online" | "on-call" = "online") => ({
  lastSeenAt: new Date(NOW - secondsAgo * 1000).toISOString(),
  activity,
});

const numbers: PhoneNumber[] = [
  { id: 1, number: "+15550000001", status: "active", assignedTo: 10 },
  { id: 2, number: "+15550000002", status: "active", assignedTo: 20 },
  { id: 3, number: "+15550000003", status: "active", assignedTo: null },
  { id: 4, number: "+15550000004", status: "inactive", assignedTo: 10 },
];

const ali: RoutableUser = { id: 10, name: "Ali", presence: seen(10), callSettings: { fallbackNumber: "+15559990010" } };
const sara: RoutableUser = { id: 20, name: "Sara", presence: seen(600), pushTokens: [{ token: "tok-sara" }] };
const omar: RoutableUser = { id: 30, name: "Omar", presence: seen(5, "on-call") };
const users = [ali, sara, omar];

describe("inbound call routing", () => {
  it("rings only the owner of an assigned number, then their cell", () => {
    const plan = planInboundCall({ dialed: "+1 (555) 000-0001", numbers, users, now: NOW });
    expect(plan.ownerId).toBe(10);
    expect(plan.ringUserIds).toEqual([10]);
    expect(plan.fallbackNumbers).toEqual(["+15559990010"]);
    expect(plan.wakeUserIds).toEqual([]); // Ali is online already
  });

  it("wakes an offline owner's Android app with a push", () => {
    const plan = planInboundCall({ dialed: "+15550000002", numbers, users, now: NOW });
    expect(plan.ringUserIds).toEqual([20]);
    expect(plan.wakeUserIds).toEqual([20]);
  });

  it("skips browser and app for an owner on do-not-disturb", () => {
    const dnd = { ...ali, callSettings: { ...ali.callSettings, dnd: true } };
    const plan = planInboundCall({ dialed: "+15550000001", numbers, users: [dnd, sara, omar], now: NOW });
    expect(plan.ringUserIds).toEqual([]);
    expect(plan.fallbackNumbers).toEqual(["+15559990010"]);
  });

  it("rings only free agents for a shared number", () => {
    const plan = planInboundCall({ dialed: "+15550000003", numbers, users, now: NOW });
    expect(plan.ownerId).toBeNull();
    expect(plan.ringUserIds).toEqual([10]); // Sara offline, Omar on a call
  });

  it("rings everyone on a shared number when nobody is free", () => {
    const busy = [{ ...ali, presence: seen(5, "on-call") }, sara, omar];
    const plan = planInboundCall({ dialed: "+15550000003", numbers, users: busy, now: NOW });
    expect(plan.ringUserIds.sort()).toEqual([10, 20, 30]);
    expect(plan.wakeUserIds).toEqual([20]);
  });

  it("ignores inactive numbers and treats stale presence as offline", () => {
    expect(ownerOfNumber(numbers, "+15550000004")).toBeNull();
    expect(isFree(sara, NOW)).toBe(false);
    expect(isFree(ali, NOW)).toBe(true);
  });
});

describe("inbound SWML stages", () => {
  it("holds with ringback, rings the browser, then the fallback cell, then voicemail", () => {
    const swml = generateInboundSwml({
      destinations: ["/private/ali"],
      fallback: ["+15559990010"],
      holdSeconds: 8,
      voicemailPrompt: "You reached Ali.",
    }) as any;
    const main = swml.sections.main;
    expect(main).toContainEqual({ play: { url: "ring:8" } });
    const first = main.find((s: any) => s.connect).connect;
    expect(first.parallel).toEqual([{ to: "/private/ali" }]);
    const second = first.result.case.failed.find((s: any) => s.connect).connect;
    expect(second.parallel).toEqual([{ to: "+15559990010" }]);
    expect(JSON.stringify(second.result.case.failed)).toContain("say:You reached Ali.");
  });

  it("goes straight to the fallback cell when nothing should ring", () => {
    const swml = generateInboundSwml({ destinations: [], fallback: ["+15559990010"] }) as any;
    const connect = swml.sections.main.find((s: any) => s.connect).connect;
    expect(connect.parallel).toEqual([{ to: "+15559990010" }]);
    expect(JSON.stringify(swml)).not.toContain("ring:");
  });
});
