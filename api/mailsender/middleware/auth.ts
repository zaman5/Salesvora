import type { Request, Response, NextFunction } from 'express';
import { authenticateRequest } from '../../kimi/auth';
import { getOrCreateShadowUserId } from '../shadowUser';

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
}

function toHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  return headers;
}

// Mail Sender no longer has its own login — the current Salesvora session
// (same cookie every other page uses) is the only source of identity. Every
// Salesvora company maps to one shadow row in Mail Sender's own users table
// (see shadowUser.ts) so campaigns/accounts/leads stay scoped per-company,
// same as the rest of Salesvora.
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await authenticateRequest(toHeaders(req));
    const scopeKey = user.companyId != null ? `company-${user.companyId}` : `user-${user.id}`;
    const label = user.companyId != null ? `Company ${user.companyId}` : (user.name || user.email || 'Superadmin');
    req.userId = getOrCreateShadowUserId(scopeKey, label);
    req.userRole = (user.role === 'admin' || user.role === 'superadmin') ? 'admin' : 'user';
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated. Please log in to Salesvora.' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}
