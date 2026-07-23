import * as jose from "jose";
import { env } from "../lib/env";
import type { SessionPayload } from "./types";

const JWT_ALG = "HS256";

/**
 * Session token lifetime.
 *
 * Was "1 year", which meant a single stolen cookie stayed valid essentially
 * forever and a revoked/deleted user kept a working token until then.
 *
 * TODO: there is currently NO refresh flow — `signSessionToken` is only called
 * at password login (auth-router) and at the OAuth callback (kimi/auth), and
 * nothing re-issues the cookie while the app is in use. Dropping straight to
 * "7d" would therefore force every user (the owner included) back through the
 * login screen every week with no silent renewal. 30 days is the compromise:
 * a large reduction in the exposure window without a weekly interruption.
 * Once a refresh endpoint exists (sliding renewal on authenticated requests,
 * plus server-side revocation), shorten this to "7d" or less.
 */
const SESSION_TOKEN_TTL = "30d";

export async function signSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(SESSION_TOKEN_TTL)
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) {
    console.warn("[session] No token provided for verification.");
    return null;
  }
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const { unionId, clientId } = payload;
    if (!unionId || !clientId) {
      console.warn("[session] JWT payload missing required fields.");
      return null;
    }
    return { unionId, clientId } as SessionPayload;
  } catch (error) {
    console.warn("[session] JWT verification failed:", error);
    return null;
  }
}
