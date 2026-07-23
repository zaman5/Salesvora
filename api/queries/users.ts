import { getDb } from "./connection";
import { users } from "@db/schema";
import { eq, and, or, desc, ne } from "drizzle-orm";
import { readJsonDb, writeJsonDb } from "./jsonDb";
// Password hashing lives in a dependency-free helper (Node crypto/scrypt) so a
// missing npm package can never crash boot on the shared-hosting deploy. Kept
// in api/lib/password.ts to avoid the users.ts <-> jsonDb.ts import cycle.
import { hashPassword, verifyPassword, isHashedPassword } from "../lib/password";

// Re-exported so existing importers (auth-router, userRouter) keep working.
export { hashPassword, verifyPassword, isHashedPassword };

export async function findAllUsers(companyId?: number) {
  try {
    const db = getDb();
    if (companyId) {
      return await db.query.users.findMany({
        where: and(eq(users.companyId, companyId), ne(users.status, "inactive")),
        orderBy: [desc(users.createdAt)],
      });
    }
    return await db.query.users.findMany({
      where: ne(users.status, "inactive"),
      orderBy: [desc(users.createdAt)],
    });
  } catch {
    console.warn("[findAllUsers] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    let res = data.users.filter((u: any) => u.status !== "inactive");
    if (companyId) {
      res = res.filter((u: any) => u.companyId == companyId && u.status !== "inactive");
    }
    return res.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function findUsersByCompany(companyId: number) {
  try {
    return await getDb().query.users.findMany({
      where: and(eq(users.companyId, companyId), ne(users.status, "inactive")),
      orderBy: [desc(users.createdAt)],
    });
  } catch {
    console.warn("[findUsersByCompany] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.users
      .filter((u: any) => u.companyId == companyId && u.status !== "inactive")
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

/**
 * Users a non-superadmin admin is allowed to see: the ones they personally
 * created, plus themselves. Keeps different admins' teams separate — an
 * admin should not see or manage accounts another admin created.
 */
export async function findUsersCreatedBy(companyId: number, adminId: number) {
  try {
    return await getDb().query.users.findMany({
      where: and(
        eq(users.companyId, companyId),
        ne(users.status, "inactive"),
        or(eq(users.createdBy, adminId), eq(users.id, adminId)),
      ),
      orderBy: [desc(users.createdAt)],
    });
  } catch {
    console.warn("[findUsersCreatedBy] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.users
      .filter((u: any) => u.companyId == companyId && u.status !== "inactive" && (u.createdBy == adminId || u.id == adminId))
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function findUsersByRole(companyId: number, role: string) {
  try {
    return await getDb().query.users.findMany({
      where: and(eq(users.companyId, companyId), eq(users.role, role as any), ne(users.status, "inactive")),
      orderBy: [desc(users.createdAt)],
    });
  } catch {
    console.warn("[findUsersByRole] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.users
      .filter((u: any) => u.companyId == companyId && u.role === role && u.status !== "inactive")
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function findUserById(id: number) {
  try {
    return await getDb().query.users.findFirst({
      where: eq(users.id, id),
    });
  } catch {
    console.warn("[findUserById] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.users.find((u: any) => u.id == id) || null;
  }
}

export async function findCallersByAdmin(adminId: number) {
  try {
    return await getDb().query.users.findMany({
      where: and(eq(users.createdBy, adminId), eq(users.role, "caller"), ne(users.status, "inactive")),
      orderBy: [desc(users.createdAt)],
    });
  } catch {
    console.warn("[findCallersByAdmin] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.users
      .filter((u: any) => u.createdBy == adminId && u.role === "caller" && u.status !== "inactive")
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function createUser(data: any) {
  try {
    const result = await getDb().insert(users).values(data).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createUser] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newUser = {
      id,
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.users.push(newUser);
    writeJsonDb(store);
    return id;
  }
}

export async function updateUser(id: number, data: any) {
  try {
    await getDb().update(users).set(data).where(eq(users.id, id));
  } catch {
    console.warn("[updateUser] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const userIndex = store.users.findIndex((u: any) => u.id == id);
    if (userIndex !== -1) {
      store.users[userIndex] = {
        ...store.users[userIndex],
        ...data,
        updatedAt: new Date().toISOString(),
      };
      writeJsonDb(store);
    }
  }
}

export async function deleteUser(id: number) {
  try {
    await getDb().update(users).set({ status: "inactive" }).where(eq(users.id, id));
  } catch {
    console.warn("[deleteUser] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const userIndex = store.users.findIndex((u: any) => u.id == id);
    if (userIndex !== -1) {
      store.users[userIndex].status = "inactive";
      store.users[userIndex].updatedAt = new Date().toISOString();
      writeJsonDb(store);
    }
  }
}

export async function updateLastLogin(id: number) {
  try {
    await getDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  } catch {
    console.warn("[updateLastLogin] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const userIndex = store.users.findIndex((u: any) => u.id == id);
    if (userIndex !== -1) {
      store.users[userIndex].lastLoginAt = new Date().toISOString();
      writeJsonDb(store);
    }
  }
}

export async function findUserByUnionId(unionId: string) {
  try {
    return await getDb().query.users.findFirst({
      where: eq(users.unionId, unionId),
    });
  } catch {
    console.warn("[findUserByUnionId] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.users.find((u: any) => u.unionId === unionId) || null;
  }
}

export async function findUserByEmail(email: string) {
  try {
    return await getDb().query.users.findFirst({
      where: eq(users.email, email),
    });
  } catch {
    console.warn("[findUserByEmail] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase()) || null;
  }
}

export async function upsertUser(data: { unionId: string; name?: string | null; email?: string | null; avatar?: string | null; role?: string; status?: "active" | "inactive" | "suspended" }) {
  try {
    const db = getDb();
    const existing = await findUserByUnionId(data.unionId);
    if (existing) {
      const updateData: any = {
        name: data.name || existing.name,
        email: data.email || existing.email,
        avatar: data.avatar || existing.avatar,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      };
      if (data.role) updateData.role = data.role;
      if (data.status) updateData.status = data.status;
      await db.update(users)
        .set(updateData)
        .where(eq(users.id, existing.id));
      return findUserById(existing.id);
    }
    // A brand-new self-registering user (e.g. via OAuth) gets the
    // least-privileged role by default — admin/superadmin must be granted
    // explicitly (Users page, or OWNER_UNION_ID for the designated owner).
    const id = await createUser({
      unionId: data.unionId,
      name: data.name,
      email: data.email,
      avatar: data.avatar,
      role: (data.role || "caller") as any,
      status: data.status || "active",
      companyId: undefined,
    });
    return findUserById(id!);
  } catch {
    console.warn("[upsertUser] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const existingIndex = store.users.findIndex((u: any) => u.unionId === data.unionId);
    if (existingIndex !== -1) {
      const updateData: any = {
        name: data.name || store.users[existingIndex].name,
        email: data.email || store.users[existingIndex].email,
        avatar: data.avatar || store.users[existingIndex].avatar,
        lastLoginAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (data.role) updateData.role = data.role;
      if (data.status) updateData.status = data.status;
      store.users[existingIndex] = {
        ...store.users[existingIndex],
        ...updateData,
      };
      writeJsonDb(store);
      return store.users[existingIndex];
    }
    const id = Date.now();
    const newUser = {
      id,
      unionId: data.unionId,
      name: data.name || "Unknown",
      email: data.email || "",
      avatar: data.avatar || "",
      role: data.role || "caller",
      status: "active",
      companyId: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.users.push(newUser);
    writeJsonDb(store);
    return newUser;
  }
}
