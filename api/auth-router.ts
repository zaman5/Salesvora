import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { signSessionToken } from "./kimi/session";
import {
  upsertUser, findUserByEmail, updateUser,
  verifyPassword, hashPassword, isBcryptHash,
} from "./queries/users";
import { env } from "./lib/env";
import { z } from "zod";

export const authRouter = createRouter({
  me: authedQuery.query((opts) => opts.ctx.user),
  // Dev-only convenience login that grants any role, including superadmin,
  // with zero credentials. Gated on an explicit opt-in (ALLOW_DEV_LOGIN=true)
  // rather than on NODE_ENV alone: on shared hosting NODE_ENV is frequently
  // unset, and "not production" must never be enough to hand out a superadmin
  // session to an anonymous caller.
  devLogin: publicQuery
    .input(
      z.object({
        role: z.enum(["superadmin", "admin", "caller", "viewer"]).default("admin"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!env.allowDevLogin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Credential-free dev login is disabled. Set ALLOW_DEV_LOGIN=true to enable it locally.",
        });
      }
      try {
        await upsertUser({
          unionId: `dev-owner-id-${input.role}`,
          name: `Developer ${input.role.charAt(0).toUpperCase() + input.role.slice(1)}`,
          email: `${input.role}@example.com`,
          avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${input.role}`,
          role: input.role,
          status: "active",
        });
      } catch (dbError) {
        console.warn("[devLogin] Database registration failed, relying on fallback:", dbError);
      }

      const token = await signSessionToken({
        unionId: `dev-owner-id-${input.role}`,
        clientId: "dev-app-id",
      });

      const opts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(Session.cookieName, token, {
          httpOnly: opts.httpOnly,
          path: opts.path,
          sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
          secure: opts.secure,
          maxAge: Session.maxAgeMs / 1000,
        }),
      );
      return { success: true };
    }),
  login: publicQuery
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await findUserByEmail(input.email);
      if (!user) {
        throw new Error("Invalid email or password");
      }

      // Stored credential lookup order is unchanged from the plaintext era so
      // that no existing account loses its login: the dedicated `password`
      // field wins, otherwise the legacy `sipCredentials.password` mirror.
      const sip = (user as any).sipCredentials as
        { username?: string; password?: string; domain?: string } | undefined | null;
      const storedPassword: unknown = (user as any).password || sip?.password;

      // Transparent verification: bcrypt digests are compared with bcrypt,
      // legacy plaintext values are compared directly. An existing password is
      // never invalidated by this change.
      if (!(await verifyPassword(input.password, storedPassword))) {
        throw new Error("Invalid email or password");
      }

      // Self-migration: the account authenticated against a plaintext value, so
      // replace it with a bcrypt hash right now. Each account upgrades itself
      // on its next successful login with no password reset required.
      if (!isBcryptHash(storedPassword)) {
        try {
          const digest = await hashPassword(input.password);
          const patch: Record<string, unknown> = { password: digest };
          // `domain: "telnyx"` credentials are a REAL SIP secret that the WebRTC
          // dialer registers with — hashing those would break calling. Only the
          // "local" mirror (which exists purely to hold the login password) is
          // rewritten.
          if (sip && sip.domain !== "telnyx" && sip.password === storedPassword) {
            patch.sipCredentials = { ...sip, password: digest };
          }
          await updateUser((user as any).id, patch);
          (user as any).password = digest;
          if (patch.sipCredentials) (user as any).sipCredentials = patch.sipCredentials;
        } catch (migrationError) {
          // A failed migration must never block a valid login — the account
          // simply stays on the legacy path and retries next time.
          console.warn("[login] Password re-hash failed; account stays on legacy storage:", migrationError);
        }
      }

      // Suspension is enforced for every role, superadmin included. Silently
      // reactivating a suspended superadmin would make the suspension useless
      // as a containment measure for a compromised operator account.
      if (user.status === "suspended" || user.status === "inactive") {
        throw new Error("Your account is inactive or suspended");
      }

      const token = await signSessionToken({
        unionId: user.unionId,
        clientId: "dev-app-id",
      });

      const opts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(Session.cookieName, token, {
          httpOnly: opts.httpOnly,
          path: opts.path,
          sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
          secure: opts.secure,
          maxAge: Session.maxAgeMs / 1000,
        }),
      );
      // Never ship credential material back to the browser — the caller only
      // needs the profile. (The Login page discards this payload entirely.)
      const { password: _pw, sipCredentials: _sip, ...safeUser } = user as Record<string, unknown>;
      return { success: true, user: safeUser };
    }),
  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),
});
