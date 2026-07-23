import React, { useState, useEffect } from 'react';
import CampaignDetail from './CampaignDetail';
import { api } from '../../lib/api';

const statusMap = {
  active:    { label: 'Active',    cls: 'badge-success' },
  paused:    { label: 'Paused',    cls: 'badge-warning' },
  draft:     { label: 'Draft',     cls: 'badge-default' },
  completed: { label: 'Completed', cls: 'badge-info' },
};

function pct(a, b) { return b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—'; }

export default function Campaigns({ userId }) {
  const [list, setList]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName]   = useState('');
  const [selected, setSelected] = useState(null);
  const [toast, setToast]       = useState('');
  const [creating, setCreating] = useState(false);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2200); }

  useEffect(() => {
    setList([]);
    setLoading(true);
    api.get('/campaigns').then(res => {
      if (res && !res.error) setList(res);
      setLoading(false);
    });
  }, [userId]);

  const filtered = list.filter(c => {
    const matchFilter = filter === 'all' || c.status === filter;
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  async function toggleStatus(id) {
    const c = list.find(x => x.id === id);
    if (!c) return;
    const newStatus = c.status === 'active' ? 'paused' : c.status === 'paused' ? 'active' : c.status;
    const res = await api.patch(`/campaigns/${id}`, { status: newStatus });
    if (res && !res.error) setList(prev => prev.map(x => x.id === id ? res : x));
  }

  async function addCampaign() {
    if (!newName.trim() || creating) return;   // guard against double-submit
    setCreating(true);
    try {
      const res = await api.post('/campaigns', { name: newName.trim() });
      if (res && !res.error) { setList(prev => [res, ...prev]); setNewName(''); setShowModal(false); showToast('Campaign created'); }
      else showToast(res?.error || 'Failed to create');
    } finally { setCreating(false); }
  }

  async function deleteCampaign(id) {
    const c = list.find(x => x.id === id);
    if (!window.confirm(`Delete "${c?.name || 'this campaign'}" and its sequences permanently? This cannot be undone.`)) return;
    await api.delete(`/campaigns/${id}`);
    setList(prev => prev.filter(c => c.id !== id));
    if (selected?.id === id) setSelected(null);
    showToast('Campaign deleted');
  }

  if (selected) {
    const live = list.find(c => c.id === selected.id) || selected;
    return (
      <div className="fade-up" style={{ height:'100%' }}>
        <CampaignDetail campaign={live} onBack={() => setSelected(null)} onToggleStatus={toggleStatus} />
      </div>
    );
  }

  return (
    <div className="page-block fade-up">
      {toast && <div style={{ position:'fixed', bottom:24, right:24, background:'#10b981', color:'#fff', padding:'0.75rem 1.25rem', borderRadius:10, fontWeight:500, zIndex:999, boxShadow:'0 4px 16px rgba(0,0,0,0.3)', fontSize:'0.875rem' }}>✅ {toast}</div>}

      <div className="flex-between">
        <div>
          <h2 style={{ fontSize:'1.3rem', fontWeight:700 }}>Campaigns</h2>
          <p className="text-secondary fs-sm" style={{ marginTop:'0.25rem' }}>{list.length} campaigns total</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Campaign</button>
      </div>

      <div className="flex-row" style={{ gap:'0.75rem', flexWrap:'wrap' }}>
        <div className="search-box" style={{ flex:1, minWidth:220 }}>
          <span className="text-muted">🔍</span>
          <input placeholder="Search campaigns..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['all','active','paused','draft','completed'].map(f => (
          <button key={f} className={`btn btn-sm ${filter===f?'btn-primary':'btn-secondary'}`} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>

      <div className="card" style={{ overflow:'hidden' }}>
        {loading ? <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)' }}>Loading…</div> : (
          <div className="table-scroll-x">
            <table className="data-table">
              <thead>
                <tr><th>Campaign</th><th>Status</th><th>Prospects</th><th>Sent</th><th>Open %</th><th>Reply %</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} style={{ cursor:'pointer' }} onClick={() => setSelected(c)}>
                    <td><div style={{ fontWeight:500 }}>{c.name}</div><div className="fs-xs text-muted">Created {c.created_at?.slice(0,10)}</div></td>
                    <td><span className={`badge ${statusMap[c.status]?.cls || 'badge-default'}`}>{statusMap[c.status]?.label || c.status}</span></td>
                    <td className="col-num">{(c.prospects||0).toLocaleString()}</td>
                    <td className="col-num">{(c.sent||0).toLocaleString()}</td>
                    <td><span className={pct(c.opens,c.sent)!=='—'?'text-info':'text-muted'}>{pct(c.opens,c.sent)}</span></td>
                    <td><span className={pct(c.replies,c.sent)!=='—'?'text-success':'text-muted'}>{pct(c.replies,c.sent)}</span></td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex-row" style={{ gap:'0.5rem' }}>
                        {(c.status==='active'||c.status==='paused') && (
                          <button className={`btn btn-sm ${c.status==='active'?'btn-secondary':'btn-success'}`} onClick={() => { toggleStatus(c.id); showToast(c.status==='active'?'Campaign paused':'Campaign resumed'); }}>
                            {c.status==='active'?'⏸':'▶'}
                          </button>
                        )}
                        <button className="btn btn-sm btn-danger" onClick={() => deleteCampaign(c.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign:'center', padding:'2.5rem', color:'var(--text-muted)' }}>{loading ? 'Loading…' : 'No campaigns found.'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile FAB — visible only on mobile (header button is hidden there) */}
      <button className="fab" onClick={() => setShowModal(true)} aria-label="New Campaign">
        +
      </button>

      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div className="card card-p" style={{ width:420 }}>
            <h3 style={{ marginBottom:'1.25rem', fontSize:'1.1rem' }}>New Campaign</h3>
            <div className="form-group" style={{ marginBottom:'1rem' }}>
              <label className="form-label">Campaign Name</label>
              <input className="form-input" placeholder="e.g. Q3 SaaS Outreach" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key==='Enter' && addCampaign()} autoFocus />
            </div>
            <div className="flex-row" style={{ justifyContent:'flex-end', gap:'0.75rem' }}>
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addCampaign} disabled={creating}>{creating ? 'Creating…' : 'Create Campaign'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
