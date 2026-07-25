import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { authenticateRequest } from "./kimi/auth";
import { verifySessionToken } from "./kimi/session";
import { getSessionCookieOptions } from "./lib/cookies";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
};

/**
 * Drop a session cookie the server can no longer make sense of.
 *
 * APP_SECRET is generated once and persisted outside the deploy checkout, but
 * if that file is ever lost the secret is regenerated and every cookie already
 * in a browser fails signature verification forever. Nothing used to clear
 * them, so the app sat on the login page firing authed queries (getDialerConfig,
 * user.heartbeat) that could only ever return 401 — a console full of errors
 * that no amount of logging in would fix, because the dead cookie was still
 * being sent.
 *
 * Only cookies that genuinely fail verification are cleared. A token that
 * verifies fine but whose account lookup failed (a transient database outage,
 * say) is left alone — expiring those would turn a blip into a mass logout.
 */
async function clearUnverifiableSession(opts: FetchCreateContextFnOptions) {
  const token = cookie.parse(opts.req.headers.get("cookie") || "")[Session.cookieName];
  if (!token) return;
  if (await verifySessionToken(token)) return;

  const cookieOpts = getSessionCookieOptions(opts.req.headers);
  opts.resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, "", {
      httpOnly: cookieOpts.httpOnly,
      path: cookieOpts.path,
      sameSite: cookieOpts.sameSite?.toLowerCase() as "lax" | "none",
      secure: cookieOpts.secure,
      maxAge: 0,
    }),
  );
}

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Authentication is optional here — public procedures still run.
    try {
      await clearUnverifiableSession(opts);
    } catch {
      // Never let cookie cleanup break request handling.
    }
  }
  return ctx;
}
