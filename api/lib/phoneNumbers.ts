import { findCompanyById, updateCompany } from "../queries/companies";
import { toE164 } from "./telnyx";

export type PhoneNumber = {
  id: number;
  number: string;
  label?: string;
  status: "active" | "inactive";
  assignedTo?: number | null; // user id (admin or caller), or null/undefined = unassigned pool
};

function settingsOf(company: unknown): Record<string, unknown> {
  const s = (company as { settings?: unknown } | null)?.settings;
  return s && typeof s === "object" ? { ...(s as Record<string, unknown>) } : {};
}

export async function listPhoneNumbers(companyId: number): Promise<PhoneNumber[]> {
  const company = await findCompanyById(companyId);
  const list = settingsOf(company).phoneNumbers;
  return Array.isArray(list) ? (list as PhoneNumber[]) : [];
}

async function writePhoneNumbers(companyId: number, numbers: PhoneNumber[]): Promise<PhoneNumber[]> {
  const company = await findCompanyById(companyId);
  const settings = settingsOf(company);
  await updateCompany(companyId, { settings: { ...settings, phoneNumbers: numbers } });
  return numbers;
}

export async function addPhoneNumber(
  companyId: number,
  input: { number: string; label?: string },
): Promise<PhoneNumber[]> {
  const numbers = await listPhoneNumbers(companyId);
  const normalized = toE164(input.number);
  if (numbers.some((n) => n.number === normalized)) return numbers;
  const entry: PhoneNumber = {
    id: Date.now(),
    number: normalized,
    label: input.label?.trim() || undefined,
    status: "active",
  };
  return writePhoneNumbers(companyId, [...numbers, entry]);
}

export async function removePhoneNumber(companyId: number, id: number): Promise<PhoneNumber[]> {
  const numbers = await listPhoneNumbers(companyId);
  return writePhoneNumbers(companyId, numbers.filter((n) => n.id !== id));
}

export async function togglePhoneNumber(companyId: number, id: number): Promise<PhoneNumber[]> {
  const numbers = await listPhoneNumbers(companyId);
  return writePhoneNumbers(
    companyId,
    numbers.map((n) => (n.id === id ? { ...n, status: n.status === "active" ? "inactive" : "active" } : n)),
  );
}

export async function updatePhoneNumber(
  companyId: number,
  id: number,
  patch: { label?: string; number?: string },
): Promise<PhoneNumber[]> {
  const numbers = await listPhoneNumbers(companyId);
  return writePhoneNumbers(
    companyId,
    numbers.map((n) =>
      n.id === id
        ? {
            ...n,
            ...(patch.label !== undefined ? { label: patch.label || undefined } : {}),
            ...(patch.number ? { number: toE164(patch.number) } : {}),
          }
        : n,
    ),
  );
}

export async function assignPhoneNumber(
  companyId: number,
  id: number,
  callerId: number | null,
): Promise<PhoneNumber[]> {
  const numbers = await listPhoneNumbers(companyId);
  return writePhoneNumbers(
    companyId,
    numbers.map((n) => (n.id === id ? { ...n, assignedTo: callerId } : n)),
  );
}

/**
 * Numbers a user (admin or caller) may dial/text from.
 *
 * Strict rule: if ANY numbers are explicitly assigned to this user, return
 * ONLY those — they must not see numbers belonging to other users or the
 * global pool.
 *
 * Fallback: if no number is assigned to them yet, return pool numbers
 * (assignedTo = null / undefined) so they can still make calls while the
 * superadmin hasn't made an explicit assignment yet.
 */
export function numbersForCaller(numbers: PhoneNumber[], userId: number): string[] {
  const mine = numbers.filter(
    (n) => n.status !== "inactive" && n.number && n.assignedTo === userId,
  );
  if (mine.length > 0) {
    // Caller has explicit assignments — show ONLY those
    return mine.map((n) => n.number);
  }
  // No assignment yet → show unassigned pool numbers (no number belongs to another caller)
  return numbers
    .filter((n) => n.status !== "inactive" && n.number && !n.assignedTo)
    .map((n) => n.number);
}