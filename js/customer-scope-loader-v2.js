/* save-estimate is gated on DASHBOARD_KEY. This file is injected by
   dashboard-shell.html AFTER dashboard.html, so sbcFetch() from
   js/dashboard-auth.js is normally already defined - but load order across an
   injected document is not something to bet a save on, so the key is read
   directly if it is not. Never falls back to an unkeyed fetch: that would 401
   and look like a mysterious "Save failed" instead of a missing key. */
function sbcScopeFetch(url, opts) {
  if (typeof sbcFetch === 'function') return sbcFetch(url, opts);
  var o = opts || {}, h = {};
  var src = o.headers || {};
  for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) h[k] = src[k]; }
  var key = '';
  try { key = localStorage.getItem('sbcKey') || sessionStorage.getItem('sbcKey') || ''; } catch (e) {}
  h['x-sbc-key'] = key;
  o.headers = h;
  return fetch(url, o);
}

/* Sani Building Corp — Customer Scope Control v2
   Robust DOM-injected dashboard module. Does not replace dashboard.html or core dashboard functions. */
(function(){
  'use strict';
  if(window.__sbcScopeV2Loaded) return;
  window.__sbcScopeV2Loaded=true;

  const A=v=>Array.isArray(v)?v:[];
  const C=v=>String(v==null?'':v).trim();
  const N=v=>C(v).toLowerCase();
  const esc=v=>C(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const uid=()=> 'sc_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
  const money=n=>'$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const unique=list=>{const s=new Set(),o=[];A(list).forEach(x=>{x=C(x);const k=N(x).replace(/[^a-z0-9]+/g,' ');if(x&&!s.has(k)){s.add(k);o.push(x)}});return o};
  const lineTotal=x=>(Number(x&&x.qty)||0)*(Number(x&&x.rate)||0);

  function record(){ try{return (typeof currentRecord!=='undefined'&&currentRecord)?currentRecord:null}catch(_){return null} }
  function estimate(){ const r=record(); return r&&r.estimate?r.estimate:null; }

  function trade(item,declared){
    const x=N(item),d=N(declared);
    if(/window|sash|balance|spring/.test(x))return'Windows';
    if(/bathroom painting|bath paint/.test(x))return'Bathroom';
    if(/shower|vanity|toilet|faucet|plumb|waterproof|membrane|grout|thinset|tile|glass enclosure|shower glass|bathroom|tub|drain|backer board/.test(x))return'Bathroom';
    if(/engineered hardwood|hardwood|subfloor|flooring|underlayment|transition|floor prep|floor removal/.test(x))return'Flooring';
    if(/interior paint|painting|painter|primer|spackle|patch|walls|ceilings|doors|trim/.test(x))return'Painting';
    if(/cabinet|countertop|kitchen/.test(x))return'Kitchen';
    if(d&&d!=='general')return C(declared);
    return'General';
  }
  function friendly(item){
    let t=C(item).replace(/^labor\s*[-:]\s*/i,'').replace(/\s*@\s*\$?[\d,.]+.*$/,'').replace(/\s{2,}/g,' ');
    if(!t)return'';
    if(/bathroom demolition/i.test(t))return'Protect the work area; remove existing bathroom finishes and fixtures as specified; load and dispose of debris';
    if(/tile install/i.test(t))return'Prepare substrates and install bathroom wall and floor tile; complete grout, sealant, and finish work';
    if(/plumb.*shower|shower.*plumb|vanity.*toilet|toilet.*vanity/i.test(t))return'Install and connect shower valve/trim, vanity/sink/faucet, and toilet in their existing plumbing locations';
    if(/glass enclosure|shower glass/i.test(t))return'Fabricate and install the frameless shower glass enclosure as specified';
    if(/engineered hardwood/i.test(t))return'Prepare the installation area and install engineered hardwood flooring, including cuts, fitting, transitions, and finish details';
    if(/interior paint|painter/i.test(t))return'Prepare and paint included interior walls, ceilings, doors, and trim, including minor patching, sanding, spot priming, touch-ups, and cleanup';
    return t.charAt(0).toUpperCase()+t.slice(1);
  }
  function generatedDraft(e){
    const map={},order=[];
    const get=name=>{name=C(name)||'General';if(!map[name]){map[name]={id:uid(),title:name,included:[],customerSupplies:[],notIncluded:[],baseSubtotal:0};order.push(name)}return map[name]};
    A(e.serviceBreakdown).forEach(s=>{const o=get(s.title||s.service);o.included.push(...A(s.included));o.customerSupplies.push(...A(s.customerSupplies||s.customerSupplied));o.notIncluded.push(...A(s.notIncluded||s.exclusions));});
    A(e.scopeSections).forEach(s=>A(s.items).forEach(i=>get(trade(i,s.title)).included.push(friendly(i))));
    A(e.labor).forEach(l=>{const f=friendly(l.item);if(f)get(trade(l.item,l.section)).included.push(f)});
    A(e.materials).forEach(l=>{if(/waterproof|membrane|backer|thinset|grout|primer|sealant|insulation|flashing|level|protection/i.test(C(l.item)))get(trade(l.item,l.section)).included.push('Provide and use '+C(l.item).replace(/[.;,:]+$/,''));});
    A(e.customerSupplied).forEach(x=>{const item=typeof x==='string'?x:x.item;get(trade(item,typeof x==='object'?x.section:'')).customerSupplies.push(item)});
    A(e.exclusions).forEach(x=>get(trade(x,'')).notIncluded.push(x));
    const mk=1+(Number(e.markupPct)||0)/100;
    A(e.labor).concat(A(e.materials)).forEach(l=>{const t=trade(l.item,l.section);get(t).baseSubtotal+=lineTotal(l)*mk});
    return{version:2,updatedAt:new Date().toISOString(),services:order.map(k=>{const s=map[k];s.included=unique(s.included);s.customerSupplies=unique(s.customerSupplies);s.notIncluded=unique(s.notIncluded);s.baseSubtotal=Math.round(s.baseSubtotal*100)/100;return s}).filter(s=>s.included.length||s.customerSupplies.length||s.notIncluded.length||s.baseSubtotal>0)};
  }
  function draft(){
    const e=estimate();if(!e)return null;
    if(!e.manualCustomerScopeDraft||!A(e.manualCustomerScopeDraft.services).length)e.manualCustomerScopeDraft=generatedDraft(e);
    return e.manualCustomerScopeDraft;
  }
  function service(id){const d=draft();return d?A(d.services).find(s=>s.id===id):null}
  function touch(){const d=draft();if(d)d.updatedAt=new Date().toISOString()}

  function styles(){if(document.getElementById('sbc-scope-v2-style'))return;const s=document.createElement('style');s.id='sbc-scope-v2-style';s.textContent=`
  #sbc-scope-v2{margin:22px 0;border:2px solid #b8930a;border-radius:14px;background:#fffdf7;padding:16px}.scv2-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.scv2-top h3{font-family:'Bebas Neue',Arial,sans-serif;letter-spacing:2px;color:#96770a;font-size:17px}.scv2-top p{font-size:12px;color:#64748b;line-height:1.5;margin-top:3px}.scv2-badge{white-space:nowrap;font-size:10px;font-weight:800;padding:6px 9px;border-radius:14px;background:#fff3bf;color:#805f00}.scv2-badge.live{background:#e8f7ee;color:#087443}.scv2-warn{margin-top:10px;padding:10px;border:1px solid #e0a23b;background:#fff4e5;color:#8a5710;border-radius:8px;font-size:11px;line-height:1.45}.scv2-svc{margin-top:12px;border:1px solid #dfe4ea;border-radius:11px;overflow:hidden;background:#fff}.scv2-head{display:flex;justify-content:space-between;gap:10px;align-items:center;background:#f4f6f9;padding:10px}.scv2-title{font-weight:800;border:1px solid #d7dde5;border-radius:7px;padding:8px;width:60%;font-size:14px}.scv2-price{text-align:right;font-size:11px;color:#64748b}.scv2-price b{display:block;color:#96770a;font-size:14px}.scv2-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px}.scv2-col{border:1px solid #e4e8ed;border-radius:8px;padding:9px}.scv2-col.inc{border-top:3px solid #16a34a}.scv2-col.sup{border-top:3px solid #b8930a}.scv2-col.out{border-top:3px solid #dc2626}.scv2-ch{display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:10px;font-weight:800;text-transform:uppercase;margin-bottom:7px}.scv2-ch button{border:1px solid #d8dee6;background:#fff;border-radius:6px;padding:4px 6px;font-size:10px}.scv2-row{display:grid;grid-template-columns:1fr 72px 28px;gap:5px;margin-bottom:6px}.scv2-row textarea{width:100%;min-height:48px;border:1px solid #d7dde5;border-radius:6px;padding:7px;font:11px/1.35 Inter,Arial,sans-serif}.scv2-row select{width:72px;border:1px solid #d7dde5;border-radius:6px;font-size:9px}.scv2-x{border:1px solid #efbcbc;background:#fff;color:#c22;border-radius:6px}.scv2-empty{font-size:10px;color:#94a3b8;font-style:italic;padding:8px;text-align:center}.scv2-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.scv2-btn{border:0;border-radius:8px;padding:10px 12px;background:#b8930a;color:#102236;font-size:11px;font-weight:800}.scv2-btn.sec{background:#fff;border:1px solid #d7dde5}.scv2-btn.pub{background:#163f69;color:#fff}.scv2-btn.danger{background:#fff;color:#b91c1c;border:1px solid #e3aaaa}.scv2-note{font-size:10px;color:#64748b;margin-top:9px;line-height:1.4}@media(max-width:760px){.scv2-cols{grid-template-columns:1fr}.scv2-head{align-items:flex-start}.scv2-title{width:100%}.scv2-actions .scv2-btn{flex:1 1 45%}}`;
    document.head.appendChild(s)}

  function items(s,kind,label,cls){const rows=A(s[kind]);return`<div class="scv2-col ${cls}"><div class="scv2-ch"><span>${label}</span><button type="button" data-add="${s.id}|${kind}">+ Add</button></div>${rows.length?rows.map((x,i)=>`<div class="scv2-row"><textarea data-edit="${s.id}|${kind}|${i}">${esc(x)}</textarea><select data-move="${s.id}|${kind}|${i}"><option value="">Move…</option>${kind!=='included'?'<option value="included">Included</option>':''}${kind!=='customerSupplies'?'<option value="customerSupplies">Customer</option>':''}${kind!=='notIncluded'?'<option value="notIncluded">Not incl.</option>':''}</select><button type="button" class="scv2-x" data-del="${s.id}|${kind}|${i}">×</button></div>`).join(''):'<div class="scv2-empty">No items</div>'}</div>`}
  function html(){const r=record(),e=estimate(),d=draft();if(!r||!e||!d)return'';const live=e.customerScopePublished===true;const shared=/sent|opened|question|accepted|invoiced|paid|completed/i.test(C(r.status));return`<div class="scv2-top"><div><h3>🧾 CUSTOMER SCOPE CONTROL</h3><p>Edit exactly what the customer should see. Changes stay private until you publish.</p></div><span class="scv2-badge ${live?'live':''}">${live?'● PUBLISHED':'● PRIVATE DRAFT'}</span></div>${shared?'<div class="scv2-warn">⚠ This estimate has already been shared. Draft edits are private; publishing will update the customer’s existing quote link.</div>':''}<div>${A(d.services).map(s=>`<div class="scv2-svc"><div class="scv2-head"><input class="scv2-title" data-title="${s.id}" value="${esc(s.title)}"><div class="scv2-price">SERVICE PRICE<b>${money(s.baseSubtotal)}</b></div></div><div class="scv2-cols">${items(s,'included','✓ Included','inc')}${items(s,'customerSupplies','◆ Customer Supplies','sup')}${items(s,'notIncluded','— Not Included','out')}</div></div>`).join('')}</div><div class="scv2-actions"><button type="button" class="scv2-btn sec" id="scv2-reset">↻ Rebuild from AI</button><button type="button" class="scv2-btn" id="scv2-save">💾 Save Draft</button><button type="button" class="scv2-btn pub" id="scv2-publish">📤 Publish Scope</button>${live?'<button type="button" class="scv2-btn danger" id="scv2-freeze">🔒 Freeze / Unpublish</button>':''}</div><div class="scv2-note">Scope wording is controlled here. Price changes still use your existing Labor / Materials tables, so totals remain consistent.</div>`}

  async function save(fields,msg){const r=record();if(!r)return false;try{const res=await sbcScopeFetch('/.netlify/functions/save-estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:r.ref,estimate:fields})});const j=await res.json().catch(()=>({}));if(!res.ok)throw new Error(j.error||'Save failed');Object.assign(r.estimate,fields);if(typeof toast==='function')toast(msg||'✓ Saved');return true}catch(err){if(typeof toast==='function')toast('Save failed: '+err.message,true);else alert('Save failed: '+err.message);return false}}

  function bind(root){
    root.querySelectorAll('[data-edit]').forEach(el=>el.addEventListener('input',()=>{const [id,k,i]=el.dataset.edit.split('|');const s=service(id);if(s){s[k][+i]=el.value;touch()}}));
    root.querySelectorAll('[data-title]').forEach(el=>el.addEventListener('input',()=>{const s=service(el.dataset.title);if(s){s.title=el.value;touch()}}));
    root.querySelectorAll('[data-add]').forEach(el=>el.addEventListener('click',()=>{const[id,k]=el.dataset.add.split('|'),s=service(id);if(s){s[k]=A(s[k]);s[k].push('');touch();render(true)}}));
    root.querySelectorAll('[data-del]').forEach(el=>el.addEventListener('click',()=>{const[id,k,i]=el.dataset.del.split('|'),s=service(id);if(s){s[k].splice(+i,1);touch();render(true)}}));
    root.querySelectorAll('[data-move]').forEach(el=>el.addEventListener('change',()=>{if(!el.value)return;const[id,k,i]=el.dataset.move.split('|'),s=service(id);if(s){const v=s[k][+i];s[k].splice(+i,1);s[el.value]=A(s[el.value]);s[el.value].push(v);touch();render(true)}}));
    const reset=root.querySelector('#scv2-reset');if(reset)reset.onclick=()=>{if(confirm('Rebuild the PRIVATE scope draft from the current AI estimate? Published scope stays unchanged.')){estimate().manualCustomerScopeDraft=generatedDraft(estimate());render(true)}};
    const sv=root.querySelector('#scv2-save');if(sv)sv.onclick=async()=>{const d=draft();d.services.forEach(s=>{s.included=unique(s.included);s.customerSupplies=unique(s.customerSupplies);s.notIncluded=unique(s.notIncluded)});d.updatedAt=new Date().toISOString();await save({manualCustomerScopeDraft:d},'✓ Customer scope draft saved privately');render(true)};
    const pub=root.querySelector('#scv2-publish');if(pub)pub.onclick=async()=>{const r=record(),d=draft();const shared=/sent|opened|question|accepted|invoiced|paid|completed/i.test(C(r.status));if(!confirm(shared?'This estimate has already been shared. Publish this edited scope to the existing customer link now?':'Publish this Included / Customer Supplies / Not Included scope to the customer quote?'))return;const snap=JSON.parse(JSON.stringify(d));snap.publishedAt=new Date().toISOString();if(await save({manualCustomerScopeDraft:d,publishedCustomerScope:snap,customerScopePublished:true,customerViewPublishedVersion:'v7',customerPresentationVersion:'v7-service-proposal'},'✓ Customer scope published'))render(true)};
    const fr=root.querySelector('#scv2-freeze');if(fr)fr.onclick=async()=>{if(confirm('Freeze/unpublish the new customer scope and return the quote to the legacy-safe view?')){if(await save({customerScopePublished:false,customerViewPublishedVersion:''},'🔒 Customer scope frozen'))render(true)}};
  }

  let lastRef='';
  function render(force){
    const r=record(),e=estimate(),card=document.getElementById('edit-card');
    if(!r||!e||!card)return;
    styles();
    let root=document.getElementById('sbc-scope-v2');
    if(root&&!force&&lastRef===C(r.ref))return;
    if(root)root.remove();
    root=document.createElement('section');root.id='sbc-scope-v2';root.innerHTML=html();
    const anchor=card.querySelector('.cv-panel') || Array.from(card.querySelectorAll('*')).find(x=>/customer view mode/i.test(C(x.textContent)));
    if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(root,anchor.closest('.cv-panel')||anchor);else card.appendChild(root);
    lastRef=C(r.ref);bind(root);
  }

  window.sbcScopeV2Render=()=>render(true);
  setTimeout(()=>render(true),250);
  setTimeout(()=>render(true),1000);
  setInterval(()=>render(false),1200);
  const mo=new MutationObserver(()=>render(false));
  mo.observe(document.documentElement,{childList:true,subtree:true});
})();
