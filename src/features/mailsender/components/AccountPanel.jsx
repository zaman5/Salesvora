import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);
const MicrosoftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path d="M11.5 11.5H2v-9h9.5v9z" fill="#F25022"/>
    <path d="M22 11.5h-9.5v-9H22v9z" fill="#7FBA00"/>
    <path d="M11.5 22H2v-9h9.5v9z" fill="#00A4EF"/>
    <path d="M22 22h-9.5v-9H22v9z" fill="#FFB900"/>
  </svg>
);

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '1rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span>{label}</span><span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>ⓘ</span>
      </div>
      <div style={{ fontFamily: 'Outfit', fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
      {sub !== undefined && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{sub}</div>}
    </div>
  );
}

function CssBarChart({ data, labels, colors }) {
  const max = Math.max(...data.map(d => typeof d === 'number' ? d : Math.max(d.sent, d.inbox, d.spam)), 1);
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        {colors.map((c, i) => <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><span style={{ width: 12, height: 12, borderRadius: 2, background: c.color, display: 'inline-block' }} />{c.label}</span>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: 100, paddingBottom: 4, borderBottom: '1px solid var(--border-color)' }}>
        {data.map((d, i) => {
          const sentVal = typeof d === 'number' ? d : d.sent;
          const inboxVal = typeof d === 'number' ? 0 : d.inbox;
          const spamVal = typeof d === 'number' ? 0 : d.spam;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end', position: 'relative' }}>
              <div style={{ width: '100%', display: 'flex', gap: 2, height: '100%', alignItems: 'flex-end' }}>
                {sentVal > 0 && <div style={{ flex: 1, background: '#8b5cf6', borderRadius: '2px 2px 0 0', height: `${(sentVal / max) * 85}%`, minHeight: 3 }} title={`Sent: ${sentVal}`} />}
                {inboxVal > 0 && <div style={{ flex: 1, background: '#10b981', borderRadius: '2px 2px 0 0', height: `${(inboxVal / max) * 85}%`, minHeight: 3 }} title={`Inbox: ${inboxVal}`} />}
                {spamVal > 0 && <div style={{ flex: 1, background: '#ef4444', borderRadius: '2px 2px 0 0', height: `${(spamVal / max) * 85}%`, minHeight: 3 }} title={`Spam: ${spamVal}`} />}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '6px', marginTop: '0.4rem' }}>
        {(labels || []).map((l, i) => <div key={i} style={{ flex: 1, fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center' }}>{l}</div>)}
      </div>
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{ width: 42, height: 24, borderRadius: 99, cursor: 'pointer', background: value ? 'var(--accent-primary)' : 'var(--bg-tertiary)', border: `2px solid ${value ? 'var(--accent-primary)' : 'var(--border-color)'}`, position: 'relative', transition: 'all 0.2s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 1, left: value ? 18 : 1, width: 18, height: 18, borderRadius: '50%', background: value ? '#fff' : 'var(--text-muted)', transition: 'left 0.2s' }} />
    </div>
  );
}

export default function AccountPanel({ account, accounts, onClose, onNavigate, onUpdate, showToast }) {
  const [mainTab, setMainTab] = useState('Account');
  const [subTab, setSubTab] = useState('Analytics');
  const [dateRange, setDateRange] = useState('Custom');
  
  const [warmupSettings, setWarmupSettings] = useState({
    filterTag: 'helpful', includeFilterTag: false, dailyLimit: 20,
    emailReply: true, activeLimit: 1, dailyIncrement: 1,
    personalizedList: '', businessType: '', universe: '',
    customContent: '', signature: '', replyRate: 50, openaiKey: '',
    warmupMode: 'ai', customTemplates: []
  });

  const [newTemplate, setNewTemplate] = useState({ subject: '', body: '' });
  const [aiPreview, setAiPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  async function generateAiPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    setAiPreview(null);
    try {
      const res = await api.post('/warmup/ai-preview', {
        businessType: warmupSettings.businessType,
        customContent: warmupSettings.customContent,
        openaiKey: warmupSettings.openaiKey
      });
      if (res && !res.error) {
        setAiPreview(res);
      } else {
        setPreviewError(res?.error || 'Failed to generate preview');
      }
    } catch (err) {
      setPreviewError('Connection error generating preview');
    } finally {
      setPreviewLoading(false);
    }
  }

  function addCustomTemplate() {
    if (!newTemplate.subject.trim() || !newTemplate.body.trim()) return;
    const list = [...(warmupSettings.customTemplates || [])];
    list.push({ subject: newTemplate.subject.trim(), body: newTemplate.body.trim() });
    setWarmupSettings(p => ({ ...p, customTemplates: list }));
    setNewTemplate({ subject: '', body: '' });
  }

  function deleteCustomTemplate(index) {
    const list = (warmupSettings.customTemplates || []).filter((_, i) => i !== index);
    setWarmupSettings(p => ({ ...p, customTemplates: list }));
  }

  const [accountForm, setAccountForm] = useState({
    firstName: account.first_name || account.firstName || '',
    lastName: account.last_name || account.lastName || '',
    limitPerDay: account.limit_per_day || account.limit || 150,
  });
  const [savingAccount, setSavingAccount] = useState(false);

  useEffect(() => {
    setAccountForm({
      firstName: account.first_name || account.firstName || '',
      lastName: account.last_name || account.lastName || '',
      limitPerDay: account.limit_per_day || account.limit || 150,
    });
  }, [account.id]);

  async function saveAccountSettings() {
    setSavingAccount(true);
    try {
      const res = await api.patch(`/accounts/${account.id}`, accountForm);
      if (res && !res.error) {
        showToast('Account settings saved');
        if (onUpdate) onUpdate(res);
      } else {
        showToast(res?.error || 'Failed to save account settings');
      }
    } catch (_) {
      showToast('Error saving account settings');
    } finally {
      setSavingAccount(false);
    }
  }

  const [stats, setStats] = useState({
    totalSent: 0,
    totalReceived: 0,
    landedInbox: 0,
    savedFromSpam: 0,
    replied: 0,
    landedInboxPercent: 100,
    savedFromSpamPercent: 0,
    dailyStats: [],
    daysLabels: []
  });

  const idx = accounts.findIndex(a => a.email === account.email);

  useEffect(() => {
    if (account.id) {
      // 1. Fetch Warmup Settings
      api.get(`/warmup/settings/${account.id}`).then(res => {
        if (res && res.settings) {
          setWarmupSettings(prev => ({
            ...prev,
            ...res.settings,
            warmupMode: res.settings.warmupMode || 'ai',
            customTemplates: res.settings.customTemplates || []
          }));
        }
      });

      // 2. Fetch Warmup Stats
      api.get(`/warmup/stats/${account.id}`).then(res => {
        if (res && !res.error) {
          setStats(res);
        }
      });
    }
  }, [account.id]);

  async function saveWarmup() {
    try {
      const res = await api.post(`/warmup/settings/${account.id}`, { settings: warmupSettings });
      if (res && res.success) {
        showToast('Warmup settings saved successfully');
        if (onUpdate) onUpdate();
      } else {
        showToast('Failed to save settings: ' + (res.error || ''));
      }
    } catch (_) {
      showToast('Error saving settings to backend');
    }
  }

  const EspIcon = account.esp === 'Google' ? GoogleIcon : MicrosoftIcon;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div className="account-slideover" style={{ width: '68%', maxWidth: 720, height: '100%', background: 'var(--bg-secondary)', boxShadow: '-8px 0 40px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        
        {/* Panel Header */}
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button onClick={() => onNavigate(idx - 1)} disabled={idx === 0} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 6, width: 28, height: 28, cursor: idx === 0 ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', opacity: idx === 0 ? 0.4 : 1 }}>◀</button>
            <button onClick={() => onNavigate(idx + 1)} disabled={idx === accounts.length - 1} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 6, width: 28, height: 28, cursor: idx === accounts.length - 1 ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', opacity: idx === accounts.length - 1 ? 0.4 : 1 }}>▶</button>
          </div>
          <EspIcon />
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{account.email}</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>

        {/* Main Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          {['Account', 'Warmup'].map(t => (
            <button key={t} onClick={() => { setMainTab(t); setSubTab('Analytics'); }}
              style={{ padding: '0.75rem 1.5rem', background: 'none', border: 'none', borderBottom: mainTab === t ? '2px solid var(--accent-primary)' : '2px solid transparent', color: mainTab === t ? 'var(--accent-primary)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: mainTab === t ? 600 : 400, fontSize: '0.875rem' }}>{t}</button>
          ))}
        </div>

        {/* Sub Tabs + Date */}
        <div style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {['Analytics', 'Settings'].map(t => (
              <button key={t} onClick={() => setSubTab(t)}
                style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: subTab === t ? 'var(--accent-primary)' : 'transparent', color: subTab === t ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: subTab === t ? 600 : 400, fontSize: '0.825rem' }}>{t}</button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>

          {/* ACCOUNT > ANALYTICS */}
          {mainTab === 'Account' && subTab === 'Analytics' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <StatCard label="Account Status" value={account.status === 'active' ? 'Active' : 'Paused'} />
                <StatCard label="Daily Limit" value={`${account.limit} emails`} />
              </div>
            </div>
          )}

          {/* ACCOUNT > SETTINGS */}
          {mainTab === 'Account' && subTab === 'Settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input className="form-input" type="text" defaultValue={account.email} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="form-input" type="text" value={accountForm.firstName} onChange={e => setAccountForm(p => ({ ...p, firstName: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="form-input" type="text" value={accountForm.lastName} onChange={e => setAccountForm(p => ({ ...p, lastName: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Daily Sending Limit</label>
                <input className="form-input" type="number" min={1} value={accountForm.limitPerDay} onChange={e => setAccountForm(p => ({ ...p, limitPerDay: e.target.value }))} />
              </div>
              <button className="btn btn-primary" onClick={saveAccountSettings} disabled={savingAccount}>
                {savingAccount ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          )}

          {/* WARMUP > ANALYTICS */}
          {mainTab === 'Warmup' && subTab === 'Analytics' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <StatCard label="Warmup Email Sent" value={stats.totalSent || 0} />
                <StatCard label="Landed in Inbox" value={`${stats.landedInboxPercent}%`} sub={`${stats.landedInbox} emails`} />
                <StatCard label="Saved from Spam" value={`${stats.savedFromSpamPercent}%`} sub={`${stats.savedFromSpam} emails`} />
              </div>
              <div className="card card-p">
                <div style={{ fontWeight: 600, marginBottom: '1rem', fontSize: '0.9rem' }}>Daily Warmup Deliverability (Purple=Sent, Green=Inbox, Red=Spam)</div>
                {stats.dailyStats.length > 0 ? (
                  <CssBarChart 
                    data={stats.dailyStats} 
                    labels={stats.daysLabels} 
                    colors={[{ color: '#8b5cf6', label: 'Sent' }, { color: '#10b981', label: 'Inbox' }, { color: '#ef4444', label: 'Spam' }]} 
                  />
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>No deliverability statistics available yet. Run a diagnostic check to generate data.</div>
                )}
              </div>
            </div>
          )}

          {/* WARMUP > SETTINGS */}
          {mainTab === 'Warmup' && subTab === 'Settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Bootstrapping our Human-Email-Human (H2H) approach, the warmup engine is expertly adjusted to mirror natural human behavior and also key inbox tracking email patterns.
              </div>
              
              <div style={{ fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.04em' }}>Basic Warmup Settings</div>
              
              <div className="form-group">
                <label className="form-label">Warmup Filter Tag <span className="fs-xs text-muted">(Used to identify and group warmup emails)</span></label>
                <input className="form-input" value={warmupSettings.filterTag} onChange={e => setWarmupSettings(p => ({...p, filterTag: e.target.value}))} />
              </div>

              <div className="flex-between card card-p" style={{ padding: '0.875rem' }}>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Include Filter Tag in Body</div>
                  <div className="fs-xs text-secondary">Adding this tag in the email body helps avoid filters.</div>
                </div>
                <Toggle value={warmupSettings.includeFilterTag} onChange={v => setWarmupSettings(p => ({...p, includeFilterTag: v}))} />
              </div>

              <div className="form-group">
                <label className="form-label">Daily Warmup Limit <span className="fs-xs text-muted">(max: 50 limit)</span></label>
                <input className="form-input" type="number" min={1} max={50} value={warmupSettings.dailyLimit} onChange={e => setWarmupSettings(p => ({...p, dailyLimit: e.target.value}))} style={{ maxWidth: 100 }} />
              </div>

              <div className="flex-between card card-p" style={{ padding: '0.875rem' }}>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Warmup Email Reply</div>
                  <div className="fs-xs text-secondary">Automatically reply to incoming warmup emails to simulate engagement.</div>
                </div>
                <Toggle value={warmupSettings.emailReply} onChange={v => setWarmupSettings(p => ({...p, emailReply: v}))} />
              </div>

              <div className="form-group">
                <label className="form-label">Message Reply Rate: {warmupSettings.replyRate}%</label>
                <input type="range" min={0} max={100} value={warmupSettings.replyRate} onChange={e => setWarmupSettings(p => ({...p, replyRate: e.target.value}))} style={{ width: '100%', accentColor: 'var(--accent-primary)' }} />
              </div>

              <div className="form-group">
                <label className="form-label">Warmup Content Mode</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.25rem' }}>
                  {[['ai', '🤖 AI Base Warmup'], ['custom', '✍️ Manual Composing']].map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => setWarmupSettings(p => ({ ...p, warmupMode: mode }))}
                      type="button"
                      style={{
                        padding: '0.6rem',
                        borderRadius: 8,
                        border: `2px solid ${warmupSettings.warmupMode === mode ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                        background: warmupSettings.warmupMode === mode ? 'rgba(99,102,241,0.12)' : 'var(--bg-tertiary)',
                        color: warmupSettings.warmupMode === mode ? 'var(--accent-primary)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontWeight: warmupSettings.warmupMode === mode ? 700 : 400,
                        fontSize: '0.8rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {warmupSettings.warmupMode === 'ai' ? (
                <div style={{ background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Advanced AI Warmup Settings</div>
                  <p className="fs-xs text-secondary" style={{ marginBottom: '1rem' }}>These settings control OpenAI GPT email content generation to maximize domain reputation.</p>
                  
                  <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Custom OpenAI API Key <span className="fs-xs text-muted">(Optional - leaves default)</span></label>
                    <input className="form-input" type="password" style={{ fontSize: '0.8rem' }} placeholder="sk-..." value={warmupSettings.openaiKey || ''} onChange={e => setWarmupSettings(p => ({...p, openaiKey: e.target.value}))} />
                  </div>

                  <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Business Type / Service</label>
                    <input className="form-input" style={{ fontSize: '0.8rem' }} placeholder="e.g. outreach automation / web design" value={warmupSettings.businessType || ''} onChange={e => setWarmupSettings(p => ({...p, businessType: e.target.value}))} />
                  </div>

                  <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Custom AI Topic / Style Prompt</label>
                    <input className="form-input" style={{ fontSize: '0.8rem' }} placeholder="e.g. a friendly partnership connect, asking for feedback" value={warmupSettings.customContent || ''} onChange={e => setWarmupSettings(p => ({...p, customContent: e.target.value}))} />
                  </div>

                  <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Personalized Target Recipients <span className="fs-xs text-muted">(Optional - comma separated list, e.g. test@other.com)</span></label>
                    <input className="form-input" style={{ fontSize: '0.8rem' }} placeholder="e.g. test1@gmail.com, test2@outlook.com" value={warmupSettings.personalizedList || ''} onChange={e => setWarmupSettings(p => ({...p, personalizedList: e.target.value}))} />
                  </div>

                  <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Warmup Custom Email Signature</label>
                    <textarea className="form-input" style={{ fontSize: '0.8rem', minHeight: 60 }} placeholder="Your warmup email signature tag" value={warmupSettings.signature || ''} onChange={e => setWarmupSettings(p => ({...p, signature: e.target.value}))} />
                  </div>

                  <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={generateAiPreview}
                      disabled={previewLoading}
                      type="button"
                    >
                      {previewLoading ? 'Generating...' : '✨ Generate AI Sample Email'}
                    </button>
                    {aiPreview && (
                      <div style={{ marginTop: '0.75rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.75rem' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--accent-primary)', marginBottom: '0.25rem' }}>Subject:</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{aiPreview.subject}</div>
                        <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--accent-primary)', marginBottom: '0.25rem' }}>Body:</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{aiPreview.body}</div>
                      </div>
                    )}
                    {previewError && (
                      <div style={{ marginTop: '0.5rem', color: 'var(--danger)', fontSize: '0.75rem' }}>
                        ⚠ {previewError}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
                  <div style={{ background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: '1rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Manual Template Composing</div>
                    <p className="fs-xs text-secondary" style={{ marginBottom: '1rem' }}>Compose templates that the warmup engine will rotate through when sending emails and replies.</p>

                    <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                      <label className="form-label" style={{ fontSize: '0.8rem' }}>Template Subject</label>
                      <input className="form-input" style={{ fontSize: '0.8rem' }} placeholder="e.g. Quick feedback on your app" value={newTemplate.subject} onChange={e => setNewTemplate(p => ({ ...p, subject: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                      <label className="form-label" style={{ fontSize: '0.8rem' }}>Template Body</label>
                      <textarea className="form-input" style={{ fontSize: '0.8rem', minHeight: 80 }} placeholder="e.g. Hi,\n\nI was testing out your platform..." value={newTemplate.body} onChange={e => setNewTemplate(p => ({ ...p, body: e.target.value }))} />
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={addCustomTemplate} disabled={!newTemplate.subject.trim() || !newTemplate.body.trim()} type="button">
                      ➕ Add Template
                    </button>
                  </div>

                  <div className="card card-p">
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.75rem' }}>Your Custom Templates ({(warmupSettings.customTemplates || []).length})</div>
                    {(warmupSettings.customTemplates || []).length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.5rem 0' }}>No templates composed. Add one above.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {(warmupSettings.customTemplates || []).map((t, idx) => (
                          <div key={idx} style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.75rem', background: 'var(--bg-tertiary)', position: 'relative' }}>
                            <button
                              onClick={() => deleteCustomTemplate(idx)}
                              type="button"
                              style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                              🗑 Delete
                            </button>
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem', paddingRight: '3.5rem' }}>
                              Subject: {t.subject}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                              {t.body}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={saveWarmup}>Save Warmup Settings</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
