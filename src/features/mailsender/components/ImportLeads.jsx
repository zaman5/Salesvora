import React, { useState, useRef } from 'react';
// SheetJS loaded from CDN in index.html — available as window.XLSX

const PLUSVIBE_FIELDS = [
  'Email','Full Name','First Name','Last Name','Company Name','Job Title',
  'Phone Number','City','State','Country','Company Website',
  'LinkedIn URL','Industry','Company Size','Company Founded',
];

const COLORS = ['#6366f1','#10b981','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#ef4444','#f97316'];

// ── Proper RFC-4180 CSV parser (handles quoted fields with embedded commas/newlines) ──
function parseCSV(text) {
  // Normalize line endings
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!raw) return { headers: [], rows: [] };

  // Tokenise the entire file character-by-character
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        // Escaped quote inside quoted field
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        record.push(field.trim());
        field = '';
      } else if (ch === '\n') {
        record.push(field.trim());
        field = '';
        if (record.some(v => v !== '')) records.push(record);
        record = [];
      } else {
        field += ch;
      }
    }
  }
  // Last field / record
  record.push(field.trim());
  if (record.some(v => v !== '')) records.push(record);

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map(h => h.replace(/^"|"$/g, '').trim());
  const rows = records.slice(1).map(vals => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').replace(/^"|"$/g, '').trim(); });
    return obj;
  }).filter(r => headers.some(h => r[h])); // skip fully-empty rows

  return { headers, rows };
}

function autoMap(header) {
  const h = header.toLowerCase().replace(/[\s_-]/g, '');
  if (h.includes('email'))                                                   return 'Email';
  if (h === 'firstname' || h === 'fname')                                    return 'First Name';
  if (h === 'lastname'  || h === 'lname')                                    return 'Last Name';
  if (h === 'fullname'  || h === 'name')                                     return 'Full Name';
  if (h.includes('name') && !h.includes('company') && !h.includes('last') && !h.includes('first')) return 'Full Name';
  if (h.includes('company') && !h.includes('website') && !h.includes('size') && !h.includes('industry') && !h.includes('found')) return 'Company Name';
  if (h.includes('title') || h.includes('jobtitle'))                        return 'Job Title';
  if (h.includes('phone') || h.includes('mobile') || h.includes('tel'))     return 'Phone Number';
  if (h === 'city' || h === 'location')                                      return 'City';
  if (h === 'state' || h === 'province')                                     return 'State';
  if (h === 'country')                                                       return 'Country';
  if (h.includes('website') || (h.includes('url') && h.includes('comp')))   return 'Company Website';
  if (h.includes('linkedin'))                                                return 'LinkedIn URL';
  if (h.includes('industry'))                                                return 'Industry';
  if (h.includes('size'))                                                    return 'Company Size';
  return '';
}

// ── Searchable field combobox (replaces native <select>) ──────────────────────
function FieldCombobox({ value, allFields, customFields, onChange, onAddCustom }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ]       = React.useState('');
  const ref             = React.useRef(null);

  React.useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    if (open) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const allOptions = [...allFields, ...customFields.map(f => `⚙ ${f}`)];
  const filtered   = q ? allOptions.filter(f => f.toLowerCase().includes(q.toLowerCase())) : allOptions;

  function select(f) {
    const real = f.startsWith('⚙ ') ? f.slice(2) : f;
    onChange(real); setOpen(false); setQ('');
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button type="button" onClick={() => { setOpen(p => !p); setQ(''); }} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: value ? 'rgba(99,102,241,0.1)' : 'var(--bg-tertiary)',
        border: `1px solid ${value ? 'var(--accent-primary)' : 'var(--border-color)'}`,
        borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
        color: value ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'left', gap: '0.4rem',
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {value || '— Skip this column —'}
        </span>
        {value && (
          <span onClick={e => { e.stopPropagation(); onChange(''); }}
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer', flexShrink: 0 }} title="Clear">✕</span>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 300,
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden', maxHeight: 220, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '5px 8px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
            <input autoFocus placeholder="Search field…" value={q} onChange={e => setQ(e.target.value)}
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.8rem' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div onClick={() => { onChange(''); setOpen(false); setQ(''); }}
              style={{ padding: '6px 12px', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', fontStyle: 'italic' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-4)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >— Skip this column —</div>
            {filtered.map(f => (
              <div key={f} onClick={() => select(f)}
                style={{ padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer',
                  color: f.startsWith('⚙') ? '#a78bfa' : 'var(--text-primary)',
                  background: 'none', fontWeight: 400 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-5)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >{f}</div>
            ))}
            <div onClick={() => { setOpen(false); onAddCustom(); }}
              style={{ padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--accent-primary)', fontWeight: 600, borderTop: '1px solid var(--border-color)', marginTop: 2 }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >+ Add Custom Field…</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ImportLeads({ onImport, onClose }) {

  const [step, setStep] = useState(1);
  const [csvData, setCsvData] = useState(null);
  const [mapping, setMapping] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [customFields, setCustomFields] = useState([]);
  const [addingCustom, setAddingCustom] = useState(null);
  const [newCustomName, setNewCustomName] = useState('');
  const [parseError, setParseError] = useState('');
  const fileRef = useRef();
  const [previewRows, setPreviewRows] = useState([]); // {lead, status, reason}
  const [selectedRows, setSelectedRows] = useState(new Set()); // indices of rows to import
  const [importing, setImporting] = useState(false);   // true while API call is in flight
  const [importErr,  setImportErr]  = useState('');    // error message from API

  function loadFile(file) {
    if (!file) return;
    const isExcel = /\.(xlsx|xls|xlsm|ods)$/i.test(file.name);
    const isCsv   = /\.(csv|txt)$/i.test(file.name);
    if (!isExcel && !isCsv) {
      setParseError('Unsupported file type. Please upload a .csv, .xlsx, or .xls file.');
      return;
    }
    setParseError('');

    if (isExcel) {
      // ── Excel via SheetJS ──────────────────────────────────────
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const workbook = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          // Use the first sheet
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          // Convert to array of arrays
          const jsonRows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (jsonRows.length < 2) { setParseError('Excel sheet has no data rows.'); return; }

          const headers = jsonRows[0].map(h => String(h).trim()).filter(Boolean);
          const rows = jsonRows.slice(1)
            .filter(row => row.some(cell => String(cell).trim()))
            .map(row => {
              const obj = {};
              headers.forEach((h, i) => { obj[h] = String(row[i] ?? '').trim(); });
              return obj;
            });

          if (rows.length === 0) { setParseError('No data rows found in the Excel file.'); return; }

          const autoMapping = {};
          headers.forEach(h => { autoMapping[h] = autoMap(h); });
          setMapping(autoMapping);
          setCsvData({ headers, rows, fileName: file.name });
          setStep(2);
        } catch (err) {
          setParseError('Failed to read Excel file: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // ── CSV via RFC-4180 tokenizer ──────────────────────────────
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const { headers, rows } = parseCSV(e.target.result);
          if (headers.length === 0) { setParseError('Could not parse CSV — no headers found.'); return; }
          if (rows.length === 0)    { setParseError('CSV has no data rows (only a header was found).'); return; }

          const autoMapping = {};
          headers.forEach(h => { autoMapping[h] = autoMap(h); });
          setMapping(autoMapping);
          setCsvData({ headers, rows, fileName: file.name });
          setStep(2);
        } catch (err) {
          setParseError('Failed to parse CSV: ' + err.message);
        }
      };
      reader.readAsText(file, 'UTF-8');
    }
  }

  // ── Duplicate field detection ──────────────────────────────
  function getDupeFields() {
    const usage = {};
    Object.values(mapping).forEach(v => { if (v) usage[v] = (usage[v] || 0) + 1; });
    return Object.entries(usage).filter(([,c]) => c > 1).map(([f]) => f);
  }

  // ── Build preview rows (Step 2 → Step 3) ──────────────────
  function goToPreview() {
    const dupes = getDupeFields();
    if (dupes.length) { alert(`These fields are mapped more than once: ${dupes.join(', ')}. Each field can only be used once.`); return; }
    const find = (field) => Object.entries(mapping).find(([,v]) => v === field)?.[0];
    const emailCol = find('Email');
    if (!emailCol) { alert('Please map the Email column before continuing.'); return; }
    const firstCol    = find('First Name');
    const lastCol     = find('Last Name');
    const fullNameCol = find('Full Name');
    const compCol    = find('Company Name'),  titleCol   = find('Job Title');
    const phoneCol   = find('Phone Number'),  cityCol    = find('City');
    const stateCol   = find('State'),         countryCol = find('Country');
    const linkedinCol = find('LinkedIn URL');
    const seen = new Set();
    const rows = csvData.rows.map((row, i) => {
      const emailRaw = (row[emailCol] || '').trim();
      const email = emailRaw.toLowerCase();
      let status = 'ok', reason = '';
      if (!emailRaw || !email.includes('@')) { status = 'skip'; reason = 'Invalid or missing email'; }
      else if (seen.has(email)) { status = 'dupe'; reason = 'Duplicate email'; }
      else seen.add(email);

      // Resolve first/last name — prefer explicit cols, fall back to splitting Full Name
      let first = (firstCol ? row[firstCol] : '') || '';
      let last  = (lastCol  ? row[lastCol]  : '') || '';
      if (!first && !last && fullNameCol) {
        const parts = (row[fullNameCol] || '').trim().split(/\s+/);
        first = parts[0] || '';
        last  = parts.slice(1).join(' ');
      }
      const name = [first, last].filter(Boolean).join(' ') ||
                   (fullNameCol ? row[fullNameCol] : '') ||
                   email.split('@')[0];

      const customData = {};
      customFields.forEach(cf => { const s = Object.entries(mapping).find(([,v]) => v === cf)?.[0]; if (s) customData[cf] = row[s] || ''; });
      const lead = {
        initials: name.slice(0,2).toUpperCase(), color: COLORS[i % COLORS.length],
        name, first_name: first, last_name: last,
        email: emailRaw, company: row[compCol]||'', title: row[titleCol]||'',
        phone: row[phoneCol]||'', city: row[cityCol]||'', state: row[stateCol]||'',
        country: row[countryCol]||'', linkedin_url: row[linkedinCol]||'',
        esp: email.includes('gmail')?'Google':email.includes('outlook')||email.includes('hotmail')?'Microsoft':'SMTP',
        sent:0,opened:0,clicked:0,replied:0,status:'In Progress',step:'0/1',label:null,customFields:customData,
      };
      return { lead, status, reason, idx: i };
    });
    setPreviewRows(rows);
    setSelectedRows(new Set(rows.filter(r => r.status === 'ok').map(r => r.idx)));
    setStep(3);
  }

  async function doImport() {
    const leads = previewRows.filter(r => selectedRows.has(r.idx) && r.status === 'ok').map(r => r.lead);
    if (!leads.length) { alert('No leads selected to import.'); return; }
    setImporting(true);
    setImportErr('');
    try {
      await onImport(leads);   // wait for API call to complete
      onClose();               // only close AFTER success
    } catch (err) {
      setImportErr(err?.message || 'Import failed — please try again.');
      setImporting(false);
    }
  }

  const samples = csvData ? csvData.rows.slice(0, 3) : [];

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}>
      <div style={{ background:'var(--bg-secondary)', borderRadius:16, width:900, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'var(--shadow-lg)' }}>

        {/* Header */}
        <div style={{ padding:'1.25rem 1.5rem', borderBottom:'1px solid var(--border-color)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div>
            <h3 style={{ fontWeight:700, fontSize:'1.1rem', marginBottom:'0.15rem' }}>📊 Import Leads</h3>
            {csvData && <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{csvData.fileName} · {csvData.rows.length} rows detected · map your columns below</span>}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.2rem' }}>✕</button>
        </div>

        {/* Step 1: Upload */}
        {step === 1 && (
          <div style={{ padding:'2rem', flex:1, display:'flex', flexDirection:'column', gap:'1rem' }}>
            <div
              style={{ border:`2px dashed ${dragOver ? 'var(--accent-primary)' : 'var(--border-color)'}`, borderRadius:14, padding:'3.5rem', textAlign:'center', background: dragOver ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.02)', transition:'all 0.2s', cursor:'pointer' }}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current.click()}
            >
              <div style={{ fontSize:'3rem', marginBottom:'0.75rem' }}>📊</div>
              <div style={{ fontWeight:600, fontSize:'1rem', marginBottom:'0.5rem' }}>Drop your file here or click to browse</div>
              {/* Supported format badges */}
              <div style={{ display:'flex', gap:'0.4rem', justifyContent:'center', marginBottom:'0.6rem' }}>
                {[['CSV','#10b981'],['XLSX','#217346'],['XLS','#1d6f42'],['ODS','#f59e0b']].map(([fmt,clr]) => (
                  <span key={fmt} style={{ background:`${clr}22`, color:clr, border:`1px solid ${clr}55`, borderRadius:6, padding:'2px 8px', fontSize:'0.72rem', fontWeight:700 }}>{fmt}</span>
                ))}
              </div>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>
                Required column: <strong>email</strong> · Optional: first_name, last_name, company, job_title, phone, city…
              </div>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.xlsm,.ods,.txt" style={{ display:'none' }} onChange={e => loadFile(e.target.files[0])} />
            </div>
            {parseError && (
              <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:8, padding:'0.65rem 1rem', color:'#ef4444', fontSize:'0.82rem' }}>
                ❌ {parseError}
              </div>
            )}
            <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', textAlign:'center' }}>
              Supports standard CSV with quoted fields, commas inside values, and UTF-8 encoding
            </div>
          </div>
        )}

        {/* Step 2: Column Mapping */}
        {step === 2 && csvData && (
          <>
            <div style={{ flex:1, overflowY:'auto', padding:'0' }}>
              {/* Column header row */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 24px 1.2fr 24px 1fr', gap:'0.5rem', padding:'0.875rem 1.5rem', borderBottom:'1px solid var(--border-color)', fontSize:'0.78rem', fontWeight:600, color:'var(--text-secondary)', background:'var(--overlay-1)', position:'sticky', top:0 }}>
                <span>Your CSV Column</span><span></span><span>Map to Field</span><span></span><span>Sample Values</span>
              </div>

              {csvData.headers.map((h) => (
                <div key={h} style={{ display:'grid', gridTemplateColumns:'1fr 24px 1.2fr 24px 1fr', gap:'0.75rem', padding:'0.6rem 1.5rem', borderBottom:'1px solid var(--overlay-4)', alignItems:'center' }}>
                  {/* Column name */}
                  <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'rgba(99,102,241,0.07)', border:'1px solid rgba(99,102,241,0.15)', borderRadius:6, padding:'6px 10px', fontSize:'0.8rem', fontWeight:500 }}>
                    <span style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>⊞</span>{h}
                  </div>

                  <span style={{ color:'var(--text-muted)', textAlign:'center' }}>→</span>

                  {/* Field selector */}
                  {addingCustom === h ? (
                    <div style={{ display:'flex', gap:'0.35rem' }}>
                      <input autoFocus className="form-input" placeholder="Custom field name…"
                        value={newCustomName} onChange={e => setNewCustomName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && newCustomName.trim()) {
                            const n = newCustomName.trim();
                            if (!customFields.includes(n)) setCustomFields(p => [...p, n]);
                            setMapping(p => ({ ...p, [h]: n }));
                            setNewCustomName(''); setAddingCustom(null);
                          }
                          if (e.key === 'Escape') { setAddingCustom(null); setNewCustomName(''); }
                        }}
                        style={{ flex:1, fontSize:'0.78rem', padding:'5px 8px' }}
                      />
                      <button onClick={() => {
                        if (newCustomName.trim()) {
                          const n = newCustomName.trim();
                          if (!customFields.includes(n)) setCustomFields(p => [...p, n]);
                          setMapping(p => ({ ...p, [h]: n }));
                        }
                        setNewCustomName(''); setAddingCustom(null);
                      }} style={{ background:'var(--accent-primary)', border:'none', borderRadius:6, color:'#fff', padding:'5px 9px', cursor:'pointer', fontWeight:700 }}>✓</button>
                      <button onClick={() => { setAddingCustom(null); setNewCustomName(''); }}
                        style={{ background:'none', border:'1px solid var(--border-color)', borderRadius:6, color:'var(--text-muted)', padding:'5px 8px', cursor:'pointer' }}>✕</button>
                    </div>
                  ) : (
                    <FieldCombobox
                      value={mapping[h] || ''}
                      allFields={PLUSVIBE_FIELDS}
                      customFields={customFields}
                      onChange={val => setMapping(prev => ({ ...prev, [h]: val }))}
                      onAddCustom={() => { setAddingCustom(h); setNewCustomName(''); }}
                    />
                  )}

                  <span style={{ color:'var(--text-muted)', textAlign:'center' }}>—</span>

                  {/* Sample values */}
                  <div style={{ fontSize:'0.73rem' }}>
                    {samples.map((row, si) => (
                      <div key={si} style={{ color: row[h] ? 'var(--accent-primary)' : 'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.7 }}>
                        {row[h] || '—'}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Duplicate warning banner */}
            {getDupeFields().length > 0 && (
              <div style={{ margin:'0 1.5rem 0', padding:'0.6rem 1rem', background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.4)', borderRadius:8, fontSize:'0.78rem', color:'var(--warning-text)', flexShrink:0 }}>
                ⚠ Field{getDupeFields().length>1?'s':''} <strong>{getDupeFields().join(', ')}</strong> mapped to multiple columns — fix before continuing.
              </div>
            )}

            {/* Footer */}
            <div style={{ padding:'1rem 1.5rem', borderTop:'1px solid var(--border-color)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
              <div style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>
                {csvData.rows.length} rows detected
              </div>
              <div style={{ display:'flex', gap:'0.75rem' }}>
                <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
                <button className="btn btn-primary" onClick={goToPreview} disabled={getDupeFields().length > 0}>
                  Preview Leads →
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 3: Preview with checkboxes */}
        {step === 3 && (
          <>
            <div style={{ flex:1, overflowY:'auto', overflowX:'auto' }}>
              {/* Stats bar */}
              <div style={{ display:'flex', gap:'1rem', padding:'0.75rem 1.5rem', background:'var(--overlay-1)', borderBottom:'1px solid var(--border-color)', fontSize:'0.78rem', flexShrink:0 }}>
                <span style={{ color:'var(--success-text)' }}>✓ {previewRows.filter(r=>r.status==='ok').length} valid</span>
                <span style={{ color:'var(--warning-text)' }}>⚠ {previewRows.filter(r=>r.status==='dupe').length} duplicate</span>
                <span style={{ color:'var(--danger-text)' }}>✕ {previewRows.filter(r=>r.status==='skip').length} invalid email</span>
                <span style={{ color:'var(--text-muted)', marginLeft:'auto' }}>{selectedRows.size} selected</span>
              </div>

              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem', minWidth: 700 }}>
                <thead>
                  <tr style={{ background:'var(--overlay-3)', position:'sticky', top:0 }}>
                    <th style={{ padding:'8px 12px', textAlign:'left', width:36, borderBottom:'1px solid var(--border-color)' }}>
                      <input type="checkbox"
                        checked={selectedRows.size === previewRows.filter(r=>r.status==='ok').length && selectedRows.size > 0}
                        onChange={e => setSelectedRows(e.target.checked ? new Set(previewRows.filter(r=>r.status==='ok').map(r=>r.idx)) : new Set())}
                        style={{ accentColor:'var(--accent-primary)' }} />
                    </th>
                    <th style={{ padding:'8px 8px', textAlign:'left', borderBottom:'1px solid var(--border-color)', color:'var(--text-muted)', fontWeight:600, whiteSpace:'nowrap' }}>Status</th>
                    {Object.entries(mapping).filter(([,v])=>v).map(([col,field])=>(
                      <th key={col} style={{ padding:'8px 10px', textAlign:'left', borderBottom:'1px solid var(--border-color)', color:'var(--text-muted)', fontWeight:600, whiteSpace:'nowrap', minWidth:120 }}>{field}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => {
                    const isOk = r.status === 'ok';
                    const checked = selectedRows.has(r.idx);
                    return (
                      <tr key={r.idx} style={{ opacity: isOk ? 1 : 0.45, background: checked && isOk ? 'rgba(99,102,241,0.04)' : 'transparent' }}
                        onMouseEnter={e => e.currentTarget.style.background = isOk ? 'var(--overlay-3)' : 'transparent'}
                        onMouseLeave={e => e.currentTarget.style.background = checked && isOk ? 'rgba(99,102,241,0.04)' : 'transparent'}>
                        <td style={{ padding:'6px 12px', borderBottom:'1px solid var(--overlay-4)' }}>
                          <input type="checkbox" checked={checked && isOk} disabled={!isOk}
                            onChange={e => setSelectedRows(prev => { const s = new Set(prev); e.target.checked ? s.add(r.idx) : s.delete(r.idx); return s; })}
                            style={{ accentColor:'var(--accent-primary)', cursor: isOk ? 'pointer' : 'not-allowed' }} />
                        </td>
                        <td style={{ padding:'6px 8px', borderBottom:'1px solid var(--overlay-4)', whiteSpace:'nowrap' }}>
                          {isOk
                            ? <span style={{ color:'#10b981', fontSize:'0.7rem', fontWeight:700 }}>✓ OK</span>
                            : <span style={{ color: r.status==='dupe'?'#f59e0b':'#ef4444', fontSize:'0.7rem', fontWeight:600 }} title={r.reason}>
                                {r.status==='dupe'?'⚠ Dupe':'✕ Skip'}: {r.reason}
                              </span>}
                        </td>
                        {Object.entries(mapping).filter(([,v])=>v).map(([col,field])=>(
                          <td key={col} style={{ padding:'6px 10px', borderBottom:'1px solid var(--overlay-4)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:200,
                            color: field==='Email' ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                            {csvData.rows[r.idx]?.[col] || '—'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ padding:'1rem 1.5rem', borderTop:'1px solid var(--border-color)', display:'flex', flexDirection:'column', gap:'0.6rem', flexShrink:0 }}>
              {/* Error banner — shown if API call fails */}
              {importErr && (
                <div style={{ padding:'0.6rem 1rem', background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.4)', borderRadius:8, fontSize:'0.8rem', color:'var(--danger-text)' }}>
                  ❌ {importErr}
                </div>
              )}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>
                  {selectedRows.size} lead{selectedRows.size!==1?'s':''} will be imported
                </div>
                <div style={{ display:'flex', gap:'0.75rem' }}>
                  <button className="btn btn-secondary" onClick={() => setStep(2)} disabled={importing}>← Back</button>
                  <button className="btn btn-primary" onClick={doImport}
                    disabled={selectedRows.size===0 || importing}
                    style={{ minWidth: 160, opacity: (selectedRows.size===0 || importing) ? 0.7 : 1 }}>
                    {importing
                      ? <span style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                          <span style={{ display:'inline-block', width:14, height:14, border:'2px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
                          Importing…
                        </span>
                      : `Import ${selectedRows.size} Lead${selectedRows.size!==1?'s':''} →`
                    }
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
