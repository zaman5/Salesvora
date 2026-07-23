import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import SequenceBuilder from './SequenceBuilder';
import CampaignSchedule from './CampaignSchedule';
import CampaignSettings from './CampaignSettings';
import CampaignSubsequences from './CampaignSubsequences';
import CampaignLeads from './CampaignLeads';

const TABS = ['Leads', 'Sequences', 'Schedule', 'Settings', 'Subsequences', 'Analytics'];
const TAB_ICONS = { Leads:'👥', Sequences:'🔗', Schedule:'📅', Settings:'⚙️', Subsequences:'🔀', Analytics:'📊' };

function StatCard({ icon, label, value, sub, color, wide, warn }) {
  return (
    <div className="card card-p" style={{
      gridColumn: wide ? 'span 2' : 'span 1',
      borderLeft: warn ? '3px solid var(--danger)' : '3px solid transparent',
      position: 'relative',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', color:'var(--text-secondary)', fontSize:'0.78rem', marginBottom:'0.4rem' }}>
        <span>{icon}</span><span>{label}</span>
      </div>
      <div style={{ display:'flex', alignItems:'baseline', gap:'0.4rem' }}>
        <span style={{ fontFamily:'Outfit', fontSize:'1.6rem', fontWeight:700, color: color || 'var(--text-primary)' }}>{value ?? '—'}</span>
        {sub && <span style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{sub}</span>}
      </div>
      {warn && <div style={{ position:'absolute', top:6, right:8, fontSize:'0.65rem', color:'var(--danger)', fontWeight:700 }}>⚠ HIGH</div>}
    </div>
  );
}

export default function CampaignDetail({ campaign, onBack, onToggleStatus }) {
  const [tab, setTab]     = useState('Leads');
  const [active, setActive] = useState(campaign.status === 'active');
  const [toast, setToast] = useState('');

  const [stats, setStats]               = useState(null);
  const [statsLoading, setStatsLoading]   = useState(false);
  const [bounceThreshold, setBounceThreshold] = useState('10');
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [sending, setSending]             = useState(false);
  const [toggling, setToggling]           = useState(false);
  const [sendStatus, setSendStatus]       = useState(''); // message from send run
  const [warnings, setWarnings]           = useState([]);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  const loadAnalytics = useCallback(async () => {
    if (!campaign?.id) return;
    setStatsLoading(true);
    const res = await api.get(`/campaigns/${campaign.id}/analytics`);
    if (res && !res.error) {
      setStats(res);
      setBounceThreshold(String(res.bounceThreshold ?? 10));
      // If backend auto-paused, reflect it in UI
      if (res.autoPaused) {
        setActive(false);
        showToast('⚠️ Campaign auto-paused: bounce rate exceeded threshold!');
      }
    }
    setStatsLoading(false);
  }, [campaign?.id]);

  useEffect(() => {
    if (tab === 'Analytics') loadAnalytics();
    
    // Auto-poll analytics every 5s while the campaign is active and on the Analytics tab
    let interval;
    if (tab === 'Analytics' && active) {
      interval = setInterval(() => loadAnalytics(), 5000);
    }
    return () => clearInterval(interval);
  }, [tab, active, loadAnalytics]);

  async function saveBounceThreshold() {
    setSavingThreshold(true);
    // Load current settings_json, merge bounceThreshold, PATCH back
    const current = await api.get(`/campaigns/${campaign.id}`);
    let settings = {};
    if (current?.settings_json) { try { settings = JSON.parse(current.settings_json); } catch (_) {} }
    settings.bounceThreshold = parseFloat(bounceThreshold) || 10;
    await api.patch(`/campaigns/${campaign.id}`, { settings_json: JSON.stringify(settings) });
    setSavingThreshold(false);
    showToast('✅ Bounce threshold saved');
    loadAnalytics();
  }

  async function resetCounters() {
    if (!window.confirm('Reset all sent/open/reply/bounce counters for this campaign?')) return;
    await api.post(`/campaigns/${campaign.id}/analytics/reset`, {});
    showToast('✅ Counters reset');
    loadAnalytics();
  }

  async function toggleCampaign() {
    // A second toggle while one is in flight would POST /run again and send
    // the whole batch twice.
    if (toggling || sending) return;
    setToggling(true);
    const nowActive = !active;
    setActive(nowActive);

    try {
      // 1. Persist status to DB
      await api.patch(`/campaigns/${campaign.id}`, { status: nowActive ? 'active' : 'paused' });
      onToggleStatus(campaign.id);

      if (nowActive) {
        // 2. Validate prerequisites
        const checkRes = await api.post(`/send/campaign/${campaign.id}/activate`, {});
        const warns = checkRes?.warnings || [];
        setWarnings(warns);

        if (warns.length > 0) {
          showToast('⚠️ Campaign active but has issues — check below');
        } else {
          // 3. Trigger actual sending
          setSending(true);
          setSendStatus('Starting email delivery…');
          const runRes = await api.post(`/send/campaign/${campaign.id}/run`, { origin: window.location.origin });
          setSending(false);
          if (runRes?.error) {
            setSendStatus('');
            showToast(`❌ ${runRes.error}`);
          } else {
            setSendStatus(runRes?.message || `Sending to ${runRes?.leads} leads…`);
            showToast(`✅ ${runRes?.message || 'Email delivery started'}`);
          }
        }
      } else {
        setWarnings([]);
        setSendStatus('');
        showToast('Campaign paused');
      }
    } finally {
      setToggling(false);
    }
  }

  const bounceNum = parseFloat(stats?.bounceRate ?? '0');
  const threshNum = parseFloat(bounceThreshold) || 10;
  const bounceWarn = bounceNum >= threshNum;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', position:'relative' }}>
      {toast && (
        <div style={{ position:'fixed', bottom:24, right:24,
          background: toast.startsWith('⚠️') || toast.startsWith('❌') ? '#ef4444' : '#10b981',
          color:'#fff', padding:'0.75rem 1.25rem', borderRadius:10, fontWeight:500,
          zIndex:999, boxShadow:'0 4px 16px rgba(0,0,0,0.3)', fontSize:'0.875rem', maxWidth:380 }}>
          {toast}
        </div>
      )}

      {/* Breadcrumb */}
      <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginBottom:'0.75rem' }}>
        Home › Campaigns › <span style={{ color:'var(--accent-primary)', fontWeight:500 }}>{campaign.name}</span>
      </div>

      {/* Tab Bar */}
      <div className="card campaign-tab-bar" style={{ padding:'0 0.75rem', marginBottom:'0.75rem', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:0, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', paddingRight:'1rem', borderRight:'1px solid var(--border-color)', marginRight:'0.25rem', flexShrink:0 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background: active ? 'var(--success)' : '#f59e0b', flexShrink:0 }} />
            <span style={{ fontWeight:600, fontSize:'0.85rem', whiteSpace:'nowrap', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis' }}>{campaign.name}</span>
            <span className="tab-status-label" style={{ fontSize:'0.72rem', color:'var(--text-muted)', whiteSpace:'nowrap' }}>{active ? 'Active' : 'Paused'}</span>
            <div onClick={toggleCampaign} title={toggling || sending ? 'Working…' : (active ? 'Pause campaign' : 'Activate campaign')}
              style={{ width:32, height:18, borderRadius:99,
                cursor: toggling || sending ? 'wait' : 'pointer',
                pointerEvents: toggling || sending ? 'none' : 'auto',
                opacity: toggling || sending ? 0.5 : 1,
                background: active ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                border:`2px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                position:'relative', transition:'all 0.2s', flexShrink:0 }}>
              <div style={{ position:'absolute', top:1, left: active ? 12 : 1, width:12, height:12, borderRadius:'50%', background:'#fff', transition:'left 0.2s' }} />
            </div>
          </div>
          <div className="campaign-tab-scroll">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ background:'none', border:'none',
                  borderBottom: tab===t ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  color: tab===t ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  padding:'0.85rem 0.6rem', cursor:'pointer', fontWeight: tab===t ? 600 : 400,
                  fontSize:'0.8rem', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:'0.25rem',
                  transition:'color 0.15s', flexShrink:0 }}>
                {TAB_ICONS[t]} <span className="tab-label-text">{t}</span>
              </button>
            ))}
          </div>
          <button onClick={onBack} className="btn btn-secondary btn-sm"
            style={{ marginLeft:'0.5rem', flexShrink:0, whiteSpace:'nowrap', fontSize:'0.78rem', padding:'5px 10px' }}>
            ← Back
          </button>
        </div>
      </div>

      {/* ── Sending status strip ── */}
      {sending && (
        <div style={{ background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, padding:'0.5rem 1rem', marginBottom:'0.5rem', fontSize:'0.82rem', color:'var(--accent-primary)', display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
          <span style={{ animation:'spin 1s linear infinite', display:'inline-block' }}>⏳</span>
          {sendStatus || 'Sending emails…'}
        </div>
      )}
      {!sending && sendStatus && (
        <div style={{ background:'rgba(16,185,129,0.1)', border:'1px solid rgba(16,185,129,0.3)', borderRadius:8, padding:'0.5rem 1rem', marginBottom:'0.5rem', fontSize:'0.82rem', color:'var(--success)', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span>✅ {sendStatus}</span>
          <button onClick={() => setSendStatus('')} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'0.9rem' }}>✕</button>
        </div>
      )}

      {/* ── Prerequisite warnings ── */}
      {warnings.length > 0 && (
        <div style={{ background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.35)', borderRadius:10, padding:'0.75rem 1rem', marginBottom:'0.75rem', flexShrink:0 }}>
          <div style={{ fontWeight:700, fontSize:'0.82rem', color:'#f59e0b', marginBottom:'0.35rem' }}>⚠️ Fix these before emails can send:</div>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize:'0.78rem', color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
              <span>→</span> {w}
            </div>
          ))}
        </div>
      )}

      {/* Tab Content */}
      <div style={{ flex:1, overflowY:'auto', paddingBottom:'2rem' }}>
        {tab === 'Leads'        && <CampaignLeads       key={campaign.id} campaign={campaign} active={active} />}
        {tab === 'Sequences'    && <SequenceBuilder     key={campaign.id} campaign={campaign} />}
        {tab === 'Schedule'     && <CampaignSchedule    key={campaign.id} campaign={campaign} />}
        {tab === 'Settings'     && <CampaignSettings    key={campaign.id} campaign={campaign} />}
        {tab === 'Subsequences' && <CampaignSubsequences key={campaign.id} />}

        {tab === 'Analytics' && (
          <div style={{ maxWidth:820, display:'flex', flexDirection:'column', gap:'1.25rem' }}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem' }}>
              <h3 style={{ fontWeight:700, margin:0 }}>📊 Campaign Analytics</h3>
              <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                <button className="btn btn-ghost btn-sm" onClick={loadAnalytics} disabled={statsLoading}>
                  {statsLoading ? '⏳' : '🔄'} Refresh
                </button>
                <button className="btn btn-secondary btn-sm" onClick={resetCounters} style={{ fontSize:'0.72rem' }}>
                  🗑 Reset Counters
                </button>
              </div>
            </div>

            {statsLoading && !stats && (
              <div style={{ color:'var(--text-muted)', fontSize:'0.875rem', padding:'2rem', textAlign:'center' }}>⏳ Loading analytics…</div>
            )}

            {stats && (<>

              {/* Auto-pause banner */}
              {stats.autoPaused && (
                <div style={{ background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.4)', borderRadius:10, padding:'0.75rem 1rem', display:'flex', alignItems:'center', gap:'0.75rem' }}>
                  <span style={{ fontSize:'1.2rem' }}>🚨</span>
                  <div>
                    <div style={{ fontWeight:700, color:'#ef4444', fontSize:'0.9rem' }}>Campaign Auto-Paused</div>
                    <div style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>Bounce rate ({stats.bounceRate}) exceeded your threshold ({bounceThreshold}%). Resume the campaign after reviewing.</div>
                  </div>
                </div>
              )}

              {/* Stats grid */}
              <div className="stats-grid-4">
                <StatCard icon="📤" label="Emails Sent"          value={stats.sent}       color="var(--accent-primary)" />
                <StatCard icon="👥" label="Total Leads"          value={stats.totalLeads} color="#818cf8" />
                <StatCard icon="✅" label="Completed Leads"      value={stats.completed}  color="var(--success)" />
                <StatCard icon="↩"  label="Replies"              value={stats.replies}    sub={stats.replyRate} color="#34d399" />
                <StatCard icon="👁" label="Opens"                value={stats.opens}      sub={stats.openRate}  color="#60a5fa" wide />
                <StatCard icon="⚡" label="Bounced"              value={stats.bounced}    sub={stats.bounceRate}
                  color={bounceWarn ? 'var(--danger)' : '#f59e0b'}
                  warn={bounceWarn} wide />
              </div>

              {/* Progress bars */}
              <div className="card card-p" style={{ display:'flex', flexDirection:'column', gap:'0.85rem' }}>
                <div style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.25rem' }}>Delivery Overview</div>
                {[
                  { label:'Reply Rate',  value: parseFloat(stats.replyRate),  color:'#34d399', max:30  },
                  { label:'Open Rate',   value: parseFloat(stats.openRate),   color:'#60a5fa', max:80  },
                  { label:'Bounce Rate', value: parseFloat(stats.bounceRate), color: bounceWarn ? '#ef4444' : '#f59e0b', max:20 },
                ].map(bar => (
                  <div key={bar.label}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.78rem', marginBottom:'3px' }}>
                      <span style={{ color:'var(--text-secondary)' }}>{bar.label}</span>
                      <span style={{ fontWeight:700, color: bar.color }}>{bar.value.toFixed(1)}%</span>
                    </div>
                    <div style={{ height:7, background:'var(--bg-tertiary)', borderRadius:99, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${Math.min(bar.value / bar.max * 100, 100)}%`, background:bar.color, borderRadius:99, transition:'width 0.4s ease' }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Bounce Threshold Control */}
              <div className="card card-p" style={{ borderLeft: bounceWarn ? '4px solid var(--danger)' : '4px solid var(--warning)' }}>
                <div style={{ fontWeight:700, fontSize:'0.875rem', marginBottom:'0.25rem' }}>
                  ⚡ Auto-Pause Bounce Rate Threshold
                </div>
                <p style={{ fontSize:'0.8rem', color:'var(--text-secondary)', marginBottom:'0.85rem', lineHeight:1.5 }}>
                  If the campaign bounce rate reaches this percentage, the campaign will automatically pause.
                  Current bounce rate: <strong style={{ color: bounceWarn ? 'var(--danger)' : 'var(--warning)' }}>{stats.bounceRate}</strong>
                </p>
                <div style={{ display:'flex', gap:'0.75rem', alignItems:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', background:'var(--bg-tertiary)', border:`1px solid ${bounceWarn?'var(--danger)':'var(--border-color)'}`, borderRadius:8, padding:'0 0.75rem', height:38 }}>
                    <input
                      type="number" min="1" max="100" step="0.5"
                      value={bounceThreshold}
                      onChange={e => setBounceThreshold(e.target.value)}
                      style={{ width:60, background:'none', border:'none', outline:'none', color:'var(--text-primary)', fontWeight:700, fontSize:'1rem', textAlign:'center' }}
                    />
                    <span style={{ color:'var(--text-muted)', fontWeight:700 }}>%</span>
                  </div>
                  <input type="range" min="1" max="30" step="0.5"
                    value={bounceThreshold}
                    onChange={e => setBounceThreshold(e.target.value)}
                    style={{ flex:1, accentColor: bounceWarn ? 'var(--danger)' : 'var(--accent-primary)' }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={saveBounceThreshold} disabled={savingThreshold}>
                    {savingThreshold ? 'Saving…' : 'Save'}
                  </button>
                </div>
                {bounceWarn && (
                  <div style={{ marginTop:'0.65rem', fontSize:'0.78rem', color:'var(--danger)', fontWeight:600 }}>
                    🚨 Current bounce rate ({stats.bounceRate}) has already exceeded your threshold ({bounceThreshold}%). Campaign will auto-pause on next analytics refresh.
                  </div>
                )}
              </div>

            </>)}

            {!stats && !statsLoading && (
              <div style={{ color:'var(--text-muted)', fontSize:'0.875rem', textAlign:'center', padding:'3rem' }}>
                Click <strong>Refresh</strong> to load analytics for this campaign.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
