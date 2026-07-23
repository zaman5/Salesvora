import React, { useState } from 'react';

const ANALYTICS_STATS = [
  { label: 'Total Email Sent', icon: '📤', value: '1,240', sub: null },
  { label: 'Total Contacted Leads', icon: '👥', value: '842', sub: null },
  { label: 'New Leads Contacted', icon: '✨', value: '612', sub: null },
  { label: 'Total Completed Leads', icon: '✅', value: '528', sub: null },
  { label: 'Reply Rate (with OOO)', icon: '↩', value: '14.2%', sub: '119' },
  { label: 'Reply Rate', icon: '↩', value: '12.4%', sub: '104' },
  { label: 'Positive Reply', icon: '⭐', value: '5.1%', sub: '$0k', subColor: 'var(--success)' },
  { label: 'Bounce Rate', icon: '⚡', value: '1.1%', sub: '14' },
  { label: 'Open rate', icon: '👁', value: '42.6%', sub: null, wide: true },
  { label: 'Unsubscribe rate', icon: '🚫', value: '0.0%', sub: null, wide: true },
];

export default function CampaignSubsequences() {
  const [modal, setModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [subsequences, setSubsequences] = useState([]);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsTab, setAnalyticsTab] = useState('analytics');
  const [dateRange, setDateRange] = useState('Custom');
  const [toast, setToast] = useState('');

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2200); }

  function addSubsequence() {
    if (!newName.trim()) return;
    setSubsequences(prev => [...prev, { id: Date.now(), name: newName.trim(), leads: 0, status: 'active' }]);
    setNewName('');
    setModal(false);
    showToast(`Subsequence "${newName.trim()}" created`);
  }

  return (
    <div style={{ maxWidth: 800, padding: '1.5rem 0', position: 'relative' }}>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#10b981', color: '#fff', padding: '0.75rem 1.25rem', borderRadius: 10, fontWeight: 500, zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', fontSize: '0.875rem' }}>
          ✅ {toast}
        </div>
      )}

      {subsequences.length === 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.75rem' }}>Add subsequence</h3>
            <p className="text-secondary fs-sm" style={{ marginBottom: '1.5rem' }}>
              Sub-sequences automatically move leads to a new campaign based on actions like label updates or specific reply text, making follow-ups easy and efficient.
            </p>
            <div className="card card-p" style={{ marginBottom: '1.5rem', background: 'rgba(99,102,241,0.04)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>Maximize Your Campaign Efficiency</div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {[
                  'Automate Follow-ups: move leads based on their actions',
                  'Increase Engagement: tailored responses keep leads interested and improve conversion rates',
                  'Save Time: let automation handle the routine tasks so you can focus on strategy',
                ].map((item, i) => (
                  <li key={i} className="fs-sm text-secondary" style={{ paddingLeft: '0.75rem', borderLeft: '2px solid var(--accent-primary)' }}>
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
            <button className="btn btn-primary" onClick={() => setModal(true)}>+ Add Subsequence</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 220, height: 220, background: 'rgba(99,102,241,0.06)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <div style={{ fontSize: '4rem' }}>📋</div>
              <div style={{ position: 'absolute', top: 30, right: 20, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-primary)' }}>INTERESTED</div>
              <div style={{ position: 'absolute', bottom: 30, right: 10, fontSize: '2rem' }}>📢</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {subsequences.map(s => (
            <div key={s.id} className="card card-p flex-between">
              <div>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div className="fs-sm text-secondary">{s.leads} leads</div>
              </div>
              <div className="flex-row">
                <span className="badge badge-success">Active</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setAnalyticsOpen(true)}>Analytics</button>
                <button className="btn btn-ghost btn-sm text-danger" onClick={() => { setSubsequences(prev => prev.filter(x => x.id !== s.id)); showToast('Subsequence removed'); }}>Remove</button>
              </div>
            </div>
          ))}
          <button className="btn btn-primary btn-sm" style={{ width: 'fit-content' }} onClick={() => setModal(true)}>+ Add Subsequence</button>
        </div>
      )}

      {/* Add Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 14, padding: '2rem', width: 420, boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ marginBottom: '1.25rem', fontSize: '1.1rem', fontWeight: 700 }}>Add Subsequence</h3>
            <input
              className="form-input"
              placeholder="Subsequence name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSubsequence()}
              autoFocus
              style={{ marginBottom: '1.25rem' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addSubsequence}>Next →</button>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Modal */}
      {analyticsOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '8vh', zIndex: 100 }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, width: '90%', maxWidth: 800, maxHeight: '80vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontWeight: 700 }}>Campaign Analytics</h3>
              </div>
              <button onClick={() => setAnalyticsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1.5rem' }}>
              {['analytics', 'steps & variations'].map(t => (
                <button key={t} onClick={() => setAnalyticsTab(t)}
                  style={{ background: 'none', border: 'none', borderBottom: analyticsTab === t ? '2px solid var(--accent-primary)' : '2px solid transparent', color: analyticsTab === t ? 'var(--accent-primary)' : 'var(--text-secondary)', padding: '6px 2px', cursor: 'pointer', fontWeight: analyticsTab === t ? 600 : 400, fontSize: '0.875rem', textTransform: 'capitalize' }}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
              <div style={{ marginLeft: 'auto' }}>
                <select className="form-input" style={{ fontSize: '0.8rem', padding: '5px 10px', width: 'auto' }} value={dateRange} onChange={e => setDateRange(e.target.value)}>
                  {['Today', 'Last 7 days', 'Last 30 days', 'Custom'].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            </div>

            <div style={{ padding: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                {ANALYTICS_STATS.map((s, i) => (
                  <div key={i} className="card card-p" style={{ gridColumn: s.wide ? 'span 2' : 'span 1', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      <span>{s.icon}</span><span>{s.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontFamily: 'Outfit', fontSize: '1.5rem', fontWeight: 700 }}>{s.value}</span>
                      {s.sub && <span style={{ fontSize: '0.8rem', color: s.subColor || 'var(--text-muted)' }}>{s.sub}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
