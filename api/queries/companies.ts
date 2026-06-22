import { getDb } from "./connection";
import { companies } from "@db/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const dbJsonPath = path.resolve(process.cwd(), "db.json");

function readJsonDb() {
  if (!fs.existsSync(dbJsonPath)) {
    const initialData = {
      users: [],
      companies: [
        {
          id: 1,
          name: "Acme Corporation",
          phone: "+1-555-0100",
          email: "admin@acme.com",
          address: "123 Business Ave, Suite 100",
          website: "https://acme.com",
          industry: "Technology",
          isActive: true,
          settings: {
            phoneNumbers: [
              { id: 1, name: "Twilio Sales Line", provider: "Twilio", number: "+1-855-901-2003", status: "active", details: "SID: AC7b8a...df41" },
              { id: 2, name: "Telnyx Support Line", provider: "Telnyx", number: "+1-888-402-9904", status: "active", details: "Conn: 49204..." },
              { id: 3, name: "Custom SIP Agent Line", provider: "Custom SIP", number: "+1-555-102-3004", status: "inactive", details: "Domain: sip.voip.com" }
            ]
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };
    fs.writeFileSync(dbJsonPath, JSON.stringify(initialData, null, 2), "utf-8");
    return initialData;
  }
  try {
    const content = fs.readFileSync(dbJsonPath, "utf-8");
    const data = JSON.parse(content);
    if (!data.companies) {
      data.companies = [
        {
          id: 1,
          name: "Acme Corporation",
          phone: "+1-555-0100",
          email: "admin@acme.com",
          address: "123 Business Ave, Suite 100",
          website: "https://acme.com",
          industry: "Technology",
          isActive: true,
          settings: {
            phoneNumbers: [
              { id: 1, name: "Twilio Sales Line", provider: "Twilio", number: "+1-855-901-2003", status: "active", details: "SID: AC7b8a...df41" },
              { id: 2, name: "Telnyx Support Line", provider: "Telnyx", number: "+1-888-402-9904", status: "active", details: "Conn: 49204..." },
              { id: 3, name: "Custom SIP Agent Line", provider: "Custom SIP", number: "+1-555-102-3004", status: "inactive", details: "Domain: sip.voip.com" }
            ]
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      fs.writeFileSync(dbJsonPath, JSON.stringify(data, null, 2), "utf-8");
    }
    return data;
  } catch (err) {
    console.error("Failed to parse db.json, returning empty structure:", err);
    return { users: [], companies: [] };
  }
}

function writeJsonDb(data: any) {
  try {
    fs.writeFileSync(dbJsonPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write to db.json:", err);
  }
}

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
