import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

export default function Settings() {
  const { user, login, token } = useAuth();
  const [profileForm, setProfileForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    company: user?.company || 'MailSender Inc.',
    timezone: user?.timezone || 'Asia/Karachi',
  });
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [savedMsg, setSavedMsg] = useState('');
  const [tab, setTab] = useState('profile');
  const [integrations, setIntegrations] = useState({ hubspot: false, salesforce: false, slack: true, zapier: false, webhook: false });
  const [apiRevealed, setApiRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [twofa, setTwofa] = useState(false);
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [team, setTeam] = useState([
    { name: user?.name || 'Owner', email: user?.email || '', role: 'Owner', status: 'active' },
  ]);
  const [selectedPlan, setSelectedPlan] = useState('Growth');
  const [toast, setToast] = useState('');

  // Placeholder only — this screen has no real API-key backend yet. Kept
  // obviously fake so it can't be mistaken for a live credential (and so
  // secret scanners don't flag the repo).
  const API_KEY = 'pvk_demo_EXAMPLE_KEY_NOT_A_REAL_CREDENTIAL';

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  async function saveProfile() {
    const res = await api.patch('/auth/profile', { 
      name: profileForm.name,
      email: profileForm.email 
    });
    if (res && !res.error) {
      login({ ...user, name: res.user.name, email: res.user.email }, token);
      setSavedMsg('✅ Saved!');
      showToast('Profile saved successfully');
      setTimeout(() => setSavedMsg(''), 2500);
    } else {
      showToast(res?.error || 'Failed to save');
    }
  }

  async function updatePassword() {
    if (!passwords.current) { showToast('Enter current password'); return; }
    if (passwords.next !== passwords.confirm) { showToast('New passwords do not match'); return; }
    if (passwords.next.length < 6) { showToast('Password must be at least 6 characters'); return; }
    const res = await api.patch('/auth/password', { current: passwords.current, next: passwords.next });
    if (res && !res.error) {
      setPasswords({ current: '', next: '', confirm: '' });
      showToast('Password updated successfully');
    } else {
      showToast(res?.error || 'Incorrect current password');
    }
  }

  function copyApiKey() {
    navigator.clipboard.writeText(API_KEY).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast('API key copied to clipboard');
  }

  function saveWebhook() {
    if (!webhookUrl.startsWith('http')) { showToast('Enter a valid URL starting with http'); return; }
    setWebhookSaved(true);
    showToast('Webhook URL saved');
  }

  function inviteMember() {
    if (!inviteEmail.includes('@')) { showToast('Enter a valid email address'); return; }
    setTeam((prev) => [...prev, { name: inviteEmail.split('@')[0], email: inviteEmail, role: 'Member', status: 'invited' }]);
    setInviteEmail('');
    setInviteModal(false);
    showToast(`Invite sent to ${inviteEmail}`);
  }

  function removeMember(email) {
    setTeam((prev) => prev.filter((m) => m.email !== email));
    showToast('Member removed');
  }

  const plans = [
    { name: 'Free Warmup', price: '$0', features: ['3 email accounts', '30 warmup emails/day', 'Basic analytics'] },
    { name: 'Starter', price: '$49/mo', features: ['10 email accounts', '150 warmup emails/day', 'Unlimited campaigns', 'CSV import'] },
    { name: 'Growth', price: '$99/mo', features: ['25 accounts', '500 warmup/day', 'AI content engine', 'Unified inbox', 'Zapier integration'] },
    { name: 'Agency', price: '$249/mo', features: ['Unlimited accounts', 'White-label', 'Client workspaces', 'Priority support', 'API access'] },
  ];

  return (
    <div className="page-block fade-up" style={{ position: 'relative' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#10b981', color: '#fff', padding: '0.75rem 1.25rem', borderRadius: 10, fontWeight: 500, zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', fontSize: '0.875rem' }}>
          {toast}
        </div>
      )}

      <div>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Settings</h2>
        <p className="text-secondary fs-sm" style={{ marginTop: '0.25rem' }}>Manage your account, billing and integrations</p>
      </div>

      <div className="tab-bar">
        {['profile', 'billing', 'integrations', 'team', 'api'].map((t) => (
          <button key={t} className={`tab-item ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── PROFILE ── */}
      {tab === 'profile' && (
        <div className="grid-2">
          <div className="card card-p">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>Profile Information</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[['name', 'Full Name'], ['email', 'Email Address'], ['company', 'Company Name'], ['timezone', 'Timezone']].map(([k, label]) => (
                <div key={k} className="form-group">
                  <label className="form-label">{label}</label>
                  <input className="form-input" value={profileForm[k]} onChange={(e) => setProfileForm((p) => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
              <button className="btn btn-primary" onClick={saveProfile} style={{ marginTop: '0.5rem' }}>
                {savedMsg || 'Save Changes'}
              </button>
            </div>
          </div>
          <div className="card card-p">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>Security</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Current Password</label>
                <input className="form-input" type="password" placeholder="••••••••" value={passwords.current} onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input className="form-input" type="password" placeholder="••••••••" value={passwords.next} onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm New Password</label>
                <input className="form-input" type="password" placeholder="••••••••" value={passwords.confirm} onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))} />
              </div>
              <div className="divider"></div>
              <div className="flex-between">
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Two-Factor Authentication</div>
                  <div className="fs-xs text-muted">{twofa ? 'Enabled — your account is protected' : 'Add extra security to your account'}</div>
                </div>
                <button className={`btn btn-sm ${twofa ? 'btn-danger' : 'btn-secondary'}`} onClick={() => { setTwofa((v) => !v); showToast(twofa ? '2FA disabled' : '2FA enabled'); }}>
                  {twofa ? 'Disable 2FA' : 'Enable 2FA'}
                </button>
              </div>
              <button className="btn btn-primary" onClick={updatePassword}>Update Password</button>
            </div>
          </div>
        </div>
      )}

      {/* ── BILLING ── */}
      {tab === 'billing' && (
        <div className="page-block">
          <div className="card card-p" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}>
            <div className="flex-between">
              <div>
                <div className="fs-sm text-secondary">Current Plan</div>
                <div style={{ fontFamily: 'Outfit', fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {selectedPlan} <span className="badge badge-success">Active</span>
                </div>
                <div className="fs-sm text-secondary" style={{ marginTop: '0.25rem' }}>
                  {plans.find((p) => p.name === selectedPlan)?.price}/month · Renews Jun 3, 2026
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            {plans.map((p) => (
              <div key={p.name} className="card card-p" style={{ border: selectedPlan === p.name ? '1px solid var(--accent-primary)' : undefined, position: 'relative' }}>
                {selectedPlan === p.name && <div style={{ position: 'absolute', top: 12, right: 12 }}><span className="badge badge-purple">Current</span></div>}
                <div style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.25rem' }}>{p.name}</div>
                <div style={{ fontFamily: 'Outfit', fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '1rem' }}>{p.price}</div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  {p.features.map((f, j) => <li key={j} className="fs-sm text-secondary">✓ {f}</li>)}
                </ul>
                <button
                  className={`btn btn-sm ${selectedPlan === p.name ? 'btn-secondary' : 'btn-primary'}`}
                  style={{ width: '100%' }}
                  onClick={() => { if (selectedPlan !== p.name) { setSelectedPlan(p.name); showToast(`Switched to ${p.name} plan`); } }}
                >
                  {selectedPlan === p.name ? 'Current Plan' : 'Select Plan'}
                </button>
              </div>
            ))}
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', fontWeight: 600 }}>Billing History</div>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
              <tbody>
                {[
                  { date: 'May 3, 2026', desc: `${selectedPlan} Plan - Monthly`, amount: plans.find((p) => p.name === selectedPlan)?.price, status: 'Paid' },
                  { date: 'Apr 3, 2026', desc: 'Growth Plan - Monthly', amount: '$99.00', status: 'Paid' },
                  { date: 'Mar 3, 2026', desc: 'Starter Plan - Monthly', amount: '$49.00', status: 'Paid' },
                ].map((r, i) => (
                  <tr key={i}>
                    <td className="text-secondary">{r.date}</td>
                    <td>{r.desc}</td>
                    <td className="col-num">{r.amount}</td>
                    <td><span className="badge badge-success">{r.status}</span></td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => showToast('Invoice downloaded')}>⬇ PDF</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── INTEGRATIONS ── */}
      {tab === 'integrations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {[
            { key: 'hubspot', name: 'HubSpot', desc: 'Sync replies and contacts to your HubSpot CRM', icon: '🟠' },
            { key: 'salesforce', name: 'Salesforce', desc: 'Push hot leads directly to Salesforce', icon: '☁️' },
            { key: 'slack', name: 'Slack', desc: 'Get notified when a prospect replies', icon: '💬' },
            { key: 'zapier', name: 'Zapier', desc: 'Connect to 5000+ apps via Zapier webhooks', icon: '⚡' },
            { key: 'webhook', name: 'Custom Webhook', desc: 'Send events to your own endpoint', icon: '🔗' },
          ].map(({ key, name, desc, icon }) => (
            <div key={key} className="card card-p flex-between">
              <div className="flex-row">
                <div style={{ width: 46, height: 46, borderRadius: 10, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>{icon}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{name}</div>
                  <div className="fs-sm text-secondary">{desc}</div>
                </div>
              </div>
              <div className="flex-row">
                <span className={`badge ${integrations[key] ? 'badge-success' : 'badge-default'}`}>
                  {integrations[key] ? 'Connected' : 'Disconnected'}
                </span>
                <label className="form-toggle">
                  <div
                    className={`toggle-track ${integrations[key] ? 'on' : ''}`}
                    onClick={() => {
                      setIntegrations((p) => ({ ...p, [key]: !p[key] }));
                      showToast(`${name} ${integrations[key] ? 'disconnected' : 'connected'}`);
                    }}
                  >
                    <div className="toggle-thumb"></div>
                  </div>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TEAM ── */}
      {tab === 'team' && (
        <div className="page-block">
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>Team Members ({team.length})</span>
              <button className="btn btn-primary btn-sm" onClick={() => setInviteModal(true)}>+ Invite Member</button>
            </div>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {team.map((m, i) => (
                  <tr key={i}>
                    <td className="fw-600">{m.name}</td>
                    <td className="text-secondary">{m.email}</td>
                    <td><span className="badge badge-purple">{m.role}</span></td>
                    <td><span className={`badge ${m.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{m.status}</span></td>
                    <td>
                      {m.role !== 'Owner' && (
                        <button className="btn btn-ghost btn-sm text-danger" onClick={() => removeMember(m.email)}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {inviteModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
              <div className="card card-p" style={{ width: 400 }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Invite Team Member</h3>
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Email Address</label>
                  <input className="form-input" type="email" placeholder="colleague@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && inviteMember()} autoFocus />
                </div>
                <div className="flex-row" style={{ justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button className="btn btn-ghost" onClick={() => setInviteModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={inviteMember}>Send Invite</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── API ── */}
      {tab === 'api' && (
        <div className="grid-2">
          <div className="card card-p">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>API Keys</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <code style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {apiRevealed ? API_KEY : 'pvk_demo_••••••••••••••••••••••••••••'}
                </code>
                <button className="btn btn-secondary btn-sm" onClick={() => setApiRevealed((v) => !v)}>
                  {apiRevealed ? '🙈 Hide' : '👁 Reveal'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={copyApiKey}>
                  {copied ? '✅' : '📋 Copy'}
                </button>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => { showToast('API key regenerated'); setApiRevealed(false); }}>
                🔄 Regenerate Key
              </button>
            </div>
            <div className="divider"></div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Webhook URL</h3>
            <div className="form-group">
              <input className="form-input" placeholder="https://your-server.com/webhook" value={webhookUrl} onChange={(e) => { setWebhookUrl(e.target.value); setWebhookSaved(false); }} />
            </div>
            <button className="btn btn-primary btn-sm" style={{ marginTop: '0.75rem' }} onClick={saveWebhook}>
              {webhookSaved ? '✅ Saved' : 'Save Webhook'}
            </button>
          </div>
          <div className="card card-p">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>API Documentation</h3>
            <p className="text-secondary fs-sm" style={{ marginBottom: '1rem' }}>Use the REST API to programmatically manage campaigns, prospects, and warmup accounts.</p>
            <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '1rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#a78bfa' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{'//'} Get all campaigns</div>
              <div><span style={{ color: '#06b6d4' }}>GET</span> /api/v1/campaigns</div>
              <div style={{ color: 'var(--text-muted)', margin: '0.75rem 0 0.5rem' }}>{'//'} Create campaign</div>
              <div><span style={{ color: '#10b981' }}>POST</span> /api/v1/campaigns</div>
              <div style={{ color: 'var(--text-muted)', margin: '0.75rem 0 0.5rem' }}>{'//'} List prospects</div>
              <div><span style={{ color: '#06b6d4' }}>GET</span> /api/v1/prospects</div>
              <div style={{ color: 'var(--text-muted)', margin: '0.75rem 0 0.5rem' }}>{'//'} Send warmup</div>
              <div><span style={{ color: '#10b981' }}>POST</span> /api/v1/warmup/send</div>
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: '1rem' }} onClick={() => showToast('Opening API docs...')}>
              View Full Docs ↗
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
