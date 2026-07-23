import React, { useState, useEffect } from 'react';
import ImportLeads from '../../components/ImportLeads';
import { api } from '../../lib/api';

const STATUSES = [
  { label: 'Replied',     cls: 'badge-success' },
  { label: 'Completed',   cls: 'badge-info' },
  { label: 'In Progress', cls: 'badge-warning' },
  { label: 'Bounced',     cls: 'badge-danger' },
];

// Each campaign starts with its own empty leads list.
// campaign.id is passed as key from CampaignDetail, ensuring complete isolation.

const ESP_ICON = {
  Google: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  ),
  Microsoft: (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M11.5 11.5H2v-9h9.5v9z" fill="#F25022"/>
      <path d="M22 11.5h-9.5v-9H22v9z" fill="#7FBA00"/>
      <path d="M11.5 22H2v-9h9.5v9z" fill="#00A4EF"/>
      <path d="M22 22h-9.5v-9H22v9z" fill="#FFB900"/>
    </svg>
  ),
};

const COLORS = ['#6366f1','#10b981','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#ef4444','#f97316'];
const EMPTY_FORM = { firstName: '', lastName: '', email: '', company: '', jobTitle: '', phone: '', city: '' };

function makeLead(form, idx) {
  const name = [form.firstName, form.lastName].filter(Boolean).join(' ') || form.email.split('@')[0];
  const esp = form.email.toLowerCase().includes('gmail') ? 'Google'
    : form.email.toLowerCase().includes('outlook') || form.email.toLowerCase().includes('hotmail') ? 'Microsoft'
    : 'SMTP';
  return {
    initials: name.slice(0, 2).toUpperCase(),
    color: COLORS[idx % COLORS.length],
    name, email: form.email,
    company: form.company, title: form.jobTitle, phone: form.phone, city: form.city,
    esp, sent: 0, opened: 0, clicked: 0, replied: 0,
    status: 'In Progress', step: '0/1', label: null,
  };
}

// ── Standalone field — defined OUTSIDE modal to prevent focus loss on re-render ─
function LeadField({ label, fieldKey, placeholder, required, form, errors, set }) {
  return (
    <div className="form-group">
      <label className="form-label" style={{ fontSize: '0.8rem' }}>
        {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      <input
        className="form-input"
        placeholder={placeholder}
        value={form[fieldKey]}
        onChange={e => set(fieldKey, e.target.value)}
        onKeyDown={e => e.key === 'Enter' && e.currentTarget.form?.requestSubmit?.()}
        style={errors[fieldKey] ? { borderColor: 'var(--danger)' } : {}}
      />
      {errors[fieldKey] && <div style={{ color: 'var(--danger)', fontSize: '0.72rem', marginTop: '0.25rem' }}>⚠ {errors[fieldKey]}</div>}
    </div>
  );
}

// ── Single Lead Add / Edit Modal ───────────────────────────────────────────────
function AddSingleLeadModal({ totalLeads, onAdd, onClose, initialValues, isEdit = false }) {
  const [form, setForm]           = useState(initialValues || EMPTY_FORM);
  const [errors, setErrors]       = useState({});
  const [customFields, setCustomFields] = useState([]); // [{key:'', value:''}]
  const [addingKey, setAddingKey] = useState(false);
  const [newKey, setNewKey]       = useState('');

  function set(k, v) {
    setForm(p => ({ ...p, [k]: v }));
    if (errors[k]) setErrors(p => { const n = { ...p }; delete n[k]; return n; });
  }

  function addCustomField() {
    if (!newKey.trim()) return;
    setCustomFields(p => [...p, { key: newKey.trim(), value: '' }]);
    setNewKey('');
    setAddingKey(false);
  }

  function setCustomVal(idx, v) {
    setCustomFields(p => p.map((f, i) => i === idx ? { ...f, value: v } : f));
  }

  function removeCustomField(idx) {
    setCustomFields(p => p.filter((_, i) => i !== idx));
  }

  function validate() {
    const e = {};
    if (!form.email.trim() || !form.email.includes('@')) e.email = 'Valid email required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    if (!validate()) return;
    const lead = makeLead(form, totalLeads);
    // Attach custom fields as a map
    const cf = {};
    customFields.forEach(f => { if (f.key) cf[f.key] = f.value; });
    onAdd({ ...lead, customFields: cf });
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.2rem' }}>{isEdit ? '✏ Edit Lead' : '👤 Add Single Lead'}</h3>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{isEdit ? 'Update this lead\'s details' : 'Manually add one lead to this campaign'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>

        {/* Form */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <LeadField label="First Name" fieldKey="firstName" placeholder="John" form={form} errors={errors} set={set} />
            <LeadField label="Last Name"  fieldKey="lastName"  placeholder="Doe" form={form} errors={errors} set={set} />
          </div>
          <LeadField label="Email Address" fieldKey="email" placeholder="john@company.com" required form={form} errors={errors} set={set} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <LeadField label="Company"   fieldKey="company"  placeholder="Acme Corp" form={form} errors={errors} set={set} />
            <LeadField label="Job Title" fieldKey="jobTitle" placeholder="CEO" form={form} errors={errors} set={set} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <LeadField label="Phone" fieldKey="phone" placeholder="+1 555 0100" form={form} errors={errors} set={set} />
            <LeadField label="City"  fieldKey="city"  placeholder="New York" form={form} errors={errors} set={set} />
          </div>

          {/* ── Custom Fields Section ── */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.9rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>⚙ Custom Fields</div>
              {!addingKey && (
                <button
                  onClick={() => setAddingKey(true)}
                  style={{ background: 'none', border: '1px dashed rgba(99,102,241,0.4)', borderRadius: 6, color: 'var(--accent-primary)', fontSize: '0.75rem', padding: '3px 10px', cursor: 'pointer', fontWeight: 600 }}
                >+ Add Custom Field</button>
              )}
            </div>

            {/* Existing custom fields */}
            {customFields.map((cf, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 3fr auto', gap: '0.4rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 6, padding: '5px 9px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
                  {cf.key}
                </div>
                <input
                  className="form-input"
                  placeholder={`Value for ${cf.key}`}
                  value={cf.value}
                  onChange={e => setCustomVal(idx, e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '5px 9px' }}
                />
                <button onClick={() => removeCustomField(idx)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1rem', padding: '4px 6px' }}>🗑</button>
              </div>
            ))}

            {/* Add new field name input */}
            {addingKey && (
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input
                  autoFocus
                  className="form-input"
                  placeholder="Field name (e.g. Timezone, Revenue…)"
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCustomField(); if (e.key === 'Escape') { setAddingKey(false); setNewKey(''); } }}
                  style={{ flex: 1, fontSize: '0.8rem' }}
                />
                <button onClick={addCustomField}
                  style={{ background: 'var(--accent-primary)', border: 'none', borderRadius: 6, color: '#fff', padding: '6px 10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>✓</button>
                <button onClick={() => { setAddingKey(false); setNewKey(''); }}
                  style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-muted)', padding: '6px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
              </div>
            )}

            {customFields.length === 0 && !addingKey && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No custom fields yet — click "+ Add Custom Field" to create one
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.25rem' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={submit}>{isEdit ? 'Save Changes →' : 'Add Lead →'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Import Choice Modal ────────────────────────────────────────────────────────
function ImportChoiceModal({ onSingle, onBulk, onFromProspects, onClose }) {
  const cardBase = {
    borderRadius: 14, padding: '1.4rem 1rem', cursor: 'pointer', textAlign: 'center',
    transition: 'all 0.18s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem', border: '2px solid',
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, width: 560, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.15rem' }}>Add Leads to Campaign</h3>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Choose how you'd like to add leads</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>
        <div style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.9rem' }}>
          <button onClick={onSingle} style={{ ...cardBase, background: 'rgba(99,102,241,0.06)', borderColor: 'rgba(99,102,241,0.25)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.14)'; e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.06)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)'; }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>👤</div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>Add Single Lead</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>Manually enter one lead's details</div>
          </button>

          <button onClick={onBulk} style={{ ...cardBase, background: 'rgba(16,185,129,0.06)', borderColor: 'rgba(16,185,129,0.25)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.14)'; e.currentTarget.style.borderColor = '#10b981'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.06)'; e.currentTarget.style.borderColor = 'rgba(16,185,129,0.25)'; }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>📄</div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>Bulk Import CSV</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>Upload CSV/Excel with column mapping</div>
          </button>

          <button onClick={onFromProspects} style={{ ...cardBase, background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.25)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.14)'; e.currentTarget.style.borderColor = '#f59e0b'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.06)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.25)'; }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>📋</div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>From Prospects</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>Import an existing Prospects list</div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Prospects Picker Modal ─────────────────────────────────────────────────────
function ProspectsPickerModal({ onImport, onClose }) {
  const [lists, setLists]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [picked, setPicked]     = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    api.get('/leads').then(data => { setLists(Array.isArray(data) ? data : []); setLoading(false); });
  }, []);

  async function doImport() {
    if (!picked || importing) return;
    const newLeads = (picked.leads || []).map((l, i) => ({
      ...l,
      initials: (l.name || l.email || '?').slice(0,2).toUpperCase(),
      color: COLORS[i % COLORS.length],
      esp: (l.email||'').includes('gmail') ? 'Google'
         : (l.email||'').includes('outlook') || (l.email||'').includes('hotmail') ? 'Microsoft' : 'SMTP',
      sent:0, opened:0, clicked:0, replied:0, status:'In Progress', step:'0/1', label:null,
    }));
    // onImport throws when every lead is a duplicate — surface that instead of
    // closing the modal as though the import had succeeded.
    setImporting(true);
    setError('');
    try {
      await onImport(newLeads);
      onClose();
    } catch (e) {
      setError(e?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.78)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }} onClick={onClose}>
      <div style={{ background:'var(--bg-secondary)', borderRadius:16, width:460, maxHeight:'75vh', display:'flex', flexDirection:'column', boxShadow:'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding:'1.25rem 1.5rem', borderBottom:'1px solid var(--border-color)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div>
            <h3 style={{ fontWeight:700, fontSize:'1.05rem', marginBottom:'0.15rem' }}>📋 Import from Prospects</h3>
            <div style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>Select a list to add all its leads to this campaign</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.2rem' }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'1rem 1.5rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
          {loading ? (
            <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'2rem' }}>Loading…</div>
          ) : lists.length === 0 ? (
            <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'2rem' }}>No Prospect lists found. Create one in the Prospects section first.</div>
          ) : lists.map(list => (
            <div key={list.id} onClick={() => setPicked(list)} style={{
              padding:'0.9rem 1rem', borderRadius:10, cursor:'pointer', border:'2px solid',
              borderColor: picked?.id === list.id ? 'var(--accent-primary)' : 'var(--border-color)',
              background: picked?.id === list.id ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)',
              transition:'all 0.15s',
            }}>
              <div style={{ fontWeight:600, fontSize:'0.88rem' }}>{list.name}</div>
              <div style={{ fontSize:'0.73rem', color:'var(--text-muted)', marginTop:'0.2rem' }}>{(list.count||0).toLocaleString()} leads · {list.created_at?.slice(0,10)}</div>
            </div>
          ))}
        </div>
        <div style={{ padding:'1rem 1.5rem', borderTop:'1px solid var(--border-color)', flexShrink:0 }}>
          {error && (
            <div style={{ marginBottom:'0.75rem', padding:'0.5rem 0.75rem', borderRadius:8, background:'var(--danger-light)', color:'var(--danger)', fontSize:'0.78rem' }}>
              {error}
            </div>
          )}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:'0.75rem' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={doImport} disabled={!picked || importing}>
              {importing ? 'Importing…' : picked ? `Import ${(picked.count||0)} Leads →` : 'Select a list'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function CampaignLeads({ campaign, active }) {
  const [leads, setLeads]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [selected, setSelected]         = useState([]);
  const [modal, setModal]               = useState(null); // null|'choice'|'single'|'bulk'|'prospects'
  const [editLead, setEditLead]         = useState(null);
  const [actionsOpen, setActionsOpen]   = useState(null);
  const [toast, setToast]               = useState('');

  // ── Load leads from backend ─────────────────────────────────────────────
  async function fetchLeads() {
    if (!campaign?.id) return;
    const data = await api.get(`/campaigns/${campaign.id}/leads`);
    if (Array.isArray(data)) {
      setLeads(data.map((l, i) => ({
        ...l,
        initials: (l.name || l.email || '?').slice(0, 2).toUpperCase(),
        color: COLORS[i % COLORS.length],
        esp: (l.email||'').includes('gmail') ? 'Google'
           : (l.email||'').includes('outlook') || (l.email||'').includes('hotmail') ? 'Microsoft' : 'SMTP',
        sent:    l.sent    ?? 0,
        opened:  l.opened  ?? 0,
        clicked: l.clicked ?? 0,
        replied: l.replied ?? 0,
        status:  l.status  || 'In Progress',
        step_index: l.step_index ?? 0,
        label: l.label ?? null,
      })));
    }
    setLoading(false);
  }

  useEffect(() => { fetchLeads(); }, [campaign?.id]);

  // ── Live polling when campaign is active ───────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(fetchLeads, 8000); // refresh every 8s
    return () => clearInterval(interval);
  }, [active, campaign?.id]);

  // ── CSV download ───────────────────────────────────────────────────────────
  function downloadLeadsCSV() {
    const cols    = ['name','first_name','last_name','email','company','title','phone','city','state','country','linkedin_url','status'];
    const headers = ['Full Name','First Name','Last Name','Email','Company','Job Title','Phone','City','State','Country','LinkedIn URL','Status'];
    const escape  = v => `"${String(v||'').replace(/"/g,'""')}"`;
    const rows = [headers.join(','), ...leads.map(l => cols.map(c => escape(l[c])).join(','))];
    const blob = new Blob([rows.join('\n')], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${campaign?.name||'campaign'}_leads.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2200); }

  async function handleBulkImport(newLeads) {
    const existing = new Set(leads.map(l => (l.email || '').toLowerCase()));
    const fresh = newLeads
      .filter(l => l.email && !existing.has(l.email.toLowerCase()))
      .map((l, i) => ({ ...l, color: COLORS[(leads.length + i) % COLORS.length] }));
    if (fresh.length === 0) throw new Error('All leads already exist in this campaign');
    // Save to backend — throw on error so ImportLeads can display it
    if (campaign?.id) {
      const res = await api.post(`/campaigns/${campaign.id}/leads`, fresh);
      if (res?.error) throw new Error(res.error);
      // Adopt the server rows so each lead carries its real id (needed to edit
      // or remove it before the next refetch).
      if (Array.isArray(res?.leads)) {
        const byEmail = new Map(res.leads.map(r => [(r.email || '').toLowerCase(), r]));
        fresh.forEach(l => {
          const row = byEmail.get(l.email.toLowerCase());
          if (row) l.id = row.id;
        });
      }
    }
    setLeads(prev => [...prev, ...fresh]);
    const skipped = newLeads.length - fresh.length;
    showToast(`✅ ${fresh.length} lead(s) imported${skipped ? ` · ${skipped} duplicate(s) skipped` : ''}`);
  }


  async function handleSingleAdd(lead) {
    if (leads.some(l => (l.email || '').toLowerCase() === lead.email.toLowerCase())) {
      showToast('⚠ This email already exists in the campaign'); return;
    }
    const colored = { ...lead, color: COLORS[leads.length % COLORS.length] };
    // Save to backend, keeping the server-assigned id so the new row is
    // immediately editable/removable.
    if (campaign?.id) {
      const res = await api.post(`/campaigns/${campaign.id}/leads`, [colored]);
      const row = Array.isArray(res?.leads)
        ? res.leads.find(r => (r.email || '').toLowerCase() === colored.email.toLowerCase())
        : null;
      if (row) colored.id = row.id;
    }
    setLeads(prev => [...prev, colored]);
    showToast('✅ Lead added successfully');
  }

  async function handleSaveEdit(updated) {
    if (!campaign?.id || !editLead?.id) return;
    const name = [updated.firstName, updated.lastName].filter(Boolean).join(' ') || updated.email.split('@')[0];
    
    // Save to database
    await api.patch(`/campaigns/${campaign.id}/leads/${editLead.id}`, updated);
    
    setLeads(prev => prev.map(l => l.email === editLead.email
      ? { ...l, name, email: updated.email, company: updated.company, title: updated.jobTitle,
          phone: updated.phone, city: updated.city, initials: name.slice(0,2).toUpperCase() }
      : l
    ));
    setEditLead(null);
    showToast('✅ Lead updated in database');
  }

  // Persist a triage change (label / status) instead of only touching local
  // state — the 8s refresh poll would otherwise wipe it moments later.
  async function patchLead(lead, patch) {
    setLeads(prev => prev.map(x => x.email === lead.email ? { ...x, ...patch } : x));
    if (!campaign?.id || !lead.id) return;
    try {
      await api.patch(`/campaigns/${campaign.id}/leads/${lead.id}`, patch);
    } catch {
      showToast('⚠ Could not save — reverting');
      fetchLeads();
    }
  }

  async function removeLead(lead) {
    if (!window.confirm(`Remove ${lead.name || lead.email} from this campaign?`)) return;
    setLeads(prev => prev.filter(x => x.email !== lead.email));
    if (!campaign?.id || !lead.id) return;
    try {
      await api.delete(`/campaigns/${campaign.id}/leads/${lead.id}`);
      showToast('Lead removed');
    } catch {
      showToast('⚠ Could not remove — reverting');
      fetchLeads();
    }
  }

  const filtered = leads.filter(l => {
    const q  = search.toLowerCase();
    const ms = (l.name || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q);
    const mf = filterStatus === 'All' || l.status === filterStatus;
    return ms && mf;
  });

  const toggleSelect = email => setSelected(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]);
  const allSelected  = filtered.length > 0 && filtered.every(l => selected.includes(l.email));
  const toggleAll    = () => setSelected(allSelected ? [] : filtered.map(l => l.email));

  const StatIcon = ({ icon, count, color }) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '0.75rem', color: count > 0 ? color : 'var(--text-muted)' }}>
      <span>{icon}</span><span style={{ fontWeight: count > 0 ? 600 : 400 }}>{count}</span>
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative' }}>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#10b981', color: '#fff', padding: '0.75rem 1.25rem', borderRadius: 10, fontWeight: 500, zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', fontSize: '0.875rem' }}>
          {toast}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>🔍</span>
          <input placeholder="Search by Email or Name..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-secondary btn-sm" style={{ borderColor: '#10b981', color: '#10b981' }} onClick={() => showToast('Enriching leads with Apollo.io data...')}>✨ Enrich</button>
        <button className="btn btn-secondary btn-sm" onClick={() => showToast('Verifying email addresses...')}>✅ Verify Leads</button>

        {/* Single + Bulk buttons */}
        <button
          className="btn btn-secondary btn-sm"
          style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)', fontWeight: 600 }}
          onClick={() => setModal('single')}
        >
          👤 Add Lead
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => setModal('choice')}>
          ⬇ Import Leads
        </button>
        <button className="btn btn-secondary btn-sm" onClick={downloadLeadsCSV}
          style={{ borderColor:'#10b981', color:'#10b981' }} disabled={leads.length === 0}>
          ⬇ Download CSV
        </button>

        <select className="form-input" style={{ width: 'auto', fontSize: '0.8rem', padding: '6px 12px' }}
          value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option>All</option>
          {STATUSES.map(s => <option key={s.label}>{s.label}</option>)}
        </select>
      </div>

      {/* ── Bulk action bar ── */}
      {selected.length > 0 && (
        <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.875rem' }}>
          <span>{selected.length} lead(s) selected</span>
          <button className="btn btn-danger btn-sm" onClick={async () => {
            // Delete from backend
            if (campaign?.id) {
              for (const email of selected) {
                const lead = leads.find(l => l.email === email);
                if (lead?.id) await api.delete(`/campaigns/${campaign.id}/leads/${lead.id}`);
              }
            }
            setLeads(prev => prev.filter(l => !selected.includes(l.email)));
            setSelected([]);
            showToast('Leads removed');
          }}>🗑 Remove Selected</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="card" style={{ overflow: 'hidden', overflowX: 'auto' }}>
        <table className="data-table" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }} />
              </th>
              <th style={{ minWidth: 200 }}>Leads <span style={{ background: 'var(--accent-primary)', color: '#fff', borderRadius: 99, padding: '1px 8px', fontSize: '0.7rem', marginLeft: 4 }}>{leads.length}</span></th>
              <th style={{ minWidth: 70 }}>Lead ESP</th>
              <th style={{ minWidth: 160 }}>Performance</th>
              <th style={{ minWidth: 160 }}>Status</th>
              <th style={{ minWidth: 130 }}>Label</th>
              <th style={{ minWidth: 60 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id ?? l.email} style={{ background: selected.includes(l.email) ? 'rgba(99,102,241,0.05)' : 'transparent' }}>
                <td><input type="checkbox" checked={selected.includes(l.email)} onChange={() => toggleSelect(l.email)} style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }} /></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: l.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', color: '#fff', flexShrink: 0 }}>{l.initials}</div>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{l.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{l.email}</div>
                      {l.company && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l.company}{l.title ? ` · ${l.title}` : ''}</div>}
                    </div>
                  </div>
                </td>
                <td><div style={{ display: 'flex', alignItems: 'center' }}>{ESP_ICON[l.esp] || <span style={{ fontSize: '0.75rem' }}>{l.esp}</span>}</div></td>
                <td>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <StatIcon icon="✉️" count={l.sent}    color="var(--text-secondary)" />
                    <StatIcon icon="👁️"  count={l.opened}  color="var(--info)" />
                    <StatIcon icon="👆"  count={l.clicked} color="var(--accent-secondary)" />
                    <StatIcon icon="↩️"  count={l.replied}  color="var(--success)" />
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className={`badge ${STATUSES.find(s => s.label === l.status)?.cls || 'badge-default'}`} style={{ fontSize: '0.72rem' }}>
                      {l.status === 'Replied' ? '↩ ' : l.status === 'Completed' ? '✅ ' : ''}{l.status}
                    </span>
                    <div style={{ flex: 1, minWidth: 60, height: 4, background: 'var(--overlay-8)', borderRadius: 99 }}>
                      <div style={{ height: '100%', borderRadius: 99, background: 'var(--accent-primary)',
                        width: `${Math.min(100, Math.round(((l.step_index||0) / Math.max(l.total_steps||1,1)) * 100))}%` }} />
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Step {l.step_index||0}/{l.total_steps||1}</span>
                  </div>
                </td>
                <td>
                  <select className="form-input" style={{ fontSize: '0.75rem', padding: '4px 8px', width: 'auto' }}
                    value={l.label || ''}
                    onChange={e => patchLead(l, { label: e.target.value || null })}>
                    <option value="">Not assigned</option>
                    <option value="Interested">Interested</option>
                    <option value="Not Interested">Not Interested</option>
                    <option value="Meeting Booked">Meeting Booked</option>
                    <option value="Follow Up">Follow Up</option>
                  </select>
                </td>
                <td style={{ position: 'relative' }}>
                  <button onClick={() => setActionsOpen(actionsOpen === l.email ? null : l.email)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: '4px 8px' }}>⋯</button>
                  {actionsOpen === l.email && (
                    <div style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, boxShadow: 'var(--shadow-md)', zIndex: 50, minWidth: 160, overflow: 'hidden' }}>
                      {[
                        ['✏ Edit Lead',    () => { setEditLead(l); setActionsOpen(null); }],
                        ['↩ Mark Replied',  () => { patchLead(l, { status:'Replied', replied:1 }); setActionsOpen(null); showToast('Marked as Replied'); }],
                        ['✅ Mark Complete', () => { patchLead(l, { status:'Completed' }); setActionsOpen(null); showToast('Marked as Completed'); }],
                        ['🗑 Remove',       () => { removeLead(l); setActionsOpen(null); }],
                      ].map(([label, fn]) => (
                        <button key={label} onClick={() => { fn(); setActionsOpen(null); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.6rem 1rem', color: label.includes('Remove') ? 'var(--danger)' : 'var(--text-primary)', cursor: 'pointer', fontSize: '0.8rem' }}
                          onMouseEnter={e => e.currentTarget.style.background='var(--overlay-5)'}
                          onMouseLeave={e => e.currentTarget.style.background='none'}>{label}</button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  {loading ? (
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>⏳ Loading leads…</div>
                  ) : leads.length === 0 ? (
                    <div>
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>👥</div>
                      <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.35rem' }}>No leads yet</div>
                      <div style={{ fontSize: '0.8rem', marginBottom: '1.25rem', color: 'var(--text-muted)' }}>
                        Add leads one by one or import a CSV file
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                        <button className="btn btn-secondary btn-sm"
                          style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }}
                          onClick={() => setModal('single')}>
                          👤 Add Single Lead
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => setModal('choice')}>
                          ⬇ Import Leads
                        </button>
                      </div>
                    </div>
                  ) : 'No leads match your filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Modals ── */}
      {modal === 'choice' && (
        <ImportChoiceModal
          onSingle={() => setModal('single')}
          onBulk={() => setModal('bulk')}
          onFromProspects={() => setModal('prospects')}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'single' && (
        <AddSingleLeadModal
          totalLeads={leads.length}
          onAdd={handleSingleAdd}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'bulk' && (
        <ImportLeads
          onImport={handleBulkImport}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'prospects' && (
        <ProspectsPickerModal
          onImport={handleBulkImport}
          onClose={() => setModal(null)}
        />
      )}
      {/* Edit Lead Modal */}
      {editLead && (
        <AddSingleLeadModal
          totalLeads={leads.length}
          initialValues={{
            firstName: editLead.name?.split(' ')[0] || '',
            lastName:  editLead.name?.split(' ').slice(1).join(' ') || '',
            email:     editLead.email   || '',
            company:   editLead.company || '',
            jobTitle:  editLead.title   || '',
            phone:     editLead.phone   || '',
            city:      editLead.city    || '',
          }}
          isEdit
          onAdd={handleSaveEdit}
          onClose={() => setEditLead(null)}
        />
      )}
    </div>
  );
}
