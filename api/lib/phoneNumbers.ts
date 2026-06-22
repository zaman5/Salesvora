import { findCompanyById, updateCompany } from "../queries/companies";
import { toE164 } from "./telnyx";

export type PhoneNumber = {
  id: number;
  number: string;
  label?: string;
  status: "active" | "inactive";
  assignedTo?: number | null; // caller (user) id, or null = unassigned (any caller can use)
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

// All mutations read-merge-write so other settings (e.g. the Telnyx config) are
// never clobbered.
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
  if (numbers.some((n) => n.number === normalized)) {
    return numbers; // already present, no duplicate
  }
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

/** Active numbers a caller may use: their assigned numbers + any unassigned ones. */
export function numbersForCaller(numbers: PhoneNumber[], userId: number): string[] {
  return numbers
    .filter((n) => n.status !== "inactive" && (!n.assignedTo || n.assignedTo === userId))
    .map((n) => n.number);
}
