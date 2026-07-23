import type { CookieOptions } from "hono/utils/cookie";

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);

  return {
    httpOnly: true,
    path: "/",
    // SECURITY (CSRF): this used to be "None" for every non-localhost host,
    // which let any attacker page auto-submit a cross-site form carrying the
    // session cookie (e.g. POST /api/mail/send/campaign/1/run). The frontend
    // only ever calls same-origin relative URLs (src/features/mailsender/lib/
    // api.js uses BASE = '/api/mail', src/providers/trpc.tsx likewise), and
    // there is no cross-site embed of this app anywhere in the codebase, so
    // "Lax" is safe and blocks the cross-origin POST path.
    sameSite: "Lax",
    secure: !localhost,
  };
}
