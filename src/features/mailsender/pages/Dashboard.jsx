import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';

const barData = {
  'Emails Sent':  [32, 48, 41, 67, 54, 78, 62, 91, 74, 58, 49, 71],
  'Open Rate':    [28, 35, 31, 44, 42, 48, 40, 51, 46, 38, 33, 43],
  'Reply Rate':   [8,  12, 9,  15, 13, 17, 12, 19, 14, 11, 9,  13],
};

const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const activity = [
  { icon: '💬', label: 'Hot Lead Reply', sub: 'Alex Turner · Q2 Agency Outreach', time: '10m ago', type: 'success' },
  { icon: '📢', label: 'Campaign Launched', sub: 'LinkedIn Replied Leads', time: '1h ago', type: 'info' },
  { icon: '⚠️', label: 'Warmup Score Drop', sub: 'info@domain2.com → 31 pts', time: '3h ago', type: 'danger' },
  { icon: '👥', label: '500 Prospects Imported', sub: 'E-commerce Decision Makers', time: '5h ago', type: 'info' },
  { icon: '✅', label: 'Campaign Completed', sub: 'SaaS Founders Q1 · 450 sent', time: '1d ago', type: 'success' },
  { icon: '🔥', label: 'Warmup Milestone', sub: 'outreach@yourcompany.com · 90+ score', time: '2d ago', type: 'success' },
];

const typeColor = { success: 'var(--success)', danger: 'var(--danger)', info: 'var(--info)', warning: 'var(--warning)' };

export default function Dashboard({ onNavigate }) {
  const [chartMetric, setChartMetric] = useState('Emails Sent');
  const [liveStats, setLiveStats] = useState(null);

  useEffect(() => {
    // Fetch live dashboard metrics from the new API
    api.get('/dashboard').then(data => {
      if (!data.error) setLiveStats(data);
    });
  }, []);

  const data = barData[chartMetric];
  const maxVal = Math.max(...data);

  // Dynamic stats array using real data if available
  const statsList = [
    { label: 'Active Campaigns', value: liveStats?.activeCampaigns ?? '—', trend: `${liveStats?.totalCampaigns ?? 0} total`, dir: 'neutral', icon: '📢', color: '#818cf8' },
    { label: 'Emails Sent',      value: (liveStats?.sent ?? 0).toLocaleString(), trend: 'All time', dir: 'up', icon: '📤', color: '#06b6d4' },
    { label: 'Avg Open Rate',    value: `${liveStats?.openRate ?? '0.0'}%`, trend: 'All time', dir: 'up', icon: '👁', color: '#10b981' },
    { label: 'Reply Rate',       value: `${liveStats?.replyRate ?? '0.0'}%`, trend: 'All time', dir: 'up', icon: '💬', color: '#f59e0b' },
    { label: 'Prospects',        value: (liveStats?.prospects ?? 0).toLocaleString(), trend: 'Total in DB', dir: 'up', icon: '👥', color: '#ec4899' },
    { label: 'Email Accounts',   value: liveStats?.accountsCount ?? (liveStats?.warmupAccounts?.length ?? 0), trend: 'Connected', dir: 'neutral', icon: '📬', color: '#10b981' },
    { label: 'Deliverability',   value: '96.2%', trend: 'Excellent', dir: 'neutral', icon: '✅', color: '#10b981' },
    { label: 'Bounce Rate',      value: `${liveStats?.bounceRate ?? '0.0'}%`, trend: 'Avg: <2%', dir: liveStats?.bounceRate > 2 ? 'down' : 'up', icon: '⚡', color: '#6366f1' },
  ];

  return (
    <div className="page-block fade-up">
      <div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Good morning, 👋</h2>
        <p className="text-secondary fs-sm" style={{ marginTop: '0.3rem' }}>Here is your platform overview</p>
      </div>

      {/* 8-stat grid */}
      <div className="grid-4" style={{ gap: '1rem' }}>
        {statsList.map((s, i) => (
          <div key={i} className="card stat-card fade-up" style={{ animationDelay: `${i * 0.05}s`, cursor: 'pointer' }}
            onClick={() => {
              if (s.label.includes('Campaign')) onNavigate('campaigns');
              else if (s.label.includes('Prospect')) onNavigate('prospects');
              else if (s.label.includes('Warmup')) onNavigate('warmup');
            }}>
            <div className="stat-icon" style={{ background: s.color + '18', color: s.color }}>{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className={`stat-trend ${s.dir}`}>
              {s.dir === 'up' ? '↑' : s.dir === 'down' ? '↓' : ''} {s.trend}
            </div>
          </div>
        ))}
      </div>

      {/* Chart + Activity */}
      <div className="grid-2" style={{ gridTemplateColumns: '1.6fr 1fr', gap: '1.5rem' }}>
        <div className="card card-p">
          <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Campaign Performance</h3>
              <p className="fs-xs text-muted">{chartMetric} per month — 2026</p>
            </div>
            <select
              className="form-select"
              style={{ width: 'auto', fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
              value={chartMetric}
              onChange={(e) => setChartMetric(e.target.value)}
            >
              {Object.keys(barData).map((k) => <option key={k}>{k}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '180px', padding: '0 0 8px' }}>
            {data.map((h, i) => (
              <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                <div
                  title={`${months[i]}: ${h}${chartMetric === 'Emails Sent' ? '' : '%'}`}
                  style={{
                    width: '100%',
                    height: `${(h / maxVal) * 100}%`,
                    background: i === 4 ? 'linear-gradient(to top, #6366f1, #818cf8)' : 'rgba(99,102,241,0.25)',
                    borderRadius: '5px 5px 0 0',
                    border: i === 4 ? '1px solid #6366f1' : '1px solid rgba(99,102,241,0.15)',
                    transition: 'height 0.6s cubic-bezier(.16,1,.3,1)',
                    cursor: 'default',
                  }}
                ></div>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{months[i]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-p">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>Live Activity</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {activity.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.875rem', padding: '0.7rem 0', borderBottom: i < activity.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: typeColor[a.type] + '18', border: `1px solid ${typeColor[a.type]}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0 }}>{a.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{a.label}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.sub}</div>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions + Warmup */}
      <div className="grid-2" style={{ gap: '1.5rem' }}>
        <div className="card card-p">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>Quick Actions</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {[
              { label: 'New Campaign', icon: '📢', nav: 'campaigns' },
              { label: 'Import Prospects', icon: '👥', nav: 'prospects' },
              { label: 'Connect Email', icon: '📬', nav: 'warmup' },
              { label: 'View Analytics', icon: '📊', nav: 'campaigns' },
            ].map((q, i) => (
              <button
                key={i}
                className="btn btn-secondary"
                style={{ flexDirection: 'column', height: 72, gap: '0.4rem', border: '1px solid var(--border-color)' }}
                onClick={() => onNavigate(q.nav)}
              >
                <span style={{ fontSize: '1.25rem' }}>{q.icon}</span>
                <span style={{ fontSize: '0.78rem' }}>{q.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card card-p">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>Account Warmup Status</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {(liveStats?.warmupAccounts?.length > 0 ? liveStats.warmupAccounts : []).map((a, i) => (
              <div key={i} style={{ cursor: 'pointer' }} onClick={() => onNavigate('warmup')}>
                <div className="flex-between" style={{ marginBottom: '0.3rem' }}>
                  <span style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{a.email}</span>
                  <span style={{ fontWeight: 700, color: (a.warmup_status === 'Active' ? 'var(--success)' : 'var(--warning)'), fontSize: '0.85rem' }}>
                    {a.warmup_status === 'Active' ? '92' : 'Paused'}
                  </span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: a.warmup_status === 'Active' ? '92%' : '0%', background: a.warmup_status === 'Active' ? 'var(--success)' : 'var(--warning)' }}></div>
                </div>
              </div>
            ))}
            {!liveStats?.warmupAccounts?.length && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No accounts connected yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
