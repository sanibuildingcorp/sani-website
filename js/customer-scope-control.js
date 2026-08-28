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

/*
 * Sani Building Corp — Customer Scope Control
 * Isolated dashboard extension. Does NOT replace core dashboard functions.
 *
 * Safety model:
 * - AI/generated estimate data stays untouched.
 * - Contractor edits live in estimate.manualCustomerScopeDraft.
 * - Customer-visible snapshot lives in estimate.publishedCustomerScope.
 * - Draft edits never change a customer's live quote until explicitly published.
 */
(function () {
  'use strict';
  if (window.__sbcCustomerScopeControl) return;
  window.__sbcCustomerScopeControl = true;

  var VERSION = 1;
  var TRADE_ORDER = ['Bathroom','Flooring','Painting','Windows','Kitchen','Carpentry','Handyman','General'];

  function rec(){ return (typeof currentRecord !== 'undefined' && currentRecord) ? currentRecord : null; }
  function est(){ var r=rec(); if(!r) return null; if(!r.estimate) r.estimate={}; return r.estimate; }
  function A(v){ return Array.isArray(v) ? v : []; }
  function C(v){ return String(v == null ? '' : v).trim(); }
  function N(v){ return C(v).toLowerCase(); }
  function esc2(v){ return C(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
  function uid(){ return 'sc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7); }
  function unique(list){ var out=[],seen={}; A(list).forEach(function(x){ x=C(x); var k=N(x).replace(/[^a-z0-9]+/g,' '); if(x&&!seen[k]){seen[k]=1;out.push(x);} }); return out; }
  function lineTotal(x){ return (Number(x&&x.qty)||0)*(Number(x&&x.rate)||0); }

  function trade(item, declared){
    var x=N(item), d=N(declared);
    if(/window|sash|balance|spring/.test(x)) return 'Windows';
    if(/bathroom painting|bath paint/.test(x)) return 'Bathroom';
    if(/shower|vanity|toilet|faucet|plumb|waterproof|membrane|grout|thinset|tile|glass enclosure|shower glass|bathroom|tub|drain|backer board/.test(x)) return 'Bathroom';
    if(/engineered hardwood|hardwood|subfloor|flooring|underlayment|transition|floor prep|floor removal/.test(x)) return 'Flooring';
    if(/interior paint|painting|painter|primer|spackle|patch|walls|ceilings|doors|trim/.test(x)) return 'Painting';
    if(/cabinet|countertop|kitchen/.test(x)) return 'Kitchen';
    if(/carpentry|millwork|door|stair|railing|molding/.test(x)) return 'Carpentry';
    if(d && d !== 'general') return C(declared);
    return 'General';
  }

  function friendly(item){
    var t=C(item).replace(/^labor\s*[-:]\s*/i,'').replace(/\s*@\s*\$?[\d,.]+.*$/,'').replace(/\s{2,}/g,' ');
    if(!t) return '';
    if(/bathroom demolition/i.test(t)) return 'Protect the work area; remove existing bathroom finishes and fixtures as specified; load and dispose of debris';
    if(/tile install/i.test(t)) return 'Prepare substrates and install bathroom wall and floor tile; complete grout, sealant, and finish work';
    if(/plumb.*shower|shower.*plumb|vanity.*toilet|toilet.*vanity/i.test(t)) return 'Install and connect shower valve/trim, vanity/sink/faucet, and toilet in their existing plumbing locations';
    if(/glass enclosure|shower glass/i.test(t)) return 'Fabricate and install the frameless shower glass enclosure as specified';
    if(/engineered hardwood/i.test(t)) return 'Prepare the installation area and install engineered hardwood flooring, including cuts, fitting, transitions, and finish details';
    if(/interior paint|painter/i.test(t)) return 'Prepare and paint included interior walls, ceilings, doors, and trim, including minor patching, sanding, spot priming, touch-ups, and cleanup';
    if(/project management|supervision|coordination/i.test(t)) return 'Project coordination, scheduling, deliveries, and quality control';
    if(/cleanup|final clean/i.test(t)) return 'Final cleanup and removal of construction debris';
    return t.charAt(0).toUpperCase()+t.slice(1);
  }

  function calculateServiceCosts(e){
    var markup=1+(Number(e.markupPct)||0)/100;
    var totals={};
    A(e.labor).concat(A(e.materials)).forEach(function(l){
      var t=trade(l.item,l.section);
      totals[t]=(totals[t]||0)+lineTotal(l)*markup;
    });
    return totals;
  }

  function fromGenerated(e){
    var map={}, order=[];
    function get(name){
      name=C(name)||'General';
      if(!map[name]){ map[name]={id:uid(),title:name,included:[],customerSupplies:[],notIncluded:[],priceAdjustment:0}; order.push(name); }
      return map[name];
    }

    A(e.serviceBreakdown).forEach(function(s){
      var title=C(s.title||s.service)||'General', o=get(title);
      o.included.push.apply(o.included,A(s.included));
      o.customerSupplies.push.apply(o.customerSupplies,A(s.customerSupplies||s.customerSupplied));
      o.notIncluded.push.apply(o.notIncluded,A(s.notIncluded||s.exclusions));
    });
    A(e.scopeSections).forEach(function(s){
      A(s.items).forEach(function(i){ get(trade(i,s.title)).included.push(friendly(i)); });
    });
    A(e.labor).forEach(function(l){
      var f=friendly(l.item); if(f) get(trade(l.item,l.section)).included.push(f);
    });
    A(e.materials).forEach(function(l){
      if(/waterproof|membrane|backer|thinset|grout|primer|sealant|insulation|flashing|level|protection/i.test(C(l.item))) {
        get(trade(l.item,l.section)).included.push('Provide and use '+C(l.item).replace(/[.;,:]+$/,''));
      }
    });
    A(e.customerSupplied).forEach(function(x){
      var item=typeof x==='string'?x:x.item;
      get(trade(item,typeof x==='object'?x.section:'')).customerSupplies.push(item);
    });
    A(e.exclusions).forEach(function(x){ get(trade(x,'')).notIncluded.push(x); });

    var costs=calculateServiceCosts(e);
    Object.keys(costs).forEach(function(k){ get(k); });

    var services=order.map(function(k){
      var s=map[k];
      s.included=unique(s.included);
      s.customerSupplies=unique(s.customerSupplies);
      s.notIncluded=unique(s.notIncluded);
      s.baseSubtotal=Math.round((costs[k]||0)*100)/100;
      return s;
    }).filter(function(s){ return s.included.length||s.customerSupplies.length||s.notIncluded.length||s.baseSubtotal>0; });

    services.sort(function(a,b){
      var ai=TRADE_ORDER.indexOf(a.title), bi=TRADE_ORDER.indexOf(b.title);
      if(ai<0) ai=999; if(bi<0) bi=999; return ai-bi;
    });
    return {version:VERSION,updatedAt:new Date().toISOString(),services:services};
  }

  function ensureDraft(){
    var e=est(); if(!e) return null;
    if(!e.manualCustomerScopeDraft || !Array.isArray(e.manualCustomerScopeDraft.services)) {
      if(e.publishedCustomerScope && Array.isArray(e.publishedCustomerScope.services)) {
        e.manualCustomerScopeDraft=JSON.parse(JSON.stringify(e.publishedCustomerScope));
        e.manualCustomerScopeDraft.updatedAt=new Date().toISOString();
      } else {
        e.manualCustomerScopeDraft=fromGenerated(e);
      }
    }
    return e.manualCustomerScopeDraft;
  }

  function serviceById(id){ var d=ensureDraft(); if(!d)return null; return A(d.services).find(function(s){return s.id===id;})||null; }
  function listFor(s,kind){ if(!s[kind])s[kind]=[]; return s[kind]; }

  function statusWarning(){
    var r=rec(); if(!r)return '';
    if(/sent|opened|question|accepted|invoiced|paid|completed/i.test(C(r.status))) {
      return '<div class="sc-warning">⚠ This estimate has already been shared with the customer. Draft edits stay private. Publishing a new scope will immediately change what their existing quote link displays.</div>';
    }
    return '';
  }

  function renderItems(s,kind,label,cls){
    var rows=listFor(s,kind);
    return '<div class="sc-col '+cls+'"><div class="sc-col-head"><span>'+label+'</span><button type="button" onclick="sbcScopeAddItem(\''+s.id+'\',\''+kind+'\')">+ Add</button></div>'+
      '<div class="sc-rows">'+(rows.length?rows.map(function(x,i){
        return '<div class="sc-row"><textarea rows="2" oninput="sbcScopeEditItem(\''+s.id+'\',\''+kind+'\','+i+',this.value)">'+esc2(x)+'</textarea>'+
          '<select title="Move item" onchange="sbcScopeMoveItem(\''+s.id+'\',\''+kind+'\','+i+',this.value);this.value=\'\'"><option value="">Move…</option>'+
            (kind!=='included'?'<option value="included">→ Included</option>':'')+
            (kind!=='customerSupplies'?'<option value="customerSupplies">→ Customer Supplies</option>':'')+
            (kind!=='notIncluded'?'<option value="notIncluded">→ Not Included</option>':'')+
          '</select><button class="sc-x" type="button" onclick="sbcScopeDeleteItem(\''+s.id+'\',\''+kind+'\','+i+')">×</button></div>';
      }).join(''):'<div class="sc-empty">No items</div>')+'</div></div>';
  }

  function serviceCard(s){
    var subtotal=Number(s.baseSubtotal)||0;
    return '<div class="sc-service">'+
      '<div class="sc-service-head"><input class="sc-title" value="'+esc2(s.title)+'" oninput="sbcScopeRename(\''+s.id+'\',this.value)">'+
        '<div class="sc-price"><small>ESTIMATED SERVICE PRICE</small><strong>'+((typeof fmt==='function')?fmt(subtotal):('$'+subtotal.toFixed(2)))+'</strong></div></div>'+
      '<div class="sc-grid">'+renderItems(s,'included','✓ Included','inc')+renderItems(s,'customerSupplies','◆ Customer Supplies','sup')+renderItems(s,'notIncluded','— Not Included','out')+'</div>'+
    '</div>';
  }

  function panelHtml(){
    var e=est(), d=ensureDraft(); if(!e||!d)return '';
    var published=e.customerScopePublished===true && e.publishedCustomerScope && Array.isArray(e.publishedCustomerScope.services);
    return '<div class="sc-panel">'+
      '<div class="sc-top"><div><h3>🧾 CUSTOMER SCOPE CONTROL</h3><p>AI drafted the starting scope. Edit exactly what the customer should see. Your edits are private until you publish them.</p></div><span class="sc-state '+(published?'live':'draft')+'">'+(published?'● PUBLISHED':'● PRIVATE DRAFT')+'</span></div>'+
      statusWarning()+
      '<div id="sc-services">'+(d.services.length?d.services.map(serviceCard).join(''):'<div class="sc-empty big">No service scope yet. Generate the estimate first, or add a service below.</div>')+'</div>'+
      '<div class="sc-actions"><button type="button" class="sc-btn secondary" onclick="sbcScopeAddService()">+ Add Service</button>'+ 
        '<button type="button" class="sc-btn secondary" onclick="sbcScopeResetFromAI()">↻ Rebuild Draft from AI</button>'+ 
        '<button type="button" class="sc-btn" onclick="sbcScopeSaveDraft()">💾 Save Scope Draft</button>'+ 
        '<button type="button" class="sc-btn preview" onclick="sbcScopePreview()">👁 Preview Draft</button>'+ 
        '<button type="button" class="sc-btn publish" onclick="sbcScopePublish()">📤 Publish Customer Scope</button>'+ 
        (published?'<button type="button" class="sc-btn danger" onclick="sbcScopeUnpublish()">🔒 Unpublish / Freeze</button>':'')+
      '</div><div class="sc-note">Price changes still come from the Labor / Materials tables above, so your project total remains mathematically consistent. Scope wording here controls what the customer sees.</div></div>';
  }

  function injectStyles(){
    if(document.getElementById('sbc-scope-control-style'))return;
    var st=document.createElement('style'); st.id='sbc-scope-control-style'; st.textContent=
      '.sc-panel{margin:22px 0 24px;border:2px solid var(--gold);border-radius:14px;background:#fffdf7;padding:18px}.sc-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:12px}.sc-top h3{font-family:var(--display);font-size:16px;letter-spacing:2px;color:var(--gold-2);margin:0 0 4px}.sc-top p{font-size:12px;color:var(--ink-muted);line-height:1.5;max-width:650px}.sc-state{font-size:10px;font-weight:800;letter-spacing:1px;border-radius:20px;padding:6px 10px;white-space:nowrap}.sc-state.draft{color:#805f00;background:#fff3bf}.sc-state.live{color:#087443;background:#e9f8ef}.sc-warning{background:#fff4e5;border:1px solid #d88d24;color:#8a5710;border-radius:9px;padding:10px 12px;font-size:12px;line-height:1.45;margin-bottom:12px}.sc-service{background:#fff;border:1px solid rgba(13,27,42,.12);border-radius:12px;margin:12px 0;overflow:hidden}.sc-service-head{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#f4f6f9;padding:12px 14px;border-bottom:1px solid rgba(13,27,42,.08)}.sc-title{font-family:var(--display);font-size:17px;letter-spacing:1px;font-weight:700;color:var(--ink);background:#fff;border:1px solid rgba(13,27,42,.14);border-radius:8px;padding:8px 10px;min-width:180px;max-width:420px;width:50%}.sc-price{text-align:right}.sc-price small{display:block;font-size:9px;letter-spacing:1px;color:var(--ink-muted)}.sc-price strong{font-size:15px;color:var(--gold-2)}.sc-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:12px}.sc-col{border:1px solid rgba(13,27,42,.1);border-radius:10px;padding:10px;background:#fafbfd}.sc-col.inc{border-top:3px solid #16a34a}.sc-col.sup{border-top:3px solid #b8930a}.sc-col.out{border-top:3px solid #dc2626}.sc-col-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;margin-bottom:8px}.sc-col.inc .sc-col-head{color:#15803d}.sc-col.sup .sc-col-head{color:#96770a}.sc-col.out .sc-col-head{color:#b91c1c}.sc-col-head button{border:1px solid rgba(13,27,42,.12);background:#fff;border-radius:7px;padding:5px 8px;font-size:10px;font-weight:700;cursor:pointer;color:var(--ink-soft)}.sc-row{display:grid;grid-template-columns:1fr 84px 30px;gap:6px;align-items:start;margin-bottom:7px}.sc-row textarea{width:100%;min-height:52px;resize:vertical;border:1px solid rgba(13,27,42,.14);border-radius:7px;background:#fff;padding:7px 8px;font:12px/1.4 var(--body);color:var(--ink)}.sc-row select{width:84px;border:1px solid rgba(13,27,42,.14);border-radius:7px;background:#fff;padding:7px 4px;font-size:10px;color:var(--ink-soft)}.sc-x{width:30px;height:30px;border-radius:7px;border:1px solid rgba(220,38,38,.25);background:#fff;color:#dc2626;font-size:16px;cursor:pointer}.sc-empty{font-size:11px;color:var(--ink-muted);font-style:italic;padding:10px;text-align:center}.sc-empty.big{padding:24px}.sc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.sc-btn{border:none;border-radius:9px;background:var(--gold);color:#102236;padding:10px 14px;font:700 11px var(--body);letter-spacing:.5px;cursor:pointer}.sc-btn.secondary{background:#fff;border:1px solid var(--line);color:var(--ink-soft)}.sc-btn.preview{background:#fff;border:1px solid var(--gold);color:var(--gold-2)}.sc-btn.publish{background:#163f69;color:#fff}.sc-btn.danger{background:#fff;border:1px solid #dc2626;color:#b91c1c}.sc-note{font-size:11px;color:var(--ink-muted);margin-top:10px;line-height:1.45}.sc-service-remove{font-size:10px;color:#b91c1c;cursor:pointer}@media(max-width:800px){.sc-grid{grid-template-columns:1fr}.sc-service-head{align-items:flex-start}.sc-title{width:100%;max-width:none}.sc-price{min-width:120px}.sc-actions .sc-btn{flex:1 1 46%}}@media(max-width:520px){.sc-top{flex-direction:column}.sc-state{align-self:flex-start}.sc-service-head{flex-direction:column}.sc-price{text-align:left}.sc-row{grid-template-columns:1fr 76px 30px}.sc-actions .sc-btn{flex:1 1 100%}}';
    document.head.appendChild(st);
  }

  function inject(){
    try{
      var card=document.getElementById('edit-card'); if(!card||!rec()||!est())return;
      injectStyles();
      var old=document.getElementById('sbc-customer-scope-control'); if(old)old.remove();
      var wrap=document.createElement('div'); wrap.id='sbc-customer-scope-control'; wrap.innerHTML=panelHtml();
      var anchor=card.querySelector('.cv-panel');
      if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(wrap,anchor); else card.appendChild(wrap);
    }catch(e){ console.error('scope control inject',e); }
  }

  function touch(){ var d=ensureDraft(); if(d)d.updatedAt=new Date().toISOString(); }
  function rerender(){ touch(); inject(); }

  window.sbcScopeEditItem=function(id,kind,idx,val){ var s=serviceById(id); if(!s)return; listFor(s,kind)[idx]=val; touch(); };
  window.sbcScopeDeleteItem=function(id,kind,idx){ var s=serviceById(id); if(!s)return; listFor(s,kind).splice(idx,1); rerender(); };
  window.sbcScopeAddItem=function(id,kind){ var s=serviceById(id); if(!s)return; listFor(s,kind).push(''); rerender(); setTimeout(function(){ var p=document.getElementById('sbc-customer-scope-control'); if(p){var xs=p.querySelectorAll('.sc-row textarea'); if(xs.length)xs[xs.length-1].focus();}},20); };
  window.sbcScopeMoveItem=function(id,from,idx,to){ if(!to)return; var s=serviceById(id); if(!s)return; var src=listFor(s,from); var item=src[idx]; src.splice(idx,1); listFor(s,to).push(item); rerender(); };
  window.sbcScopeRename=function(id,val){ var s=serviceById(id); if(!s)return; s.title=val; touch(); };
  window.sbcScopeAddService=function(){ var d=ensureDraft(); d.services.push({id:uid(),title:'New Service',included:[],customerSupplies:[],notIncluded:[],baseSubtotal:0,priceAdjustment:0}); rerender(); };
  window.sbcScopeResetFromAI=function(){ if(!confirm('Rebuild the PRIVATE scope draft from the current AI estimate? This replaces only your unpublished draft. Published customer scope stays unchanged.'))return; var e=est(); e.manualCustomerScopeDraft=fromGenerated(e); inject(); };

  async function saveFields(fields,success){
    var r=rec(); if(!r)return false;
    try{
      var resp=await sbcScopeFetch('/.netlify/functions/save-estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:r.ref,estimate:fields})});
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok)throw new Error(data.error||'Save failed');
      Object.keys(fields).forEach(function(k){r.estimate[k]=fields[k];});
      if(window.toast)toast(success||'✓ Saved');
      return true;
    }catch(e){ if(window.toast)toast('Save failed: '+e.message,true); return false; }
  }

  window.sbcScopeSaveDraft=async function(){
    var d=ensureDraft(); if(!d)return;
    d.services.forEach(function(s){s.included=unique(s.included);s.customerSupplies=unique(s.customerSupplies);s.notIncluded=unique(s.notIncluded);});
    d.updatedAt=new Date().toISOString();
    await saveFields({manualCustomerScopeDraft:d},'✓ Customer scope draft saved privately');
    inject();
  };

  window.sbcScopePreview=async function(){
    var ok=await window.sbcScopeSaveDraft();
    var r=rec(); if(!r)return;
    window.open('/quote.html?ref='+encodeURIComponent(r.ref)+'&previewScope=1','_blank');
  };

  window.sbcScopePublish=async function(){
    var e=est(),r=rec(),d=ensureDraft(); if(!e||!r||!d)return;
    var shared=/sent|opened|question|accepted|invoiced|paid|completed/i.test(C(r.status));
    var msg=shared
      ? 'This customer already has the estimate link. Publishing will immediately replace the scope they see with this edited version.\n\nPublish now?'
      : 'Publish this edited Included / Customer Supplies / Not Included scope to the customer quote?';
    if(!confirm(msg))return;
    var snapshot=JSON.parse(JSON.stringify(d)); snapshot.publishedAt=new Date().toISOString();
    var fields={manualCustomerScopeDraft:d,publishedCustomerScope:snapshot,customerScopePublished:true,customerViewPublishedVersion:'v7',customerPresentationVersion:'v7-service-proposal'};
    if(await saveFields(fields,'✓ Customer scope published')) inject();
  };

  window.sbcScopeUnpublish=async function(){
    var e=est(),r=rec(); if(!e||!r)return;
    if(!confirm('Freeze the customer scope? Their existing quote link will return to the legacy-safe scope view. Your published snapshot will be kept for later.'))return;
    if(await saveFields({customerScopePublished:false,customerViewPublishedVersion:''},'🔒 Customer scope unpublished / frozen')) inject();
  };

  // Patch renderEdit only by wrapping it; core implementation remains untouched.
  if(typeof renderEdit==='function'){
    var _renderEdit=renderEdit;
    renderEdit=function(){ var out=_renderEdit.apply(this,arguments); try{inject();}catch(e){console.error(e);} return out; };
  }

  // Preserve scope-control fields whenever the core Save Draft / Send path gathers the estimate.
  if(typeof gatherForm==='function'){
    var _gatherForm=gatherForm;
    gatherForm=function(){
      var out=_gatherForm.apply(this,arguments), e=est();
      if(out&&e){
        if(e.manualCustomerScopeDraft)out.manualCustomerScopeDraft=e.manualCustomerScopeDraft;
        if(e.publishedCustomerScope)out.publishedCustomerScope=e.publishedCustomerScope;
        out.customerScopePublished=e.customerScopePublished===true;
        out.customerViewPublishedVersion=C(e.customerViewPublishedVersion);
        if(e.customerPresentationVersion)out.customerPresentationVersion=e.customerPresentationVersion;
      }
      return out;
    };
  }

  // AI regeneration replaces currentRecord.estimate. Preserve contractor-controlled scope snapshots around it.
  if(typeof generateAI==='function'){
    var _generateAI=generateAI;
    generateAI=async function(){
      var e=est()||{};
      var keep={draft:e.manualCustomerScopeDraft?JSON.parse(JSON.stringify(e.manualCustomerScopeDraft)):null,pub:e.publishedCustomerScope?JSON.parse(JSON.stringify(e.publishedCustomerScope)):null,published:e.customerScopePublished===true,ver:C(e.customerViewPublishedVersion)};
      var out=await _generateAI.apply(this,arguments);
      var ne=est();
      if(ne){ if(keep.draft)ne.manualCustomerScopeDraft=keep.draft; if(keep.pub)ne.publishedCustomerScope=keep.pub; ne.customerScopePublished=keep.published; ne.customerViewPublishedVersion=keep.ver; }
      return out;
    };
  }
})();
