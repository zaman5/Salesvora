import { findCompanyById, updateCompany } from "../queries/companies";
import { toE164 } from "./telnyx";

// Company-scoped SMS contact names: lets agents label a client's phone number
// with a real name so the inbox shows "John Smith" instead of "+15550001234".
// Stored in company.settings.smsContacts, same pattern as phoneNumbers.

export type SmsContact = { number: string; name: string };

function settingsOf(company: unknown): Record<string, unknown> {
  const s = (company as { settings?: unknown } | null)?.settings;
  return s && typeof s === "object" ? { ...(s as Record<string, unknown>) } : {};
}

export async function listContacts(companyId: number): Promise<SmsContact[]> {
  const company = await findCompanyById(companyId);
  const list = settingsOf(company).smsContacts;
  return Array.isArray(list) ? (list as SmsContact[]) : [];
}

/** Upsert a contact name for a number; an empty name removes the entry. */
export async function setContactName(
  companyId: number,
  number: string,
  name: string,
): Promise<SmsContact[]> {
  const normalized = toE164(number);
  const trimmed = name.trim();
  const contacts = (await listContacts(companyId)).filter(
    (c) => toE164(c.number) !== normalized,
  );
  if (trimmed) contacts.push({ number: normalized, name: trimmed });
  const company = await findCompanyById(companyId);
  const settings = settingsOf(company);
  await updateCompany(companyId, { settings: { ...settings, smsContacts: contacts } });
  return contacts;
}
