import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';

const TIMEZONES = [
  'America/New_York (UTC -04:00)',
  'America/Chicago (UTC -05:00)',
  'America/Los_Angeles (UTC -07:00)',
  'Europe/London (UTC +01:00)',
  'Europe/Berlin (UTC +02:00)',
  'Asia/Karachi (UTC +05:00)',
  'Asia/Kolkata (UTC +05:30)',
  'Asia/Tokyo (UTC +09:00)',
  'Australia/Sydney (UTC +10:00)',
];
// Parse "8:30 AM" → { h:'8', m:'30', ampm:'AM' }
function parseTime(str) {
  const match = String(str||'').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match) return { h:String(parseInt(match[1])), m:match[2], ampm:match[3].toUpperCase() };
  return { h:'8', m:'00', ampm:'AM' };
}
function fmtTime({ h, m, ampm }) {
  const hh = Math.min(12, Math.max(1, parseInt(h)||1));
  const mm = Math.min(59, Math.max(0, parseInt(m)||0));
  return `${hh}:${String(mm).padStart(2,'0')} ${ampm}`;
}
function TimePicker({ value, onChange }) {
  const parts = parseTime(value);
  function upd(field, val) { onChange(fmtTime({ ...parseTime(value), [field]: val })); }
  function clamp(field, min, max, val) {
    const n = Math.min(max, Math.max(min, parseInt(val)||min));
    upd(field, field==='m' ? String(n).padStart(2,'0') : String(n));
  }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:4,
      background:'var(--bg-tertiary)', border:'1px solid var(--border-color)',
      borderRadius:8, padding:'6px 10px', width:'fit-content' }}>
      <input type="number" min="1" max="12" value={parts.h}
        onChange={e => upd('h', e.target.value)}
        onBlur={e => clamp('h',1,12,e.target.value)}
        style={{ width:38, background:'none', border:'none', outline:'none',
          color:'var(--text-primary)', fontSize:'1.05rem', fontWeight:700,
          textAlign:'center', MozAppearance:'textfield' }} />
      <span style={{ color:'var(--text-muted)', fontWeight:800, fontSize:'1.1rem' }}>:</span>
      <input type="number" min="0" max="59" value={parts.m}
        onChange={e => upd('m', e.target.value)}
        onBlur={e => clamp('m',0,59,e.target.value)}
        style={{ width:38, background:'none', border:'none', outline:'none',
          color:'var(--text-primary)', fontSize:'1.05rem', fontWeight:700,
          textAlign:'center', MozAppearance:'textfield' }} />
      <button onClick={() => upd('ampm', parts.ampm==='AM'?'PM':'AM')}
        style={{ marginLeft:4, background: parts.ampm==='AM'
            ? 'rgba(99,102,241,0.2)' : 'rgba(239,68,68,0.18)',
          border:'none', borderRadius:6, padding:'4px 10px',
          color: parts.ampm==='AM' ? 'var(--accent-primary)' : '#f87171',
          fontWeight:700, fontSize:'0.8rem', cursor:'pointer',
          transition:'all 0.15s', letterSpacing:'0.05em' }}>
        {parts.ampm}
      </button>
    </div>
  );
}
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const DEFAULT = {
  days:           { Monday:true, Tuesday:true, Wednesday:true, Thursday:true, Friday:true, Saturday:false, Sunday:false },
  timezone:       'Asia/Karachi (UTC +05:00)',
  startTime:      '8:00 AM',
  endTime:        '6:00 PM',
  startDate:      '',
  endDate:        '',
  maxEmails:      '100',
  maxLeads:       '',
  // Account split
  autoSplit:      true,
  accountCount:   '1',
  // Delivery mode: 'random' | 'quick' | 'custom'
  deliveryMode:   'random',
  quickMinutes:   '60',         // deliver all emails within N minutes
  customInterval: '2',          // minutes between each email
  customUnit:     'minutes',    // 'seconds' | 'minutes' | 'hours'
};

const Section = ({ title, subtitle, children }) => (
  <div>
    <div style={{ marginBottom:'0.75rem' }}>
      <div style={{ fontSize:'0.75rem', fontWeight:700, letterSpacing:'0.08em', color:'var(--text-muted)', textTransform:'uppercase' }}>{title}</div>
      {subtitle && <p className="fs-xs text-muted" style={{ marginTop:'0.2rem' }}>{subtitle}</p>}
    </div>
    {children}
  </div>
);

function Radio({ value, current, onChange, label, desc }) {
  const active = value === current;
  return (
    <label onClick={() => onChange(value)}
      style={{ display:'flex', alignItems:'flex-start', gap:'0.75rem', padding:'0.875rem 1rem', borderRadius:10, cursor:'pointer', border:`1px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`, background: active ? 'rgba(99,102,241,0.07)' : 'var(--overlay-1)', transition:'all 0.15s' }}>
      <div style={{ width:18, height:18, borderRadius:'50%', border:`2px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2 }}>
        {active && <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--accent-primary)' }} />}
      </div>
      <div>
        <div style={{ fontWeight:600, fontSize:'0.875rem', color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</div>
        <div className="fs-xs text-muted" style={{ marginTop:'0.2rem' }}>{desc}</div>
      </div>
    </label>
  );
}

export default function CampaignSchedule({ campaign }) {
  const [data,     setData]     = useState(DEFAULT);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [toast,    setToast]    = useState('');
  const [seqSteps, setSeqSteps] = useState([]); // follow-up steps from sequence

  function showToast(m) { setToast(m); setTimeout(()=>setToast(''), 2400); }
  const set  = (field) => (e) => setData(p => ({ ...p, [field]: e.target.value }));
  const setV = (field, val) => setData(p => ({ ...p, [field]: val }));
  const toggleDay = (d) => setData(p => ({ ...p, days: { ...p.days, [d]: !p.days[d] } }));

  useEffect(() => {
    if (!campaign?.id) { setLoading(false); return; }
    Promise.all([
      api.get(`/campaigns/${campaign.id}/schedule`),
      api.get(`/campaigns/${campaign.id}/sequences`),
      api.get(`/campaigns/${campaign.id}/accounts`),
    ]).then(([sched, seq, accts]) => {
      if (sched && !sched.error && typeof sched === 'object') setData({ ...DEFAULT, ...sched });
      if (Array.isArray(seq) && seq.length > 1) setSeqSteps(seq.slice(1));
      // Auto-set account count from Settings tab
      if (Array.isArray(accts) && accts.length > 0) {
        setData(p => ({ ...p, accountCount: String(accts.length) }));
      }
      setLoading(false);
    });
  }, [campaign?.id]);

  // Save both schedule + updated sequence wait days
  async function saveSchedule() {
    // The form renders even with no campaign loaded — saving then would throw.
    if (!campaign?.id) { showToast('No campaign selected — nothing to save'); return; }
    if (saving) return;
    setSaving(true);
    await api.post(`/campaigns/${campaign.id}/schedule`, data);
    // If user edited wait days on follow-up steps, save sequence too
    if (seqSteps.length) {
      const all = await api.get(`/campaigns/${campaign.id}/sequences`);
      if (Array.isArray(all) && all.length > 1) {
        const updated = [all[0], ...seqSteps];
        await api.post(`/campaigns/${campaign.id}/sequences`, updated);
      }
    }
    setSaving(false); setSaved(true); showToast('Schedule saved ✅');
    setTimeout(() => setSaved(false), 2500);
  }

  const ac         = Math.max(1, parseInt(data.accountCount)||1);
  const perAccount = data.autoSplit ? Math.max(1, Math.floor((parseInt(data.maxEmails)||0) / ac)) : null;
  const perLeads   = data.autoSplit && data.maxLeads ? Math.max(1, Math.floor((parseInt(data.maxLeads)||0) / ac)) : null;

  // interval display for quick mode
  const quickIntervalSec = data.quickMinutes && data.maxEmails
    ? ((parseFloat(data.quickMinutes) * 60) / Math.max(1, parseInt(data.maxEmails))).toFixed(1)
    : null;

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, color:'var(--text-muted)' }}>
      ⏳ Loading schedule…
    </div>
  );

  return (
    <div style={{ maxWidth:780, padding:'1.5rem 0 3rem', display:'flex', flexDirection:'column', gap:'2rem' }}>
      {toast && <div style={{ position:'fixed', bottom:24, right:24, background:'#10b981', color:'#fff', padding:'0.75rem 1.25rem', borderRadius:10, fontWeight:500, zIndex:999, boxShadow:'0 4px 16px rgba(0,0,0,0.3)', fontSize:'0.875rem' }}>{toast}</div>}

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h3 style={{ fontWeight:700, fontSize:'1rem', marginBottom:'0.2rem' }}>📅 Campaign Schedule</h3>
          <p className="fs-sm text-secondary">Configure when and how this campaign delivers emails.</p>
        </div>
        <button className="btn btn-primary" onClick={saveSchedule} disabled={saving} style={{ flexShrink:0 }}>
          {saving ? '⏳ Saving…' : saved ? '✅ Saved' : 'Save Schedule'}
        </button>
      </div>

      {/* ── Days ── */}
      <Section title="Sending Days">
        <div className="card card-p">
          <div style={{ display:'flex', gap:'0.6rem', flexWrap:'wrap' }}>
            {DAYS.map(d => (
              <label key={d} style={{ display:'flex', alignItems:'center', gap:'0.45rem', cursor:'pointer', userSelect:'none',
                padding:'6px 12px', borderRadius:8, border:`1px solid ${data.days[d] ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                background: data.days[d] ? 'rgba(99,102,241,0.1)' : 'var(--overlay-1)', transition:'all 0.15s' }}>
                <input type="checkbox" checked={data.days[d]} onChange={() => toggleDay(d)} style={{ display:'none' }} />
                <span style={{ fontSize:'0.8rem', fontWeight: data.days[d] ? 600 : 400, color: data.days[d] ? 'var(--accent-primary)' : 'var(--text-muted)' }}>{d.slice(0,3)}</span>
              </label>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Time Window ── */}
      <Section title="Time Window">
        <div className="card card-p" style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>
          <div className="form-group">
            <label className="form-label">Timezone</label>
            <select className="form-input" value={data.timezone} onChange={set('timezone')}>
              {TIMEZONES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="schedule-grid-2">
            <div className="form-group">
              <label className="form-label">Daily start time</label>
              <TimePicker value={data.startTime} onChange={v => setV('startTime', v)} />
              <span className="fs-xs text-muted">Type hour &amp; minute, click AM/PM to toggle</span>
            </div>
            <div className="form-group">
              <label className="form-label">Daily end time</label>
              <TimePicker value={data.endTime} onChange={v => setV('endTime', v)} />
              <span className="fs-xs text-muted">Type hour &amp; minute, click AM/PM to toggle</span>
            </div>
          </div>
          <div className="schedule-grid-2">
            <div className="form-group">
              <label className="form-label">Campaign start date</label>
              <input type="date" className="form-input" value={data.startDate} onChange={set('startDate')} />
              <span className="fs-xs text-muted">Leave empty to start immediately</span>
            </div>
            <div className="form-group">
              <label className="form-label">Campaign end date</label>
              <input type="date" className="form-input" value={data.endDate} onChange={set('endDate')} />
              <span className="fs-xs text-muted">Leave empty to run until complete</span>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Sending Limits + Account Split ── */}
      <Section title="Daily Sending Limits" subtitle="Set total emails and leads per day. Enable equal split to auto-divide across all connected sending accounts.">
        <div className="card card-p" style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>

          {/* Account count + toggle (top) */}
          <div style={{ display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap', paddingBottom:'0.75rem', borderBottom:'1px solid var(--border-color)' }}>
            <label style={{ display:'flex', alignItems:'center', gap:'0.75rem', cursor:'pointer' }}>
              <div onClick={() => setV('autoSplit', !data.autoSplit)}
                style={{ width:38, height:22, borderRadius:99, cursor:'pointer', transition:'all 0.2s', position:'relative', flexShrink:0,
                  background: data.autoSplit ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  border: `2px solid ${data.autoSplit ? 'var(--accent-primary)' : 'var(--border-color)'}` }}>
                <div style={{ position:'absolute', top:1, left: data.autoSplit ? 14 : 1, width:16, height:16, borderRadius:'50%', background:'#fff', transition:'left 0.2s' }} />
              </div>
              <span style={{ fontSize:'0.875rem', fontWeight:600 }}>Equally divide across accounts</span>
            </label>
            {data.autoSplit && (
              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                <span className="fs-sm text-muted">Connected accounts:</span>
                <input type="number" min="1" max="100" value={data.accountCount} onChange={set('accountCount')}
                  style={{ width:60, background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:6, color:'var(--text-primary)', padding:'4px 8px', fontSize:'0.9rem', fontWeight:700, textAlign:'center' }} />
                <span style={{ fontSize:'0.72rem', background:'rgba(99,102,241,0.12)', color:'#818cf8', padding:'2px 8px', borderRadius:99, fontWeight:500 }}>
                  📡 auto-detected from Settings
                </span>
              </div>
            )}
          </div>

          {/* Max emails */}
          <div className="form-group">
            <label className="form-label">📧 Max emails per day <span className="fs-xs text-muted">(total across all accounts)</span></label>
            <div style={{ display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
              <input className="form-input" type="number" min="1" value={data.maxEmails} onChange={set('maxEmails')}
                style={{ maxWidth:140 }} />
              {data.autoSplit && perAccount !== null && (
                <div style={{ background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.3)', borderRadius:8, padding:'5px 14px', fontSize:'0.82rem', color:'#10b981', fontWeight:600 }}>
                  ✅ {data.accountCount} accounts × <strong>{perAccount} emails/day</strong> each
                </div>
              )}
            </div>
          </div>

          {/* Max new leads */}
          <div className="form-group">
            <label className="form-label">👥 Max new leads per day <span className="fs-xs text-muted">(total across all accounts)</span></label>
            <div style={{ display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
              <input className="form-input" type="number" placeholder="No limit" value={data.maxLeads} onChange={set('maxLeads')}
                style={{ maxWidth:140 }} />
              {data.autoSplit && perLeads !== null && (
                <div style={{ background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, padding:'5px 14px', fontSize:'0.82rem', color:'#818cf8', fontWeight:600 }}>
                  ✅ {data.accountCount} accounts × <strong>{perLeads} leads/day</strong> each
                </div>
              )}
            </div>
          </div>

        </div>
      </Section>

      {/* ── Delivery Speed Mode ── */}
      <Section title="Delivery Speed" subtitle="Control the pace at which emails are sent within the time window.">
        <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>

          <Radio value="random" current={data.deliveryMode} onChange={v => setV('deliveryMode', v)}
            label="🎲 Auto Random (Recommended)"
            desc="The system randomly spaces emails within your time window — mimics human behaviour, best for deliverability." />

          <Radio value="quick" current={data.deliveryMode} onChange={v => setV('deliveryMode', v)}
            label="⚡ Quick Delivery"
            desc="Send all emails as fast as possible within a set target window (e.g. all 100 emails within 2 minutes)." />

          {data.deliveryMode === 'quick' && (
            <div className="card card-p" style={{ background:'rgba(251,191,36,0.06)', border:'1px solid rgba(251,191,36,0.25)', display:'flex', flexDirection:'column', gap:'0.75rem' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
                <label className="form-label" style={{ margin:0, whiteSpace:'nowrap' }}>Deliver all emails within:</label>
                <input type="number" min="1" value={data.quickMinutes} onChange={set('quickMinutes')}
                  style={{ width:70, background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:6, color:'var(--text-primary)', padding:'4px 8px', fontSize:'0.85rem', textAlign:'center' }} />
                <span style={{ fontSize:'0.85rem', color:'var(--text-secondary)' }}>minutes</span>
              </div>
              {quickIntervalSec && (
                <div style={{ fontSize:'0.8rem', color:'rgba(251,191,36,0.9)', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                  ⚡ With <strong>{data.maxEmails}</strong> emails → ~<strong>{quickIntervalSec}s</strong> between each email
                  {parseFloat(quickIntervalSec) < 5 && (
                    <span style={{ background:'rgba(239,68,68,0.15)', color:'var(--danger)', padding:'2px 8px', borderRadius:99, fontSize:'0.72rem', fontWeight:600 }}>
                      ⚠ Very fast — may trigger spam filters
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <Radio value="custom" current={data.deliveryMode} onChange={v => setV('deliveryMode', v)}
            label="⏱ Custom Interval"
            desc="You set the exact gap between each email. E.g. send 1 email, wait 2 minutes, send the next." />

          {data.deliveryMode === 'custom' && (
            <div className="card card-p" style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.2)', display:'flex', flexDirection:'column', gap:'0.75rem' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
                <label className="form-label" style={{ margin:0, whiteSpace:'nowrap' }}>Gap between emails:</label>
                <input type="number" min="1" value={data.customInterval} onChange={set('customInterval')}
                  style={{ width:70, background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:6, color:'var(--text-primary)', padding:'4px 8px', fontSize:'0.85rem', textAlign:'center' }} />
                <select value={data.customUnit} onChange={set('customUnit')}
                  style={{ background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:6, color:'var(--text-secondary)', fontSize:'0.82rem', padding:'4px 8px' }}>
                  <option value="seconds">Seconds</option>
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                </select>
              </div>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>
                📧 With <strong>{data.maxEmails}</strong> emails at <strong>{data.customInterval} {data.customUnit}</strong> intervals
                → total time ≈ <strong>
                  {(() => {
                    const secs = parseInt(data.customInterval||1) * (data.customUnit==='seconds'?1:data.customUnit==='minutes'?60:3600) * (parseInt(data.maxEmails||1)-1);
                    if (secs < 60) return `${secs}s`;
                    if (secs < 3600) return `${Math.round(secs/60)} min`;
                    return `${(secs/3600).toFixed(1)} hrs`;
                  })()}
                </strong> to complete
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Follow-up Steps (from Sequence) ── */}
      {seqSteps.length > 0 && (
        <Section title="Follow-up Step Delays"
          subtitle={`Loaded from your sequence. Adjust the wait days before each follow-up email (Step 2 onwards). Changes save with the schedule.`}>
          <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
            {seqSteps.map((step, i) => (
              <div key={step.id ?? i} className="card card-p"
                style={{ display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap',
                         padding:'0.75rem 1rem', background:'var(--overlay-1)' }}>
                <span style={{ background:'var(--accent-primary)', color:'#fff', padding:'2px 10px', borderRadius:99, fontSize:'0.75rem', fontWeight:700, flexShrink:0 }}>
                  Step {i + 2}
                </span>
                <span style={{ fontSize:'0.82rem', color:'var(--text-secondary)', flex:1 }}>
                  {step.variations?.[0]?.subject || `Follow-up ${i + 2}`}
                </span>
                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexShrink:0 }}>
                  <span className="fs-xs text-muted">Wait</span>
                  <input type="number" min="0" value={step.waitDays ?? 3}
                    onChange={e => setSeqSteps(p => p.map((s,j) => j===i ? {...s, waitDays: parseInt(e.target.value)||0} : s))}
                    style={{ width:52, background:'var(--bg-tertiary)', border:'1px solid var(--border-color)', borderRadius:6,
                      color:'var(--text-primary)', padding:'4px 8px', fontSize:'0.9rem', fontWeight:700, textAlign:'center' }} />
                  <span className="fs-xs text-muted">days before sending</span>
                </div>
                <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', flexShrink:0 }}>
                  {step.variations?.length > 1 ? `${step.variations.length} variations` : '1 variation'}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {seqSteps.length === 0 && !loading && (
        <div style={{ background:'var(--overlay-1)', border:'1px dashed var(--border-color)', borderRadius:10, padding:'1.25rem', textAlign:'center', fontSize:'0.85rem', color:'var(--text-muted)' }}>
          📭 No follow-up steps yet — go to the <strong>Sequences</strong> tab and add Step 2, 3… to configure follow-up delays here.
        </div>
      )}

      {/* ── Summary ── */}
      <div className="card card-p" style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.2)' }}>
        <div style={{ fontWeight:700, fontSize:'0.85rem', marginBottom:'0.65rem' }}>📋 Schedule Summary</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'0.5rem 2rem', fontSize:'0.82rem', color:'var(--text-secondary)' }}>
          <span>⏰ {data.startTime} – {data.endTime}</span>
          <span>🗓 {Object.entries(data.days).filter(([,v])=>v).map(([k])=>k.slice(0,3)).join(', ') || 'No days'}</span>
          <span>🌍 {data.timezone.split(' ')[0]}</span>
          <span>📧 {data.maxEmails}/day total</span>
          {data.autoSplit && <span>👥 {data.accountCount} accts × {perAccount} emails, {perLeads ?? '∞'} leads</span>}
          {data.deliveryMode==='random' && <span>🎲 Auto-random spacing</span>}
          {data.deliveryMode==='quick'  && <span>⚡ All in {data.quickMinutes} min</span>}
          {data.deliveryMode==='custom' && <span>⏱ {data.customInterval} {data.customUnit} between emails</span>}
          {seqSteps.length > 0 && <span>🔄 {seqSteps.length} follow-up step(s)</span>}
          {data.startDate && <span>▶ From {data.startDate}</span>}
          {data.endDate   && <span>⏹ Until {data.endDate}</span>}
        </div>
      </div>

      <button className="btn btn-primary" style={{ width:'fit-content' }} onClick={saveSchedule} disabled={saving}>
        {saving ? '⏳ Saving…' : saved ? '✅ Saved' : 'Save Schedule'}
      </button>
    </div>
  );
}
