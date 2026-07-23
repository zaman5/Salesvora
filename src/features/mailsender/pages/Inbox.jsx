import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { setUnreadCount, publishUnread } from '../store/inboxStore';
import RichEditor from '../components/RichEditor';

// ── Module-level cache: survives React re-renders and navigation ──────────────
// Structure: { emails: [], accounts: [], newestDate: ISO|null, syncedAt: Date|null }
const inboxCache = {};
function getCached(folder) { return inboxCache[folder] || null; }
function setCache(folder, data) { inboxCache[folder] = data; }
function bustCache(folder) { delete inboxCache[folder]; }

// ── Body cache: avoids re-fetching email body on every open ───────────────────
const bodyCache = new Map(); // emailId -> body string

// ── Exported: called on logout / user switch to prevent cross-user data leak ──
export function clearInboxCache() {
  Object.keys(inboxCache).forEach(k => delete inboxCache[k]);
  bodyCache.clear();
}

/* ── Tag detection ── */
const TAG_COLORS = { 'Auto Reply': '#6366f130', 'Out of Office': '#f59e0b30', 'Replied': '#10b98130', 'Spam': '#ef444430' };
const TAG_TEXT   = { 'Auto Reply': '#a78bfa',   'Out of Office': '#f59e0b',  'Replied': '#10b981',   'Spam': '#ef4444' };

function detectTags(subject = '', body = '') {
  const s = `${subject} ${body}`.toLowerCase();
  if (s.includes('automatic reply') || s.includes('auto reply') || s.includes('autoreply')) return ['Auto Reply'];
  if (s.includes('out of office') || s.includes('ooo ') || s.includes('away from office'))  return ['Out of Office'];
  return [];
}

function getInitials(name = '', email = '') {
  const src = name.trim() || email.split('@')[0];
  const parts = src.split(/[\s._-]+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : src.slice(0, 2).toUpperCase();
}
function getColor(s = '') {
  const palette = ['#6366f1','#10b981','#f59e0b','#ec4899','#8b5cf6','#14b8a6','#f97316','#06b6d4'];
  let h = 0;
  for (const c of s) h = ((h * 31) + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

const FOLDERS = [
  { key: 'inbox',   label: 'Inbox',       icon: '📥' },
  { key: 'spam',    label: 'Spam / Junk', icon: '🚫' },
  { key: 'sent',    label: 'Sent',        icon: '📤' },
  { key: 'starred', label: 'Starred',     icon: '⭐' },
];

// Strip Re:/Fwd: prefixes for thread grouping
function normalizeSubject(s = '') {
  return s.replace(/^(Re:|RE:|Fwd:|FW:|Fw:)\s*/gi, '').trim().toLowerCase();
}

function isHtmlEmpty(html) {
  if (!html) return true;
  const clean = html.replace(/<[^>]*>/g, '').trim();
  return clean.length === 0;
}

const AutoHeightIframe = ({ html }) => {
  const iframeRef = useRef(null);

  const handleLoad = () => {
    const iframe = iframeRef.current;
    if (iframe && iframe.contentWindow) {
      try {
        // Wait briefly for images/layouts inside iframe to calculate
        setTimeout(() => {
          const body = iframe.contentWindow.document.body;
          if (body) {
            iframe.style.height = `${body.scrollHeight + 25}px`;
          }
        }, 100);
      } catch (e) {
        // Handle cross-origin access security
      }
    }
  };

  useEffect(() => {
    handleLoad();
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      onLoad={handleLoad}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      style={{
        width: '100%',
        minHeight: '220px',
        border: 'none',
        borderRadius: 8,
        background: '#fff',
        transition: 'height 0.2s ease',
        display: 'block'
      }}
      title="Email Body"
    />
  );
};

export default function Inbox({ userId }) {
  const [folder, setFolder]       = useState('inbox');
  const [emails, setEmails]       = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [newestEmailDate, setNewestEmailDate] = useState(null);
  const [lastSyncedAt, setLastSyncedAt]       = useState(null);
  const [active, setActive]       = useState(null);
  const [replies, setReplies]     = useState({});
  const [replyText, setReplyText] = useState('');
  const [sending, setSending]     = useState(false);
  const [searchMail, setSearchMail] = useState('');
  const [showUnread, setShowUnread] = useState(false);
  const [filterAcc, setFilterAcc] = useState('all');
  const [toast, setToast]         = useState('');
  const [threadEmails, setThreadEmails] = useState([]);
  const [midWidth, setMidWidth]   = useState(320);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [showReply, setShowReply]   = useState(false);
  const [expandedMsgIds, setExpandedMsgIds] = useState(new Set());
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeForm, setComposeForm] = useState({ accountId: '', to: '', subject: '', body: '' });
  const [composeSending, setComposeSending] = useState(false);
  const autoRefreshRef  = useRef(null);
  const newestDateRef   = useRef(null);
  const dragRef         = useRef(null);
  const currentUserRef  = useRef(userId);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2600); }

  async function sendCompose() {
    if (!composeForm.accountId || !composeForm.to || !composeForm.subject || !composeForm.body) {
      showToast('Please fill all fields');
      return;
    }
    setComposeSending(true);
    const res = await api.post('/inbox/send', {
      accountId: composeForm.accountId,
      toEmail: composeForm.to,
      subject: composeForm.subject,
      body: composeForm.body
    });
    setComposeSending(false);
    if (res?.success) {
      showToast('✅ Email sent successfully!');
      setComposeOpen(false);
      setComposeForm({ accountId: '', to: '', subject: '', body: '' });
      bustCache('sent');
      if (folder === 'sent') refreshEmails('sent');
    } else {
      showToast('❌ ' + (res?.error || 'Failed to send email'));
    }
  }

  // ── Clear ALL caches when user switches (prevents cross-user data leaks) ──
  useEffect(() => {
    if (currentUserRef.current !== userId) {
      currentUserRef.current = userId;
      clearInboxCache();
      setEmails([]);
      setAccounts([]);
      setActive(null);
      setThreadEmails([]);
      setFolder('inbox');
      setSearchMail('');
      setNewestEmailDate(null);
    }
  }, [userId]);

  // Keep ref in sync so interval always has the live cursor
  useEffect(() => { newestDateRef.current = newestEmailDate; }, [newestEmailDate]);

  /* ── Incremental merge helper ── */
  function mergeNew(prev, newEmails) {
    const existingIds = new Set(prev.map(e => e.id));
    const fresh = newEmails.filter(e => !existingIds.has(e.id));
    return fresh.length === 0 ? prev : [...fresh, ...prev];
  }

  /* ── Background incremental fetch (no loading spinner) ── */
  const incrementalFetch = useCallback(async (f, cursor) => {
    if (!cursor) return;
    setSyncing(true);
    const res = await api.get(`/inbox?folder=${f}&since=${encodeURIComponent(cursor)}`);
    setSyncing(false);
    const now = new Date();
    if (res && !res.error) {
      const newEmails = res.emails || [];
      if (newEmails.length > 0) {
        setEmails(prev => {
          const merged = mergeNew(prev, newEmails);
          const newest = merged[0]?.dateRaw || cursor;
          setNewestEmailDate(newest);
          newestDateRef.current = newest;
          // Preserve existing accounts if incremental response omits them
          setAccounts(prev => (res.accounts?.length ? res.accounts : prev));
          setCache(f, { emails: merged, accounts: res.accounts?.length ? res.accounts : (getCached(f)?.accounts || []), newestDate: newest, syncedAt: now });
          return merged;
        });

        // Only show toast notification if new unread emails arrived
        const unreadFresh = newEmails.filter(e => e.unread);
        if (unreadFresh.length > 0) {
          showToast(`✅ ${unreadFresh.length} new unread email${unreadFresh.length > 1 ? 's' : ''} arrived`);
        }
      }
      setLastSyncedAt(now);
    }
  }, []);

  /* ── Full fetch from API (first visit to a folder, no cache) ── */
  const fullFetch = useCallback(async (f) => {
    setLoading(true);
    const res = await api.get(`/inbox?folder=${f}`);
    setLoading(false);
    if (res && !res.error) {
      const fetched = res.emails || [];
      const accs    = res.accounts || [];
      const newest  = fetched[0]?.dateRaw || null;
      const now     = new Date();
      setEmails(fetched);
      setAccounts(accs);
      setNewestEmailDate(newest);
      setLastSyncedAt(now);
      setCache(f, { emails: fetched, accounts: accs, newestDate: newest, syncedAt: now });
    } else {
      showToast('❌ ' + (res?.error || 'Failed to load emails'));
      setEmails([]);
    }
  }, []);

  /* ── Manual refresh button: force full re-sync from IMAP ── */
  const refreshEmails = useCallback(async (f = folder) => {
    setSyncing(true);
    bustCache(f);
    const res = await api.get(`/inbox?folder=${f}&force=true`);
    setSyncing(false);
    if (res && !res.error) {
      const fetched = res.emails || [];
      const accs    = res.accounts || [];
      const newest  = fetched[0]?.dateRaw || null;
      const now     = new Date();
      setEmails(fetched);
      setAccounts(accs);
      setNewestEmailDate(newest);
      setLastSyncedAt(now);
      setCache(f, { emails: fetched, accounts: accs, newestDate: newest, syncedAt: now });
      showToast(`✅ Refreshed — ${fetched.length} emails`);
    } else {
      showToast('❌ ' + (res?.error || 'Refresh failed'));
    }
  }, [folder]);


  /* ── On folder switch: show cache instantly, then incremental sync ── */
  useEffect(() => {
    setActive(null);
    setMobileShowDetail(false);
    const cached = getCached(folder);
    if (cached) {
      // Restore cache immediately — no API call, no spinner
      setEmails(cached.emails);
      setAccounts(cached.accounts);
      setNewestEmailDate(cached.newestDate);
      setLastSyncedAt(cached.syncedAt);
      // Then silently fetch only new emails since last cursor
      incrementalFetch(folder, cached.newestDate);
    } else {
      setEmails([]);
      setNewestEmailDate(null);
      setLastSyncedAt(null);
      fullFetch(folder);
    }

    // ── Auto-refresh every 60 s — re-fetch from server DB cache ──────────────
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    autoRefreshRef.current = setInterval(async () => {
      setSyncing(true);
      const res = await api.get(`/inbox?folder=${folder}`);
      setSyncing(false);
      if (res && !res.error && res.emails?.length) {
        setEmails(prev => {
          const existingIds = new Set(prev.map(e => e.id));
          const fresh = (res.emails || []).filter(e => !existingIds.has(e.id));
          if (fresh.length === 0) return prev;

          // Only alert when unread emails arrive
          const unreadFresh = fresh.filter(e => e.unread);
          if (unreadFresh.length > 0) {
            showToast(`✅ ${unreadFresh.length} new unread email${unreadFresh.length > 1 ? 's' : ''} arrived`);
          }

          const merged = [...fresh, ...prev];
          const newest = merged[0]?.dateRaw || null;
          setNewestEmailDate(newest);
          setCache(folder, { emails: merged, accounts: res.accounts || [], newestDate: newest, syncedAt: new Date() });
          return merged;
        });
        if (res.accounts?.length) setAccounts(res.accounts);
        setLastSyncedAt(new Date());
      }
    }, 60_000); // 1 minute

    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [folder]);


  /* ── Open a thread (all messages with same subject+account) ── */
  async function openThread(thread) {
    const { latest, all } = thread;
    const sorted = [...all].sort((a, b) => new Date(b.dateRaw) - new Date(a.dateRaw));
    setActive({ ...latest, unread: false, bodyLoading: !latest.body });
    // Auto-expand only the first (newest) message
    setExpandedMsgIds(new Set([sorted[0]?.id]));
    setShowReply(false);
    setShowAllMessages(false);
    // Only use bodyCache entry if it's non-empty
    setThreadEmails(sorted.map(e => {
      const cached = bodyCache.get(e.id);
      const body = (cached && cached.trim()) ? cached : (e.body && e.body.trim() ? e.body : null);
      return { ...e, body, bodyLoading: !body };
    }));
    setReplyText('');

    // Mark all unread in thread as read
    for (const email of all) {
      if (email.unread) {
        setEmails(prev => prev.map(e => e.id === email.id ? { ...e, unread: false } : e));
        api.post('/inbox/mark-read', { accountId: email.accountId, uid: email.uid, folder: email.folder || 'INBOX' });
      }
    }
    const f = folder;
    const c = getCached(f);
    if (c) {
      const ids = new Set(all.map(e => e.id));
      setCache(f, { ...c, emails: c.emails.map(e => ids.has(e.id) ? { ...e, unread: false } : e) });
    }

    // Fetch bodies for all thread messages (latest first for speed)
    const toFetch = [...all].sort((a, b) => new Date(b.dateRaw) - new Date(a.dateRaw));
    for (const email of toFetch) {
      const cached = bodyCache.get(email.id);
      const alreadyHasBody = cached && cached.trim().length > 0;
      const dbHasBody = email.body && email.body.trim().length > 0;
      if (!alreadyHasBody && !dbHasBody) {
        // Clear stale empty entry so fresh fetch is stored
        bodyCache.delete(email.id);
        api.get(`/inbox/message/${email.accountId}/${email.uid}?folder=${encodeURIComponent(email.folder || 'INBOX')}`)
          .then(res => {
            if (res && !res.error) {
              const body = (res.body || '').trim();
              const subject = res.subject;
              // Only cache if body has real content
              if (body) bodyCache.set(email.id, body);
              setEmails(prev => prev.map(e => e.id === email.id ? { ...e, body: body || null, ...(subject ? { subject } : {}) } : e));
              setThreadEmails(prev => prev.map(e => e.id === email.id ? { ...e, body: body || null, bodyLoading: false, ...(subject ? { subject } : {}) } : e));
              if (email.id === latest.id)
                setActive(prev => prev?.id === email.id ? { ...prev, body: body || null, bodyLoading: false, ...(subject ? { subject } : {}) } : prev);
            } else {
              setThreadEmails(prev => prev.map(e => e.id === email.id ? { ...e, bodyLoading: false } : e));
              if (email.id === latest.id)
                setActive(prev => prev?.id === email.id ? { ...prev, bodyLoading: false } : prev);
            }
          });

      }
    }
  }

  /* ── Star / Unstar → persisted to IMAP ── */
  async function toggleStar(id, e) {
    e?.stopPropagation();
    const target = emails.find(em => em.id === id);
    if (!target) return;
    const newStarred = !target.starred;

    setEmails(prev => prev.map(em => em.id === id ? { ...em, starred: newStarred } : em));
    if (active?.id === id) setActive(prev => ({ ...prev, starred: newStarred }));

    // Persist to IMAP server
    await api.post('/inbox/star', {
      accountId: target.accountId,
      uid:       target.uid,
      folder:    target.folder || 'INBOX',
      starred:   newStarred,
    });
    showToast(newStarred ? '⭐ Starred' : 'Star removed');
  }

  /* ── Mark unread (right-click / button) → persisted ── */
  async function markUnread(email) {
    setEmails(prev => prev.map(e => e.id === email.id ? { ...e, unread: true } : e));
    if (active?.id === email.id) setActive(prev => ({ ...prev, unread: true }));
    await api.post('/inbox/mark-unread', {
      accountId: email.accountId,
      uid:       email.uid,
      folder:    email.folder || 'INBOX',
    });
    showToast('Marked as unread');
  }

  /* ── Send reply via real SMTP ── */
  async function sendReply() {
    if (!replyText.trim() || !active || sending) return;
    setSending(true);
    const res = await api.post('/inbox/reply', {
      accountId: active.accountId,
      toEmail:   active.email,
      subject:   active.subject,
      body:      replyText.trim(),
    });
    setSending(false);

    if (res?.success) {
      const newMsg = { from: 'me', body: replyText.trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
      setReplies(prev => ({ ...prev, [active.id]: [...(prev[active.id] || []), newMsg] }));
      setReplyText('');
      setShowReply(false); // close reply box after sending
      showToast('✅ Reply sent');
      bustCache('sent');
    } else {
      showToast('❌ ' + (res?.error || 'Failed to send reply'));
    }
  }

  function markDone(id) {
    setEmails(prev => prev.filter(e => e.id !== id));
    if (active?.id === id) setActive(null);
    showToast('Marked as done');
  }

  /* ── Derived list + threading + deduplication ── */
  const ownEmails = new Set(accounts.map(a => a.email.toLowerCase()));

  // Deduplicate raw emails by uid+accountId (prevents same email appearing twice
  // if it exists in both INBOX and Sent cache rows for the same account)
  const seenUids = new Set();
  const dedupedEmails = emails.filter(e => {
    const key = `${e.accountId}-${e.uid}`;
    if (seenUids.has(key)) return false;
    seenUids.add(key);
    return true;
  });

  const enriched = dedupedEmails.map(e => ({
    ...e,
    initials:   getInitials(e.name, e.email),
    color:      getColor(e.email),
    tags:       e.spam ? ['Spam'] : detectTags(e.subject, e.body),
    isSelfSent: ownEmails.has((e.email || '').toLowerCase()),
  }));

  const displayed = enriched.filter(e => {
    if (folder === 'inbox' && e.isSelfSent) return false;
    const q = searchMail.toLowerCase();
    return (!q || e.name.toLowerCase().includes(q) || e.subject.toLowerCase().includes(q) || e.email.toLowerCase().includes(q))
        && (!showUnread || e.unread)
        && (filterAcc === 'all' || e.account === filterAcc);
  });

  // Group into threads by normalised subject and receiving accountId (cross-account conversations separate)
  const threadMap = new Map();
  for (const e of displayed) {
    const key = `${normalizeSubject(e.subject)}-${e.accountId}`;
    if (!threadMap.has(key)) threadMap.set(key, []);
    // Within thread, skip duplicate uid+accountId
    const existing = threadMap.get(key);
    const alreadyIn = existing.some(x => x.uid === e.uid && x.accountId === e.accountId);
    if (!alreadyIn) existing.push(e);
  }
  const threadList = [...threadMap.values()]
    .map(msgs => {
      const byDate = [...msgs].sort((a, b) => new Date(b.dateRaw) - new Date(a.dateRaw));
      return {
        key: `${normalizeSubject(byDate[0].subject)}-${byDate[0].accountId}`,
        latest: byDate[0],
        all: byDate,
        count: byDate.length,
        hasUnread: byDate.some(e => e.unread)
      };
    })
    .sort((a, b) => new Date(b.latest.dateRaw) - new Date(a.latest.dateRaw));


  // Always reflects the INBOX folder specifically, regardless of which folder tab
  // is currently open — otherwise switching to Sent/Spam/Starred recomputes this
  // from that folder's emails and the Inbox badge shows the wrong (usually zero) count.
  const inboxEmailsForBadge = folder === 'inbox' ? dedupedEmails : (getCached('inbox')?.emails || []);
  const unreadCount = inboxEmailsForBadge.filter(e => e.unread && !ownEmails.has((e.email || '').toLowerCase())).length;

  // Publish live count to App sidebar badge
  useEffect(() => { setUnreadCount(unreadCount); publishUnread(unreadCount); }, [unreadCount]);
  useEffect(() => () => { setUnreadCount(0); publishUnread(0); }, []); // clear on unmount

  return (
    <div
      style={{ display: 'flex', height: 'calc(100vh - 80px)', minHeight: 500, overflow: 'hidden' }}
      onMouseMove={e => {
        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.startX;
        const newW = Math.max(220, Math.min(560, dragRef.current.startW + dx));
        setMidWidth(newW);
      }}
      onMouseUp={() => { dragRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; }}
      onMouseLeave={() => { dragRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; }}
    >
      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.startsWith('❌') ? '#ef4444' : '#10b981', color: '#fff', padding: '0.75rem 1.25rem', borderRadius: 10, fontWeight: 500, zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', fontSize: '0.875rem' }}>{toast}</div>}

      {/* ── LEFT SIDEBAR (collapsible) ── */}
      <div style={{ display: 'flex', flexShrink: 0, position: 'relative' }}>
        {/* Sidebar panel */}
        <div style={{
          width: sidebarOpen ? 200 : 0,
          overflow: 'hidden',
          transition: 'width 0.22s ease',
          borderRight: sidebarOpen ? '1px solid var(--border-color)' : 'none',
          display: 'flex', flexDirection: 'column',
          background: 'var(--overlay-1)',
        }}>
          <div style={{ width: 200, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '0.75rem', flexShrink: 0 }}>
              <button
                className="btn btn-primary btn-sm"
                style={{ width: '100%', fontSize: '0.8rem' }}
                onClick={() => {
                  setComposeForm({ accountId: accounts[0]?.id || '', to: '', subject: '', body: '' });
                  setComposeOpen(true);
                }}
              >
                + Compose Email
              </button>
            </div>

            {/* Scrollable region — flex:1 + minHeight:0 lets this shrink to fit
                and scroll instead of every row being squashed to fit the sidebar
                (a flex column with many children otherwise compresses them all). */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {FOLDERS.map(f => (
                <button key={f.key} type="button" aria-current={folder === f.key ? 'true' : undefined} onClick={() => setFolder(f.key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1rem', cursor: 'pointer', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', border: 'none', background: folder === f.key ? 'rgba(99,102,241,0.12)' : 'transparent', borderLeft: folder === f.key ? '3px solid var(--accent-primary)' : '3px solid transparent' }}
                  onMouseEnter={e => { if (folder !== f.key) e.currentTarget.style.background = 'var(--overlay-4)'; }}
                  onMouseLeave={e => { if (folder !== f.key) e.currentTarget.style.background = 'transparent'; }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem' }}>{f.icon}</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: folder === f.key ? 600 : 400, color: folder === f.key ? 'var(--accent-primary)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{f.label}</span>
                  </div>
                  {f.key === 'inbox' && unreadCount > 0 && <span style={{ background: 'var(--accent-primary)', color: '#fff', fontSize: '0.62rem', fontWeight: 700, borderRadius: 99, padding: '1px 6px' }}>{unreadCount}</span>}
                </button>
              ))}

              {accounts.length > 0 && (<>
                <div style={{ height: 1, background: 'var(--border-color)', margin: '0.5rem 0' }} />
                <div style={{ padding: '0.35rem 1rem', fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>ACCOUNTS</div>
                {[{ email: 'all', label: '📥 All Accounts' }, ...accounts.map(a => ({ email: a.email, label: `📧 ${a.email}` }))].map(a => (
                  <button key={a.email} type="button" aria-current={filterAcc === a.email ? 'true' : undefined} onClick={() => setFilterAcc(a.email)} title={a.email}
                    style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', fontFamily: 'inherit', padding: '0.45rem 1rem', cursor: 'pointer', fontSize: '0.78rem', color: filterAcc === a.email ? 'var(--accent-primary)' : 'var(--text-secondary)', background: filterAcc === a.email ? 'rgba(99,102,241,0.08)' : 'transparent', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: filterAcc === a.email ? 600 : 400 }}>{a.label}</button>
                ))}
              </>)}
            </div>

            <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
              <button className="btn btn-secondary btn-sm" style={{ width: '100%', fontSize: '0.78rem' }}
                onClick={() => refreshEmails(folder)} disabled={syncing}>
                {syncing ? '⏳ Checking…' : '🔄 Refresh'}
              </button>
              {lastSyncedAt && (
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.3rem' }}>
                  Synced {lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ⏱1m
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Toggle button — always visible on the right edge of sidebar area */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          style={{
            position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)',
            zIndex: 10, width: 20, height: 44,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
            borderRadius: '0 6px 6px 0', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.6rem', color: 'var(--text-muted)',
            boxShadow: '2px 0 6px rgba(0,0,0,0.15)',
          }}
        >{sidebarOpen ? '◄' : '►'}</button>
      </div>

      {/* ── MIDDLE PANEL ── */}
      <div className={`inbox-list-panel${mobileShowDetail ? ' inbox-panel--hidden' : ''}`} style={{ width: midWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>
              {FOLDERS.find(f => f.key === folder)?.icon} {FOLDERS.find(f => f.key === folder)?.label}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.4rem' }}>({threadList.length})</span>
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={showUnread} onChange={() => setShowUnread(v => !v)} style={{ accentColor: 'var(--accent-primary)' }} />
              Unread only
            </label>
          </div>
          <div className="search-box" style={{ fontSize: '0.8rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>🔍</span>
            <input placeholder="Search mail…" value={searchMail} onChange={e => setSearchMail(e.target.value)} style={{ fontSize: '0.8rem' }} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>Fetching emails…
            </div>
          ) : threadList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {accounts.length === 0 ? (
                <>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📭</div>
                  <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>No accounts connected</div>
                  <div style={{ fontSize: '0.78rem' }}>Add accounts with IMAP settings in <strong>Email Accounts</strong></div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
                  {folder === 'spam' ? 'No spam / junk emails' : folder === 'starred' ? 'No starred emails' : 'No emails found'}
                </>
              )}
            </div>
          ) : (
            <>
              {accounts.length === 0 && (
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(245, 158, 11, 0.1)', borderBottom: '1px solid rgba(245, 158, 11, 0.2)', color: 'var(--warning-text)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1rem' }}>⚠️</span>
                  <span><strong>Offline mode:</strong> You have no active email accounts connected. Reconnect them in Settings to sync new emails.</span>
                </div>
              )}
              {threadList.map(thread => {
                const t = thread.latest;
                const isActive = active?.id === t.id;
                return (
                  <div key={thread.key} role="button" tabIndex={0} aria-current={isActive ? 'true' : undefined}
                    onClick={() => { openThread(thread); setMobileShowDetail(true); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread(thread); setMobileShowDetail(true); } }}
                    style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--overlay-4)', cursor: 'pointer', background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent', borderLeft: isActive ? '3px solid var(--accent-primary)' : '3px solid transparent', transition: 'background 0.12s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.3rem' }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.68rem', color: '#fff' }}>{t.initials}</div>
                        {thread.hasUnread && <div style={{ position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-primary)', border: '1.5px solid var(--bg-primary)' }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: thread.hasUnread ? 700 : 500, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{t.name || t.email}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                            {thread.count > 1 && <span style={{ fontSize: '0.6rem', background: 'rgba(99,102,241,0.25)', color: 'var(--accent-primary)', borderRadius: 99, padding: '1px 5px', fontWeight: 700 }}>{thread.count}</span>}
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t.date}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: '0.77rem', fontWeight: thread.hasUnread ? 600 : 400, color: thread.hasUnread ? 'var(--text-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem', marginLeft: 40, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>📧 {t.account}</span>
                      {t.tags?.map(tag => <span key={tag} style={{ fontSize: '0.62rem', padding: '1px 6px', borderRadius: 99, background: TAG_COLORS[tag] || 'var(--overlay-8)', color: TAG_TEXT[tag] || 'var(--text-muted)', fontWeight: 600 }}>{tag}</span>)}
                      <button onClick={ev => toggleStar(t.id, ev)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.82rem', color: t.starred ? 'var(--warning-text)' : 'var(--text-muted)', flexShrink: 0 }}>★</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          <span>{threadList.length} thread{threadList.length !== 1 ? 's' : ''}</span>
          {unreadCount > 0 && <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>{unreadCount} unread</span>}
        </div>
      </div>

      {/* ── DRAG HANDLE ── */}
      <div
        onMouseDown={e => {
          dragRef.current = { startX: e.clientX, startW: midWidth };
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          e.preventDefault();
        }}
        style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'var(--border-color)', transition: 'background 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-primary)'}
        onMouseLeave={e => { if (!dragRef.current) e.currentTarget.style.background = 'var(--border-color)'; }}
      />

      {/* ── RIGHT PANEL ── */}
      <div className={`inbox-detail-panel${!mobileShowDetail ? ' inbox-panel--hidden' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-primary)' }}>
        {/* Mobile back button */}
        {mobileShowDetail && (
          <div className="inbox-mobile-back">
            <button className="btn btn-secondary btn-sm" onClick={() => { setMobileShowDetail(false); setActive(null); }}>
              ← Back to Inbox
            </button>
          </div>
        )}
        {!active ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem', opacity: 0.2 }}>✉️</div>
            <div style={{ fontWeight: 500 }}>Select an email to read</div>
            {accounts.length > 0 && <div style={{ fontSize: '0.78rem', marginTop: '0.4rem' }}>{accounts.length} account{accounts.length !== 1 ? 's' : ''} connected</div>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>

            {/* ── GMAIL-STYLE SUBJECT ROW ── */}
            <div style={{ padding: '1rem 1.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontWeight: 700, fontSize: '1.15rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                {active.subject}
              </span>
              {/* Inbox badge */}
              <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--overlay-20)', color: 'var(--text-secondary)', fontWeight: 500, flexShrink: 0 }}>
                Inbox ✕
              </span>
              {/* Nav icons */}
              <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                {['⬆', '⬇'].map((ic, i) => (
                  <button key={i} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 4px', borderRadius: 4 }}>{ic}</button>
                ))}
                <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 4px', borderRadius: 4 }}>🖨</button>
                <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 4px', borderRadius: 4 }}>⤢</button>
              </div>
            </div>

            {/* ── THREAD MESSAGES (oldest → newest, Gmail order) ── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 1.5rem 1rem' }}>
              {[...threadEmails].reverse().map((msg, idx, arr) => {
                const isLast     = idx === arr.length - 1;
                const isExpanded = expandedMsgIds.has(msg.id);
                const initials   = getInitials(msg.name, msg.email);
                const color      = getColor(msg.email);
                const time       = msg.dateRaw
                  ? new Date(msg.dateRaw).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : msg.date;

                // Backend already returns clean plain text — no need to double-strip
                // Use body first, then preview as fallback (preview is the snippet from list view)
                const rawBody = (msg.body || '').trim() || (msg.preview || '').trim();
                const quoteIdx = rawBody.search(/\nOn .{5,100} wrote:/m);
                const mainText  = quoteIdx > -1 ? rawBody.slice(0, quoteIdx).trim() : rawBody;
                const quotedText = quoteIdx > -1 ? rawBody.slice(quoteIdx).trim() : '';


                const toggleExpand = () => setExpandedMsgIds(prev => {
                  const next = new Set(prev);
                  if (next.has(msg.id)) next.delete(msg.id); else next.add(msg.id);
                  return next;
                });

                if (!isExpanded) {
                  // ── COLLAPSED ROW (Gmail style) ──
                  return (
                    <div key={msg.id} role="button" tabIndex={0} aria-expanded={false}
                      onClick={toggleExpand}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); } }}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0', cursor: 'pointer', borderBottom: '1px solid var(--overlay-4)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-3)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Avatar */}
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.65rem', color: '#fff', flexShrink: 0 }}>
                        {initials}
                      </div>
                      {/* Name */}
                      <div style={{ fontWeight: 600, fontSize: '0.83rem', flexShrink: 0, minWidth: 110, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {msg.name || msg.email}
                      </div>
                      {/* Preview snippet */}
                      <div style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {mainText.slice(0, 120) || '(no preview)'}
                      </div>
                      {/* Time + star */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{time}</span>
                        <button onClick={ev => toggleStar(msg.id, ev)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', color: msg.starred ? 'var(--warning-text)' : 'var(--text-muted)', padding: 0 }}>☆</button>
                      </div>
                    </div>
                  );
                }

                // ── EXPANDED MESSAGE (Gmail style) ──
                return (
                  <div key={msg.id} style={{ borderBottom: isLast ? 'none' : '1px solid var(--overlay-5)', paddingBottom: '0.75rem', marginBottom: '0.25rem' }}>
                    {/* Expanded header */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem 0 0.5rem' }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.72rem', color: '#fff', flexShrink: 0 }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{msg.name || msg.email}</span>
                          {msg.name && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>&lt;{msg.email}&gt;</span>}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                          to {msg.account || active.account} ▾
                        </div>
                      </div>
                      {/* Right: time + actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{time}</span>
                        <button onClick={ev => toggleStar(msg.id, ev)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: msg.starred ? 'var(--warning-text)' : 'var(--text-muted)', padding: 0 }}>☆</button>
                        <button title="Reply" onClick={() => { setShowReply(true); setReplyText(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--text-muted)', padding: 0 }}>↩</button>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--text-muted)', padding: 0 }}>⋮</button>
                      </div>
                    </div>

                    {/* Body */}
                    <div style={{ paddingLeft: 48 }}>
                      {msg.bodyLoading ? (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '1rem 0' }}>Loading…</div>
                      ) : (
                        <>
                          <div style={{ marginBottom: quotedText ? '0.75rem' : 0 }}>
                            {msg.body ? (
                              <AutoHeightIframe html={msg.body} />
                            ) : (
                              <div style={{ fontSize: '0.875rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)' }}>
                                {mainText || '(Empty)'}
                              </div>
                            )}
                          </div>
                          {quotedText && (
                            <div>
                              <button style={{ background: 'none', border: '1px solid var(--overlay-15)', borderRadius: 3, padding: '1px 6px', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '0.5rem' }}>
                                · · ·
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {/* Sent replies inline */}
                      {(replies[msg.id] || []).map((r, i) => (
                        <div key={i} style={{ display: 'flex', gap: '0.5rem', flexDirection: 'row-reverse', marginTop: '0.75rem' }}>
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.55rem', color: '#fff', flexShrink: 0 }}>ME</div>
                          <div style={{ maxWidth: '72%' }}>
                            <div 
                              style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '10px 2px 10px 10px', padding: '0.55rem 0.85rem', fontSize: '0.84rem', lineHeight: 1.65 }}
                              dangerouslySetInnerHTML={{ __html: r.body }}
                            />
                            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '0.2rem', textAlign: 'right' }}>Sent · {r.time}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Inline reply/forward triggers (last message only) */}
                    {isLast && !showReply && (
                      <div style={{ paddingLeft: 48, marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => { setShowReply(true); setReplyText(''); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: '1px solid var(--overlay-20)', borderRadius: 6, padding: '0.4rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-5)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >↩ Reply</button>
                        <button
                          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: '1px solid var(--overlay-20)', borderRadius: 6, padding: '0.4rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-5)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >↪ Forward</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── REPLY BOX (Gmail style — bottom of panel) ── */}
            {showReply && (
              <div style={{ padding: '0.75rem 1.5rem 1rem', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ border: '1px solid rgba(99,102,241,0.45)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.25)' }}>
                  <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--overlay-7)', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '1.5rem' }}>
                    <span>From: <strong style={{ color: 'var(--text-secondary)' }}>{active.account}</strong></span>
                    <span>To: <strong style={{ color: 'var(--text-secondary)' }}>{active.email}</strong></span>
                  </div>
                  <RichEditor
                    placeholder={`Reply to ${active.name || active.email}…`}
                    value={replyText}
                    onChange={setReplyText}
                    style={{ border: 'none', borderRadius: 0 }}
                  />
                  <div style={{ padding: '0.5rem 1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--overlay-5)' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setShowReply(false); setReplyText(''); }}>Discard</button>

                    <button className="btn btn-primary btn-sm" onClick={sendReply} disabled={isHtmlEmpty(replyText) || sending}>
                      {sending ? 'Sending…' : '↑ Send Reply'}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── COMPOSE MODAL ── */}
      {composeOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 600, maxWidth: '90%', background: 'var(--bg-primary)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '1rem 1.5rem', background: 'var(--overlay-3)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>New Message</h3>
              <button onClick={() => setComposeOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
            </div>
            
            <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                <span style={{ width: 80, color: 'var(--text-muted)', fontSize: '0.85rem' }}>From:</span>
                <select 
                  className="form-input" 
                  style={{ flex: 1, border: 'none', background: 'transparent', padding: '0.25rem' }}
                  value={composeForm.accountId}
                  onChange={e => setComposeForm(p => ({ ...p, accountId: e.target.value }))}
                >
                  <option value="" disabled>Select an account</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                <span style={{ width: 80, color: 'var(--text-muted)', fontSize: '0.85rem' }}>To:</span>
                <input 
                  type="email" 
                  className="form-input" 
                  placeholder="client@example.com" 
                  style={{ flex: 1, border: 'none', background: 'transparent', padding: '0.25rem' }}
                  value={composeForm.to}
                  onChange={e => setComposeForm(p => ({ ...p, to: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                <span style={{ width: 80, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Subject:</span>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Subject" 
                  style={{ flex: 1, border: 'none', background: 'transparent', padding: '0.25rem' }}
                  value={composeForm.subject}
                  onChange={e => setComposeForm(p => ({ ...p, subject: e.target.value }))}
                />
              </div>

              <RichEditor
                placeholder="Write your message here..."
                value={composeForm.body}
                onChange={val => setComposeForm(p => ({ ...p, body: val }))}
                style={{ marginTop: '0.5rem', minHeight: 280 }}
              />
            </div>

            <div style={{ padding: '1rem 1.5rem', background: 'var(--overlay-1)', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="btn btn-ghost text-muted" onClick={() => setComposeOpen(false)}>Discard</button>
              <button 
                className="btn btn-primary" 
                onClick={sendCompose} 
                disabled={composeSending || !composeForm.accountId || !composeForm.to || !composeForm.subject || isHtmlEmpty(composeForm.body)}
              >
                {composeSending ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

