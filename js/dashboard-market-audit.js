/* Sani Building Corp — internal estimator market-audit panel v1.0
   Dashboard-only UI. Never changes pricing and is never used by customer quote/invoice/contract pages. */
(function(){
  'use strict';
  if (window.__sbcMarketAuditPanelLoaded) return;
  window.__sbcMarketAuditPanelLoaded = true;

  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];
    });
  }
  function money(v){
    var n=Number(v); return Number.isFinite(n) ? '$'+n.toLocaleString(undefined,{maximumFractionDigits:2}) : '—';
  }
  function tone(status){
    status=String(status||'').toUpperCase();
    if(status==='PASS'||status==='COMPETITIVE') return {fg:'#166534',bg:'#dcfce7',bd:'#86efac'};
    if(status==='BLOCK'||status==='HIGH'||status==='LOW') return {fg:'#991b1b',bg:'#fee2e2',bd:'#fca5a5'};
    if(status==='REVIEW'||status==='EDGE') return {fg:'#92400e',bg:'#fef3c7',bd:'#fcd34d'};
    return {fg:'#475569',bg:'#f1f5f9',bd:'#cbd5e1'};
  }
  function pill(text,status){
    var t=tone(status||text);
    return '<span style="display:inline-block;padding:4px 9px;border-radius:999px;border:1px solid '+t.bd+';background:'+t.bg+';color:'+t.fg+';font-size:10px;font-weight:800;letter-spacing:.7px;text-transform:uppercase">'+esc(text)+'</span>';
  }
  function row(c){
    var range=c.expectedLow===c.expectedHigh ? money(c.expectedLow)+' minimum' : money(c.expectedLow)+'–'+money(c.expectedHigh);
    return '<div style="display:grid;grid-template-columns:minmax(190px,1.7fr) minmax(100px,.8fr) minmax(120px,1fr) 86px;gap:10px;align-items:center;padding:9px 0;border-top:1px solid rgba(13,27,42,.08);font-size:12px">'
      +'<div><strong>'+esc(c.label||c.code)+'</strong><div style="font-size:10px;color:#7a879b;margin-top:2px">'+esc(c.code||'')+(c.confidence?' · '+esc(c.confidence)+' confidence':'')+'</div></div>'
      +'<div><span style="color:#7a879b">Actual</span><br><strong>'+money(c.actual)+'</strong>'+(c.unit?'<span style="font-size:10px;color:#7a879b"> '+esc(c.unit)+'</span>':'')+'</div>'
      +'<div><span style="color:#7a879b">Guardrail</span><br><strong>'+range+'</strong></div>'
      +'<div>'+pill(c.status||'—',c.status)+'</div>'
      +'</div>';
  }
  function panel(a){
    if(!a) return '';
    var st=String(a.status||'NO_BENCHMARK').toUpperCase(), pos=String(a.marketPosition||'UNKNOWN').toUpperCase();
    var checks=(a.checks||[]).map(row).join('');
    var structure=(a.structureChecks||[]).map(function(x){
      return '<div style="padding:8px 10px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;margin-top:7px;font-size:11px;color:#9a3412"><strong>'+esc(x.code||'STRUCTURE')+':</strong> '+esc(x.message||'')+'</div>';
    }).join('');
    var flags=(a.accessFlags||[]).map(function(x){
      var b=typeof x.benchmark==='string'?x.benchmark:JSON.stringify(x.benchmark||{});
      return '<span style="display:inline-block;margin:3px 5px 0 0;padding:4px 8px;border-radius:8px;background:#f8fafc;border:1px solid #cbd5e1;font-size:10px;color:#475569"><strong>'+esc(x.label||x.code)+'</strong>'+(b?' · '+esc(b):'')+'</span>';
    }).join('');
    var competitors=(a.competitiveContext||[]).map(function(x){
      return '<div style="font-size:11px;color:#44536a;margin-top:5px">'+esc(x.label)+': <strong>'+money(x.low)+'–'+money(x.high)+'</strong> <span style="color:#7a879b">(context only — not used to set price)</span></div>';
    }).join('');
    var priority=(a.calibrationPriority||[]).map(function(x,i){return '<span style="font-size:10px;color:#64748b">'+(i+1)+'. '+esc(x)+'</span>';}).join('<span style="color:#cbd5e1"> → </span>');
    return '<div data-market-audit-panel="1" style="background:#fff;border:1.5px solid #94a3b8;border-radius:14px;padding:16px 18px;margin:16px 0;box-shadow:0 4px 16px rgba(15,23,42,.05)">'
      +'<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">'
      +'<div><div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#475569;text-transform:uppercase">Internal · NYC Market Price Check</div><div style="font-size:10px;color:#7a879b;margin-top:3px">'+esc(a.version||'')+' · price is NOT changed by this audit · never customer-visible</div></div>'
      +'<div style="display:flex;gap:6px;align-items:center">'+pill(st,st)+pill(pos,pos)+'</div></div>'
      +'<div style="margin-top:11px;padding:10px 12px;background:#f8fafc;border-radius:9px;font-size:12px;color:#334155"><strong>Audit guidance:</strong> '+esc(a.guidance||'')+'</div>'
      +(checks?'<div style="margin-top:10px">'+checks+'</div>':'<div style="font-size:12px;color:#7a879b;margin-top:10px">No reliable project/quantity benchmark was matched. Normal contractor review still applies.</div>')
      +(structure?'<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;letter-spacing:1px;color:#7a879b;text-transform:uppercase">Structure checks</div>'+structure+'</div>':'')
      +(flags?'<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;letter-spacing:1px;color:#7a879b;text-transform:uppercase">NYC access / logistics context</div>'+flags+'</div>':'')
      +(competitors?'<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #cbd5e1"><div style="font-size:10px;font-weight:800;letter-spacing:1px;color:#7a879b;text-transform:uppercase">Competitor context</div>'+competitors+'</div>':'')
      +(priority?'<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #cbd5e1"><div style="font-size:10px;font-weight:800;letter-spacing:1px;color:#7a879b;text-transform:uppercase;margin-bottom:4px">Calibration authority order</div>'+priority+'</div>':'')
      +'</div>';
  }
  function inject(){
    try{
      var host=document.getElementById('estimate-edit');
      if(!host) return;
      var existing=host.querySelector('[data-market-audit-panel="1"]');
      if(existing) existing.remove();
      var audit=(window.current&&window.current.estimate&&window.current.estimate.marketAudit)||
                (typeof current!=='undefined'&&current&&current.estimate&&current.estimate.marketAudit)||null;
      if(!audit) return;
      var anchor=host.querySelector('#scope-control-wrap')||host.querySelector('.cv-panel');
      if(anchor) anchor.insertAdjacentHTML('beforebegin',panel(audit));
      else host.insertAdjacentHTML('beforeend',panel(audit));
    }catch(e){ console.warn('market audit panel:',e); }
  }
  function hook(){
    if(typeof window.renderEdit==='function'&&!window.__sbcMarketAuditRenderHook){
      window.__sbcMarketAuditRenderHook=true;
      var orig=window.renderEdit;
      window.renderEdit=function(){var out=orig.apply(this,arguments);setTimeout(inject,0);return out;};
    }
    inject();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){setTimeout(hook,0);});
  else setTimeout(hook,0);
  // Existing dashboard scripts may replace renderEdit after this file executes; re-check briefly.
  var tries=0,t=setInterval(function(){tries++;hook();if(tries>20)clearInterval(t);},500);
})();
