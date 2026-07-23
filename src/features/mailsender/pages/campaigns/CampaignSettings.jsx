import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import RichEditor from '../../components/RichEditor';

function isHtmlEmpty(html) {
  return !html || /^(<p>)?(<br\s*\/?>)?(<\/p>)?(\s|&nbsp;)*$/i.test(html.trim());
}

const SAFETY_SETTINGS = [
  { key: 'stopOnReply', label: 'Stop sending emails on reply', desc: 'When a lead replies, subsequent emails steps in the sequence will not be sent.', default: true },
  { key: 'continueOOO', label: 'Continue sending for Out of Office replies and Automatic replies', desc: 'Enabling this option will continue with subsequent emails if a reply is detected as an Out of Office message or an automatic reply', default: false },
  { key: 'stopSameDomain', label: 'Stop sending to same Domain on reply', desc: 'When a lead replies to a campaign email, further emails will not be sent to other leads from the same domain.', default: false },
  { key: 'openTracking', label: 'Open Rate Tracking', desc: 'Open rate tracking is no longer a reliable metric due to recent updates by email service providers. Enabling it can reduce deliverability by up to 80%. There is no reason to turn it on.', default: false },
  { key: 'unsubLink', label: 'Unsubscribe link', desc: 'Enabling this will include an unsubscribe link in the email body and header. We do not recommend enabling this unless you are legally required to, as it can drastically reduce email deliverability.', default: false },
  { key: 'plainText', label: 'Send as Plain Text', desc: 'When plain text sending is on, images and links will be displayed as text URLs. Please send a test email to ensure this meets your requirements.', default: false },
  { key: 'riskyEmails', label: 'Send to Risky Emails', desc: 'If email verification has been run for these leads\' emails, enabling this will allow contacting risky addresses.', default: false },
  { key: 'autoPause', label: 'Auto-Pause Campaign on High Bounce Rate', desc: 'When the bounce rate reaches or exceeds your defined percentage and at least 100 campaign emails have been sent, the campaign will auto-pause.', default: true },
];

const PREFERENCE_OPTIONS = [
  { label: 'All New', ratio: '100/0' },
  { label: 'Growth', ratio: '70/30' },
  { label: 'Balanced', ratio: '50/50' },
  { label: 'Retention', ratio: '30/70' },
  { label: 'All Follow-ups', ratio: '0/100' },
];

function Toggle({ value, onChange }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 42, height: 24, borderRadius: 99, cursor: 'pointer',
        background: value ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
        border: `2px solid ${value ? 'var(--accent-primary)' : 'var(--border-color)'}`,
        position: 'relative', transition: 'all 0.2s', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 1, left: value ? 18 : 1,
        width: 18, height: 18, borderRadius: '50%',
        background: value ? '#fff' : 'var(--text-muted)',
        transition: 'left 0.2s',
      }} />
    </div>
  );
}

export default function CampaignSettings({ campaign }) {
  const [name, setName] = useState(campaign?.name || '');
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [preference, setPreference] = useState('Balanced');
  const [variationMode, setVariationMode] = useState('roundrobin');
  const [espMatching, setEspMatching] = useState(false);
  const [opportunityValue, setOpportunityValue] = useState('0');
  const [safety, setSafety] = useState(() =>
    Object.fromEntries(SAFETY_SETTINGS.map(s => [s.key, s.default]))
  );
  const [toast, setToast] = useState('');
  const [addAccountModal, setAddAccountModal] = useState(false);
  // Real email accounts from DB
  const [emailAccounts, setEmailAccounts] = useState([]);
  // All available tags
  const [allTags, setAllTags] = useState([]); // [{tag, count}]
  // Send test email — defaults get replaced with the campaign's real Step 1
  // content once sequences load (see effect below), so "Send Test Email"
  // previews what will actually go out instead of unrelated placeholder text.
  const [testToEmail, setTestToEmail]   = useState('');
  const [testSubject, setTestSubject]   = useState('');
  const [testBody, setTestBody]         = useState('');
  const [testAccountId, setTestAccountId] = useState('');
  const [testSending, setTestSending]   = useState(false);
  const [testResult, setTestResult]     = useState(null);
  const [signature, setSignature]       = useState('');
  const [sigSaving, setSigSaving]       = useState(false);
  const [tagPreview, setTagPreview]     = useState(null);
  const [tagPreviewSel, setTagPreviewSel] = useState({});
  const [bounceThreshold, setBounceThreshold] = useState('10');

  // Keep the name field in sync with the real campaign. Seeding it once from a
  // placeholder meant saving settings could silently rename the campaign.
  useEffect(() => { setName(campaign?.name || ''); }, [campaign?.id, campaign?.name]);

  useEffect(() => {
    // Load all available accounts
    api.get('/accounts').then(res => {
      if (res && !res.error) {
        setEmailAccounts(res);
        if (res.length > 0 && !testAccountId) setTestAccountId(String(res[0].id));
      }
    });
    // Load this campaign's assigned accounts
    if (campaign?.id) {
      api.get(`/campaigns/${campaign.id}/accounts`).then(res => {
        if (Array.isArray(res)) setSelectedAccounts(res);
      });
    }
    // Load all tags
    api.get('/accounts/tags/all').then(res => {
      if (Array.isArray(res)) setAllTags(res);
    });
    api.get('/campaigns/signature/me').then(res => {
      if (res?.signature !== undefined) setSignature(res.signature);
    });
    // Pre-fill the test email with the campaign's real Step 1 content, so
    // "Send Test Email" previews the actual sequence instead of generic text.
    if (campaign?.id) {
      api.get(`/campaigns/${campaign.id}/sequences`).then(res => {
        const firstVariation = Array.isArray(res) && res[0]?.variations?.[0];
        if (firstVariation) {
          setTestSubject(firstVariation.subject || '');
          setTestBody(firstVariation.body || '');
        }
      });
    }
    // Load saved settings
    if (campaign?.id) {
      api.get(`/campaigns/${campaign.id}`).then(res => {
        // Sync the name unconditionally — a campaign that never had settings
        // saved still has a name, and it must not be overwritten on save.
        if (res?.name) setName(res.name);
        if (res?.settings_json) {
          try {
            const s = JSON.parse(res.settings_json);
            if (s.preference)     setPreference(s.preference);
            if (s.variationMode)  setVariationMode(s.variationMode);
            if (s.espMatching !== undefined) setEspMatching(s.espMatching);
            if (s.opportunityValue !== undefined) setOpportunityValue(String(s.opportunityValue));
            if (s.safety)         setSafety(prev => ({ ...prev, ...s.safety }));
            if (s.bounceThreshold !== undefined) setBounceThreshold(String(s.bounceThreshold));
          } catch (_) {}
        }
      });
    }
  }, [campaign?.id]);

  // Show accounts for a tag in preview panel
  async function previewTag(tag) {
    if (tagPreview?.tag === tag) { setTagPreview(null); return; }
    const res = await api.get(`/accounts/by-tag/${encodeURIComponent(tag)}`);
    if (!Array.isArray(res)) return;
    const existing = new Set(selectedAccounts.map(a => a.id));
    const sel = {};
    res.forEach(a => { sel[a.id] = !existing.has(a.id); });
    setTagPreviewSel(sel);
    setTagPreview({ tag, accounts: res });
  }

  // Add selected previewed accounts
  async function addTagPreviewSelected() {
    const toAdd = (tagPreview?.accounts || []).filter(a => tagPreviewSel[a.id] && !selectedAccounts.find(x => x.id === a.id));
    if (!toAdd.length) { showToast('No new accounts selected'); return; }
    const updated = [...selectedAccounts, ...toAdd];
    setSelectedAccounts(updated);
    await saveAccounts(updated);
    showToast(`✅ Added ${toAdd.length} account(s) from "${tagPreview.tag}"`);
    setTagPreview(null);
  }

  // Save assigned accounts to backend
  async function saveAccounts(accounts) {
    if (!campaign?.id) return;
    await api.post(`/campaigns/${campaign.id}/accounts`, {
      accountIds: accounts.map(a => a.id),
    });
  }

  function addAccount(account) {
    if (selectedAccounts.find(a => a.id === account.id)) return; // already added
    const updated = [...selectedAccounts, account];
    setSelectedAccounts(updated);
    saveAccounts(updated);
    setAddAccountModal(false);
  }

  function removeAccount(accountId) {
    const updated = selectedAccounts.filter(a => a.id !== accountId);
    setSelectedAccounts(updated);
    saveAccounts(updated);
  }

  async function saveSignature() {
    setSigSaving(true);
    await api.post('/campaigns/signature/me', { signature });
    setSigSaving(false);
    showToast('Signature saved');
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2200); }

  async function saveSettings() {
    if (!campaign?.id) { showToast('Settings saved locally'); return; }
    const settings = { preference, variationMode, espMatching, opportunityValue, safety, bounceThreshold: parseFloat(bounceThreshold) || 10 };
    // Never PATCH an empty name over the real one.
    const payload = { settings_json: JSON.stringify(settings) };
    if (name.trim()) payload.name = name.trim();
    await api.patch(`/campaigns/${campaign.id}`, payload);
    showToast('✅ Settings saved');
  }

  async function sendTestEmail() {
    if (!testToEmail.includes('@')) { setTestResult({ error: 'Enter a valid recipient email address' }); return; }
    if (!testSubject.trim())        { setTestResult({ error: 'Subject is required' }); return; }
    if (isHtmlEmpty(testBody))      { setTestResult({ error: 'Email body is required' }); return; }
    setTestSending(true);
    setTestResult(null);
    const res = await api.post('/campaigns/send-test', {
      toEmail: testToEmail,
      subject: testSubject,
      body: testBody,
      accountId: testAccountId ? parseInt(testAccountId) : undefined,
    });
    setTestSending(false);
    if (res && res.success) {
      setTestResult({ success: true, message: res.message });
    } else {
      setTestResult({ error: res?.error || 'Failed to send test email' });
    }
  }

  const selectedPref = PREFERENCE_OPTIONS.find(p => p.label === preference);
  const newPct = parseInt(selectedPref?.ratio.split('/')[0] || 50);
  const followPct = 100 - newPct;

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: '1.75rem' }}>
      <div style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '1rem' }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ maxWidth: 760, padding: '1.5rem 0 3rem 0' }}>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#10b981', color: '#fff', padding: '0.75rem 1.25rem', borderRadius: 10, fontWeight: 500, zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', fontSize: '0.875rem' }}>
          ✅ {toast}
        </div>
      )}

      {/* Campaign Name */}
      <Section title="Campaign Name">
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input className="form-input" style={{ flex: 1, maxWidth: 400 }} value={name} onChange={e => setName(e.target.value)} />
          <button className="btn btn-primary" onClick={saveSettings}>Save Settings</button>
        </div>
      </Section>

      {/* Sending Email Accounts */}
      <Section title="Sending Email Accounts">
        <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Add by Tag — dropdown */}
          <div>
            <div style={{ fontSize:'0.8rem', fontWeight:700, marginBottom:'0.5rem', color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em' }}>Add Accounts by Tag</div>
            {allTags.length === 0 ? (
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>No tags yet — go to <strong>Email Accounts</strong> and assign tags.</div>
            ) : (
              <div>
                {/* Dropdown */}
                <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                  <select
                    className="form-input"
                    style={{ maxWidth:260 }}
                    value={tagPreview?.tag || ''}
                    onChange={e => e.target.value ? previewTag(e.target.value) : setTagPreview(null)}
                  >
                    <option value="">— Select a tag —</option>
                    {allTags.map(t => (
                      <option key={t.tag} value={t.tag}>🏷 {t.tag} ({t.count} accounts)</option>
                    ))}
                  </select>
                  {tagPreview && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setTagPreview(null)}>✕ Clear</button>
                  )}
                </div>

                {/* Preview panel — shown when a tag is selected */}
                {tagPreview && (
                  <div style={{ background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:10, padding:'0.75rem', marginTop:'0.65rem' }}>
                    <div style={{ fontSize:'0.78rem', fontWeight:700, marginBottom:'0.5rem', color:'var(--accent-primary)' }}>
                      🏷 {tagPreview.accounts.length} account{tagPreview.accounts.length!==1?'s':''} tagged "{tagPreview.tag}" — check to add
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem', maxHeight:220, overflowY:'auto', marginBottom:'0.65rem' }}>
                      {tagPreview.accounts.map(a => {
                        const alreadyIn = !!selectedAccounts.find(x => x.id === a.id);
                        return (
                          <label key={a.id} style={{ display:'flex', alignItems:'center', gap:'0.6rem', padding:'6px 8px',
                            background: alreadyIn ? 'rgba(16,185,129,0.07)' : tagPreviewSel[a.id] ? 'rgba(99,102,241,0.08)' : 'none',
                            borderRadius:7, cursor: alreadyIn ? 'default' : 'pointer', opacity: alreadyIn ? 0.55 : 1,
                            border:`1px solid ${alreadyIn?'rgba(16,185,129,0.2)':tagPreviewSel[a.id]?'rgba(99,102,241,0.3)':'transparent'}`,
                            transition:'all 0.12s' }}>
                            <input type="checkbox" disabled={alreadyIn}
                              checked={alreadyIn || !!tagPreviewSel[a.id]}
                              onChange={() => setTagPreviewSel(p => ({ ...p, [a.id]: !p[a.id] }))}
                              style={{ accentColor:'var(--accent-primary)', width:15, height:15, flexShrink:0 }} />
                            <div style={{ fontSize:'0.82rem', flex:1 }}>
                              <span style={{ fontWeight:500 }}>📧 {a.email}</span>
                              {a.name && <span style={{ color:'var(--text-muted)', marginLeft:6, fontSize:'0.72rem' }}>{a.name}</span>}
                              {alreadyIn && <span style={{ marginLeft:8, fontSize:'0.68rem', color:'var(--success)', fontWeight:600 }}>✔ already in campaign</span>}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                      <button className="btn btn-primary btn-sm" onClick={addTagPreviewSelected}>
                        ➕ Add Selected
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setTagPreview(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize:'0.8rem', fontWeight:600, marginBottom:'0.5rem', color:'var(--text-secondary)' }}>Selected Accounts ({selectedAccounts.length})</div>
            {selectedAccounts.length === 0 ? (
              <div style={{ color:'var(--text-muted)', fontSize:'0.82rem', padding:'0.5rem 0' }}>No accounts selected yet. Click "+ Select Email Account" below.</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                {selectedAccounts.map((a) => (
                  <div key={a.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.5rem 0.75rem', background:'var(--bg-tertiary)', borderRadius:8, fontSize:'0.875rem' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                      <span style={{ fontSize:'1rem' }}>📧</span>
                      <div>
                        <div style={{ fontWeight:500 }}>{a.email}</div>
                        {a.name && <div style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{a.name}</div>}
                      </div>
                    </div>
                    <button onClick={() => removeAccount(a.id)} style={{ background:'none', border:'none', color:'var(--danger)', cursor:'pointer', fontSize:'1rem' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="btn btn-secondary btn-sm" style={{ width:'fit-content' }} onClick={() => setAddAccountModal(true)}>
            + Select Email Account
          </button>
        </div>
      </Section>

      {/* Sending Preference */}
      <Section title="Sending Preference">
        <div className="card card-p">
          <p className="fs-sm text-secondary" style={{ marginBottom: '1rem' }}>Choose to prioritize emailing new leads or following up with existing ones</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            {PREFERENCE_OPTIONS.map(p => (
              <button
                key={p.label}
                onClick={() => setPreference(p.label)}
                style={{
                  padding: '6px 14px', borderRadius: 99, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500, border: '1px solid var(--border-color)',
                  background: preference === p.label ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: preference === p.label ? '#fff' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}
              >
                {p.label} ({p.ratio})
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>👥</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>New Leads</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Growth focused</div>
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.4rem' }}>{newPct}% of daily volume</div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${newPct}%`, background: 'var(--accent-primary)' }} /></div>
            </div>
            <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>📬</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Follow-ups</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Retention focused</div>
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.4rem' }}>{followPct}% of daily volume</div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${followPct}%`, background: 'var(--info)' }} /></div>
            </div>
          </div>
        </div>
      </Section>

      {/* Follow-up Variation Selection Mode */}
      <Section title="Follow-up Variation Selection Mode">
        <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p className="fs-sm text-secondary">Choose how MailSender assigns variation paths for steps after Step 1.</p>
          {[
            { val: 'roundrobin', label: 'Round Robin', desc: 'Each step independently rotates through variations for even distribution across all leads. This introduces more randomness and has less risk of getting flagged by email providers.' },
            { val: 'match', label: 'Match Initial Variation', desc: 'Lead stays on the same variation path. Example: 1A → 2A → 3A' },
          ].map(opt => (
            <label key={opt.val} style={{ display: 'flex', gap: '0.75rem', cursor: 'pointer', alignItems: 'flex-start' }}>
              <input type="radio" name="varmode" value={opt.val} checked={variationMode === opt.val} onChange={() => setVariationMode(opt.val)} style={{ marginTop: 3, accentColor: 'var(--accent-primary)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{opt.label}</div>
                <div className="fs-sm text-secondary">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </Section>

      {/* ESP Matching */}
      <div className="card card-p flex-between" style={{ marginBottom: '1.75rem' }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>ESP matching</div>
          <div className="fs-sm text-secondary">Email Service Provider (ESP) Matching allows you to match your sender account's provider with the recipient's ESP provider</div>
        </div>
        <Toggle value={espMatching} onChange={setEspMatching} />
      </div>

      {/* Opportunity Value */}
      <Section title="Opportunity Value">
        <p className="fs-sm text-secondary" style={{ marginBottom: '0.75rem' }}>You can assign an opportunity dollar value for each positive reply you receive for the campaign.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', maxWidth: 200 }}>
          <span style={{ fontWeight: 600 }}>$</span>
          <input className="form-input" type="number" min="0" value={opportunityValue} onChange={e => setOpportunityValue(e.target.value)} />
        </div>
      </Section>

      {/* Safety Settings */}
      <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem' }}>Safety Settings</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
        {SAFETY_SETTINGS.map(s => (
          <div key={s.key} className="card card-p flex-between" style={{ padding: '0.875rem 1rem' }}>
            <div style={{ flex: 1, paddingRight: '1.5rem' }}>
              <div style={{ fontWeight: 500, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{s.label}</div>
              <div className="fs-xs text-secondary">{s.desc}</div>
            </div>
            <Toggle value={safety[s.key]} onChange={v => setSafety(prev => ({ ...prev, [s.key]: v }))} />
          </div>
        ))}
      </div>

      <button className="btn btn-primary" onClick={saveSettings}>Save Settings</button>

      {/* ── Sender Signature ─────────────────────────────── */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border-color)', paddingTop: '2rem' }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem' }}>✍ Sender Signature</div>
        <p className="fs-sm text-secondary" style={{ marginBottom: '1.25rem' }}>
          This is your <code style={{ background:'rgba(99,102,241,0.12)', color:'#818cf8', padding:'1px 6px', borderRadius:4 }}>{'{{sender_signature}}'}</code> variable.
          Insert it in any email step and it will be replaced with what you set here.
        </p>
        <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <RichEditor
            value={signature}
            onChange={setSignature}
            placeholder="Best regards, John Doe — CEO, Acme Corp — john@acme.com"
            minHeight={110}
          />
          {signature && !/^(<br\s*\/?>|\s|&nbsp;)*$/i.test(signature) && (
            <div style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:8, padding:'0.75rem 1rem', fontSize:'0.85rem', color:'var(--text-secondary)' }}>
              <div style={{ fontSize:'0.72rem', fontWeight:600, color:'var(--text-muted)', marginBottom:'0.5rem', textTransform:'uppercase', letterSpacing:'0.05em' }}>Preview</div>
              <div dangerouslySetInnerHTML={{ __html: signature }} />
            </div>
          )}
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <button className="btn btn-primary" onClick={saveSignature} disabled={sigSaving}>
              {sigSaving ? 'Saving…' : 'Save Signature'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Send Test Email ─────────────────────────────── */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border-color)', paddingTop: '2rem' }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem' }}>Send Test Email</div>
        <p className="fs-sm text-secondary" style={{ marginBottom: '1.25rem' }}>
          Send a real test email using one of your connected accounts to verify your setup before launching.
        </p>
        <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {emailAccounts.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              ⚠️ No email accounts connected. <a href="#" style={{ color: 'var(--accent-primary)' }}>Add one in Email Accounts</a> first.
            </div>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label">Send From</label>
                <select className="form-input" value={testAccountId} onChange={e => setTestAccountId(e.target.value)}>
                  {emailAccounts.map(a => (
                    <option key={a.id} value={String(a.id)}>{a.email} ({a.esp})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Send To (your email to verify)</label>
                <input className="form-input" type="email" placeholder="yourname@gmail.com" value={testToEmail} onChange={e => { setTestToEmail(e.target.value); setTestResult(null); }} />
              </div>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className="form-input" value={testSubject} onChange={e => setTestSubject(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Email Body <span className="fs-xs text-muted">(pre-filled from Step 1 of your sequence)</span></label>
                <RichEditor value={testBody} onChange={setTestBody} minHeight={140} />
              </div>
              {testResult && (
                <div style={{
                  padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.875rem',
                  background: testResult.success ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${testResult.success ? 'var(--success)' : 'var(--danger)'}`,
                  color: testResult.success ? 'var(--success)' : 'var(--danger)',
                }}>
                  {testResult.success ? `✅ ${testResult.message}` : `❌ ${testResult.error}`}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: 'fit-content' }} onClick={sendTestEmail} disabled={testSending}>
                {testSending ? '⏳ Sending…' : '📧 Send Test Email'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Add Account Modal */}
      {addAccountModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}
          onClick={() => setAddAccountModal(false)}>
          <div className="card card-p" style={{ width:440, maxHeight:'80vh', display:'flex', flexDirection:'column' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom:'0.25rem' }}>Select Sending Accounts</h3>
            <p className="fs-sm text-muted" style={{ marginBottom:'1rem' }}>Check the accounts you want to assign to this campaign.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem', overflowY:'auto', flex:1 }}>
              {emailAccounts.length === 0 ? (
                <div style={{ color:'var(--text-muted)', fontSize:'0.875rem', padding:'0.5rem' }}>No accounts found. Add one in Email Accounts first.</div>
              ) : emailAccounts.map(a => {
                const isChecked = !!selectedAccounts.find(x => x.id === a.id);
                return (
                  <label key={a.id}
                    style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.65rem 0.75rem',
                      background: isChecked ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)',
                      border: `1px solid ${isChecked ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      borderRadius:8, cursor:'pointer', transition:'all 0.15s' }}>
                    <input type="checkbox" checked={isChecked}
                      onChange={() => {
                        const next = isChecked
                          ? selectedAccounts.filter(x => x.id !== a.id)
                          : [...selectedAccounts, a];
                        setSelectedAccounts(next);
                      }}
                      style={{ accentColor:'var(--accent-primary)', width:16, height:16 }} />
                    <div>
                      <div style={{ fontSize:'0.875rem', fontWeight:500 }}>📧 {a.email}</div>
                      {a.name && <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{a.name} · {a.esp}</div>}
                    </div>
                  </label>
                );
              })}
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.75rem', marginTop:'1rem', paddingTop:'1rem', borderTop:'1px solid var(--border-color)' }}>
              <span className="fs-sm text-muted">{selectedAccounts.length} account{selectedAccounts.length!==1?'s':''} selected</span>
              <div style={{ display:'flex', gap:'0.75rem' }}>
                <button className="btn btn-ghost" onClick={() => setAddAccountModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => { saveAccounts(selectedAccounts); setAddAccountModal(false); showToast(`${selectedAccounts.length} account(s) saved`); }}>
                  Save Selection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
