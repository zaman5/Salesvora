import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { signSessionToken } from "./kimi/session";
import { upsertUser, findUserByEmail } from "./queries/users";
import { z } from "zod";

export const authRouter = createRouter({
  me: authedQuery.query((opts) => opts.ctx.user),
  devLogin: publicQuery
    .input(
      z.object({
        role: z.enum(["superadmin", "admin", "caller", "viewer"]).default("admin"),
      })
    )
    .mutation(async ({ input, ctx }) => {
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

      const userPassword = (user as any).password || (user as any).sipCredentials?.password;
      if (!userPassword || userPassword !== input.password) {
        throw new Error("Invalid email or password");
      }

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
      return { success: true, user };
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
