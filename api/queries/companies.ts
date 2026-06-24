import { getDb } from "./connection";
import { companies } from "@db/schema";
import { eq } from "drizzle-orm";
import { readJsonDb, writeJsonDb } from "./jsonDb";

export async function findAllCompanies() {
  try {
    return await getDb().query.companies.findMany({
      orderBy: (companies, { desc }) => [desc(companies.createdAt)],
    });
  } catch {
    console.warn("[findAllCompanies] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.companies.filter((c: any) => c.isActive !== false);
  }
}

export async function findCompanyById(id: number) {
  try {
    return await getDb().query.companies.findFirst({
      where: eq(companies.id, id),
    });
  } catch {
    console.warn("[findCompanyById] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.companies.find((c: any) => c.id === id) || null;
  }
}

export async function createCompany(data: any) {
  try {
    const result = await getDb().insert(companies).values(data).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createCompany] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newCompany = {
      id,
      ...data,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.companies.push(newCompany);
    writeJsonDb(store);
    return id;
  }
}

export async function updateCompany(id: number, data: any) {
  try {
    await getDb().update(companies).set(data).where(eq(companies.id, id));
  } catch {
    console.warn("[updateCompany] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const companyIndex = store.companies.findIndex((c: any) => c.id === id);
    if (companyIndex !== -1) {
      store.companies[companyIndex] = {
        ...store.companies[companyIndex],
        ...data,
        updatedAt: new Date().toISOString(),
      };
      writeJsonDb(store);
    }
  }
}

export async function deleteCompany(id: number) {
  try {
    await getDb().update(companies).set({ isActive: false }).where(eq(companies.id, id));
  } catch {
    console.warn("[deleteCompany] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const companyIndex = store.companies.findIndex((c: any) => c.id === id);
    if (companyIndex !== -1) {
      store.companies[companyIndex].isActive = false;
      store.companies[companyIndex].updatedAt = new Date().toISOString();
      writeJsonDb(store);
    }
  }
}
