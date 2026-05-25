/* ═══════════════════════════════════════════════════════════
   SANI BUILDING CORP — SHARED SITE JAVASCRIPT
   Loads menu + footer partials, then initializes mobile menu.
   Also: Google Analytics 4 tracking (G-QQF68GFQNX)
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   GOOGLE ANALYTICS 4 — Loads on EVERY page automatically
   ═══════════════════════════════════════════════════════════ */
(function(){
  // Load GA library
  var gaScript = document.createElement('script');
  gaScript.async = true;
  gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-QQF68GFQNX';
  document.head.appendChild(gaScript);

  // Initialize GA
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', 'G-QQF68GFQNX', {
    'anonymize_ip': true,
    'cookie_flags': 'SameSite=None;Secure'
  });
})();

/* ───── Conversion tracking helper (called after partials load) ───── */
function setupGATracking(){
  if(!window.gtag) return;

  // Track phone clicks (e.g. 332-277-0990)
  document.querySelectorAll('a[href^="tel:"]').forEach(function(link){
    if(link.dataset.gaTracked) return;
    link.dataset.gaTracked = '1';
    link.addEventListener('click', function(){
      gtag('event', 'phone_click', {
        'event_category': 'engagement',
        'event_label': link.getAttribute('href').replace('tel:', ''),
        'value': 1
      });
    });
  });

  // Track email clicks
  document.querySelectorAll('a[href^="mailto:"]').forEach(function(link){
    if(link.dataset.gaTracked) return;
    link.dataset.gaTracked = '1';
    link.addEventListener('click', function(){
      gtag('event', 'email_click', {
        'event_category': 'engagement',
        'event_label': link.getAttribute('href').replace('mailto:', ''),
        'value': 1
      });
    });
  });

  // Track lead form submissions (estimate / handyman / contact)
  document.querySelectorAll('form').forEach(function(form){
    if(form.dataset.gaTracked) return;
    var hint = ((form.id||'') + ' ' + (form.action||'') + ' ' + (form.className||'')).toLowerCase();
    if(hint.indexOf('estimate')>-1 || hint.indexOf('handyman')>-1 || hint.indexOf('contact')>-1 || hint.indexOf('lead')>-1){
      form.dataset.gaTracked = '1';
      form.addEventListener('submit', function(){
        gtag('event', 'lead_form_submit', {
          'event_category': 'conversion',
          'event_label': window.location.pathname,
          'value': 10
        });
      });
    }
  });

  // Track "Get Estimate" CTA clicks
  document.querySelectorAll('a[href*="estimate"]').forEach(function(btn){
    if(btn.dataset.gaTracked) return;
    btn.dataset.gaTracked = '1';
    btn.addEventListener('click', function(){
      gtag('event', 'cta_click', {
        'event_category': 'engagement',
        'event_label': btn.textContent.trim().substring(0,50),
        'value': 1
      });
    });
  });
}

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
      // ✅ Run GA tracking AFTER menu+footer loaded
      // (so phone/email links inside them get tracked too)
      setupGATracking();
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){
      loadAll();
      setupGATracking(); // also track items on the main page body
    });
  } else {
    loadAll();
    setupGATracking();
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
