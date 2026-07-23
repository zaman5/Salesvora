import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import db from '../db';
import { tlsOptionsFor } from './security';

// ─── Default Fallback API Key ───────────────────────────────────────────────
const DEFAULT_OPENAI_KEY = "";

// ─── Realistic Fallback Warmup Templates ─────────────────────────────────────
const FALLBACK_TEMPLATES = [
  {
    subject: "Quick feedback on your recent blog post",
    body: "Hi,\n\nI was reading your article on scaling engineering teams and found it really insightful. I loved the section on performance reviews. We've been looking to update our internal handbook.\n\nDo you have any recommendations for templates or further reading on this topic?\n\nBest,\n{{sender_name}}"
  },
  {
    subject: "Inquiry regarding custom integrations and options",
    body: "Hello,\n\nI was looking through your product integration documentation. We're interested in connecting your tool with our internal database systems.\n\nIs there a team member we could speak to about custom SSO setup and API rate limits?\n\nKind regards,\n{{sender_name}}"
  },
  {
    subject: "Introductory chat / marketing synergies",
    body: "Hi there,\n\nI run growth at our startup and came across what you guys are building. I think there is a nice alignment between our audience and your solutions.\n\nWould you be open to a brief 10-minute sync sometime next week?\n\nBest regards,\n{{sender_name}}"
  },
  {
    subject: "Question about enterprise pricing and SLA tiers",
    body: "Hello,\n\nOur team is currently evaluating platforms for our Q3 launch. We need a tier that supports 50+ seats and custom data governance constraints.\n\nCould you send over your latest SLA document and enterprise rate sheet?\n\nThanks,\n{{sender_name}}"
  },
  {
    subject: "Virtual networking / coffee connect",
    body: "Hey,\n\nI'm a founder in the analytics space. I try to connect with other builders in similar industries every week. Your product caught my eye.\n\nLet me know if you'd be open to a quick Zoom call sometime soon.\n\nCheers,\n{{sender_name}}"
  }
];

const FALLBACK_REPLIES = [
  "Thanks for reaching out! That sounds interesting. I'll pass this along to our product lead.",
  "Thanks for the email. Let me check with our scheduling coordinator and get back to you next week.",
  "Appreciate the feedback! I'd love to jump on a call. Let me know what days work best for you.",
  "Hi, thanks for reaching out. Yes, we support custom SSO integrations. Let's set up a quick call.",
  "Hey! Thanks for connecting. I'd definitely be open to a virtual coffee next week."
];

// Helper to make SMTP transporter
function makeTransport(account: any): nodemailer.Transporter {
  const timeoutConfig = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 };
  if (account.esp === 'Google') {
    return nodemailer.createTransport({ service: 'gmail', auth: { user: account.email, pass: account.app_password }, ...timeoutConfig });
  }
  if (account.esp === 'Microsoft') {
    return nodemailer.createTransport({
      host: 'smtp.office365.com', port: 587, secure: false,
      auth: { user: account.email, pass: account.app_password },
      tls: { ciphers: 'SSLv3' },
      ...timeoutConfig
    });
  }
  const port = parseInt(account.smtp_port || '587', 10);
  return nodemailer.createTransport({
    host: account.smtp_host, port, secure: port === 465,
    auth: { user: account.smtp_user || account.email, pass: account.smtp_pass },
    // Verify the server certificate unless this specific account opted out.
    tls: tlsOptionsFor(account),
    ...timeoutConfig
  });
}

// ─── Tenant scoping helper ───────────────────────────────────────────────────
// Every account query in this engine MUST be filtered by user_id. Without it the
// warmup pool paired mailboxes across tenants (leaking one customer's addresses
// and subject lines into another's logs) and a single authenticated user could
// drive every tenant's mailboxes via POST /api/mail/warmup/trigger.
function loadActiveWarmupAccounts(userId: number): any[] {
  return db
    .prepare("SELECT * FROM email_accounts WHERE status='active' AND warmup_status='active' AND user_id = ?")
    .all(userId) as any[];
}

/** All user ids that currently have at least one active warmup mailbox. */
export function listWarmupUserIds(): number[] {
  const rows = db
    .prepare("SELECT DISTINCT user_id FROM email_accounts WHERE status='active' AND warmup_status='active'")
    .all() as any[];
  return rows.map(r => r.user_id).filter((id: unknown): id is number => typeof id === 'number');
}

// Low-level OpenAI API fetch wrapper
export async function callOpenAI(apiKey: string, prompt: string, systemMessage = "You are a professional business writer."): Promise<string> {
  const key = apiKey || process.env.OPENAI_API_KEY || DEFAULT_OPENAI_KEY;
  if (!key) {
    throw new Error("OpenAI API key is not configured.");
  }
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 250
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI status=${res.status} body=${errText}`);
    }

    const data: any = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch (err) {
    console.error("[OpenAI] API call failed:", err);
    throw err;
  }
}

// Parse custom settings JSON
function getWarmupSettings(account: any) {
  try {
    if (account.warmup_settings_json) {
      return JSON.parse(account.warmup_settings_json);
    }
  } catch (_) {}
  return {
    filterTag: 'helpful',
    includeFilterTag: false,
    dailyLimit: 20,
    emailReply: true,
    activeLimit: 1,
    dailyIncrement: 1,
    replyRate: 50,
    personalizedList: '',
    businessType: '',
    universe: '',
    customContent: '',
    signature: '',
    openaiKey: '',
    warmupMode: 'ai',
    customTemplates: []
  };
}

// ─── WARMUP SENDING ──────────────────────────────────────────────────────────
// Runs one warmup sending cycle for a SINGLE tenant. `userId` is mandatory:
// callers must iterate per user (see cron.ts) rather than sweeping globally.
export async function runWarmupSending(userId: number): Promise<{ sent: number; logs: string[] }> {
  const logs: string[] = [];
  let sentCount = 0;

  try {
    // 1. Get this user's active warmup accounts (tenant-scoped)
    const accounts = loadActiveWarmupAccounts(userId);
    if (accounts.length === 0) {
      return { sent: 0, logs: ["No active warmup accounts found."] };
    }

    for (const sender of accounts) {
      const settings = getWarmupSettings(sender);
      const limit = parseInt(settings.dailyLimit || '20', 10);

      // Check how many sent today
      const today = new Date().toISOString().split('T')[0];
      const todaySentRow = db.prepare(`
        SELECT COUNT(*) as count FROM warmup_logs 
        WHERE sender_account_id = ? AND date_sent = ?
      `).get(sender.id, today) as any;
      const todaySent = todaySentRow?.count || 0;

      if (todaySent >= limit) {
        logs.push(`Account ${sender.email} reached daily limit (${todaySent}/${limit})`);
        continue;
      }

      // 2. Select recipient
      let recipientEmail = '';
      let isPoolAccount = false;

      // Check if user set a custom list of emails
      const customList = (settings.personalizedList || '').split(',').map((e: string) => e.trim()).filter(Boolean);
      if (customList.length > 0) {
        recipientEmail = customList[Math.floor(Math.random() * customList.length)];
      } else {
        // Fallback to pool: another active warmup account. `accounts` is already
        // restricted to this user, so pairing can never cross tenants; the
        // explicit user_id check below is defense in depth.
        const otherPool = accounts.filter(a => a.id !== sender.id && a.user_id === sender.user_id);
        if (otherPool.length > 0) {
          const chosen = otherPool[Math.floor(Math.random() * otherPool.length)];
          recipientEmail = chosen.email;
          isPoolAccount = true;
        } else {
          // No other pool account found
          logs.push(`No pairing partner for ${sender.email} in database warmup pool`);
          continue;
        }
      }

      // 3. Generate Warmup Email Subject & Body
      let subject = '';
      let body = '';
      const senderName = [sender.first_name, sender.last_name].filter(Boolean).join(' ') || sender.email.split('@')[0];

      const warmupMode = settings.warmupMode || 'ai';
      const customTemplates = settings.customTemplates || [];

      if (warmupMode === 'custom' && customTemplates.length > 0) {
        const chosenTemplate = customTemplates[Math.floor(Math.random() * customTemplates.length)];
        subject = chosenTemplate.subject || "Quick business connect";
        body = chosenTemplate.body || "Hi,\n\nI wanted to reach out regarding potential collaborations.\n\nThanks,\n" + senderName;
      } else {
        try {
          const businessType = settings.businessType || 'outreach automation / software services';
          const customPrompt = settings.customContent || 'a professional networking email';
          const apiKey = settings.openaiKey || '';

          const systemPrompt = "You are a professional business manager writing an outreach email. Write a natural, highly realistic, friendly email. Return a JSON structure ONLY: {\"subject\": \"...\", \"body\": \"...\"}. Do not use Markdown formatting or code block wrapper block backticks.";
          const userPrompt = `Write a short, realistic business or networking email from a sender named "${senderName}". The email should relate to "${businessType}" and follow this prompt style: "${customPrompt}". Keep the email short (2-4 sentences).`;

          const rawAi = await callOpenAI(apiKey, userPrompt, systemPrompt);
          let parsed: any;
          
          // Clean JSON formatting from AI if present
          const jsonStr = rawAi.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            // regex fallback
            const subjMatch = jsonStr.match(/"subject"\s*:\s*"([^"]+)"/i);
            const bodyMatch = jsonStr.match(/"body"\s*:\s*"([\s\S]+?)"/i);
            if (subjMatch && bodyMatch) {
              parsed = { subject: subjMatch[1], body: bodyMatch[1].replace(/\\n/g, '\n') };
            } else {
              throw new Error("Could not parse AI JSON response: " + jsonStr);
            }
          }

          subject = parsed.subject || "Quick networking connect";
          body = parsed.body || "Hi,\n\nI wanted to reach out regarding potential business partnerships.\n\nThanks,\n" + senderName;
        } catch (aiErr) {
          logs.push(`AI generation failed for ${sender.email}, using template: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`);
          // Fallback Template
          const t = FALLBACK_TEMPLATES[Math.floor(Math.random() * FALLBACK_TEMPLATES.length)];
          subject = t.subject;
          body = t.body.replace("{{sender_name}}", senderName);
        }
      }

      // 4. Append filter tags if enabled
      const filterTag = settings.filterTag || 'helpful';
      if (settings.includeFilterTag) {
        body += `\n\n[tag: ${filterTag}]`;
      }

      // Add signature if provided
      if (settings.signature) {
        body += `\n\n${settings.signature}`;
      }

      // 5. Send via SMTP
      try {
        const transporter = makeTransport(sender);
        await transporter.sendMail({
          from: sender.email,
          to: recipientEmail,
          subject: subject,
          text: body,
          headers: {
            'X-MailSender-Warmup': 'true',
            'X-MailSender-Warmup-Filter': filterTag
          }
        });

        // Insert send log
        db.prepare(`
          INSERT INTO warmup_logs (sender_account_id, recipient_email, subject, status, folder_found)
          VALUES (?, ?, ?, 'sent', 'INBOX')
        `).run(sender.id, recipientEmail, subject);

        sentCount++;
        logs.push(`[Sent Warmup] ${sender.email} -> ${recipientEmail} Subject: "${subject}"`);
      } catch (smtpErr) {
        logs.push(`[SMTP Fail] ${sender.email} to ${recipientEmail}: ${smtpErr instanceof Error ? smtpErr.message : String(smtpErr)}`);
      }
    }
  } catch (e) {
    logs.push(`Sending cycle crash: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { sent: sentCount, logs };
}


// ─── WARMUP RECEIVING & AUTO-REPLY ──────────────────────────────────────────
// Runs one warmup receive/auto-reply cycle for a SINGLE tenant. `userId` is
// mandatory — see runWarmupSending.
export async function runWarmupReceiving(userId: number): Promise<{ processed: number; logs: string[] }> {
  const logs: string[] = [];
  let processedCount = 0;

  try {
    // 1. Get this user's active warmup accounts to monitor (tenant-scoped)
    const accounts = loadActiveWarmupAccounts(userId);
    if (accounts.length === 0) {
      return { processed: 0, logs: ["No active warmup accounts to monitor."] };
    }

    const allWarmupEmails = new Set(accounts.map(a => a.email.toLowerCase()));

    for (const receiver of accounts) {
      const settings = getWarmupSettings(receiver);
      const filterTag = settings.filterTag || 'helpful';
      const port = parseInt(receiver.imap_port || '993', 10);
      const isSecure = port === 993;

      const client = new ImapFlow({
        host: receiver.imap_host || `imap.${receiver.email.split('@')[1]}`,
        port,
        secure: isSecure,
        auth: {
          user: receiver.smtp_user || receiver.email,
          pass: receiver.smtp_pass || receiver.app_password
        },
        // Verify the IMAP server certificate unless this account opted out.
        tls: tlsOptionsFor(receiver),
        logger: false
      } as any);

      try {
        await client.connect();

        // Check Inbox first, then Spam/Junk
        const foldersToCheck = ['INBOX'];
        try {
          const list = await client.list();
          const spamMbx = list.find(
            mb => mb.path.toLowerCase().includes('spam') ||
                  mb.path.toLowerCase().includes('junk') ||
                  (mb.specialUse && mb.specialUse.toLowerCase().includes('junk'))
          );
          if (spamMbx) foldersToCheck.push(spamMbx.path);
        } catch (_) {}

        for (const mboxName of foldersToCheck) {
          const isSpamMbx = mboxName.toLowerCase().includes('spam') || mboxName.toLowerCase().includes('junk');
          const lock = await client.getMailboxLock(mboxName);

          try {
            // Search all unread messages
            const uids = (await client.search({ seen: false })) as any;
            if (!uids || uids.length === 0) continue;

            // Fetch headers and envelopes in batches
            for await (const msg of client.fetch(uids, { envelope: true, source: true } as any, { uid: true })) {
              const env = msg.envelope;
              const senderAddr = (env?.from?.[0] as any)?.address || '';
              const subjectStr = env?.subject || '';
              
              let isWarmup = false;
              let rawSource = '';

              if (msg.source) {
                rawSource = Buffer.isBuffer(msg.source) ? msg.source.toString('utf8') : Buffer.from(msg.source as any).toString('utf8');
              }

              // Check if it's a warmup email:
              // 1. Has custom header X-MailSender-Warmup
              // 2. Contains the filter tag in body or subject
              // 3. Sender is from our shared warmup pool
              if (
                rawSource.includes('X-MailSender-Warmup: true') ||
                subjectStr.toLowerCase().includes(filterTag.toLowerCase()) ||
                rawSource.toLowerCase().includes(`tag: ${filterTag.toLowerCase()}`) ||
                allWarmupEmails.has(senderAddr.toLowerCase())
              ) {
                isWarmup = true;
              }

              if (!isWarmup) continue;

              logs.push(`[Found Warmup Email] Folder: "${mboxName}", Sender: ${senderAddr}, Subject: "${subjectStr}"`);
              processedCount++;

              // A. If in Spam, move back to INBOX (self-healing deliverability)
              if (isSpamMbx) {
                try {
                  await client.messageMove({ uid: msg.uid }, 'INBOX', { uid: true } as any);
                  logs.push(`[Deliverability Save] Moved warmup email from ${senderAddr} from Spam to INBOX`);
                  
                  // Update log status if matching database sender can be resolved
                  const dbSender = accounts.find(a => a.email.toLowerCase() === senderAddr.toLowerCase());
                  if (dbSender) {
                    db.prepare(`
                      UPDATE warmup_logs 
                      SET folder_found = 'Spam', status = 'saved_from_spam' 
                      WHERE sender_account_id = ? AND recipient_email = ? AND subject = ?
                    `).run(dbSender.id, receiver.email, subjectStr);
                  }
                } catch (moveErr) {
                  logs.push(`Failed to move email from spam: ${moveErr instanceof Error ? moveErr.message : String(moveErr)}`);
                }
              } else {
                // Landed in inbox
                const dbSender = accounts.find(a => a.email.toLowerCase() === senderAddr.toLowerCase());
                if (dbSender) {
                  db.prepare(`
                    UPDATE warmup_logs 
                    SET folder_found = 'INBOX', status = 'landed_inbox' 
                    WHERE sender_account_id = ? AND recipient_email = ? AND subject = ? AND status = 'sent'
                  `).run(dbSender.id, receiver.email, subjectStr);
                }
              }

              // B. Mark as Read (Seen)
              await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true } as any);

              // C. Check Reply setting
              const shouldReply = settings.emailReply && (Math.random() * 100 < parseInt(settings.replyRate || '50', 10));
              if (shouldReply) {
                let replyBody = '';
                const receiverName = [receiver.first_name, receiver.last_name].filter(Boolean).join(' ') || receiver.email.split('@')[0];

                const warmupMode = settings.warmupMode || 'ai';
                const customTemplates = settings.customTemplates || [];

                if (warmupMode === 'custom' && customTemplates.length > 0) {
                  const chosenTemplate = customTemplates[Math.floor(Math.random() * customTemplates.length)];
                  replyBody = chosenTemplate.body || "Thanks for your email. I've received your request.";
                } else {
                  try {
                    const apiKey = settings.openaiKey || '';
                    const systemPrompt = "You are a professional assistant replying to a friendly business email. Keep it extremely short (1-2 sentences). Return plain text only.";
                    const userPrompt = `Write a short, natural business reply to the following email. Keep it highly realistic. Send reply from "${receiverName}".\n\nIncoming email text:\n${rawSource.slice(0, 800)}`;
                    
                    replyBody = await callOpenAI(apiKey, userPrompt, systemPrompt);
                  } catch (_) {
                    // Fallback Reply
                    replyBody = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
                  }
                }

                // Add signature to reply if configured
                if (settings.signature) {
                  replyBody += `\n\n${settings.signature}`;
                }

                try {
                  const replySubject = subjectStr.startsWith('Re:') ? subjectStr : `Re: ${subjectStr}`;
                  const transporter = makeTransport(receiver);
                  await transporter.sendMail({
                    from: receiver.email,
                    to: senderAddr,
                    subject: replySubject,
                    text: replyBody,
                    headers: {
                      'X-MailSender-Warmup': 'true',
                      'X-MailSender-Warmup-Filter': filterTag
                    }
                  });

                  logs.push(`[Warmup Auto-Replied] Sent reply from ${receiver.email} -> ${senderAddr}`);
                  
                  // Update logs status to replied
                  const dbSender = accounts.find(a => a.email.toLowerCase() === senderAddr.toLowerCase());
                  if (dbSender) {
                    db.prepare(`
                      UPDATE warmup_logs 
                      SET status = 'replied' 
                      WHERE sender_account_id = ? AND recipient_email = ? AND subject = ?
                    `).run(dbSender.id, receiver.email, subjectStr);
                  }
                } catch (sendReplyErr) {
                  logs.push(`Failed to send auto-reply from ${receiver.email}: ${sendReplyErr instanceof Error ? sendReplyErr.message : String(sendReplyErr)}`);
                }
              }
            }
          } finally {
            lock.release();
          }
        }
      } catch (imapErr) {
        logs.push(`[IMAP Connect Fail] ${receiver.email}: ${imapErr instanceof Error ? imapErr.message : String(imapErr)}`);
      } finally {
        try { await client.logout(); } catch (_) {}
      }
    }
  } catch (e) {
    logs.push(`Receiving cycle crash: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { processed: processedCount, logs };
}
