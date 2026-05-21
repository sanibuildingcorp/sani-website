/* ═══════════ SANI SITE.JS - Loads shared menu & footer ═══════════ */
(function(){
  'use strict';

  // Fetch helper with caching
  function loadPartial(url, targetId){
    return fetch(url)
      .then(function(r){ return r.text(); })
      .then(function(html){
        var el = document.getElementById(targetId);
        if(el) el.innerHTML = html;
      })
      .catch(function(err){ console.warn('Partial failed:', url, err); });
  }

  // Load menu and footer in parallel (faster than sequential)
  function loadAll(){
    Promise.all([
      loadPartial('partials/menu.html', 'site-menu'),
      loadPartial('partials/footer.html', 'site-footer')
    ]).then(function(){
      // Once loaded, mark body as ready (CSS can hide loading state)
      document.body.classList.add('site-ready');
    });
  }

  // Run as soon as DOM is parsed (don't wait for images)
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', loadAll);
  } else {
    loadAll();
  }
})();

/* Mobile menu toggle - works after menu loads */
function toggleMobileMenu(){
  var menu = document.getElementById('mobileMenu');
  var ham = document.getElementById('hamburger');
  if(!menu) return;
  menu.classList.toggle('open');
  if(ham) ham.classList.toggle('active');
}
