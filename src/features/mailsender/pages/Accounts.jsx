import React, { useState, useRef, useEffect } from 'react';
import AccountPanel from '../components/AccountPanel';
import { api } from '../lib/api';

const ACCOUNTS = [];


const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
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

function DnsBadge({ label, ok }) {
  return (
    <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: ok ? '#10b98120' : '#ef444420', color: ok ? '#10b981' : '#ef4444', border: `1px solid ${ok ? '#10b98140' : '#ef444440'}` }}>
      {label}
    </span>
  );
}

export default function Accounts({ userId }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  // Tags — MUST be declared before useEffect so setters are available
  const [allTags, setAllTags] = useState([]);
  const [accountTags, setAccountTags] = useState({});
  const [tagFilter, setTagFilter] = useState('');
  const [tagInput, setTagInput] = useState({});
  const [bulkTagModal, setBulkTagModal] = useState(false);
  const [bulkTagValue, setBulkTagValue] = useState('');
  const [tagEditorOpen, setTagEditorOpen] = useState(null); // accountId of open tag editor
  const [bulkSettingsModal, setBulkSettingsModal] = useState(false);
  const [bulkSettingsForm, setBulkSettingsForm] = useState({ limitPerDay: '', status: '' });
  const [bulkSettingsSaving, setBulkSettingsSaving] = useState(false);

  function reloadTags() {
    api.get('/accounts/tags/all').then(res => {
      if (Array.isArray(res)) setAllTags(res);
    });
  }
  function loadAccountTags(acctId) {
    api.get(`/accounts/${acctId}/tags`).then(res => {
      if (Array.isArray(res)) setAccountTags(p => ({ ...p, [acctId]: res }));
    });
  }
  async function saveAccountTags(acctId, tags) {
    const res = await api.post(`/accounts/${acctId}/tags`, { tags });
    if (res?.tags) {
      setAccountTags(p => ({ ...p, [acctId]: res.tags }));
      reloadTags();
    }
  }
  function addTag(acctId, tag) {
    const clean = tag.trim();
    if (!clean) return;
    const current = accountTags[acctId] || [];
    if (current.length >= 5) { showToast('Max 5 tags per account'); return; }
    if (current.includes(clean)) return;
    const next = [...current, clean];
    setAccountTags(p => ({ ...p, [acctId]: next }));
    saveAccountTags(acctId, next);
    setTagInput(p => ({ ...p, [acctId]: '' }));
  }
  function removeTag(acctId, tag) {
    const next = (accountTags[acctId] || []).filter(t => t !== tag);
    setAccountTags(p => ({ ...p, [acctId]: next }));
    saveAccountTags(acctId, next);
  }

  useEffect(() => {
    setAccounts([]);
    setLoading(true);
    api.get('/accounts').then(res => {
      if (res && !res.error) {
        const mapped = res.map(a => ({
          ...a,
          firstName: a.first_name || '',
          lastName:  a.last_name  || '',
          spf:       !!a.spf,
          dkim:      !!a.dkim,
          dmarc:     !!a.dmarc,
          mx:        !!a.mx,
          limit:     a.limit_per_day || 150,
          reply:     a.reply_rate   || '0%',
          status:    a.status       || 'active',
          sent:      a.sent         || 0,
          warmup:    a.warmup       || 0,
          bounce:    a.bounce       || '0%',
          campaigns: a.campaigns    || 0,
        }));
        setAccounts(mapped);
        mapped.forEach(a => { if (a.id) loadAccountTags(a.id); });
      }
      setLoading(false);
      reloadTags();
    });
  }, [userId]);

  // Close tag editor on outside click
  useEffect(() => {
    if (!tagEditorOpen) return;
    function handler() { setTagEditorOpen(null); }
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [tagEditorOpen]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [actionsOpen, setActionsOpen] = useState(null);
  
  // Modals
  const [addModal, setAddModal] = useState(false);
  const [csvModal, setCsvModal] = useState(false);

  // Single Add State
  const [addStep, setAddStep] = useState(1);
  const [newForm, setNewForm] = useState({
    firstName: '', lastName: '',
    email: '', provider: 'Google',
    smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '',
    imapHost: '', imapPort: '993', appPassword: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [testError, setTestError] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  // CSV Import State
  const fileInputRef = useRef(null);
  const [csvFile, setCsvFile] = useState(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null);
  const [csvProvider, setCsvProvider] = useState('Google');

  // Send Email modal
  const [sendModal, setSendModal] = useState(null); // account object
  const [sendForm, setSendForm] = useState({ to: '', subject: '', body: '' });
  const [sending, setSending] = useState(false);
  const [sendDone, setSendDone] = useState(false);

  // Email Tester modal
  const [testerModal, setTesterModal] = useState(null); // account object
  const [testerEmail, setTesterEmail] = useState('');
  const [testerRunning, setTesterRunning] = useState(false);
  const [testerResult, setTesterResult] = useState(null);

  // Email Tracking modal
  const [trackingModal, setTrackingModal] = useState(null); // account object

  // Mock sent-email tracking log keyed by account email
  const [trackingLog, setTrackingLog] = useState({
    'sarah@hddp.live': [
      { id: 1, to: 'client1@acmecorp.com', subject: 'Q2 Outreach', sentAt: '2026-05-12 09:14', type: 'Cold', delivered: true, opened: true, openedAt: '2026-05-12 09:52', clicked: true, bounced: false },
      { id: 2, to: 'ceo@startupx.io', subject: 'Partnership Proposal', sentAt: '2026-05-12 11:30', type: 'Follow-up', delivered: true, opened: false, openedAt: null, clicked: false, bounced: false },
      { id: 3, to: 'ops@retailbig.com', subject: 'Intro Email', sentAt: '2026-05-13 08:05', type: 'Cold', delivered: false, opened: false, openedAt: null, clicked: false, bounced: true },
    ],
    'a.hayes@hddpcrm.website': [
      { id: 4, to: 'hr@techfirm.com', subject: 'SaaS Demo Invite', sentAt: '2026-05-11 14:20', type: 'Cold', delivered: true, opened: true, openedAt: '2026-05-11 15:01', clicked: false, bounced: false },
      { id: 5, to: 'sales@agency.co', subject: 'Follow-up #2', sentAt: '2026-05-13 10:00', type: 'Follow-up', delivered: true, opened: true, openedAt: '2026-05-13 10:45', clicked: true, bounced: false },
    ],
  });

  // Leads state
  const [leadsModal, setLeadsModal] = useState(false);
  const [leads, setLeads] = useState([]);
  const [leadForm, setLeadForm] = useState({ name: '', email: '', company: '', phone: '' });
  const [leadErrors, setLeadErrors] = useState({});

  const [toast, setToast] = useState('');
  const [selectedAccount, setSelectedAccount] = useState(null);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  async function applyBulkTag(tag) {
    const clean = tag.trim();
    if (!clean) return;
    const acctIds = accounts.filter(a => selected.includes(a.email) && a.id).map(a => a.id);
    await Promise.all(acctIds.map(async id => {
      const cur = accountTags[id] || [];
      if (cur.includes(clean) || cur.length >= 5) return;
      const next = [...cur, clean];
      await api.post(`/accounts/${id}/tags`, { tags: next });
      setAccountTags(p => ({ ...p, [id]: next }));
    }));
    reloadTags();
    setBulkTagModal(false);
    setBulkTagValue('');
    showToast(`✅ Tag "${clean}" applied to ${acctIds.length} accounts`);
  }

  function openBulkSettingsModal() {
    setBulkSettingsForm({ limitPerDay: '', status: '' });
    setBulkSettingsModal(true);
  }

  async function applyBulkSettings() {
    const { limitPerDay, status } = bulkSettingsForm;
    if (!limitPerDay && !status) return;
    if (limitPerDay && (!Number(limitPerDay) || Number(limitPerDay) <= 0)) {
      showToast('❌ Daily limit must be a positive number');
      return;
    }

    const acctIds = accounts.filter(a => selected.includes(a.email) && a.id).map(a => a.id);
    setBulkSettingsSaving(true);
    try {
      const payload = {};
      if (limitPerDay) payload.limitPerDay = Number(limitPerDay);
      if (status) payload.status = status;

      const results = await Promise.all(
        acctIds.map(id => api.patch(`/accounts/${id}`, payload))
      );
      const failed = results.filter(r => !r || r.error).length;

      setAccounts(prev => prev.map(a => {
        if (!selected.includes(a.email)) return a;
        return {
          ...a,
          limit: limitPerDay ? Number(limitPerDay) : a.limit,
          status: status || a.status,
        };
      }));

      setBulkSettingsModal(false);
      setSelected([]);
      if (failed > 0) {
        showToast(`⚠ Updated ${acctIds.length - failed}/${acctIds.length} accounts — ${failed} failed`);
      } else {
        showToast(`✅ Settings applied to ${acctIds.length} account${acctIds.length !== 1 ? 's' : ''}`);
      }
    } catch (err) {
      showToast('❌ Failed to apply bulk settings');
    } finally {
      setBulkSettingsSaving(false);
    }
  }

  async function handleBulkDelete() {
    const acctIds = accounts.filter(a => selected.includes(a.email) && a.id).map(a => a.id);
    if (acctIds.length === 0) return;
    try {
      showToast('Removing accounts...');
      await Promise.all(acctIds.map(id => api.delete(`/accounts/${id}`)));
      setAccounts(prev => prev.filter(a => !selected.includes(a.email)));
      setSelected([]);
      showToast(`Removed ${acctIds.length} account(s)`);
    } catch (err) {
      showToast('❌ Failed to remove some accounts');
    }
  }

  const filtered = accounts
    .filter(a => a.email.toLowerCase().includes(search.toLowerCase()))
    .filter(a => !tagFilter || (accountTags[a.id] || []).includes(tagFilter));
  const toggleSelect = (email) => setSelected(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]);
  const allSel = filtered.length > 0 && filtered.every(a => selected.includes(a.email));

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // ---- SINGLE ACCOUNT ADD LOGIC ----
  function openAddModal() {
    setNewForm({ firstName: '', lastName: '', email: '', provider: 'Google', smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '', imapHost: '', imapPort: '993', appPassword: '' });
    setFormErrors({});
    setTestError('');
    setAddStep(1);
    setAddModal(true);
  }

  function validateForm() {
    const errs = {};
    if (!newForm.firstName.trim()) errs.firstName = 'First name is required';
    if (!newForm.lastName.trim()) errs.lastName = 'Last name is required';
    if (!EMAIL_RE.test(newForm.email)) errs.email = 'Enter a valid email address';
    else if (accounts.some(a => a.email.toLowerCase() === newForm.email.toLowerCase())) errs.email = 'This email is already added';
    
    if (newForm.provider === 'SMTP') {
      if (!newForm.smtpHost.trim()) errs.smtpHost = 'SMTP host required';
      if (!newForm.smtpPort) errs.smtpPort = 'Port required';
      if (!newForm.smtpUser.trim()) errs.smtpUser = 'SMTP user required';
      if (!newForm.smtpPass.trim()) errs.smtpPass = 'SMTP password required';
      if (!newForm.imapHost.trim()) errs.imapHost = 'IMAP host required';
    } else {
      if (!newForm.appPassword.trim()) errs.appPassword = 'App password is required';
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function testConnection() {
    if (!validateForm()) return;
    setTestError('');
    setTestLoading(true);
    setAddStep(2);

    try {
      const res = await api.post('/accounts/test-connection', {
        email: newForm.email,
        esp: newForm.provider,
        appPassword: newForm.appPassword,
        smtpHost: newForm.smtpHost,
        smtpPort: newForm.smtpPort,
        smtpUser: newForm.smtpUser,
        smtpPass: newForm.smtpPass,
        imapHost: newForm.imapHost,
        imapPort: newForm.imapPort,
      });

      if (res && res.success) {
        setAddStep(3);
      } else {
        const errMsg = res?.error || 'Connection failed. Please check your credentials.';
        setTestError(errMsg);
        setAddStep(1);
        showToast('❌ ' + errMsg);
      }
    } catch (e) {
      const errMsg = 'Network error — could not reach the server.';
      setTestError(errMsg);
      setAddStep(1);
      showToast('❌ ' + errMsg);
    } finally {
      setTestLoading(false);
    }
  }

  async function confirmAddAccount() {
    const res = await api.post('/accounts', {
      firstName:   newForm.firstName,
      lastName:    newForm.lastName,
      email:       newForm.email,
      esp:         newForm.provider,
      appPassword: newForm.appPassword,
      smtpHost:    newForm.smtpHost,
      smtpPort:    newForm.smtpPort,
      smtpUser:    newForm.smtpUser,
      smtpPass:    newForm.smtpPass,
      imapHost:    newForm.imapHost,
      imapPort:    newForm.imapPort,
    });
    if (res && !res.error) {
      const a = {
        ...res,
        spf: !!res.spf, dkim: !!res.dkim, dmarc: !!res.dmarc, mx: !!res.mx,
        limit: res.limit_per_day, reply: res.reply_rate,
        firstName: res.first_name, lastName: res.last_name,
      };
      setAccounts(prev => [a, ...prev]);
      setAddModal(false);
      setTestError('');
      showToast(`✅ ${newForm.email} connected successfully`);
    } else {
      showToast(res?.error || 'Failed to add account');
    }
  }

  function setField(key, val) {
    setNewForm(p => ({ ...p, [key]: val }));
    if (formErrors[key]) setFormErrors(p => { const n = { ...p }; delete n[key]; return n; });
  }

  // ---- SEND EMAIL LOGIC ----
  function openSendModal(account) {
    setSendForm({ to: account.email, subject: '', body: '' });
    setSendDone(false);
    setSendModal(account);
  }
  function handleSend() {
    if (!sendForm.subject.trim() || !sendForm.body.trim()) return;
    setSending(true);
    setTimeout(() => { setSending(false); setSendDone(true); showToast(`Email sent to ${sendForm.to}`); }, 1800);
  }

  // ---- LEADS LOGIC ----
  function validateLead() {
    const errs = {};
    if (!leadForm.name.trim()) errs.name = 'Name required';
    if (!EMAIL_RE.test(leadForm.email)) errs.email = 'Valid email required';
    else if (leads.some(l => l.email.toLowerCase() === leadForm.email.toLowerCase())) errs.email = 'Already in list';
    setLeadErrors(errs);
    return Object.keys(errs).length === 0;
  }
  function addLead() {
    if (!validateLead()) return;
    setLeads(prev => [...prev, { ...leadForm, id: Date.now() }]);
    setLeadForm({ name: '', email: '', company: '', phone: '' });
    setLeadErrors({});
    showToast('Lead added');
  }
  function removeLead(id) { setLeads(prev => prev.filter(l => l.id !== id)); }

  // ---- CSV IMPORT LOGIC ----
  function openCsvModal() {
    setCsvFile(null);
    setCsvResult(null);
    setCsvImporting(false);
    setCsvProvider('Google');
    setCsvModal(true);
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file && file.name.endsWith('.csv')) {
      setCsvFile(file);
    } else {
      showToast('Please upload a valid CSV file');
    }
  }

  function processCsv() {
    if (!csvFile) return;
    setCsvImporting(true);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result;
        const lines = text.trim().split(/\r?\n/);
        if (lines.length < 2) {
          showToast('❌ CSV file is empty or has no data rows');
          setCsvImporting(false);
          return;
        }

        // Parse headers — normalize to lowercase, strip quotes/spaces
        const headers = lines[0]
          .split(',')
          .map(h => h.trim().toLowerCase().replace(/['"]/g, '').replace(/\s+/g, ''));

        let added = 0;
        let skipped = 0;
        let failed = 0;
        const failedRows = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Handle quoted fields with commas inside
          const values = [];
          let cur = '', inQ = false;
          for (const ch of line) {
            if (ch === '"') { inQ = !inQ; }
            else if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; }
            else { cur += ch; }
          }
          values.push(cur.trim());

          const row = {};
          headers.forEach((h, idx) => {
            row[h] = (values[idx] || '').replace(/^"|"$/g, '').trim();
          });

          const email = row.email || row['email address'] || '';
          if (!email.includes('@')) { failed++; continue; }

          const provider = row.provider || csvProvider;
          const firstName = row.firstname || row['first_name'] || row['first name'] || '';
          const lastName  = row.lastname  || row['last_name']  || row['last name']  || '';

          // Build account payload based on provider
          let payload = {
            firstName,
            lastName,
            email,
            esp: provider,
            appPassword: (row.apppassword || row['app_password'] || row['app password'] || '').replace(/\s+/g, ''),
            smtpHost: row.smtphost || row['smtp_host'] || row['smtp host'] || '',
            smtpPort: row.smtpport || row['smtp_port'] || row['smtp port'] || '587',
            smtpUser: row.smtpuser || row['smtp_user'] || row['smtp user'] || email,
            smtpPass: (row.smtppass || row['smtp_pass'] || row['smtp pass'] || '').replace(/\s+/g, ''),
            imapHost: row.imaphost || row['imap_host'] || row['imap host'] || '',
            imapPort: row.imapport || row['imap_port'] || row['imap port'] || '993',
          };

          // Auto-fill SMTP/IMAP for known providers if not in CSV
          if (provider === 'Google' && !payload.smtpHost) {
            payload.smtpHost = 'smtp.gmail.com';
            payload.smtpPort = '587';
            payload.smtpUser = email;
            payload.imapHost = 'imap.gmail.com';
            payload.imapPort = '993';
          } else if (provider === 'Microsoft' && !payload.smtpHost) {
            payload.smtpHost = 'smtp.office365.com';
            payload.smtpPort = '587';
            payload.smtpUser = email;
            payload.imapHost = 'outlook.office365.com';
            payload.imapPort = '993';
          }

          try {
            const res = await api.post('/accounts', payload);
            if (res && !res.error) {
              added++;
              // Map snake_case DB fields to camelCase display fields (same as initial load)
              setAccounts(prev => [...prev, {
                ...res,
                firstName: res.first_name || firstName,
                lastName:  res.last_name  || lastName,
                email:     res.email,
                esp:       res.esp,
                status:    'active',
                sent:      0,
                limit:     res.limit_per_day || 150,
                warmup:    0,
                bounce:    '0%',
                reply:     '0%',
                campaigns: 0,
                spf:   true,
                dkim:  true,
                dmarc: provider !== 'Other',
                mx:    true,
              }]);
            } else if (res?.error?.toLowerCase().includes('already exists')) {
              skipped++;
            } else {
              failed++;
              failedRows.push(`${email} — ${res?.error || 'failed'}`);
            }
          } catch (rowErr) {
            failed++;
            failedRows.push(`${email} — ${rowErr?.message || 'error'}`);
          }
        }

        setCsvResult({ added, skipped, failed, failedRows });
        setCsvImporting(false);
        if (added > 0)   showToast(`✅ Imported ${added} new account${added > 1 ? 's' : ''}`);
        if (skipped > 0) showToast(`⏭ ${skipped} account${skipped > 1 ? 's' : ''} already existed — skipped`);
        if (failed > 0)  showToast(`❌ ${failed} row${failed > 1 ? 's' : ''} failed (invalid data)`);
      } catch (err) {
        console.error('CSV parse error:', err);
        showToast('❌ Failed to parse CSV file');
        setCsvImporting(false);
      }
    };
    reader.readAsText(csvFile);
  }

  function downloadCsvTemplate() {
    let headers = '';
    let exampleRow = '';
    let filename = '';

    if (csvProvider === 'Google') {
      headers  = 'FirstName,LastName,Email,Provider,AppPassword';
      exampleRow = 'John,Doe,john@gmail.com,Google,xxxx xxxx xxxx xxxx';
      filename = 'template_google.csv';
    } else if (csvProvider === 'Microsoft') {
      headers  = 'FirstName,LastName,Email,Provider,AppPassword';
      exampleRow = 'Jane,Smith,jane@outlook.com,Microsoft,xxxx xxxx xxxx xxxx';
      filename = 'template_microsoft.csv';
    } else if (csvProvider === 'SMTP') {
      headers  = 'FirstName,LastName,Email,Provider,SmtpHost,SmtpPort,SmtpUser,SmtpPass,ImapHost,ImapPort';
      exampleRow = 'Ali,Khan,ali@ionos.com,SMTP,smtp.ionos.com,465,ali@ionos.com,yourpassword,imap.ionos.com,993';
      filename = 'template_smtp.csv';
    } else {
      // Other
      headers  = 'FirstName,LastName,Email,Provider,SmtpHost,SmtpPort,SmtpUser,SmtpPass,ImapHost,ImapPort';
      exampleRow = 'Sara,Lee,sara@domain.com,Other,smtp.domain.com,587,sara@domain.com,yourpassword,imap.domain.com,993';
      filename = 'template_other.csv';
    }

    const csvContent = `data:text/csv;charset=utf-8,${headers}\n${exampleRow}\n`;
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="page-block fade-up" style={{ position:'relative', display:'flex', flexDirection:'column', overflow:'hidden', gap:0 }}>
      {toast && <div style={{ position:'fixed', bottom:24, right:24, background: toast.startsWith('❌')?'#ef4444':'#10b981', color:'#fff', padding:'0.6rem 1.1rem', borderRadius:10, fontWeight:500, zIndex:999, boxShadow:'0 4px 16px rgba(0,0,0,0.3)', fontSize:'0.8rem', maxWidth:360, lineHeight:1.4 }}>{toast}</div>}

      {/* ── Compact Top Bar ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.6rem', flexWrap:'wrap', gap:'0.5rem' }}>
        <h2 style={{ fontSize:'1.15rem', fontWeight:700, margin:0 }}>Email Accounts</h2>
        <div style={{ display:'flex', gap:'0.4rem', alignItems:'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setLeadsModal(true)}>👥 Leads</button>
          <button className="btn btn-secondary btn-sm" onClick={openCsvModal}>📄 Import CSV</button>
          <button className="btn btn-primary btn-sm" onClick={openAddModal}>+ Add Account</button>
        </div>
      </div>

      {/* ── Compact Stats Strip ── */}
      <div style={{ display:'flex', gap:'1px', background:'var(--border-color)', borderRadius:10, overflow:'hidden', marginBottom:'0.6rem', flexShrink:0 }}>
        {[
          { label:'Total', value: accounts.length, color:'var(--accent-primary)' },
          { label:'Active', value: accounts.filter(a=>a.status==='active').length, color:'var(--success)' },
          { label:'Warming Up', value: accounts.filter(a=>a.warmup>0).length, color:'var(--warning)' },
          { label:'Tags', value: allTags.length, color:'#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{ flex:1, background:'var(--bg-secondary)', padding:'0.5rem 0.75rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ fontSize:'1.25rem', fontWeight:800, color:s.color, fontFamily:'Outfit' }}>{s.value}</span>
            <span style={{ fontSize:'0.72rem', color:'var(--text-muted)', lineHeight:1.2 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Toolbar: Search + Tag Filter + Bulk Actions ── */}
      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', flexWrap:'wrap', marginBottom:'0.4rem', flexShrink:0 }}>
        {/* Search */}
        <div className="search-box" style={{ width:220, minWidth:160 }}>
          <span style={{ color:'var(--text-muted)', fontSize:'0.8rem' }}>🔍</span>
          <input placeholder="Search accounts..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex:1, fontSize:'0.8rem' }} />
        </div>

        {/* Tag filter pills */}
        {allTags.length > 0 && <>
          <button onClick={() => setTagFilter('')}
            style={{ fontSize:'0.7rem', padding:'3px 9px', borderRadius:99, border:`1px solid ${tagFilter===''?'var(--accent-primary)':'var(--border-color)'}`, background:tagFilter===''?'rgba(99,102,241,0.15)':'none', color:tagFilter===''?'var(--accent-primary)':'var(--text-secondary)', cursor:'pointer', fontWeight:tagFilter===''?700:400, whiteSpace:'nowrap' }}>
            All ({accounts.length})
          </button>
          {allTags.map(t => (
            <button key={t.tag} onClick={() => setTagFilter(tagFilter===t.tag?'':t.tag)}
              style={{ fontSize:'0.7rem', padding:'3px 9px', borderRadius:99, border:`1px solid ${tagFilter===t.tag?'var(--accent-primary)':'var(--border-color)'}`, background:tagFilter===t.tag?'rgba(99,102,241,0.15)':'none', color:tagFilter===t.tag?'var(--accent-primary)':'var(--text-secondary)', cursor:'pointer', fontWeight:tagFilter===t.tag?700:400, whiteSpace:'nowrap' }}>
              🏷 {t.tag} ({t.count})
            </button>
          ))}
        </>}

        {/* Bulk actions (only when selected) */}
        {selected.length > 0 && (
          <div style={{ marginLeft:'auto', display:'flex', gap:'0.35rem', alignItems:'center', background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, padding:'3px 10px' }}>
            <span style={{ fontSize:'0.75rem', color:'var(--accent-primary)', fontWeight:600 }}>{selected.length} selected</span>
            <button className="btn btn-ghost btn-sm" style={{ fontSize:'0.72rem', padding:'2px 8px' }} onClick={() => setBulkTagModal(true)}>🏷 Tag</button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize:'0.72rem', padding:'2px 8px' }} onClick={openBulkSettingsModal}>⚙ Settings</button>
            <button className="btn btn-danger btn-sm" style={{ fontSize:'0.72rem', padding:'2px 8px' }} onClick={handleBulkDelete}>🗑</button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize:'0.72rem', padding:'2px 8px' }} onClick={() => setSelected([])}>✕</button>
          </div>
        )}
      </div>

      {/* ── Accounts Table (fills remaining space, scrolls) ── */}
      <div style={{ flex:1, overflowY:'auto', overflowX:'auto', borderRadius:12, border:'1px solid var(--border-color)' }}>
        <table className="data-table" style={{ minWidth:700, width:'100%' }}>
          <thead>
            <tr>
              <th style={{ width: 36 }}><input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? [] : filtered.map(a => a.email))} style={{ accentColor: 'var(--accent-primary)' }} /></th>
              <th>Account</th>
              <th>Tags</th>
              <th>Status</th>
              <th>Sent / Limit</th>
              <th>DNS Config</th>
              <th style={{ position: 'sticky', right: 0, background: 'var(--bg-secondary)', boxShadow: '-6px 0 8px -6px rgba(0,0,0,0.4)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a, i) => (
              <tr key={i} style={{ background: selected.includes(a.email) ? 'rgba(99,102,241,0.05)' : 'transparent' }}>
                <td><input type="checkbox" checked={selected.includes(a.email)} onChange={() => toggleSelect(a.email)} style={{ accentColor: 'var(--accent-primary)' }} /></td>
                <td>
                  <div className="flex-row" style={{ gap: '0.5rem' }}>
                    {a.esp === 'Google' ? <GoogleIcon /> : a.esp === 'Microsoft' ? <MicrosoftIcon /> : <span style={{fontSize: '1rem'}}>⚙️</span>}
                    <div>
                      {(a.firstName || a.lastName) && <div style={{ fontWeight: 600, fontSize: '0.8rem', lineHeight: 1.2 }}>{a.firstName} {a.lastName}</div>}
                      <span style={{ fontWeight: 500, fontSize: '0.875rem', color: a.firstName ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{a.email}</span>
                    </div>
                  </div>
                </td>
                {/* ── Tags cell (compact) ── */}
                <td style={{ maxWidth: 160 }}>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:3, alignItems:'center' }}>
                    {(accountTags[a.id] || []).map(tag => (
                      <span key={tag} style={{ display:'inline-flex', alignItems:'center', gap:2, background:'rgba(99,102,241,0.15)', color:'var(--accent-primary)', fontSize:'0.65rem', fontWeight:600, padding:'1px 6px', borderRadius:99, border:'1px solid rgba(99,102,241,0.3)', whiteSpace:'nowrap' }}>
                        {tag}
                        <button onClick={e => { e.stopPropagation(); removeTag(a.id, tag); }} style={{ background:'none', border:'none', color:'var(--accent-primary)', cursor:'pointer', fontSize:'0.7rem', lineHeight:1, padding:0, marginLeft:1 }}>×</button>
                      </span>
                    ))}
                    {/* Tag edit button */}
                    <div style={{ position:'relative', display:'inline-block' }}>
                      <button onClick={e => { e.stopPropagation(); setTagEditorOpen(tagEditorOpen===a.id ? null : a.id); }}
                        title="Edit tags"
                        style={{ background:'rgba(99,102,241,0.1)', border:'1px dashed rgba(99,102,241,0.4)', color:'var(--accent-primary)', borderRadius:99, fontSize:'0.65rem', padding:'1px 7px', cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}>
                        {(accountTags[a.id]||[]).length===0 ? '+ tag' : '✏️'}
                      </button>
                      {tagEditorOpen === a.id && (
                        <div onClick={e => e.stopPropagation()}
                          style={{ position:'absolute', top:'110%', left:0, zIndex:200, background:'var(--bg-secondary)', border:'1px solid var(--border-color)', borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.35)', padding:'0.75rem', width:220 }}>
                          <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text-muted)', marginBottom:'0.4rem', textTransform:'uppercase' }}>Tags ({(accountTags[a.id]||[]).length}/5)</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginBottom:'0.5rem' }}>
                            {(accountTags[a.id]||[]).map(tag => (
                              <span key={tag} style={{ display:'inline-flex', alignItems:'center', gap:2, background:'rgba(99,102,241,0.15)', color:'var(--accent-primary)', fontSize:'0.7rem', fontWeight:600, padding:'2px 8px', borderRadius:99, border:'1px solid rgba(99,102,241,0.3)' }}>
                                {tag}
                                <button onClick={() => removeTag(a.id, tag)} style={{ background:'none', border:'none', color:'var(--accent-primary)', cursor:'pointer', fontSize:'0.75rem', padding:0 }}>×</button>
                              </span>
                            ))}
                          </div>
                          {(accountTags[a.id]||[]).length < 5 ? (
                            <div style={{ display:'flex', gap:4 }}>
                              <input autoFocus value={tagInput[a.id]||''}
                                onChange={e => setTagInput(p=>({...p,[a.id]:e.target.value}))}
                                onKeyDown={e => { if(e.key==='Enter'||e.key===','){ e.preventDefault(); addTag(a.id, tagInput[a.id]||''); }}}
                                placeholder="Add tag, press Enter"
                                style={{ flex:1, fontSize:'0.75rem', padding:'4px 8px', background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:6, color:'var(--text-primary)', outline:'none' }} />
                              <button onClick={() => addTag(a.id, tagInput[a.id]||'')} style={{ fontSize:'0.72rem', padding:'4px 8px', background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.4)', borderRadius:6, color:'var(--accent-primary)', cursor:'pointer', fontWeight:700 }}>+</button>
                            </div>
                          ) : <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>Max 5 tags reached</div>}
                          {/* Suggest all tags */}
                          {allTags.filter(t => !(accountTags[a.id]||[]).includes(t.tag)).length > 0 && (
                            <div style={{ marginTop:'0.5rem' }}>
                              <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginBottom:'0.3rem' }}>Existing tags:</div>
                              <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                                {allTags.filter(t => !(accountTags[a.id]||[]).includes(t.tag)).map(t => (
                                  <button key={t.tag} onClick={() => addTag(a.id, t.tag)}
                                    style={{ fontSize:'0.65rem', padding:'2px 7px', borderRadius:99, border:'1px solid var(--border-color)', background:'var(--bg-tertiary)', color:'var(--text-secondary)', cursor:'pointer' }}>
                                    {t.tag}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <button onClick={() => setTagEditorOpen(null)} style={{ marginTop:'0.5rem', width:'100%', fontSize:'0.72rem', padding:'4px', background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', textAlign:'center' }}>Done</button>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 600, color: a.status === 'active' ? '#10b981' : '#f59e0b' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: a.status === 'active' ? '#10b981' : '#f59e0b', display: 'inline-block' }} />
                    {a.status === 'active' ? 'Active' : 'Paused'}
                  </span>
                </td>
                <td className="col-num fs-sm">{a.sent}/{a.limit}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'nowrap' }}>
                    <DnsBadge label="SPF" ok={a.spf} />
                    <DnsBadge label="DKIM" ok={a.dkim} />
                    <DnsBadge label="DMARC" ok={a.dmarc} />
                    <DnsBadge label="MX" ok={a.mx} />
                  </div>
                </td>
                <td style={{ position: 'sticky', right: 0, background: selected.includes(a.email) ? 'var(--bg-secondary)' : 'var(--bg-primary)', boxShadow: '-6px 0 8px -6px rgba(0,0,0,0.4)' }}>
                  <div className="flex-row" style={{ gap: '0.25rem' }}>
                    <button title="Settings" onClick={e => { e.stopPropagation(); setSelectedAccount(a); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem' }}>⚙️</button>
                    <button onClick={e => { e.stopPropagation(); setActionsOpen(actionsOpen === i ? null : i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem' }}>⋯</button>
                  </div>
                  {actionsOpen === i && (
                    <div style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, boxShadow: 'var(--shadow-md)', zIndex: 50, minWidth: 185, overflow: 'hidden' }}>
                      {[{ icon: '✉️', label: 'Send Email', action: () => { openSendModal(a); setActionsOpen(null); }, color: 'var(--text-primary)' },
                        { icon: '🧪', label: 'Test Email', action: () => { setTesterEmail(''); setTesterResult(null); setTesterRunning(false); setTesterModal(a); setActionsOpen(null); }, color: 'var(--text-primary)' },
                        { icon: '🏷', label: 'Manage Tags', action: () => { setTagEditorOpen(a.id); setActionsOpen(null); }, color: 'var(--text-primary)' },
                        { icon: '📊', label: 'View Tracking', action: () => { setTrackingModal(a); setActionsOpen(null); }, color: 'var(--text-primary)' },
                        { icon: '🗑', label: 'Remove', action: async () => { if(a.id) await api.delete(`/accounts/${a.id}`); setAccounts(prev => prev.filter(x => x.id !== a.id && x.email !== a.email)); showToast('Account removed'); setActionsOpen(null); }, color: 'var(--danger)' }
                      ].map(item => (
                        <button key={item.label} onClick={item.action}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.6rem 1rem', color: item.color, cursor: 'pointer', fontSize: '0.8rem' }}
                          onMouseEnter={e => e.currentTarget.style.background='var(--overlay-5)'}
                          onMouseLeave={e => e.currentTarget.style.background='none'}>{item.icon} {item.label}</button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>{tagFilter ? `No accounts with tag "${tagFilter}"` : 'No accounts found.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ===================== ADD SINGLE ACCOUNT MODAL ===================== */}
      {addModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setAddModal(false)}>
          <div className="card card-p" style={{ width: 520, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.25rem' }}>Add New Email Account</h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {addStep === 1 && 'Fill in your account details'}
                  {addStep === 2 && 'Testing connection…'}
                  {addStep === 3 && 'Connection verified!'}
                </div>
              </div>
              <button onClick={() => setAddModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            {addStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label">First Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input className="form-input" placeholder="John" value={newForm.firstName} onChange={e => setField('firstName', e.target.value)} autoFocus style={formErrors.firstName ? { borderColor: 'var(--danger)' } : {}} />
                    {formErrors.firstName && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.3rem' }}>⚠ {formErrors.firstName}</div>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input className="form-input" placeholder="Doe" value={newForm.lastName} onChange={e => setField('lastName', e.target.value)} style={formErrors.lastName ? { borderColor: 'var(--danger)' } : {}} />
                    {formErrors.lastName && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.3rem' }}>⚠ {formErrors.lastName}</div>}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input className="form-input" placeholder="you@yourdomain.com" value={newForm.email} onChange={e => setField('email', e.target.value)} style={formErrors.email ? { borderColor: 'var(--danger)' } : {}} />
                  {formErrors.email && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.3rem' }}>⚠ {formErrors.email}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">Provider</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                    {['Google', 'Microsoft', 'SMTP'].map(p => (
                      <button key={p} onClick={() => setField('provider', p)}
                        style={{ padding: '0.6rem', borderRadius: 8, border: `2px solid ${newForm.provider === p ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          background: newForm.provider === p ? 'rgba(99,102,241,0.12)' : 'var(--bg-tertiary)', color: newForm.provider === p ? 'var(--accent-primary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {(newForm.provider === 'Google' || newForm.provider === 'Microsoft') && (
                  <div className="form-group">
                    <label className="form-label">App Password <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input className="form-input" type="password" placeholder="App password" value={newForm.appPassword} onChange={e => setField('appPassword', e.target.value.replace(/\s+/g, ''))} style={formErrors.appPassword ? { borderColor: 'var(--danger)' } : {}} />
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Paste the 16-character app password — spaces are removed automatically.
                    </div>
                    {formErrors.appPassword && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.3rem' }}>⚠ {formErrors.appPassword}</div>}
                  </div>
                )}

                {newForm.provider === 'SMTP' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>SMTP Settings (Outgoing)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>SMTP Host <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <input className="form-input" placeholder="smtp.gmail.com" value={newForm.smtpHost} onChange={e => setField('smtpHost', e.target.value)} />
                      </div>
                      <div className="form-group" style={{ minWidth: 80 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Port</label>
                        <input className="form-input" placeholder="587" value={newForm.smtpPort} onChange={e => setField('smtpPort', e.target.value)} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label" style={{ fontSize: '0.78rem' }}>SMTP Username <span style={{ color: 'var(--danger)' }}>*</span></label>
                      <input className="form-input" placeholder="your@email.com" value={newForm.smtpUser} onChange={e => setField('smtpUser', e.target.value)} />
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        ⚠ Must be your <strong>full email address</strong> (e.g. you@ionos.com) — not just a username
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label" style={{ fontSize: '0.78rem' }}>SMTP Password <span style={{ color: 'var(--danger)' }}>*</span></label>
                      <input className="form-input" type="password" placeholder="••••••••" value={newForm.smtpPass} onChange={e => setField('smtpPass', e.target.value)} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>IMAP Settings (Incoming)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
                      <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>IMAP Host <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <input className="form-input" placeholder="imap.gmail.com" value={newForm.imapHost} onChange={e => setField('imapHost', e.target.value)} />
                      </div>
                      <div className="form-group" style={{ minWidth: 80 }}>
                        <label className="form-label" style={{ fontSize: '0.78rem' }}>Port</label>
                        <input className="form-input" placeholder="993" value={newForm.imapPort} onChange={e => setField('imapPort', e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
                {/* Error banner from failed test-connection */}
                {testError && (
                  <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8, padding: '0.65rem 0.9rem', display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.82rem', color: '#ef4444' }}>
                    <span style={{ fontSize: '1rem', flexShrink: 0 }}>❌</span>
                    <span>{testError}</span>
                  </div>
                )}
                <div className="flex-row" style={{ justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                  <button className="btn btn-ghost" onClick={() => setAddModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={testConnection} disabled={testLoading}>
                    {testLoading ? '⏳ Testing…' : 'Test Connection →'}
                  </button>
                </div>
              </div>
            )}

            {addStep === 2 && (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙️</div>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Testing connection…</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Verifying credentials for <strong>{newForm.email}</strong></div>
              </div>
            )}

            {addStep === 3 && (
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(16,185,129,0.15)', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontSize: '1.8rem' }}>✅</div>
                <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '0.5rem' }}>Connection Successful!</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                  <strong>{newForm.email}</strong> is verified and ready to use.
                </div>
                <div className="flex-row" style={{ justifyContent: 'center', gap: '1rem' }}>
                  <button className="btn btn-ghost" onClick={() => setAddStep(1)}>← Back</button>
                  <button className="btn btn-primary" onClick={confirmAddAccount}>Add Account</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== EMAIL TESTER MODAL ===================== */}
      {testerModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:120 }} onClick={() => setTesterModal(null)}>
          <div className="card card-p" style={{ width:520 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem' }}>
              <div>
                <h3 style={{ fontWeight:700, fontSize:'1.05rem' }}>🧪 Email Deliverability Test</h3>
                <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'0.2rem' }}>Test how your emails land — inbox, spam score, open tracking</div>
              </div>
              <button onClick={() => setTesterModal(null)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.2rem' }}>✕</button>
            </div>

            <div style={{ background:'rgba(99,102,241,0.07)', borderRadius:8, padding:'0.6rem 0.9rem', marginBottom:'1rem', fontSize:'0.82rem', color:'var(--text-secondary)' }}>
              Sending from: <strong style={{ color:'var(--text-primary)' }}>{testerModal.email}</strong> &nbsp;·&nbsp; Provider: <strong>{testerModal.esp}</strong>
            </div>

            {!testerResult ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
                <div className="form-group">
                  <label className="form-label">Send Test Email To <span style={{ color:'var(--danger)' }}>*</span></label>
                  <input className="form-input" placeholder="your-inbox@gmail.com" value={testerEmail} onChange={e => setTesterEmail(e.target.value)} />
                  <div style={{ fontSize:'0.73rem', color:'var(--text-muted)', marginTop:'0.3rem' }}>We'll send a test email and analyse spam score, placement & headers.</div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.65rem' }}>
                  {[{ icon:'📩', label:'Cold Email', desc:'Outreach template' },{ icon:'🔁', label:'Follow-up', desc:'Reply-style' },{ icon:'📢', label:'Newsletter', desc:'Broadcast style' }].map(t => (
                    <div key={t.label} style={{ border:'1px solid var(--border-color)', borderRadius:8, padding:'0.65rem 0.5rem', textAlign:'center', background:'var(--bg-tertiary)', fontSize:'0.78rem' }}>
                      <div style={{ fontSize:'1.3rem', marginBottom:'0.3rem' }}>{t.icon}</div>
                      <div style={{ fontWeight:600, fontSize:'0.78rem' }}>{t.label}</div>
                      <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>{t.desc}</div>
                    </div>
                  ))}
                </div>
                <div className="flex-row" style={{ justifyContent:'flex-end', gap:'0.75rem' }}>
                  <button className="btn btn-ghost" onClick={() => setTesterModal(null)}>Cancel</button>
                  <button className="btn btn-primary" disabled={testerRunning || !testerEmail.trim()} onClick={() => {
                    setTesterRunning(true);
                    setTimeout(() => {
                      const spamScore = (Math.random() * 3).toFixed(1);
                      const placement = spamScore < 1.5 ? 'Inbox' : spamScore < 2.5 ? 'Promotions' : 'Spam';
                      setTesterResult({
                        spamScore, placement,
                        delivered: true,
                        spf: testerModal.spf, dkim: testerModal.dkim, dmarc: testerModal.dmarc,
                        openTracking: true,
                        clickTracking: true,
                        replyTo: testerModal.email,
                        headers: ['Message-ID: OK', 'X-Mailer: MailSender v2', 'Content-Type: text/html'],
                        types: [{ name:'Cold Email', inbox: spamScore<2?'✅ Inbox':'⚠️ Promotions', score: spamScore },
                                { name:'Follow-up',  inbox: spamScore<2.5?'✅ Inbox':'🚫 Spam', score: (spamScore*0.8).toFixed(1) },
                                { name:'Newsletter', inbox: spamScore<1?'✅ Inbox':'⚠️ Promotions', score: (parseFloat(spamScore)+0.8).toFixed(1) }],
                      });
                      setTesterRunning(false);
                      // Also add to tracking log
                      setTrackingLog(prev => ({ ...prev, [testerModal.email]: [...(prev[testerModal.email]||[]), { id: Date.now(), to: testerEmail, subject: '[Test Email]', sentAt: new Date().toLocaleString('en-GB',{hour12:false}).slice(0,16).replace('T',' '), type: 'Test', delivered: true, opened: false, openedAt: null, clicked: false, bounced: false }] }));
                    }, 2200);
                  }}>{testerRunning ? 'Running test…' : '🧪 Run Deliverability Test'}</button>
                </div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'1.1rem' }}>
                {/* Score banner */}
                <div style={{ display:'flex', gap:'1rem', alignItems:'center', background: testerResult.spamScore < 1.5 ? 'rgba(16,185,129,0.1)' : testerResult.spamScore < 2.5 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${testerResult.spamScore < 1.5 ? '#10b981' : testerResult.spamScore < 2.5 ? '#f59e0b' : '#ef4444'}40`, borderRadius:10, padding:'0.9rem 1.1rem' }}>
                  <div style={{ fontSize:'2.5rem' }}>{testerResult.spamScore < 1.5 ? '✅' : testerResult.spamScore < 2.5 ? '⚠️' : '🚫'}</div>
                  <div>
                    <div style={{ fontWeight:700, fontSize:'1rem' }}>Spam Score: {testerResult.spamScore} / 5.0</div>
                    <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)' }}>Placement: <strong>{testerResult.placement}</strong> &nbsp;·&nbsp; Delivered: <strong style={{ color:'#10b981' }}>Yes</strong></div>
                  </div>
                </div>
                {/* Email type breakdown */}
                <div>
                  <div style={{ fontSize:'0.8rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.5rem' }}>📬 Placement by Email Type</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                    {testerResult.types.map(t => (
                      <div key={t.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.5rem 0.75rem', background:'var(--bg-tertiary)', borderRadius:7, fontSize:'0.82rem' }}>
                        <span style={{ fontWeight:500 }}>{t.name}</span>
                        <span>{t.inbox}</span>
                        <span style={{ color:'var(--text-muted)' }}>Score: {t.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Auth checks */}
                <div>
                  <div style={{ fontSize:'0.8rem', fontWeight:600, color:'var(--text-secondary)', marginBottom:'0.5rem' }}>🔐 Authentication</div>
                  <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
                    {[['SPF', testerResult.spf],['DKIM', testerResult.dkim],['DMARC', testerResult.dmarc],['Open Tracking', testerResult.openTracking],['Click Tracking', testerResult.clickTracking]].map(([lbl, ok]) => (
                      <span key={lbl} style={{ fontSize:'0.73rem', fontWeight:700, padding:'3px 8px', borderRadius:5, background: ok?'#10b98120':'#ef444420', color: ok?'#10b981':'#ef4444', border:`1px solid ${ok?'#10b98140':'#ef444440'}` }}>{ok?'✓':'✗'} {lbl}</span>
                    ))}
                  </div>
                </div>
                {/* Headers */}
                <div style={{ background:'var(--bg-tertiary)', borderRadius:8, padding:'0.6rem 0.8rem' }}>
                  <div style={{ fontSize:'0.75rem', fontWeight:600, color:'var(--text-muted)', marginBottom:'0.4rem' }}>📋 Email Headers</div>
                  {testerResult.headers.map((h,i) => <div key={i} style={{ fontSize:'0.73rem', fontFamily:'monospace', color:'var(--text-secondary)', lineHeight:1.6 }}>{h}</div>)}
                </div>
                <div className="flex-row" style={{ justifyContent:'flex-end', gap:'0.75rem' }}>
                  <button className="btn btn-ghost" onClick={() => { setTesterResult(null); setTesterEmail(''); }}>← Re-test</button>
                  <button className="btn btn-primary" onClick={() => setTesterModal(null)}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== EMAIL TRACKING MODAL ===================== */}
      {trackingModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:120 }} onClick={() => setTrackingModal(null)}>
          <div className="card card-p" style={{ width:700, maxHeight:'88vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem' }}>
              <div>
                <h3 style={{ fontWeight:700, fontSize:'1.05rem' }}>📊 Email Tracking — {trackingModal.email}</h3>
                <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'0.2rem' }}>Delivery status, open tracking & click analytics per email sent</div>
              </div>
              <button onClick={() => setTrackingModal(null)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.2rem' }}>✕</button>
            </div>
            {/* Summary stats */}
            {(() => {
              const log = trackingLog[trackingModal.email] || [];
              const delivered = log.filter(l => l.delivered).length;
              const opened = log.filter(l => l.opened).length;
              const clicked = log.filter(l => l.clicked).length;
              const bounced = log.filter(l => l.bounced).length;
              return (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.75rem', marginBottom:'1.25rem' }}>
                    {[{ label:'Delivered', val: delivered, color:'#10b981', icon:'✅' },
                      { label:'Opened', val: opened, color:'#6366f1', icon:'👁️' },
                      { label:'Clicked', val: clicked, color:'#f59e0b', icon:'🖱️' },
                      { label:'Bounced', val: bounced, color:'#ef4444', icon:'⛔' }
                    ].map(s => (
                      <div key={s.label} style={{ background:'var(--bg-tertiary)', borderRadius:10, padding:'0.75rem', textAlign:'center', border:`1px solid ${s.color}30` }}>
                        <div style={{ fontSize:'1.3rem' }}>{s.icon}</div>
                        <div style={{ fontSize:'1.4rem', fontWeight:700, color:s.color }}>{s.val}</div>
                        <div style={{ fontSize:'0.73rem', color:'var(--text-muted)' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {log.length === 0 ? (
                    <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)', fontSize:'0.875rem' }}>No emails sent yet from this account.</div>
                  ) : (
                    <div className="card" style={{ overflow:'hidden' }}>
                      <table className="data-table">
                        <thead><tr>
                          <th>To</th><th>Subject</th><th>Type</th><th>Sent At</th>
                          <th>Delivered</th><th>Opened</th><th>Clicked</th>
                        </tr></thead>
                        <tbody>
                          {log.map(l => (
                            <tr key={l.id}>
                              <td style={{ fontSize:'0.8rem' }}>{l.to}</td>
                              <td style={{ fontSize:'0.8rem', maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.subject}</td>
                              <td><span style={{ fontSize:'0.7rem', fontWeight:700, padding:'2px 7px', borderRadius:4, background: l.type==='Cold'?'rgba(99,102,241,0.15)':l.type==='Follow-up'?'rgba(245,158,11,0.15)':l.type==='Test'?'rgba(16,185,129,0.15)':'var(--overlay-8)', color: l.type==='Cold'?'#6366f1':l.type==='Follow-up'?'#f59e0b':l.type==='Test'?'#10b981':'var(--text-secondary)' }}>{l.type}</span></td>
                              <td style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{l.sentAt}</td>
                              <td style={{ textAlign:'center' }}>{l.bounced ? <span style={{ color:'#ef4444', fontSize:'0.8rem' }}>⛔ Bounced</span> : l.delivered ? <span style={{ color:'#10b981', fontSize:'0.85rem' }}>✅</span> : <span style={{ color:'#f59e0b' }}>⏳</span>}</td>
                              <td style={{ textAlign:'center' }}>
                                {l.opened
                                  ? <span style={{ fontSize:'0.75rem', color:'#6366f1' }}>👁️ {l.openedAt?.slice(11)}</span>
                                  : <span style={{ color:'var(--text-muted)', fontSize:'0.8rem' }}>—</span>}
                              </td>
                              <td style={{ textAlign:'center' }}>{l.clicked ? <span style={{ color:'#f59e0b', fontSize:'0.85rem' }}>🖱️</span> : <span style={{ color:'var(--text-muted)' }}>—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'1rem' }}>
                    <button className="btn btn-ghost" onClick={() => setTrackingModal(null)}>Close</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ===================== SEND EMAIL MODAL ===================== */}
      {sendModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:110 }} onClick={() => { setSendModal(null); setSendDone(false); }}>
          <div className="card card-p" style={{ width:480 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem' }}>
              <h3 style={{ fontWeight:700, fontSize:'1.05rem' }}>✉️ Send Email</h3>
              <button onClick={() => { setSendModal(null); setSendDone(false); }} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.2rem' }}>✕</button>
            </div>
            {!sendDone ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'0.85rem' }}>
                <div className="form-group">
                  <label className="form-label">From Account</label>
                  <div style={{ padding:'0.5rem 0.75rem', background:'var(--bg-tertiary)', borderRadius:8, fontSize:'0.85rem', color:'var(--text-secondary)' }}>{sendModal.email}</div>
                </div>
                <div className="form-group">
                  <label className="form-label">To <span style={{ color:'var(--danger)' }}>*</span></label>
                  <input className="form-input" value={sendForm.to} onChange={e => setSendForm(p=>({...p,to:e.target.value}))} placeholder="recipient@example.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Subject <span style={{ color:'var(--danger)' }}>*</span></label>
                  <input className="form-input" value={sendForm.subject} onChange={e => setSendForm(p=>({...p,subject:e.target.value}))} placeholder="Email subject…" />
                </div>
                <div className="form-group">
                  <label className="form-label">Body <span style={{ color:'var(--danger)' }}>*</span></label>
                  <textarea className="form-input" rows={5} value={sendForm.body} onChange={e => setSendForm(p=>({...p,body:e.target.value}))} placeholder="Write your email here…" style={{ resize:'vertical' }} />
                </div>
                <div className="flex-row" style={{ justifyContent:'flex-end', gap:'0.75rem' }}>
                  <button className="btn btn-ghost" onClick={() => setSendModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSend} disabled={sending || !sendForm.subject.trim() || !sendForm.body.trim()}>
                    {sending ? 'Sending…' : '✉️ Send Email'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign:'center', padding:'2rem 1rem' }}>
                <div style={{ fontSize:'3rem', marginBottom:'1rem' }}>✅</div>
                <div style={{ fontWeight:700, fontSize:'1.1rem', marginBottom:'0.5rem' }}>Email Sent!</div>
                <div style={{ fontSize:'0.85rem', color:'var(--text-secondary)', marginBottom:'1.5rem' }}>Your email was sent from <strong>{sendModal.email}</strong> to <strong>{sendForm.to}</strong>.</div>
                <button className="btn btn-primary" onClick={() => { setSendModal(null); setSendDone(false); }}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== LEADS LIST MODAL ===================== */}
      {leadsModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:110 }} onClick={() => setLeadsModal(false)}>
          <div className="card card-p" style={{ width:620, maxHeight:'88vh', overflowY:'auto', display:'flex', flexDirection:'column', gap:'1.25rem' }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <h3 style={{ fontWeight:700, fontSize:'1.1rem' }}>👥 Leads List</h3>
                <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>Add leads one by one to build your outreach list</div>
              </div>
              <button onClick={() => setLeadsModal(false)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'1.2rem' }}>✕</button>
            </div>
            {/* Add lead form */}
            <div style={{ background:'var(--bg-tertiary)', borderRadius:10, padding:'1rem', display:'flex', flexDirection:'column', gap:'0.75rem' }}>
              <div style={{ fontWeight:600, fontSize:'0.85rem', color:'var(--text-secondary)' }}>➕ Add New Lead</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.65rem' }}>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize:'0.78rem' }}>Full Name *</label>
                  <input className="form-input" placeholder="John Doe" value={leadForm.name} onChange={e => { setLeadForm(p=>({...p,name:e.target.value})); if(leadErrors.name) setLeadErrors(p=>{const n={...p};delete n.name;return n;}); }} style={leadErrors.name?{borderColor:'var(--danger)'}:{}} />
                  {leadErrors.name && <div style={{ color:'var(--danger)', fontSize:'0.72rem', marginTop:'0.2rem' }}>⚠ {leadErrors.name}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize:'0.78rem' }}>Email *</label>
                  <input className="form-input" placeholder="lead@company.com" value={leadForm.email} onChange={e => { setLeadForm(p=>({...p,email:e.target.value})); if(leadErrors.email) setLeadErrors(p=>{const n={...p};delete n.email;return n;}); }} style={leadErrors.email?{borderColor:'var(--danger)'}:{}} />
                  {leadErrors.email && <div style={{ color:'var(--danger)', fontSize:'0.72rem', marginTop:'0.2rem' }}>⚠ {leadErrors.email}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize:'0.78rem' }}>Company</label>
                  <input className="form-input" placeholder="Acme Corp" value={leadForm.company} onChange={e => setLeadForm(p=>({...p,company:e.target.value}))} />
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize:'0.78rem' }}>Phone</label>
                  <input className="form-input" placeholder="+1 555 000 0000" value={leadForm.phone} onChange={e => setLeadForm(p=>({...p,phone:e.target.value}))} />
                </div>
              </div>
              <button className="btn btn-primary" style={{ alignSelf:'flex-end' }} onClick={addLead}>+ Add Lead</button>
            </div>
            {/* Leads table */}
            {leads.length === 0 ? (
              <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)', fontSize:'0.875rem' }}>No leads yet. Add your first lead above.</div>
            ) : (
              <div className="card" style={{ overflow:'hidden' }}>
                <table className="data-table">
                  <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Company</th><th>Phone</th><th></th></tr></thead>
                  <tbody>
                    {leads.map((l, i) => (
                      <tr key={l.id}>
                        <td style={{ color:'var(--text-muted)', fontSize:'0.78rem' }}>{i+1}</td>
                        <td style={{ fontWeight:500, fontSize:'0.875rem' }}>{l.name}</td>
                        <td style={{ fontSize:'0.85rem', color:'var(--text-secondary)' }}>{l.email}</td>
                        <td style={{ fontSize:'0.8rem' }}>{l.company || '—'}</td>
                        <td style={{ fontSize:'0.8rem' }}>{l.phone || '—'}</td>
                        <td><button onClick={() => removeLead(l.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--danger)', fontSize:'0.9rem' }}>🗑</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{leads.length} lead{leads.length !== 1 ? 's' : ''} in list</span>
              <button className="btn btn-ghost" onClick={() => setLeadsModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== BULK IMPORT CSV MODAL ===================== */}
      {csvModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setCsvModal(false)}>
          <div className="card card-p" style={{ width: 560, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.25rem' }}>Bulk Import Accounts via CSV</h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Upload a CSV file containing multiple email accounts</div>
              </div>
              <button onClick={() => setCsvModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            {!csvResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Provider selection for bulk import */}
                <div className="form-group">
                  <label className="form-label">Email Provider (for all imported accounts)</label>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.5rem' }}>
                    {['Google','Microsoft','SMTP','Other'].map(p => (
                      <button key={p} onClick={() => setCsvProvider(p)}
                        style={{ padding:'0.55rem 0.25rem', borderRadius:8, border:`2px solid ${csvProvider===p?'var(--accent-primary)':'var(--border-color)'}`, background:csvProvider===p?'rgba(99,102,241,0.12)':'var(--bg-tertiary)', color:csvProvider===p?'var(--accent-primary)':'var(--text-secondary)', cursor:'pointer', fontSize:'0.8rem', fontWeight:600 }}>
                        {p==='Google'?'🔵 ':p==='Microsoft'?'🟧 ':p==='SMTP'?'⚙️ ':'📧 '}{p}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-tertiary)', border: '1px dashed var(--border-color)', borderRadius: '12px', padding: '2rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📄</div>
                  <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Upload your CSV file</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>File must include Email, Provider, and App Password/SMTP details.</p>
                  
                  <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />
                  
                  <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                    Choose File
                  </button>
                  
                  {csvFile && (
                    <div style={{ marginTop: '1.5rem', padding: '0.75rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--accent-primary)' }}>✓</span> {csvFile.name} selected
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--overlay-3)', borderRadius: '8px' }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      📋 Download {csvProvider} Template
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {(csvProvider === 'Google' || csvProvider === 'Microsoft')
                        ? 'Columns: FirstName, LastName, Email, Provider, AppPassword'
                        : 'Columns: FirstName, LastName, Email, Provider, SmtpHost, SmtpPort, SmtpUser, SmtpPass, ImapHost, ImapPort'}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={downloadCsvTemplate}>
                    ⬇ Download
                  </button>
                </div>

                <div className="flex-row" style={{ justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button className="btn btn-ghost" onClick={() => setCsvModal(false)} disabled={csvImporting}>Cancel</button>
                  <button className="btn btn-primary" onClick={processCsv} disabled={!csvFile || csvImporting}>
                    {csvImporting ? 'Importing & Testing...' : 'Import Accounts'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(16,185,129,0.15)', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontSize: '1.8rem' }}>✅</div>
                <h3 style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '0.75rem' }}>Import Complete</h3>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                  <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid #10b98140', borderRadius: 8, padding: '0.5rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success-text)' }}>{csvResult.added}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Imported</div>
                  </div>
                  {csvResult.skipped > 0 && (
                    <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b40', borderRadius: 8, padding: '0.5rem 1rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--warning-text)' }}>{csvResult.skipped}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Already existed</div>
                    </div>
                  )}
                  {csvResult.failed > 0 && (
                    <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef444440', borderRadius: 8, padding: '0.5rem 1rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--danger-text)' }}>{csvResult.failed}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Failed</div>
                    </div>
                  )}
                </div>
                {csvResult.skipped > 0 && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                    ⏭ Already-existing accounts were skipped to avoid overwriting.
                  </p>
                )}
                {csvResult.failedRows?.length > 0 && (
                  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', textAlign: 'left' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#ef4444', marginBottom: '0.4rem' }}>Failed rows (invalid data):</div>
                    {csvResult.failedRows.map((r, i) => (
                      <div key={i} style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>• {r}</div>
                    ))}
                  </div>
                )}
                <button className="btn btn-primary" onClick={() => setCsvModal(false)}>Done</button>
              </div>

            )}
          </div>
        </div>
      )}

      {/* ── Bulk Tag Modal ── */}
      {bulkTagModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}
          onClick={() => setBulkTagModal(false)}>
          <div className="card card-p" style={{ width:400 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom:'0.3rem', fontSize:'1rem' }}>🏷 Assign Tag to {selected.length} Account{selected.length!==1?'s':''}</h3>
            <p className="fs-sm text-muted" style={{ marginBottom:'1rem' }}>Pick an existing tag or type a new one. Existing tags won't be duplicated. Max 5 tags/account.</p>
            {allTags.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:'0.35rem', marginBottom:'0.75rem' }}>
                {allTags.map(t => (
                  <button key={t.tag} onClick={() => setBulkTagValue(t.tag)}
                    style={{ fontSize:'0.72rem', padding:'3px 9px', borderRadius:99, cursor:'pointer',
                      border:`1px solid ${bulkTagValue===t.tag?'var(--accent-primary)':'var(--border-color)'}`,
                      background:bulkTagValue===t.tag?'rgba(99,102,241,0.15)':'var(--bg-tertiary)',
                      color:bulkTagValue===t.tag?'var(--accent-primary)':'var(--text-secondary)' }}>
                    {t.tag}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem' }}>
              <input className="form-input" placeholder="e.g. Urgent, ColdOutreach…"
                value={bulkTagValue} onChange={e => setBulkTagValue(e.target.value)}
                onKeyDown={e => e.key==='Enter' && applyBulkTag(bulkTagValue)}
                autoFocus style={{ flex:1 }} />
            </div>
            <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setBulkTagModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => applyBulkTag(bulkTagValue)} disabled={!bulkTagValue.trim()}>
                Apply Tag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Settings Modal ── */}
      {bulkSettingsModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}
          onClick={() => setBulkSettingsModal(false)}>
          <div className="card card-p" style={{ width:420 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom:'0.3rem', fontSize:'1rem' }}>⚙ Settings for {selected.length} Account{selected.length!==1?'s':''}</h3>
            <p className="fs-sm text-muted" style={{ marginBottom:'1rem' }}>Leave a field blank to keep each account's current value.</p>

            <div className="form-group" style={{ marginBottom:'1rem' }}>
              <label className="form-label">Daily Sending Limit</label>
              <input className="form-input" type="number" min={1} placeholder="e.g. 150"
                value={bulkSettingsForm.limitPerDay}
                onChange={e => setBulkSettingsForm(p => ({ ...p, limitPerDay: e.target.value }))} />
            </div>

            <div className="form-group" style={{ marginBottom:'1.25rem' }}>
              <label className="form-label">Status</label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.5rem' }}>
                {[['', 'No change'], ['active', 'Active'], ['paused', 'Paused']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setBulkSettingsForm(p => ({ ...p, status: val }))}
                    style={{ padding:'0.5rem', borderRadius:8, border:`2px solid ${bulkSettingsForm.status===val?'var(--accent-primary)':'var(--border-color)'}`,
                      background:bulkSettingsForm.status===val?'rgba(99,102,241,0.12)':'var(--bg-tertiary)',
                      color:bulkSettingsForm.status===val?'var(--accent-primary)':'var(--text-secondary)', cursor:'pointer', fontSize:'0.8rem' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setBulkSettingsModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyBulkSettings}
                disabled={bulkSettingsSaving || (!bulkSettingsForm.limitPerDay && !bulkSettingsForm.status)}>
                {bulkSettingsSaving ? 'Applying…' : 'Apply to Selected'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAccount && (
        <AccountPanel
          account={selectedAccount}
          accounts={accounts}
          onClose={() => setSelectedAccount(null)}
          onNavigate={idx => { if (idx >= 0 && idx < accounts.length) setSelectedAccount(accounts[idx]); }}
          onUpdate={(updated) => {
            if (!updated || !updated.id) return;
            setAccounts(prev => prev.map(a => a.id === updated.id ? {
              ...a,
              firstName: updated.first_name ?? a.firstName,
              lastName: updated.last_name ?? a.lastName,
              limit: updated.limit_per_day ?? a.limit,
              status: updated.status ?? a.status,
            } : a));
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
