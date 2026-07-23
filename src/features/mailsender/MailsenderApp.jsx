import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api } from './lib/api';
import './mailsender.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import Campaigns from './pages/campaigns/Campaigns';
import Prospects from './pages/Prospects';
import Inbox from './pages/Inbox';
import Accounts from './pages/Accounts';
import Warmup from './pages/Warmup';
import Settings from './pages/Settings';

function UserMenu({ user, initials, onSettings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="avatar" title={user?.name} onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        {initials}
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          borderRadius: 12, boxShadow: 'var(--shadow-md)', zIndex: 200,
          minWidth: 220, overflow: 'hidden',
        }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1rem', color: '#fff', flexShrink: 0 }}>
              {initials}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
            </div>
          </div>
          <button onClick={() => { onSettings(); setOpen(false); }} style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            width: '100%', padding: '0.7rem 1rem', background: 'none', border: 'none',
            color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.875rem', textAlign: 'left',
          }}>
            <span>⚙️</span> Settings
          </button>
        </div>
      )}
    </div>
  );
}

const VALID_TABS = ['dashboard', 'campaigns', 'prospects', 'inbox', 'accounts', 'warmup', 'settings'];

function AppInner() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [tab, setTab] = useState(VALID_TABS.includes(urlTab) ? urlTab : 'dashboard');

  // The outer Salesvora sidebar deep-links into a specific section via
  // /mailsender?tab=campaigns — pick that up whenever the URL changes
  // (clicking a sidebar link while already on this page doesn't remount us).
  useEffect(() => {
    if (VALID_TABS.includes(urlTab) && urlTab !== tab) setTab(urlTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);

  const knownIdsRef = useRef(null);
  const tabRef = useRef(tab);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  useEffect(() => {
    knownIdsRef.current = null;
    let timer;
    async function poll() {
      try {
        const res = await api.get('/inbox?folder=inbox');
        if (!res || res.error) return;
        const emails = res.emails || [];
        const unread = emails.filter(e => e.unread);

        if (knownIdsRef.current === null) {
          knownIdsRef.current = new Set(emails.map(e => e.id));
          return;
        }
        const fresh = unread.filter(e => !knownIdsRef.current.has(e.id));
        if (fresh.length > 0) {
          emails.forEach(e => knownIdsRef.current.add(e.id));
          if (tabRef.current !== 'inbox') {
            const senders = [...new Set(fresh.map(e => e.name || e.email))].slice(0, 3);
            // Uses the app-wide sonner toaster (mounted in main.tsx) rather than
            // a bespoke card: it follows the light/dark theme automatically and
            // stacks in the same corner as every other Salesvora notification.
            toast(`${fresh.length} new email${fresh.length > 1 ? 's' : ''}`, {
              description: senders.length > 0
                ? `From: ${senders.join(', ')}${fresh.length > 3 ? ` +${fresh.length - 3} more` : ''}`
                : undefined,
              action: { label: 'View Inbox', onClick: () => navigate('inbox') },
            });
          }
        }
      } catch { /* ignore network errors */ }
    }
    const initial = setTimeout(() => {
      poll();
      timer = setInterval(poll, 60_000);
    }, 5_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [user?.id]);

  const initials = user ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'U';

  const PAGE_TITLES = {
    dashboard: 'Dashboard', campaigns: 'Campaigns', prospects: 'Prospects',
    inbox: 'Unified Inbox', accounts: 'Email Accounts', warmup: 'Email Warmup',
    settings: 'Settings',
  };

  function navigate(key) {
    setTab(key);
    setSearchParams({ tab: key }, { replace: true });
  }

  return (
    <div className="app-container">
      <main className="main-content">
        <header className="main-header">
          <div><h1 className="page-title">{PAGE_TITLES[tab]}</h1></div>

          <div className="header-actions">
            <button className="btn btn-primary btn-sm" onClick={() => navigate('campaigns')}>+ New Campaign</button>
            <UserMenu user={user} initials={initials} onSettings={() => navigate('settings')} />
          </div>
        </header>

        <div className="page-content">
          {tab === 'dashboard' && <Dashboard onNavigate={navigate} />}
          {tab === 'campaigns' && <Campaigns userId={user?.id} />}
          {tab === 'prospects' && <Prospects />}
          {tab === 'inbox'     && <Inbox userId={user?.id} />}
          {tab === 'accounts'  && <Accounts userId={user?.id} />}
          {tab === 'warmup'    && <Warmup />}
          {tab === 'settings'  && <Settings />}
        </div>
      </main>
    </div>
  );
}

export default function MailsenderApp() {
  return (
    <div className="mailsender-app">
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </div>
  );
}
