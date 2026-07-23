import db from './db';

// Mailsender's schema keys every table off a `users.id` foreign key. Rather than
// rewrite ~3000 lines of route/query logic to scope by Salesvora's companyId
// directly, every Salesvora company gets exactly one shadow row in this table —
// so "user_id" here means "which Salesvora company owns this data", matching
// how leads/campaigns are already scoped company-wide in Salesvora itself.
export function getOrCreateShadowUserId(scopeKey: string, label: string): number {
  const shadowEmail = `${scopeKey}@shadow.internal`;
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(shadowEmail) as { id: number } | undefined;
  if (existing) return existing.id;

  const info = db
    .prepare(`INSERT INTO users (name, email, password, role, verified) VALUES (?, ?, '', 'admin', 1)`)
    .run(label, shadowEmail);
  return Number(info.lastInsertRowid);
}
