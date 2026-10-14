import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanVariableBadges, cleanUnsupportedCss, formatEmailHtml } from './utils/emailFormat';
import { applyVariables } from './routes/send';
import db from './db';

describe('Email Formatting & Variable Cleanser', () => {
  it('cleans purple editor badges from single and multiple variables', () => {
    const raw = '<p>Hello <span style="background:rgba(99,102,241,0.18);color:#818cf8;border-radius:3px;padding:1px 4px;font-family:monospace;font-size:0.82em">{{first_name}}</span>, welcome to <span style="background:rgba(99,102,241,0.18);color:#818cf8;border-radius:3px;padding:1px 4px;font-family:monospace;font-size:0.82em">{{company}}</span>!</p>';
    const cleaned = cleanVariableBadges(raw);
    expect(cleaned).toBe('<p>Hello {{first_name}}, welcome to {{company}}!</p>');
  });

  it('cleans badges with single quotes and variations of rgba/monospace styling', () => {
    const raw1 = `<span style='background: rgba(99, 102, 241, 0.2); font-family: monospace;'>{{first_name}}</span>`;
    expect(cleanVariableBadges(raw1)).toBe('{{first_name}}');

    const raw2 = `<span class="pill" style="color: #818cf8; font-family: monospace">{{email}}</span>`;
    expect(cleanVariableBadges(raw2)).toBe('{{email}}');
  });

  it('replaces all custom CSS variables with inline mail-safe hex colors', () => {
    const raw = '<div style="color: var(--text-primary); border: 1px solid var(--border-color); background-color: var(--bg-primary);"><span style="color: var(--accent-primary)">Link</span></div>';
    const cleaned = cleanUnsupportedCss(raw);
    expect(cleaned).not.toContain('var(--text-primary)');
    expect(cleaned).not.toContain('var(--border-color)');
    expect(cleaned).not.toContain('var(--bg-primary)');
    expect(cleaned).not.toContain('var(--accent-primary)');
    expect(cleaned).toContain('#4f46e5');
  });

  it('wraps email in responsive HTML structure without double-wrapping', () => {
    const content = '<p>Hello World</p>';
    const wrapped = formatEmailHtml(content);
    expect(wrapped).toContain('<!DOCTYPE html>');
    expect(wrapped).toContain('<div class="email-wrapper">');
    expect(wrapped).toContain('<p>Hello World</p>');

    // Should NOT double wrap if already full HTML
    const doubleCheck = formatEmailHtml(wrapped);
    expect((doubleCheck.match(/<!DOCTYPE/g) || []).length).toBe(1);
    expect((doubleCheck.match(/<html/g) || []).length).toBe(1);
  });

  it('correctly applies variables and resolves spintax', () => {
    const lead = {
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@example.com',
      company: 'Acme Corp',
      title: 'VP Sales',
    };
    const account = {
      first_name: 'Bob',
      last_name: 'Sender',
      email: 'bob@sender.com',
    };
    const signature = 'Best,\nBob\nAcme';

    const template = '<p>{{random|Hello|Hi}} <span style="background:rgba(99,102,241,0.18);font-family:monospace">{{first_name}}</span>,</p><p>Are you still {{job_title}} at {{company}}?</p><p>{{sender_signature}}</p>';
    const result = applyVariables(template, lead, account, signature);

    expect(result).toMatch(/^(<p>(Hello|Hi) Alice,<\/p>)/);
    expect(result).toContain('Are you still VP Sales at Acme Corp?');
    expect(result).toContain('Best,<br>Bob<br>Acme');
    expect(result).not.toContain('rgba(99,102,241');
  });
});

describe('Mailsender Database Schema & Drafts', () => {
  const testUserId = 99999;

  beforeEach(() => {
    // Seed test user and account for FK constraints
    db.prepare("INSERT OR IGNORE INTO users (id, name, email, password) VALUES (?, 'Test User', 'testuser99999@example.com', 'hash')").run(testUserId);
    db.prepare("INSERT OR IGNORE INTO email_accounts (id, user_id, email) VALUES (99999, ?, 'testacc@example.com')").run(testUserId);
    db.prepare('DELETE FROM email_drafts WHERE user_id=?').run(testUserId);
    db.prepare('DELETE FROM inbox_cache WHERE user_id=?').run(testUserId);
  });

  afterEach(() => {
    db.prepare('DELETE FROM email_drafts WHERE user_id=?').run(testUserId);
    db.prepare('DELETE FROM inbox_cache WHERE user_id=?').run(testUserId);
    db.prepare('DELETE FROM email_accounts WHERE user_id=?').run(testUserId);
    db.prepare('DELETE FROM users WHERE id=?').run(testUserId);
  });

  it('creates and updates drafts with attachments', () => {
    const atts = [{ filename: 'test.pdf', size: 1024, contentType: 'application/pdf' }];
    const res = db.prepare(`
      INSERT INTO email_drafts (user_id, account_id, to_email, subject, body, attachments_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(testUserId, 99999, 'lead@example.com', 'Draft Subject', '<p>Draft body</p>', JSON.stringify(atts));

    const draftId = res.lastInsertRowid;
    expect(draftId).toBeGreaterThan(0);

    const draft = db.prepare('SELECT * FROM email_drafts WHERE id=?').get(draftId) as any;
    expect(draft.to_email).toBe('lead@example.com');
    expect(draft.subject).toBe('Draft Subject');
    expect(JSON.parse(draft.attachments_json)).toEqual(atts);

    // Update draft
    db.prepare(`
      UPDATE email_drafts SET subject=?, body=? WHERE id=?
    `).run('Updated Subject', '<p>Updated body</p>', draftId);

    const updated = db.prepare('SELECT * FROM email_drafts WHERE id=?').get(draftId) as any;
    expect(updated.subject).toBe('Updated Subject');
  });

  it('stores and retrieves sent emails with recipient_email and attachments_json in inbox_cache', () => {
    const now = new Date();
    const sentId = `sent-${testUserId}-1-${now.getTime()}`;
    const atts = [{ filename: 'contract.pdf', size: 2048, contentType: 'application/pdf' }];

    db.prepare(`
      INSERT INTO inbox_cache
        (id, user_id, account_id, account_email, folder, uid, sender_name, sender_email,
         recipient_email, subject, preview, body, attachments_json, date_raw, unread, starred, spam, synced_at)
      VALUES (?, ?, ?, ?, 'Sent', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
    `).run(
      sentId, testUserId, 1, 'sales@company.com', 12345,
      'Sales Team', 'sales@company.com', 'client@target.com',
      'Proposal', 'Please find proposal...',
      '<p>Please find proposal...</p>', JSON.stringify(atts),
      now.toISOString(), Date.now()
    );

    const cached = db.prepare('SELECT * FROM inbox_cache WHERE id=?').get(sentId) as any;
    expect(cached).toBeDefined();
    expect(cached.folder).toBe('Sent');
    expect(cached.recipient_email).toBe('client@target.com');
    expect(JSON.parse(cached.attachments_json)).toEqual(atts);
  });

  it('stores and retrieves campaign sequences with attachment metadata', () => {
    const steps = [
      {
        id: 1,
        waitDays: 0,
        activeVar: 0,
        variations: [
          {
            id: 'v1',
            subject: 'Cold Outreach with Brochure',
            body: '<p>Please find attached brochure</p>',
            attachments: [
              { filename: 'brochure.pdf', contentType: 'application/pdf', size: 10240, content: 'JVBERi0xLjQK...' }
            ]
          }
        ]
      }
    ];

    db.prepare("INSERT OR IGNORE INTO campaigns (id, user_id, name) VALUES (99999, ?, 'Test Campaign')").run(testUserId);
    db.prepare('DELETE FROM campaign_sequences WHERE campaign_id=99999').run();

    db.prepare(`
      INSERT INTO campaign_sequences (campaign_id, user_id, steps_json)
      VALUES (99999, ?, ?)
    `).run(testUserId, JSON.stringify(steps));

    const row = db.prepare('SELECT steps_json FROM campaign_sequences WHERE campaign_id=99999').get() as any;
    expect(row).toBeDefined();
    const retrieved = JSON.parse(row.steps_json);
    expect(retrieved[0].variations[0].attachments[0].filename).toBe('brochure.pdf');

    db.prepare('DELETE FROM campaign_sequences WHERE campaign_id=99999').run();
    db.prepare('DELETE FROM campaigns WHERE id=99999').run();
  });
});

