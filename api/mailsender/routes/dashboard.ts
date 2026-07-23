import { Router } from 'express';
import type { Response } from 'express';
import db from '../db';
import { requireAuth } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const activeCampaigns = (db.prepare("SELECT COUNT(*) as n FROM campaigns WHERE user_id=? AND status='active'").get(req.userId) as any)?.n || 0;
    const totalCampaigns  = (db.prepare('SELECT COUNT(*) as n FROM campaigns WHERE user_id=?').get(req.userId) as any)?.n || 0;
    const prospects = (db.prepare('SELECT COUNT(*) as n FROM leads WHERE user_id=?').get(req.userId) as any)?.n || 0;

    // Also count leads inside campaigns
    const campaignLeads = (db.prepare('SELECT COUNT(*) as n FROM campaign_leads WHERE user_id=?').get(req.userId) as any)?.n || 0;

    // Aggregate metrics across campaigns
    const metrics = db.prepare('SELECT SUM(sent) as s, SUM(opens) as o, SUM(replies) as r, SUM(bounced) as b FROM campaigns WHERE user_id=?').get(req.userId) as any;

    const sent    = metrics?.s || 0;
    const opens   = metrics?.o || 0;
    const replies = metrics?.r || 0;
    const bounced = metrics?.b || 0;

    const openRate   = sent > 0 ? ((opens   / sent) * 100).toFixed(1) : '0.0';
    const replyRate  = sent > 0 ? ((replies / sent) * 100).toFixed(1) : '0.0';
    const bounceRate = sent > 0 ? ((bounced / sent) * 100).toFixed(1) : '0.0';

    // Warmup / account status
    const warmupAccounts = db.prepare('SELECT email, warmup_status FROM email_accounts WHERE user_id=? LIMIT 4').all(req.userId) as any[];
    const accountsCount  = (db.prepare('SELECT COUNT(*) as n FROM email_accounts WHERE user_id=?').get(req.userId) as any)?.n || 0;

    res.json({
      activeCampaigns,
      totalCampaigns,
      prospects: Math.max(prospects, campaignLeads),
      sent,
      openRate,
      replyRate,
      bounceRate,
      warmupAccounts,
      accountsCount,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});


export default router;
