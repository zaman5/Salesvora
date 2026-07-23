import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../lib/api';
import ImportLeads from '../components/ImportLeads';

/** Proper RFC-4180 CSV parser — handles quoted fields with commas/newlines inside */
function parseCsv(text) {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!raw) return [];
  const records = [];
  let record = [], field = '', inQ = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i], next = raw[i + 1];
    if (inQ) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { record.push(field.trim()); field = ''; }
      else if (ch === '\n') {
        record.push(field.trim()); field = '';
        if (record.some(v => v !== '')) records.push(record);
        record = [];
      } else { field += ch; }
    }
  }
  record.push(field.trim());
  if (record.some(v => v !== '')) records.push(record);
  if (records.length < 2) return [];
  const headers = records[0].map(h => h.replace(/^"|"$/g, '').trim().toLowerCase().replace(/[\s]+/g, '_'));
  return records.slice(1)
    .filter(row => row.some(v => v))
    .map(vals => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').replace(/^"|"$/g, '').trim(); });
      return obj;
    })
    .filter(row => row.email || row.email_address);
}

/** Parse Excel ArrayBuffer via SheetJS CDN (window.XLSX loaded in index.html) */
function parseExcel(buffer) {
  if (!window.XLSX) throw new Error('SheetJS not loaded yet — please retry in a moment');
  const wb = window.XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const jsonRows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (jsonRows.length < 2) return [];
  const headers = jsonRows[0].map(h => String(h).trim().toLowerCase().replace(/[\s]+/g, '_'));
  return jsonRows.slice(1)
    .filter(row => row.some(c => String(c).trim()))
    .map(vals => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(vals[i] ?? '').trim(); });
      return obj;
    })
    .filter(row => row.email || row.email_address);
}

function getLeadName(lead) {
  const first = lead.first_name || lead.firstname || '';
  const last  = lead.last_name  || lead.lastname  || '';
  if (first || last) return `${first} ${last}`.trim();
  const emailLocal = (lead.email || '').split('@')[0];
  return emailLocal ? emailLocal.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—';
}

export default function Prospects() {
  const [lists, setLists]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selectedList, setSelectedList] = useState(null);
  const [searchList, setSearchList]     = useState('');
  const [searchLeads, setSearchLeads]   = useState('');
  const [listActionsOpen, setListActionsOpen] = useState(null);
  const [createModal, setCreateModal]   = useState(false);
  const [newListName, setNewListName]   = useState('');
  const [importModal, setImportModal]   = useState(false);
  const [pasteEmails, setPasteEmails]   = useState('');
  const [toast, setToast]               = useState('');
  const [importError, setImportError]   = useState('');
  const [saving, setSaving]             = useState(false);
  const fileInputRef = useRef(null);
  const [addLeadModal, setAddLeadModal] = useState(false);
  const EMPTY_LEAD = { firstName:'', lastName:'', email:'', company:'', jobTitle:'', phone:'', city:'' };
  const [addLeadForm, setAddLeadForm]   = useState(EMPTY_LEAD);
  const [addLeadErr, setAddLeadErr]     = useState('');
  const [addCustomFields, setAddCustomFields] = useState([]); // [{key:'',value:''}]
  const [addingKey, setAddingKey]       = useState(false);
  const [newKey, setNewKey]             = useState('');
  const [colPickerOpen, setColPickerOpen] = useState(false);
  // { id, list, top, right } — fixed-position list actions menu
  const [listMenu, setListMenu]         = useState(null);

  // All available columns
  const ALL_COLS = [
    { key: 'name',       label: 'Full Name',   always: true, w: 180 },
    { key: 'first_name', label: 'First Name',               w: 130 },
    { key: 'last_name',  label: 'Last Name',                w: 130 },
    { key: 'email',      label: 'Email',       always: true, w: 230 },
    { key: 'company',    label: 'Company',                  w: 160 },
    { key: 'title',      label: 'Job Title',                w: 160 },
    { key: 'phone',      label: 'Phone',                    w: 140 },
    { key: 'city',       label: 'City',                     w: 110 },
    { key: 'state',      label: 'State',                    w: 100 },
    { key: 'country',    label: 'Country',                  w: 110 },
    { key: 'linkedin',   label: 'LinkedIn',                 w: 180 },
    { key: 'created_at', label: 'Added',                    w: 110 },
    { key: '_actions',   label: '',            always: true, w: 72  }, // edit/delete
  ];
  const [visibleCols, setVisibleCols] = useState(
    ALL_COLS.map(c => c.key)
  );
  const toggleCol = (key) => setVisibleCols(prev =>
    prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
  );
  const activeCols = ALL_COLS.filter(c => visibleCols.includes(c.key));

  // Edit / delete single lead state
  const EMPTY_EDIT = { first_name:'', last_name:'', email:'', company:'', title:'', phone:'', city:'', state:'', country:'', linkedin_url:'' };
  const [editModal, setEditModal]   = useState(false);
  const [editLead, setEditLead]     = useState(null);   // the lead being edited
  const [editForm, setEditForm]     = useState(EMPTY_EDIT);
  const [editErr, setEditErr]       = useState('');
  const [editSaving, setEditSaving] = useState(false);

  function openEdit(lead) {
    setEditLead(lead);
    setEditForm({
      first_name:   lead.first_name   || '',
      last_name:    lead.last_name    || '',
      email:        lead.email        || '',
      company:      lead.company      || '',
      title:        lead.title        || '',
      phone:        lead.phone        || '',
      city:         lead.city         || '',
      state:        lead.state        || '',
      country:      lead.country      || '',
      linkedin_url: lead.linkedin_url || '',
    });
    setEditErr('');
    setEditModal(true);
  }

  async function saveEdit() {
    if (!editForm.email.includes('@')) { setEditErr('Valid email required'); return; }
    setEditSaving(true);
    const res = await api.patch(`/leads/${selectedList.id}/lead/${editLead.id}`, editForm);
    setEditSaving(false);
    if (res && !res.error) {
      setLists(prev => prev.map(l => l.id === selectedList.id ? res : l));
      setSelectedList(res);
      setEditModal(false);
      showToast('Lead updated');
    } else {
      setEditErr(res?.error || 'Failed to update lead');
    }
  }

  async function deleteLead(lead) {
    if (!window.confirm(`Delete ${lead.email}?`)) return;
    const res = await api.delete(`/leads/${selectedList.id}/lead/${lead.id}`);
    if (res && !res.error) {
      setLists(prev => prev.map(l => l.id === selectedList.id ? res : l));
      setSelectedList(res);
      showToast('Lead deleted');
    }
  }

  const COLORS = ['#6366f1','#10b981','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#ef4444','#f97316'];
  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  // ── Load all lists from API on mount ──────────────────────
  useEffect(() => {
    api.get('/leads').then(res => {
      if (res && !res.error) setLists(res);
      setLoading(false);
    });
  }, []);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2400); }

  // ── Create new list ───────────────────────────────────────
  async function createList() {
    if (!newListName.trim()) return;
    setSaving(true);
    const res = await api.post('/leads', { name: newListName.trim() });
    setSaving(false);
    if (res && !res.error) {
      setLists(prev => [...prev, res]);
      setSelectedList(res);
      setNewListName('');
      setCreateModal(false);
      showToast(`List "${res.name}" created`);
    } else {
      showToast(res?.error || 'Failed to create list');
    }
  }

  // ── Delete list ───────────────────────────────────────────
  async function deleteList(id) {
    await api.delete(`/leads/${id}`);
    setLists(prev => prev.filter(l => l.id !== id));
    if (selectedList?.id === id) setSelectedList(null);
    showToast('List deleted');
  }

  // ── Download list as CSV ──────────────────────────────
  function downloadList(list) {
    const leads = list.leads || [];
    const cols    = ['name','first_name','last_name','email','company','title','phone','city','state','country','linkedin_url','created_at'];
    const headers = ['Full Name','First Name','Last Name','Email','Company','Job Title','Phone','City','State','Country','LinkedIn URL','Added'];
    const escape  = (v) => `"${String(v||'').replace(/"/g,'""')}"`;
    const rows = [
      headers.join(','),
      ...leads.map(l => cols.map(c => escape(l[c])).join(',')),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${list.name.replace(/[^a-z0-9]/gi,'_')}_leads.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Import leads (CSV or paste) ───────────────────────────
  async function importLeads(rawLeads) {
    if (!selectedList) return;
    if (!rawLeads.length) throw new Error('No valid emails found.');

    setSaving(true);
    const res = await api.post(`/leads/${selectedList.id}/import`, { leads: rawLeads });
    setSaving(false);

    if (res && !res.error) {
      // Update the list in state with fresh data
      setLists(prev => prev.map(l => l.id === selectedList.id ? res : l));
      setSelectedList(res);
      setPasteEmails('');
      setImportModal(false);  // close modal on success
      showToast(`${rawLeads.length} lead${rawLeads.length !== 1 ? 's' : ''} imported successfully`);
    } else {
      throw new Error(res?.error || 'Failed to import leads');
    }
  }

  // ── Handle CSV or Excel file upload ─────────────────────
  function handleFile(file) {
    if (!file) return;
    setImportError('');
    const isExcel = /\.(xlsx|xls|xlsm|ods)$/i.test(file.name);

    function processRows(parsed) {
      const leads = parsed.map(row => ({
        email:   (row.email || row.email_address || '').toLowerCase().trim(),
        name:    getLeadName(row),
        company: row.company || row.company_name || row.organization || '',
        phone:   row.phone   || row.phone_number || row.mobile || '',
      })).filter(r => r.email.includes('@'));

      if (leads.length === 0) {
        setImportError('No valid emails found. Make sure your file has an "email" column.');
        return;
      }
      importLeads(leads).catch(err => setImportError(err.message || 'Import failed'));
    }

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = e => {
        try   { processRows(parseExcel(e.target.result)); }
        catch (err) { setImportError('Excel parse error: ' + err.message); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => processRows(parseCsv(e.target.result));
      reader.readAsText(file, 'UTF-8');
    }
  }

  // ── Add single lead manually ──────────────────────────────────
  async function handleAddSingleLead() {
    setAddLeadErr('');
    const { firstName, lastName, email, company, jobTitle, phone, city } = addLeadForm;
    if (!email.trim() || !email.includes('@')) { setAddLeadErr('Valid email required'); return; }
    if (!selectedList) return;
    const name = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];
    const cf = {};
    addCustomFields.forEach(f => { if (f.key) cf[f.key] = f.value; });
    setSaving(true);
    const res = await api.post(`/leads/${selectedList.id}/import`, {
      leads: [{ email: email.trim(), name, company, title: jobTitle, phone, city, customFields: cf }],
    });
    setSaving(false);
    if (res && !res.error) {
      setLists(prev => prev.map(l => l.id === selectedList.id ? res : l));
      setSelectedList(res);
      setAddLeadModal(false);
      setAddLeadForm(EMPTY_LEAD);
      setAddCustomFields([]);
      setAddingKey(false); setNewKey('');
      showToast('Lead added successfully');
    } else {
      setAddLeadErr(res?.error || 'Failed to add lead');
    }
  }

  // ── Handle paste emails ───────────────────────────────────
  async function handlePasteImport() {
    setImportError('');
    const emails = pasteEmails.split(/[\n,;]+/).map(e => e.trim()).filter(e => e.includes('@'));
    if (!emails.length) { setImportError('No valid emails found.'); return; }
    const leads = emails.map(email => ({ email, name: '', company: '', phone: '' }));
    try {
      await importLeads(leads);
    } catch (err) {
      setImportError(err.message || 'Import failed');
    }
  }

  // ── Computed values ───────────────────────────────────────
  const filteredLists = lists.filter(l => l.name.toLowerCase().includes(searchList.toLowerCase()));
  const activeLead  = selectedList ? lists.find(l => l.id === selectedList.id) || selectedList : null;
  const filteredLeads = (activeLead?.leads || []).filter(lead => {
    const q = searchLeads.toLowerCase();
    return !q || (lead.email + lead.name + lead.company).toLowerCase().includes(q);
  });

  return (
    <div className="page-block fade-up" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#10b981', color: '#fff', padding: '0.75rem 1.25rem', borderRadius: 10, fontWeight: 500, zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', fontSize: '0.875rem' }}>
          ✅ {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex-between" style={{ flexShrink: 0, paddingBottom: '0.75rem' }}>
        <div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Leads</h2>
          <p className="text-secondary fs-sm" style={{ marginTop: '0.25rem' }}>
            {lists.length} list{lists.length !== 1 ? 's' : ''} · {lists.reduce((a, l) => a + (l.count || 0), 0).toLocaleString()} total leads
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateModal(true)}>+ New List</button>
      </div>

      {/* Main layout: sidebar + detail — fills remaining height */}
      <div style={{ display: 'flex', gap: '1.5rem', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left: Lists sidebar — scrolls independently */}
        <div style={{ width: 280, flexShrink: 0, height: '100%', overflowY: 'auto', paddingRight: '0.25rem' }}>
          <div className="search-box" style={{ marginBottom: '0.75rem' }}>
            <span className="text-muted">🔍</span>
            <input placeholder="Search lists..." value={searchList} onChange={e => setSearchList(e.target.value)} />
          </div>

          {loading ? (
            <div className="card card-p" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
          ) : filteredLists.length === 0 ? (
            <div className="card card-p" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>No lists yet</div>
              <div className="fs-sm text-secondary" style={{ marginBottom: '1rem' }}>Create your first lead list</div>
              <button className="btn btn-primary btn-sm" onClick={() => setCreateModal(true)}>+ Create List</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {filteredLists.map(list => (
                <div
                  key={list.id}
                  className="card card-p"
                  style={{
                    cursor: 'pointer', padding: '0.75rem 1rem', position: 'relative',
                    border: activeLead?.id === list.id ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-color)',
                    background: activeLead?.id === list.id ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)',
                  }}
                  onClick={() => { setSelectedList(list); setListMenu(null); }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', flex: 1, marginRight: '0.5rem' }}>{list.name}</div>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', padding: '2px 6px', borderRadius: 4 }}
                      onClick={e => {
                        e.stopPropagation();
                        if (listMenu?.id === list.id) { setListMenu(null); return; }
                        const rect = e.currentTarget.getBoundingClientRect();
                        // position dropdown left-aligned to button right edge, below button
                        setListMenu({ id: list.id, list, top: rect.bottom + 6, left: Math.min(rect.right - 168, window.innerWidth - 178) });
                      }}
                    >⋮</button>
                  </div>
                  {/* column count badge on card */}
                  <div className="fs-xs text-muted" style={{ marginTop: '0.25rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span>{(list.count || 0).toLocaleString()} leads · {list.created_at?.slice(0, 10)}</span>
                    <span style={{ background:'rgba(99,102,241,0.15)', color:'var(--accent-primary)', borderRadius:99, padding:'1px 7px', fontSize:'0.65rem', fontWeight:700 }}>{activeCols.filter(c=>c.key!=='_actions').length} cols</span>
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fixed-position list actions dropdown — portalled to body to escape transform stacking context */}
        {listMenu && ReactDOM.createPortal(
          <>
            <div style={{ position:'fixed', inset:0, zIndex:9998 }} onClick={() => setListMenu(null)} />
            <div style={{
              position:'fixed',
              top:  listMenu.top,
              left: listMenu.left,
              background:'var(--bg-tertiary)',
              border:'1px solid var(--border-color)',
              borderRadius:10, zIndex:9999, minWidth:170,
              boxShadow:'0 8px 28px rgba(0,0,0,0.55)',
              overflow:'hidden',
            }}>
              <button
                style={{ display:'flex', alignItems:'center', gap:'0.5rem', width:'100%', padding:'0.65rem 1rem', background:'none', border:'none', color:'var(--text-primary)', cursor:'pointer', fontSize:'0.875rem' }}
                onMouseEnter={e => e.currentTarget.style.background='var(--overlay-7)'}
                onMouseLeave={e => e.currentTarget.style.background='none'}
                onClick={() => { downloadList(listMenu.list); setListMenu(null); }}
              >⬇ Download CSV</button>
              <div style={{ height:1, background:'var(--border-color)' }} />
              <button
                style={{ display:'flex', alignItems:'center', gap:'0.5rem', width:'100%', padding:'0.65rem 1rem', background:'none', border:'none', color:'var(--danger)', cursor:'pointer', fontSize:'0.875rem' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(239,68,68,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background='none'}
                onClick={() => { deleteList(listMenu.list.id); setListMenu(null); }}
              >🗑 Delete List</button>
            </div>
          </>,
          document.body
        )}

        {/* Right: Lead detail — fills remaining width and height */}
        <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
          {!activeLead ? (
            <div className="card card-p" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👈</div>
              <div style={{ fontWeight: 600, fontSize: '1rem' }}>Select a list to view leads</div>
              <div className="fs-sm text-secondary" style={{ marginTop: '0.5rem' }}>Or create a new list to get started</div>
            </div>
          ) : (
            <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* List header */}
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{activeLead.name}</div>
                  <div className="fs-xs text-muted">{(activeLead.count || 0).toLocaleString()} leads</div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)', fontWeight: 600 }}
                    onClick={() => setAddLeadModal(true)}
                  >👤 Add Lead</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { setImportModal(true); setImportError(''); }}>
                    + Import Leads
                  </button>
                </div>
              </div>

              {/* Toolbar: search + columns */}
              <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <div className="search-box" style={{ flex: 1 }}>
                  <span className="text-muted">🔍</span>
                  <input placeholder="Search leads..." value={searchLeads} onChange={e => setSearchLeads(e.target.value)} />
                </div>

                {/* Columns toggle button */}
                <div style={{ position: 'relative' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    onClick={() => setColPickerOpen(p => !p)}
                  >
                    <span>⊞</span> Columns
                    <span style={{ background: 'var(--accent-primary)', color: '#fff', borderRadius: 99, padding: '0 5px', fontSize: '0.65rem', fontWeight: 700 }}>
                      {visibleCols.length}
                    </span>
                  </button>
                  {colPickerOpen && (
                    <div
                      style={{ position: 'absolute', right: 0, top: '110%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, boxShadow: 'var(--shadow-md)', zIndex: 60, minWidth: 180, padding: '0.5rem 0', overflow: 'hidden' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div style={{ padding: '0.4rem 1rem', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Show / Hide Columns</div>
                      {ALL_COLS.filter(col => !col.always).map(col => (
                        <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 1rem', cursor: 'pointer', fontSize: '0.84rem' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-4)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <input type="checkbox" checked={visibleCols.includes(col.key)}
                            onChange={() => toggleCol(col.key)}
                            style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                          />
                          {col.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Leads table — scrollable */}
              <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }} onClick={() => setColPickerOpen(false)}>
                <table className="data-table" style={{ tableLayout: 'fixed', width: activeCols.reduce((s,c)=>s+c.w,0) + 'px', minWidth: '100%' }}>
                  <colgroup>
                    {activeCols.map(col => <col key={col.key} style={{ width: col.w }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      {activeCols.map(col => (
                        <th key={col.key} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.length === 0 ? (
                      <tr>
                        <td colSpan={activeCols.length} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                          {(activeLead.leads || []).length === 0
                            ? 'No leads yet — click "+ Import Leads" to add some'
                            : 'No leads match your search'}
                        </td>
                      </tr>
                    ) : filteredLeads.map((lead, idx) => (
                      <tr key={lead.id || idx}
                        style={{ cursor: 'default' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        {activeCols.map(col => {
                          if (col.key === '_actions') return (
                            <td key="_actions" style={{ padding:'4px 8px', whiteSpace:'nowrap' }}>
                              <div style={{ display:'flex', gap:'4px', justifyContent:'center' }}>
                                <button title="Edit" onClick={() => openEdit(lead)}
                                  style={{ background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:6, color:'var(--accent-primary)', cursor:'pointer', padding:'3px 7px', fontSize:'0.75rem', lineHeight:1 }}
                                  onMouseEnter={e=>e.currentTarget.style.background='rgba(99,102,241,0.25)'}
                                  onMouseLeave={e=>e.currentTarget.style.background='rgba(99,102,241,0.12)'}
                                >✏</button>
                                <button title="Delete" onClick={() => deleteLead(lead)}
                                  style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:6, color:'var(--danger)', cursor:'pointer', padding:'3px 7px', fontSize:'0.75rem', lineHeight:1 }}
                                  onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,0.25)'}
                                  onMouseLeave={e=>e.currentTarget.style.background='rgba(239,68,68,0.1)'}
                                >🗑</button>
                              </div>
                            </td>
                          );
                          if (col.key === 'name') return (
                            <td key="name" style={{ fontWeight: 500 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                <div style={{ width: 30, height: 30, borderRadius: '50%', background: COLORS[idx % COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.65rem', color: '#fff', flexShrink: 0 }}>
                                  {initials(lead.name)}
                                </div>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.name || '—'}</span>
                              </div>
                            </td>
                          );
                          if (col.key === 'email') return (
                            <td key="email" style={{ color: 'var(--accent-primary)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <a href={`mailto:${lead.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{lead.email}</a>
                            </td>
                          );
                          if (col.key === 'first_name') return (
                            <td key="first_name" style={{ color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{lead.first_name || '—'}</td>
                          );
                          if (col.key === 'last_name') return (
                            <td key="last_name" style={{ color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{lead.last_name || '—'}</td>
                          );
                          if (col.key === 'company') return (
                            <td key="company" style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company || '—'}</td>
                          );
                          if (col.key === 'phone') return (
                            <td key="phone" style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.78rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{lead.phone || '—'}</td>
                          );
                          if (col.key === 'title') return (
                            <td key="title" style={{ color: 'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{lead.title || lead.job_title || '—'}</td>
                          );
                          if (col.key === 'city') return (
                            <td key="city" style={{ color: 'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{lead.city || '—'}</td>
                          );
                          if (col.key === 'state') return (
                            <td key="state" style={{ color: 'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{lead.state || '—'}</td>
                          );
                          if (col.key === 'country') return (
                            <td key="country" style={{ color: 'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{lead.country || '—'}</td>
                          );
                          if (col.key === 'linkedin') return (
                            <td key="linkedin" style={{ fontSize: '0.75rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {lead.linkedin_url || lead.linkedin ? <a href={lead.linkedin_url || lead.linkedin} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', textDecoration:'none' }}>{lead.linkedin_url || lead.linkedin}</a> : <span style={{ color:'var(--text-muted)' }}>—</span>}
                            </td>
                          );
                          if (col.key === 'created_at') return (
                            <td key="created_at" style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{lead.created_at?.slice(0, 10) || '—'}</td>
                          );
                          return null;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer: row count */}
              <div style={{ padding: '0.5rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.73rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                <span>Showing <strong style={{ color: 'var(--text-primary)' }}>{filteredLeads.length.toLocaleString()}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{(activeLead.leads || []).length.toLocaleString()}</strong> leads</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create List Modal */}
      {createModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card card-p" style={{ width: 400 }}>
            <h3 style={{ marginBottom: '1.25rem' }}>Create New List</h3>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label">List Name</label>
              <input
                className="form-input"
                placeholder="e.g. SaaS Founders Q3"
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createList()}
                autoFocus
              />
            </div>
            <div className="flex-row" style={{ justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button className="btn btn-ghost" onClick={() => { setCreateModal(false); setNewListName(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={createList} disabled={saving}>
                {saving ? 'Creating…' : 'Create List'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Import Leads Modal (full column mapping) ───────────────── */}
      {importModal && (
        <ImportLeads
          onClose={() => { setImportModal(false); setImportError(''); }}
          onImport={async (leads) => {
            if (!selectedList) return;
            // leads come from ImportLeads as rich objects; convert to API shape
            const apiLeads = leads.map(l => ({
              email:        l.email,
              name:         l.name,
              first_name:   l.first_name   || '',
              last_name:    l.last_name    || '',
              company:      l.company      || '',
              title:        l.title        || '',
              phone:        l.phone        || '',
              city:         l.city         || '',
              state:        l.state        || '',
              country:      l.country      || '',
              linkedin_url: l.linkedin_url || '',
              customFields: l.customFields || {},
            }));
            setSaving(true);
            const res = await api.post(`/leads/${selectedList.id}/import`, { leads: apiLeads });
            setSaving(false);
            if (res && !res.error) {
              setLists(prev => prev.map(l => l.id === selectedList.id ? res : l));
              setSelectedList(res);
              setImportModal(false);
              showToast(`${apiLeads.length} lead${apiLeads.length !== 1 ? 's' : ''} imported`);
            } else {
              setImportError(res?.error || 'Import failed');
            }
          }}
        />
      )}

      {/* ── Add Single Lead Modal (full featured) ─────────────────── */}
      {addLeadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
          onClick={() => { setAddLeadModal(false); setAddLeadErr(''); setAddLeadForm(EMPTY_LEAD); setAddCustomFields([]); setAddingKey(false); setNewKey(''); }}>

          <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.2rem' }}>👤 Add Single Lead</h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Adding to <strong style={{ color: 'var(--text-secondary)' }}>{activeLead?.name}</strong></div>
              </div>
              <button onClick={() => { setAddLeadModal(false); setAddLeadErr(''); setAddLeadForm(EMPTY_LEAD); setAddCustomFields([]); setAddingKey(false); setNewKey(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            {/* Form */}
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              {addLeadErr && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '0.6rem 0.9rem', color: '#ef4444', fontSize: '0.82rem' }}>❌ {addLeadErr}</div>
              )}

              {/* Row 1: First / Last Name */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {[['firstName','First Name','John'],['lastName','Last Name','Doe']].map(([k,lbl,ph]) => (
                  <div key={k} className="form-group">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>{lbl}</label>
                    <input className="form-input" placeholder={ph} value={addLeadForm[k]}
                      onChange={e => setAddLeadForm(p => ({ ...p, [k]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleAddSingleLead()} />
                  </div>
                ))}
              </div>

              {/* Row 2: Email */}
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Email Address <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input className="form-input" type="email" placeholder="john@company.com" value={addLeadForm.email}
                  onChange={e => { setAddLeadForm(p => ({ ...p, email: e.target.value })); setAddLeadErr(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleAddSingleLead()}
                  style={{ borderColor: addLeadErr ? 'var(--danger)' : undefined }} />
              </div>

              {/* Row 3: Company / Job Title */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {[['company','Company','Acme Corp'],['jobTitle','Job Title','CEO']].map(([k,lbl,ph]) => (
                  <div key={k} className="form-group">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>{lbl}</label>
                    <input className="form-input" placeholder={ph} value={addLeadForm[k]}
                      onChange={e => setAddLeadForm(p => ({ ...p, [k]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleAddSingleLead()} />
                  </div>
                ))}
              </div>

              {/* Row 4: Phone / City */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {[['phone','Phone','+1 555 0100'],['city','City','New York']].map(([k,lbl,ph]) => (
                  <div key={k} className="form-group">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>{lbl}</label>
                    <input className="form-input" placeholder={ph} value={addLeadForm[k]}
                      onChange={e => setAddLeadForm(p => ({ ...p, [k]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleAddSingleLead()} />
                  </div>
                ))}
              </div>

              {/* Custom Fields Section */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.9rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>⚙ Custom Fields</div>
                  {!addingKey && (
                    <button onClick={() => setAddingKey(true)}
                      style={{ background: 'none', border: '1px dashed rgba(99,102,241,0.4)', borderRadius: 6, color: 'var(--accent-primary)', fontSize: '0.75rem', padding: '3px 10px', cursor: 'pointer', fontWeight: 600 }}
                    >+ Add Custom Field</button>
                  )}
                </div>

                {addCustomFields.map((cf, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 3fr auto', gap: '0.4rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                    <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 6, padding: '5px 9px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-primary)' }}>{cf.key}</div>
                    <input className="form-input" placeholder={`Value for ${cf.key}`} value={cf.value}
                      onChange={e => setAddCustomFields(p => p.map((f, i) => i === idx ? { ...f, value: e.target.value } : f))}
                      style={{ fontSize: '0.8rem', padding: '5px 9px' }} />
                    <button onClick={() => setAddCustomFields(p => p.filter((_, i) => i !== idx))}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1rem', padding: '4px 6px' }}>🗑</button>
                  </div>
                ))}

                {addingKey && (
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <input autoFocus className="form-input" placeholder="Field name (e.g. Timezone, Revenue…)"
                      value={newKey} onChange={e => setNewKey(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newKey.trim()) { setAddCustomFields(p => [...p, { key: newKey.trim(), value: '' }]); setNewKey(''); setAddingKey(false); }
                        if (e.key === 'Escape') { setAddingKey(false); setNewKey(''); }
                      }}
                      style={{ flex: 1, fontSize: '0.8rem' }} />
                    <button onClick={() => { if (newKey.trim()) { setAddCustomFields(p => [...p, { key: newKey.trim(), value: '' }]); setNewKey(''); setAddingKey(false); } }}
                      style={{ background: 'var(--accent-primary)', border: 'none', borderRadius: 6, color: '#fff', padding: '6px 10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>✓</button>
                    <button onClick={() => { setAddingKey(false); setNewKey(''); }}
                      style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-muted)', padding: '6px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
                  </div>
                )}

                {addCustomFields.length === 0 && !addingKey && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No custom fields yet — click "+ Add Custom Field" to create one</div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.25rem' }}>
                <button className="btn btn-ghost" onClick={() => { setAddLeadModal(false); setAddLeadErr(''); setAddLeadForm(EMPTY_LEAD); setAddCustomFields([]); setAddingKey(false); setNewKey(''); }}>Cancel</button>
                <button className="btn btn-primary" onClick={handleAddSingleLead} disabled={saving}>{saving ? 'Adding…' : 'Add Lead →'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Lead Modal ─────────────────────────────────────────── */}
      {editModal && editLead && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.78)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}
          onClick={() => { setEditModal(false); setEditErr(''); }}>
          <div style={{ background:'var(--bg-secondary)', borderRadius:16, width:520, maxHeight:'90vh', overflowY:'auto', boxShadow:'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding:'1.25rem 1.5rem', borderBottom:'1px solid var(--border-color)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <div>
                <h3 style={{ fontWeight:700, fontSize:'1.05rem', marginBottom:'0.2rem' }}>✏ Edit Lead</h3>
                <div style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{editLead.email}</div>
              </div>
              <button onClick={() => { setEditModal(false); setEditErr(''); }}
                style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.2rem' }}>✕</button>
            </div>

            {/* Form — all inputs are flat/stable (no .map) to prevent focus loss */}
            <div style={{ padding:'1.5rem', display:'flex', flexDirection:'column', gap:'0.9rem' }}>
              {editErr && (
                <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:8, padding:'0.6rem 0.9rem', color:'#ef4444', fontSize:'0.82rem' }}>❌ {editErr}</div>
              )}

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">First Name</label>
                  <input className="form-input" value={editForm.first_name}
                    onChange={e => setEditForm(p => ({ ...p, first_name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Last Name</label>
                  <input className="form-input" value={editForm.last_name}
                    onChange={e => setEditForm(p => ({ ...p, last_name: e.target.value }))} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Email <span style={{color:'#ef4444'}}>*</span></label>
                <input className="form-input" type="email" value={editForm.email}
                  onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
                  style={{ borderColor: editErr && !editForm.email.includes('@') ? '#ef4444' : undefined }} />
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Company</label>
                  <input className="form-input" value={editForm.company}
                    onChange={e => setEditForm(p => ({ ...p, company: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Job Title</label>
                  <input className="form-input" value={editForm.title}
                    onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} />
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={editForm.phone}
                    onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">City</label>
                  <input className="form-input" value={editForm.city}
                    onChange={e => setEditForm(p => ({ ...p, city: e.target.value }))} />
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">State</label>
                  <input className="form-input" value={editForm.state}
                    onChange={e => setEditForm(p => ({ ...p, state: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Country</label>
                  <input className="form-input" value={editForm.country}
                    onChange={e => setEditForm(p => ({ ...p, country: e.target.value }))} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">LinkedIn URL</label>
                <input className="form-input" placeholder="https://linkedin.com/in/…"
                  value={editForm.linkedin_url}
                  onChange={e => setEditForm(p => ({ ...p, linkedin_url: e.target.value }))} />
              </div>

              <div style={{ display:'flex', justifyContent:'flex-end', gap:'0.75rem', marginTop:'0.25rem' }}>
                <button className="btn btn-ghost" onClick={() => { setEditModal(false); setEditErr(''); }}>Cancel</button>
                <button className="btn btn-primary" onClick={saveEdit} disabled={editSaving}>{editSaving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
