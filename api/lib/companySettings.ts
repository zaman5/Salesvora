import { findCompanyById, updateCompany } from "../queries/companies";

export function asSettings(company: unknown): Record<string, unknown> {
  const s = (company as { settings?: unknown } | null)?.settings;
  return s && typeof s === "object" ? { ...(s as Record<string, unknown>) } : {};
}

// company.settings is one JSON blob shared by Telnyx, SignalWire, phone
// numbers and the active telephony provider. Every writer does
// read → modify → write, so two overlapping requests could write back a
// stale copy and silently undo each other (e.g. revert the active provider).
// Serialize writes per company and always re-read the freshest settings.
const locks = new Map<number, Promise<unknown>>();

export async function patchCompanySettings<T>(
  companyId: number,
  mutate: (settings: Record<string, unknown>) => { patch: Record<string, unknown>; result: T },
): Promise<T> {
  const prev = locks.get(companyId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const settings = asSettings(await findCompanyById(companyId));
    const { patch, result } = mutate(settings);
    await updateCompany(companyId, { settings: { ...settings, ...patch } });
    return result;
  });
  locks.set(companyId, run);
  try {
    return await run;
  } finally {
    if (locks.get(companyId) === run) locks.delete(companyId);
  }
}
