/* ═══════════════════════════════════════════════════════════
   SANI BUILDING CORP — SHARED SITE JAVASCRIPT
   Loads menu + footer partials, then initializes mobile menu.
   ═══════════════════════════════════════════════════════════ */

/* ───── Partial loader ───── */
(function(){
  'use strict';

  function loadPartial(url, targetId){
    return fetch(url)
      .then(function(r){ return r.text(); })
      .then(function(html){
        var el = document.getElementById(targetId);
        if(el) el.innerHTML = html;
      })
      .catch(function(err){ console.warn('Partial failed:', url, err); });
  }

  function loadAll(){
    return Promise.all([
      loadPartial('partials/menu.html', 'site-menu'),
      loadPartial('partials/footer.html', 'site-footer')
    ]).then(function(){
      document.body.classList.add('site-ready');
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', loadAll);
  } else {
    loadAll();
  }
})();

/* ═══════════ MOBILE MENU FUNCTIONS (called from menu HTML) ═══════════ */
function toggleMobileMenu(){
  var menu=document.getElementById('mobileMenu');
  var ham=document.getElementById('hamburger');
  menu.classList.toggle('open');
  ham.classList.toggle('active');
  if(!menu.classList.contains('open')){
    resetMobilePanels();
  }
}
var mobileStack=[];
function mobileOpen(panelName){
  var current = mobileStack.length===0 ? 'root' : mobileStack[mobileStack.length-1];
  var currentPanel = document.getElementById('panel-'+current);
  var nextPanel = document.getElementById('panel-'+panelName);
  if(!nextPanel)return;
  if(current==='root'){
    currentPanel.classList.add('pushed');
  } else {
    currentPanel.classList.remove('active');
    currentPanel.classList.add('prev');
  }
  nextPanel.classList.add('active');
  mobileStack.push(panelName);
}
function mobileBack(panelName){
  var currentPanel = document.getElementById('panel-'+panelName);
  mobileStack.pop();
  var prev = mobileStack.length===0 ? 'root' : mobileStack[mobileStack.length-1];
  var prevPanel = document.getElementById('panel-'+prev);
  currentPanel.classList.remove('active');
  if(prev==='root'){
    prevPanel.classList.remove('pushed');
  } else {
    prevPanel.classList.remove('prev');
    prevPanel.classList.add('active');
  }
}
function resetMobilePanels(){
  mobileStack=[];
  document.querySelectorAll('.m-panel').forEach(function(p){
    p.classList.remove('active','prev','pushed');
  });
  var root = document.getElementById('panel-root');
  if(root) root.classList.add('active');
}
document.addEventListener('click',function(e){
  var menu=document.getElementById('mobileMenu');
  var ham=document.getElementById('hamburger');
  if(menu&&ham&&menu.classList.contains('open')&&!menu.contains(e.target)&&!ham.contains(e.target)){
    menu.classList.remove('open');
    ham.classList.remove('active');
    resetMobilePanels();
  }
});