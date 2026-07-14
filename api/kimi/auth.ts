import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import * as jose from "jose";
import * as cookie from "cookie";
import { env } from "../lib/env";
import { getSessionCookieOptions } from "../lib/cookies";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { signSessionToken, verifySessionToken } from "./session";
import { users as kimiUsers } from "./platform";
import { findUserByUnionId, upsertUser } from "../queries/users";
import type { TokenResponse } from "./types";

async function exchangeAuthCode(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.appId,
    redirect_uri: redirectUri,
    client_secret: env.appSecret,
  });

  const resp = await fetch(`${env.kimiAuthUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<TokenResponse>;
}

// Lazy — only created when kimiAuthUrl is actually set so the app can
// start without OAuth configured (uses local db.json auth instead).
let _jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!_jwks) {
    if (!env.kimiAuthUrl) throw new Error("KIMI_AUTH_URL is not configured.");
    _jwks = jose.createRemoteJWKSet(
      new URL(`${env.kimiAuthUrl}/api/.well-known/jwks.json`),
    );
  }
  return _jwks;
}

async function verifyAccessToken(
  accessToken: string,
): Promise<{ userId: string; clientId: string }> {
  const { payload } = await jose.jwtVerify(accessToken, getJwks());
  const userId = payload.user_id as string;
  const clientId = payload.client_id as string;
  if (!userId) {
    throw new Error("user_id missing from access token");
  }
  return { userId, clientId };
}

export async function authenticateRequest(headers: Headers) {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) {
    console.warn("[auth] No session cookie found in request.");
    throw Errors.forbidden("Invalid authentication token.");
  }
  const claim = await verifySessionToken(token);
  if (!claim) {
    throw Errors.forbidden("Invalid authentication token.");
  }
  let user;
  try {
    user = await findUserByUnionId(claim.unionId);
  } catch (error) {
    if (env.isProduction) {
      throw error;
    }
    console.warn("[auth] Database query failed during authentication, using mock dev user.");
  }

  if (!user) {
    if (!env.isProduction) {
      let role: "superadmin" | "admin" | "caller" | "viewer" = "admin";
      if (claim.unionId.endsWith("-superadmin")) {
        role = "superadmin";
      } else if (claim.unionId.endsWith("-caller")) {
        role = "caller";
      } else if (claim.unionId.endsWith("-viewer")) {
        role = "viewer";
      }
      // A superadmin is a platform operator and is not tied to one company.
      const companyId = role === "superadmin" ? null : 1;
      user = {
        id: 1,
        unionId: claim.unionId,
        name: `Developer ${role.charAt(0).toUpperCase() + role.slice(1)}`,
        email: `${role}@example.com`,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${role}`,
        role: role,
        status: "active",
        companyId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
    } else {
      throw Errors.forbidden("User not found. Please re-login.");
    }
  }
  if (user.status === "suspended" || user.status === "inactive") {
    throw Errors.forbidden("Your account is inactive or suspended.");
  }
  return user;
}

export function createOAuthCallbackHandler() {
  return async (c: Context) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");
    const errorDescription = c.req.query("error_description");

    if (error) {
      if (error === "access_denied") {
        return c.redirect("/", 302);
      }
      return c.json(
        { error, error_description: errorDescription },
        400,
      );
    }

    if (!code || !state) {
      return c.json({ error: "code and state are required" }, 400);
    }

    try {
      const redirectUri = atob(state);
      const tokenResp = await exchangeAuthCode(code, redirectUri);
      const { userId } = await verifyAccessToken(tokenResp.access_token);
      const userProfile = await kimiUsers.getProfile(tokenResp.access_token);
      if (!userProfile) {
        throw new Error("Failed to fetch user profile from Kimi Open");
      }

      await upsertUser({
        unionId: userId,
        name: userProfile.name,
        avatar: userProfile.avatar_url,
        // The designated owner (OWNER_UNION_ID) becomes superadmin so they can
        // create/promote admins — everyone else keeps upsertUser's normal
        // default (new users land as "admin"; existing users keep their role).
        role: env.ownerUnionId && userId === env.ownerUnionId ? "superadmin" : undefined,
      });

      const token = await signSessionToken({
        unionId: userId,
        clientId: env.appId,
      });

      const cookieOpts = getSessionCookieOptions(c.req.raw.headers);
      setCookie(c, Session.cookieName, token, {
        ...cookieOpts,
        maxAge: Session.maxAgeMs / 1000,
      });

      return c.redirect("/", 302);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      return c.json({ error: "OAuth callback failed" }, 500);
    }
  };
}

export { exchangeAuthCode, verifyAccessToken };
