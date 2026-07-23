import db from './db';
import { runCampaignEngine } from './routes/send';
import { runWarmupSending, runWarmupReceiving, listWarmupUserIds } from './utils/warmupEngine';

// The warmup engine is now tenant-scoped (it used to sweep every account in the
// database in one pass, pairing mailboxes across tenants). The scheduled job
// therefore iterates one user at a time; behaviour per user is unchanged.
async function runWarmupForEachUser(
  label: string,
  run: (userId: number) => Promise<{ logs: string[] }>,
): Promise<void> {
  for (const userId of listWarmupUserIds()) {
    try {
      await run(userId);
    } catch (err) {
      console.error(`[Cron] ${label} error for user ${userId}:`, err);
    }
  }
}

// A simple in-memory flag to prevent the cron loop from overlapping itself
let isCronRunning = false;
let warmupSendTick = 0;
let warmupRecvTick = 0;

export function startCronService() {
  console.log('[Cron] Background scheduler service started. Checking schedules every 60s.');
  
  // Run every 60 seconds
  setInterval(async () => {
    if (isCronRunning) return;
    isCronRunning = true;

    try {
      // 1. Run active campaigns
      const activeCampaigns = db.prepare("SELECT id, user_id FROM campaigns WHERE status='active'").all() as any[];
      for (const campaign of activeCampaigns) {
        await runCampaignEngine(campaign.id, campaign.user_id);
      }

      // 2. Warmup Sending (Every 10 minutes)
      warmupSendTick++;
      if (warmupSendTick >= 10) {
        warmupSendTick = 0;
        console.log('[Cron] Triggering background Warmup Sending cycle...');
        runWarmupForEachUser('Warmup Sending', async (uid) => {
          const res = await runWarmupSending(uid);
          console.log(`[Cron] Warmup Sending complete for user ${uid}. Sent ${res.sent} emails.`);
          return res;
        }).catch(err => console.error('[Cron] Warmup Sending error:', err));
      }

      // 3. Warmup Receiving & Auto-Reply (Every 15 minutes)
      warmupRecvTick++;
      if (warmupRecvTick >= 15) {
        warmupRecvTick = 0;
        console.log('[Cron] Triggering background Warmup Receiving & Auto-Reply cycle...');
        runWarmupForEachUser('Warmup Receiving', async (uid) => {
          const res = await runWarmupReceiving(uid);
          console.log(`[Cron] Warmup Receiving complete for user ${uid}. Processed ${res.processed} emails.`);
          return res;
        }).catch(err => console.error('[Cron] Warmup Receiving error:', err));
      }

    } catch (e) {
      console.error('[Cron] Error checking campaigns:', e);
    } finally {
      isCronRunning = false;
    }
  }, 60 * 1000); // 1 minute
}

