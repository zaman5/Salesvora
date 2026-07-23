import React, { useState, useRef, useEffect } from 'react';
import { api } from '../../lib/api';

const LEAD_VARS = [
  ['First Name','{{first_name}}'],['Last Name','{{last_name}}'],['Full Name','{{full_name}}'],
  ['Email','{{email}}'],['Company','{{company}}'],['Job Title','{{job_title}}'],
  ['Phone','{{phone}}'],['City','{{city}}'],['State','{{state}}'],['Country','{{country}}'],
  ['LinkedIn','{{linkedin_url}}'],['Sender Name','{{sender_name}}'],['Sender Signature','{{sender_signature}}'],
];
const SPINTAX_LIST = [
  ['Hi/Hello/Hey','{{random|Hi|Hello|Hey}}'],
  ['Q/Checking/Followup','{{random|quick question|just checking in|following up}}'],
];
const FONTS = ['Default','Arial','Arial Black','Georgia','Impact','Times New Roman','Courier New','Verdana','Trebuchet MS'];

// Variation letters (A/B/C…) are display-only, derived from array position at
// render time — never stored — so removing a variation and adding a new one
// can't leave two variations both labeled "B" (each id below only needs to be
// unique, not meaningful).
let varSeq = 0;
const newVariation = () => {
  varSeq += 1;
  return { id: `v${Date.now()}_${varSeq}`, subject: '', body: '<p>{{random|Hi|Hello|Hey}} {{first_name}},</p><p><br></p><p>- {{sender_signature}}</p>' };
};
const letterFor = (vi) => 'ABCDEFGH'[vi] || `V${vi + 1}`;

const makeStep = (n) => ({
  id: Date.now() + n,
  waitDays: n === 1 ? 0 : 3,
  variations: [newVariation()],
  activeVar: 0,
});

// ── Rich Editor ────────────────────────────────────────────────────────────────
function RichEditor({ value, onChange }) {
  const editorRef  = useRef(null);
  const imgRef     = useRef(null);
  const lastRange  = useRef(null);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl,  setLinkUrl]  = useState('');
  const [linkText, setLinkText] = useState('');

  // Sync editor HTML from value prop (guarded so normal typing doesn't reset the cursor,
  // but external updates - e.g. sequences finishing their async load after mount - still apply)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== (value || '')) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  /* ── Selection helpers ── */
  function saveRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) lastRange.current = sel.getRangeAt(0).cloneRange();
  }
  function restoreRange() {
    if (!lastRange.current) { editorRef.current.focus(); return; }
    editorRef.current.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(lastRange.current);
  }

  /* ── Command helpers (always restore selection first) ── */
  function exec(cmd, val = null) {
    restoreRange();
    document.execCommand(cmd, false, val);
    onChange(editorRef.current.innerHTML);
    saveRange();
  }
  function ins(html) {
    restoreRange();
    document.execCommand('insertHTML', false, html);
    onChange(editorRef.current.innerHTML);
    saveRange();
  }
  function insertVar(v) {
    ins(`<span style="background:rgba(99,102,241,0.18);color:#818cf8;border-radius:3px;padding:1px 4px;font-family:monospace;font-size:0.82em">${v}</span>\u00a0`);
  }

  /* ── Link modal ── */
  function openLink() {
    saveRange();
    setLinkText(window.getSelection()?.toString() || '');
    setLinkUrl('');
    setShowLink(true);
  }
  function insertLink() {
    const display = linkText || linkUrl;
    ins(`<a href="${linkUrl}" target="_blank" style="color:#6366f1;text-decoration:underline">${display}</a>\u00a0`);
    setShowLink(false);
  }

  /* ── Image upload ── */
  function handleImg(e) {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = ev => ins(`<img src="${ev.target.result}" style="max-width:100%;border-radius:6px;margin:4px 0"/>`);
    r.readAsDataURL(file);
    e.target.value = '';
  }

  /* ── Toolbar helpers ── */
  const D = () => <div style={{width:1,height:18,background:'var(--border-color)',margin:'0 3px',flexShrink:0}}/>;

  // Button: uses onMouseDown + preventDefault to keep editor focus
  const B = ({title,cmd,val,children}) => (
    <button title={title} onMouseDown={e=>{e.preventDefault();exec(cmd,val)}}
      style={{background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer',
              padding:'3px 6px',borderRadius:4,fontSize:'0.82rem',lineHeight:1}}
      onMouseEnter={e=>e.currentTarget.style.background='var(--overlay-8)'}
      onMouseLeave={e=>e.currentTarget.style.background='none'}>
      {children}
    </button>
  );

  // Select: save range onMouseDown, then exec onChange
  const Sel = ({style, onChange:cb, children, defaultValue}) => (
    <select defaultValue={defaultValue}
      onMouseDown={saveRange}
      onChange={cb}
      style={{background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',
              borderRadius:4,color:'var(--text-secondary)',fontSize:'0.72rem',
              padding:'2px 4px',...style}}>
      {children}
    </select>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>

      {/* ── Toolbar ── */}
      <div style={{display:'flex',alignItems:'center',gap:2,padding:'5px 8px',
                   borderBottom:'1px solid var(--border-color)',flexWrap:'wrap',
                   background:'var(--overlay-1)',rowGap:4}}>

        {/* Font family */}
        <Sel style={{maxWidth:108}} onChange={e=>{const v=e.target.value;if(v!=='Default')exec('fontName',v);}}>
          {FONTS.map(f=><option key={f}>{f}</option>)}
        </Sel>

        {/* Font size */}
        <Sel style={{maxWidth:72}} defaultValue="3" onChange={e=>exec('fontSize',e.target.value)}>
          <option value="1">Small</option>
          <option value="2">Smaller</option>
          <option value="3">Normal</option>
          <option value="4">Medium</option>
          <option value="5">Large</option>
          <option value="6">Larger</option>
          <option value="7">Huge</option>
        </Sel>

        {/* Heading */}
        <Sel style={{maxWidth:82}} onChange={e=>{exec('formatBlock',e.target.value||'p');e.target.value='';}}>
          <option value="">Style</option>
          <option value="p">Normal</option>
          <option value="h1">H1</option>
          <option value="h2">H2</option>
          <option value="h3">H3</option>
          <option value="blockquote">Quote</option>
          <option value="pre">Code</option>
        </Sel>

        <D/>

        <B title="Bold (Ctrl+B)" cmd="bold"><b style={{fontFamily:'serif'}}>B</b></B>
        <B title="Italic (Ctrl+I)" cmd="italic"><i>I</i></B>
        <B title="Underline (Ctrl+U)" cmd="underline"><u>U</u></B>
        <B title="Strikethrough" cmd="strikeThrough"><s>S</s></B>
        <B title="Subscript" cmd="subscript"><sub style={{fontSize:'0.7rem'}}>₂</sub></B>
        <B title="Superscript" cmd="superscript"><sup style={{fontSize:'0.7rem'}}>²</sup></B>

        <D/>

        {/* Text color */}
        <label title="Text Color" style={{cursor:'pointer',display:'flex',alignItems:'center',gap:2,padding:'2px 5px'}}>
          <span style={{fontSize:'0.8rem',fontWeight:700,color:'var(--text-secondary)',borderBottom:'2.5px solid #ef4444'}}>A</span>
          <input type="color" defaultValue="#ff0000"
            onMouseDown={saveRange}
            onChange={e=>exec('foreColor',e.target.value)}
            style={{width:0,height:0,opacity:0,position:'absolute'}} />
        </label>

        {/* Highlight color */}
        <label title="Highlight" style={{cursor:'pointer',display:'flex',alignItems:'center',gap:2,padding:'2px 5px'}}>
          <span style={{fontSize:'0.75rem',fontWeight:700,background:'#fef08a',color:'#000',borderRadius:2,padding:'0 3px'}}>H</span>
          <input type="color" defaultValue="#fef08a"
            onMouseDown={saveRange}
            onChange={e=>exec('backColor',e.target.value)}
            style={{width:0,height:0,opacity:0,position:'absolute'}} />
        </label>

        <D/>

        <B title="Align Left" cmd="justifyLeft">⬅</B>
        <B title="Center" cmd="justifyCenter">↔</B>
        <B title="Align Right" cmd="justifyRight">➡</B>
        <B title="Justify" cmd="justifyFull">≡</B>

        <D/>

        <B title="Bullet List" cmd="insertUnorderedList">• ≡</B>
        <B title="Numbered List" cmd="insertOrderedList">1 ≡</B>
        <B title="Indent" cmd="indent">⇥</B>
        <B title="Outdent" cmd="outdent">⇤</B>

        <D/>

        {/* Link */}
        <button title="Insert Link" onMouseDown={e=>{e.preventDefault();openLink();}}
          style={{background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer',padding:'3px 5px',borderRadius:4,fontSize:'0.85rem'}}>
          🔗
        </button>

        {/* Image upload */}
        <button title="Upload Image" onMouseDown={e=>{e.preventDefault();imgRef.current.click();}}
          style={{background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer',padding:'3px 5px',borderRadius:4,fontSize:'0.85rem'}}>
          🖼
        </button>
        <input ref={imgRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleImg}/>

        {/* Image by URL */}
        <button title="Image by URL" onMouseDown={e=>{e.preventDefault();const u=prompt('Image URL:');if(u)ins(`<img src="${u}" style="max-width:100%;border-radius:6px;margin:4px 0"/>`);}}
          style={{background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer',padding:'3px 5px',borderRadius:4,fontSize:'0.7rem'}}>
          URL🖼
        </button>

        {/* HR */}
        <button title="Divider" onMouseDown={e=>{e.preventDefault();ins('<hr style="border:none;border-top:1px solid var(--overlay-15);margin:12px 0"/><p><br></p>');}}
          style={{background:'none',border:'none',color:'var(--text-secondary)',cursor:'pointer',padding:'3px 5px',borderRadius:4,fontSize:'0.85rem'}}>─</button>

        <B title="Remove Formatting" cmd="removeFormat">✕A</B>
        <B title="Undo (Ctrl+Z)" cmd="undo">↩</B>
        <B title="Redo (Ctrl+Y)" cmd="redo">↪</B>

        <D/>

        {/* Variables */}
        <select onMouseDown={saveRange}
          onChange={e=>{if(e.target.value){insertVar(e.target.value);e.target.value='';}}}
          style={{background:'var(--bg-tertiary)',border:'1px solid rgba(99,102,241,0.5)',borderRadius:5,
                  color:'#818cf8',fontSize:'0.72rem',padding:'3px 5px',cursor:'pointer',maxWidth:112}}>
          <option value="">{'{{ }}'} Variables</option>
          {LEAD_VARS.map(([l,v])=><option key={v} value={v}>{l}</option>)}
        </select>

        {/* Spintax */}
        <select onMouseDown={saveRange}
          onChange={e=>{if(e.target.value){ins(`<span style="color:#a78bfa;font-family:monospace;font-size:0.82em">${e.target.value}</span>\u00a0`);e.target.value='';}}}
          style={{background:'var(--bg-tertiary)',border:'1px solid rgba(139,92,246,0.5)',borderRadius:5,
                  color:'#a78bfa',fontSize:'0.72rem',padding:'3px 5px',cursor:'pointer',maxWidth:92}}>
          <option value="">Spintax</option>
          {SPINTAX_LIST.map(([l,v])=><option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {/* ── Editor body ── */}
      <div ref={editorRef} contentEditable suppressContentEditableWarning
        onInput={()=>{onChange(editorRef.current.innerHTML);saveRange();}}
        onMouseUp={saveRange} onKeyUp={saveRange} onClick={saveRange}
        style={{flex:1,padding:'1rem 1.25rem',outline:'none',color:'var(--text-primary)',
                fontSize:'0.9rem',lineHeight:1.75,overflowY:'auto',minHeight:180,
                background:'transparent'}}
      />

      {/* Footer */}
      <div style={{padding:'4px 12px',borderTop:'1px solid var(--border-color)',
                   display:'flex',alignItems:'center',gap:'1rem',fontSize:'0.72rem',color:'var(--text-muted)'}}>
        <span>Characters: {(editorRef.current?.innerText||'').length}</span>
        <span style={{marginLeft:'auto',background:'#10b98120',color:'#10b981',padding:'2px 10px',borderRadius:99,fontWeight:600}}>
          Score: Excellent
        </span>
      </div>

      {/* ── Link modal ── */}
      {showLink && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:500}}
          onClick={()=>setShowLink(false)}>
          <div style={{background:'var(--bg-secondary)',borderRadius:14,padding:'1.5rem',width:360,boxShadow:'0 8px 32px rgba(0,0,0,0.5)'}}
            onClick={e=>e.stopPropagation()}>
            <h4 style={{fontWeight:700,marginBottom:'1rem',fontSize:'1rem'}}>🔗 Insert Link</h4>
            <div className="form-group" style={{marginBottom:'0.75rem'}}>
              <label className="form-label">URL</label>
              <input className="form-input" autoFocus placeholder="https://example.com"
                value={linkUrl} onChange={e=>setLinkUrl(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&linkUrl&&insertLink()}/>
            </div>
            <div className="form-group" style={{marginBottom:'1rem'}}>
              <label className="form-label">Display Text (optional)</label>
              <input className="form-input" placeholder="Click here"
                value={linkText} onChange={e=>setLinkText(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&linkUrl&&insertLink()}/>
            </div>
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" onClick={()=>setShowLink(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={insertLink} disabled={!linkUrl}>Insert →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main SequenceBuilder ───────────────────────────────────────────────────────
export default function SequenceBuilder({ campaign }) {
  const [steps,      setSteps]      = useState([makeStep(1),makeStep(2)]);
  const [activeStep, setActiveStep] = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [toast,      setToast]      = useState('');
  // Snapshot of what's actually persisted server-side, so the status line can
  // tell "you have edits to save" apart from "nothing has changed yet" —
  // otherwise a freshly-loaded, untouched sequence always claimed "Unsaved".
  const persistedRef = useRef(null);
  const dirty = persistedRef.current !== null && JSON.stringify(steps) !== persistedRef.current;

  function showToast(m){setToast(m);setTimeout(()=>setToast(''),2500);}

  useEffect(()=>{
    if(!campaign?.id)return;
    setLoading(true);
    api.get(`/campaigns/${campaign.id}/sequences`).then(data=>{
      if(Array.isArray(data)&&data.length>0){
        setSteps(data);
        persistedRef.current = JSON.stringify(data);
      }
      setLoading(false);
    });
  },[campaign?.id]);

  async function saveAll(){
    setSaving(true);
    const snapshot = JSON.stringify(steps);
    await api.post(`/campaigns/${campaign.id}/sequences`,steps);
    persistedRef.current = snapshot;
    setSaving(false);setSaved(true);showToast('Sequence saved ✅');
    setTimeout(()=>setSaved(false),2500);
  }

  function addStep(){const s=makeStep(steps.length+1);setSteps(p=>[...p,s]);setActiveStep(steps.length);}
  function removeStep(idx){
    if(steps.length===1)return;
    setSteps(p=>p.filter((_,i)=>i!==idx));
    setActiveStep(i=>Math.max(0,i>=idx?i-1:i));
  }
  function addVar(si){
    setSteps(p=>p.map((s,i)=>{
      if(i!==si)return s;
      return{...s,variations:[...s.variations,newVariation()],activeVar:s.variations.length};
    }));
  }
  function removeVar(si,vi){
    setSteps(p=>p.map((s,i)=>{
      if(i!==si||s.variations.length===1)return s;
      return{...s,variations:s.variations.filter((_,j)=>j!==vi),activeVar:Math.max(0,vi-1)};
    }));
  }
  function setAV(si,vi){setSteps(p=>p.map((s,i)=>i===si?{...s,activeVar:vi}:s));}
  function updWait(si,v){setSteps(p=>p.map((s,i)=>i===si?{...s,waitDays:parseInt(v)||0}:s));}
  function updSubj(si,vi,v){setSteps(p=>p.map((s,i)=>i!==si?s:{...s,variations:s.variations.map((vr,j)=>j!==vi?vr:{...vr,subject:v})}));}
  function updBody(si,vi,v){setSteps(p=>p.map((s,i)=>i!==si?s:{...s,variations:s.variations.map((vr,j)=>j!==vi?vr:{...vr,body:v})}));}

  const step = steps[activeStep];
  const vari = step?.variations[step?.activeVar];

  return(
    <div style={{display:'flex',height:'calc(100vh - 280px)',minHeight:480,position:'relative'}}>
      {toast&&<div style={{position:'fixed',bottom:24,right:24,background:'#10b981',color:'#fff',padding:'0.75rem 1.25rem',borderRadius:10,fontWeight:500,zIndex:999,boxShadow:'0 4px 16px rgba(0,0,0,0.3)',fontSize:'0.875rem'}}>{toast}</div>}

      {/* Left: Steps */}
      <div style={{width:248,flexShrink:0,borderRight:'1px solid var(--border-color)',overflowY:'auto',padding:'1rem',background:'var(--overlay-1)'}}>
        {loading?(
          <div style={{color:'var(--text-muted)',fontSize:'0.85rem',textAlign:'center',padding:'2rem'}}>⏳ Loading…</div>
        ):steps.map((s,si)=>(
          <div key={s.id} onClick={()=>setActiveStep(si)}
            style={{marginBottom:'0.75rem',padding:'0.8rem',borderRadius:10,cursor:'pointer',transition:'all 0.15s',
                    border:`1px solid ${activeStep===si?'var(--accent-primary)':'var(--border-color)'}`,
                    background:activeStep===si?'rgba(99,102,241,0.08)':'var(--overlay-1)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.55rem'}}>
              <span style={{fontSize:'0.75rem',fontWeight:600,color:activeStep===si?'var(--accent-primary)':'var(--text-secondary)'}}>
                📧 Step {si+1}
                {s.variations.length>1&&<span style={{marginLeft:5,fontSize:'0.62rem',background:'rgba(139,92,246,0.2)',color:'#a78bfa',padding:'1px 5px',borderRadius:99}}>{s.variations.length}v</span>}
              </span>
              {steps.length>1&&<button onClick={e=>{e.stopPropagation();removeStep(si);}} style={{background:'none',border:'none',color:'var(--danger)',cursor:'pointer',fontSize:'0.75rem',padding:2}}>🗑</button>}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'0.3rem',flexWrap:'wrap'}}>
              {s.variations.map((v,vi)=>(
                <button key={v.id} onClick={e=>{e.stopPropagation();setActiveStep(si);setAV(si,vi);}}
                  style={{width:26,height:26,borderRadius:'50%',fontWeight:700,fontSize:'0.68rem',cursor:'pointer',border:'1px solid var(--border-color)',
                          background:s.activeVar===vi?'var(--accent-primary)':'var(--bg-tertiary)',
                          color:s.activeVar===vi?'#fff':'var(--text-secondary)'}}>
                  {letterFor(vi)}
                </button>
              ))}
              <button onClick={e=>{e.stopPropagation();addVar(si);}} title="Add variation"
                style={{width:26,height:26,borderRadius:'50%',background:'none',border:'1px dashed var(--border-color)',color:'var(--text-muted)',cursor:'pointer',fontSize:'1rem',display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
              {s.variations.length>1&&<button onClick={e=>{e.stopPropagation();removeVar(si,s.activeVar);}} title="Remove variation"
                style={{width:26,height:26,borderRadius:'50%',background:'none',border:'1px dashed rgba(239,68,68,0.4)',color:'var(--danger)',cursor:'pointer',fontSize:'1rem',display:'flex',alignItems:'center',justifyContent:'center'}}>−</button>}
            </div>
            {si>0&&(
              <div style={{marginTop:'0.55rem',display:'flex',alignItems:'center',gap:'0.35rem'}}>
                <span style={{fontSize:'0.68rem',color:'var(--text-muted)'}}>Wait</span>
                <input type="number" min="0" value={s.waitDays} onClick={e=>e.stopPropagation()}
                  onChange={e=>{e.stopPropagation();updWait(si,e.target.value);}}
                  style={{width:38,background:'var(--bg-primary)',border:'1px solid var(--border-color)',borderRadius:4,color:'var(--text-primary)',fontSize:'0.72rem',padding:'2px 4px',textAlign:'center'}}/>
                <span style={{fontSize:'0.68rem',color:'var(--text-muted)'}}>days</span>
              </div>
            )}
          </div>
        ))}
        <button onClick={addStep}
          style={{width:'100%',padding:'0.6rem',borderRadius:8,background:'none',border:'1px dashed var(--border-color)',color:'var(--accent-primary)',cursor:'pointer',fontSize:'0.85rem',fontWeight:500,display:'flex',alignItems:'center',justifyContent:'center',gap:'0.4rem'}}
          onMouseEnter={e=>{e.currentTarget.style.background='rgba(99,102,241,0.08)';e.currentTarget.style.borderColor='var(--accent-primary)';}}
          onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.borderColor='var(--border-color)';}}>
          + Add Step
        </button>
      </div>

      {/* Right: Editor */}
      {step&&vari&&(
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <div style={{padding:'0.6rem 1rem',borderBottom:'1px solid var(--border-color)',display:'flex',alignItems:'center',gap:'0.75rem',background:'var(--overlay-1)',flexShrink:0}}>
            <span style={{background:'var(--accent-primary)',color:'#fff',padding:'2px 10px',borderRadius:99,fontSize:'0.75rem',fontWeight:700,flexShrink:0}}>
              Step {activeStep+1}{letterFor(step.activeVar)}
            </span>
            <input value={vari.subject} onChange={e=>updSubj(activeStep,step.activeVar,e.target.value)}
              placeholder="Subject — e.g. {{random|Quick question|Following up}} about {{company}}?"
              style={{flex:1,background:'var(--overlay-4)',border:'1px solid var(--border-color)',borderRadius:6,color:'var(--text-primary)',padding:'5px 10px',fontSize:'0.85rem',outline:'none'}}/>
            <button onClick={saveAll} disabled={saving}
              style={{background:'linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))',color:'#fff',border:'none',borderRadius:8,padding:'6px 18px',fontWeight:600,cursor:'pointer',fontSize:'0.85rem',flexShrink:0,opacity:saving?0.7:1}}>
              {saving?'Saving…':saved?'✅ Saved':'Save All'}
            </button>
          </div>
          <RichEditor key={`${activeStep}-${step.activeVar}`} value={vari.body} onChange={v=>updBody(activeStep,step.activeVar,v)}/>
          <div style={{padding:'4px 14px',borderTop:'1px solid var(--border-color)',fontSize:'0.72rem',color:dirty?'var(--warning)':'var(--success)',fontWeight:500}}>
            {dirty?'● Unsaved — click Save All to persist':'✅ All changes saved'}
          </div>
        </div>
      )}
    </div>
  );
}
