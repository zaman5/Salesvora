import { createSign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { findUserById, updateUser } from "../queries/users";
import type { RoutableUser } from "./callRouting";

/**
 * Firebase Cloud Messaging (HTTP v1) sender for the Salesvora Android app.
 *
 * Credentials: a Firebase service-account key, from (first match wins)
 *   FCM_SERVICE_ACCOUNT_JSON   the JSON itself
 *   FCM_SERVICE_ACCOUNT_PATH   a path to the JSON file
 *   <data dir>/firebase-service-account.json   next to db.json (on Hostinger:
 *                                              ~/salesvora-data/, which survives deploys)
 * With none configured every send is a logged no-op, so the web app is unaffected.
 *
 * No firebase-admin dependency: the OAuth token is a self-signed RS256 JWT
 * exchanged at Google's token endpoint, cached until shortly before expiry.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cachedAccount: ServiceAccount | null | undefined;
let cachedToken: { value: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;
  try {
    let raw = process.env.FCM_SERVICE_ACCOUNT_JSON || "";
    if (!raw) {
      const dataDir = path.dirname(process.env.DB_JSON_PATH || path.join(process.cwd(), "db.json"));
      const file = process.env.FCM_SERVICE_ACCOUNT_PATH || path.join(dataDir, "firebase-service-account.json");
      if (existsSync(file)) raw = readFileSync(file, "utf8");
    }
    const parsed = raw ? (JSON.parse(raw.replace(/^﻿/, "")) as ServiceAccount) : null;
    cachedAccount = parsed?.project_id && parsed.client_email && parsed.private_key ? parsed : null;
  } catch (err) {
    console.error("[push] Could not read the Firebase service account:", err instanceof Error ? err.message : err);
    cachedAccount = null;
  }
  return cachedAccount;
}

export function pushConfigured(): boolean {
  return loadServiceAccount() !== null;
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export type PushMessage = {
  /** "call" is a data-only, high-priority message the app turns into a full-screen ringing screen. */
  kind: "call" | "sms" | "missed_call" | "voicemail";
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Seconds the message stays deliverable; a call push is useless after it stops ringing. */
  ttlSeconds?: number;
};

/** Send to one device token. Returns "invalid" when FCM says the token is dead. */
async function sendToToken(sa: ServiceAccount, token: string, msg: PushMessage): Promise<"ok" | "invalid" | "error"> {
  const data: Record<string, string> = { kind: msg.kind, title: msg.title, body: msg.body, ...(msg.data ?? {}) };
  const message: Record<string, unknown> = {
    token,
    data,
    android: {
      priority: "HIGH",
      ttl: `${msg.ttlSeconds ?? (msg.kind === "call" ? 30 : 86400)}s`,
      // Calls are data-only so the app's own service builds the ringing screen
      // even when the app is killed; everything else is a normal notification.
      ...(msg.kind === "call" ? {} : {
        notification: { channel_id: msg.kind === "sms" ? "sms" : "calls", sound: "default", tag: msg.data?.tag },
      }),
    },
    ...(msg.kind === "call" ? {} : { notification: { title: msg.title, body: msg.body } }),
  };
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return "ok";
    const text = await res.text();
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(text)) return "invalid";
    console.error(`[push] FCM ${res.status}: ${text.slice(0, 300)}`);
    return "error";
  } catch (err) {
    console.error("[push] send failed:", err instanceof Error ? err.message : err);
    return "error";
  }
}

/** Push to every device a user has registered; prunes tokens FCM reports as dead. */
export async function pushToUser(userId: number, msg: PushMessage): Promise<number> {
  const sa = loadServiceAccount();
  if (!sa) return 0;
  const user = (await findUserById(userId).catch(() => null)) as RoutableUser | null;
  const tokens = user?.pushTokens ?? [];
  if (!tokens.length) return 0;

  const results = await Promise.all(tokens.map((t) => sendToToken(sa, t.token, msg)));
  const dead = new Set(tokens.filter((_, i) => results[i] === "invalid").map((t) => t.token));
  if (dead.size) {
    await updateUser(userId, { pushTokens: tokens.filter((t) => !dead.has(t.token)) }).catch(() => {});
  }
  return results.filter((r) => r === "ok").length;
}

/** Fire-and-forget fan-out; webhooks must answer SignalWire/Telnyx without waiting on FCM. */
export function pushToUsers(userIds: number[], msg: PushMessage): void {
  if (!userIds.length || !pushConfigured()) return;
  void Promise.all(userIds.map((id) => pushToUser(id, msg))).catch(() => {});
}
