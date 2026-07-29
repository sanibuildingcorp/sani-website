function setupGATracking(){window.gtag&&(document.querySelectorAll('a[href^="tel:"]').forEach(function(e){e.dataset.gaTracked||(e.dataset.gaTracked="1",e.addEventListener("click",function(){gtag("event","phone_click",{event_category:"engagement",event_label:e.getAttribute("href").replace("tel:",""),value:1})}))}),document.querySelectorAll('a[href^="mailto:"]').forEach(function(e){e.dataset.gaTracked||(e.dataset.gaTracked="1",e.addEventListener("click",function(){gtag("event","email_click",{event_category:"engagement",event_label:e.getAttribute("href").replace("mailto:",""),value:1})}))}),document.querySelectorAll("form").forEach(function(e){if(!e.dataset.gaTracked){var t=((e.id||"")+" "+(e.action||"")+" "+(e.className||"")).toLowerCase();(t.indexOf("estimate")>-1||t.indexOf("handyman")>-1||t.indexOf("contact")>-1||t.indexOf("lead")>-1)&&(e.dataset.gaTracked="1",e.addEventListener("submit",function(){gtag("event","lead_form_submit",{event_category:"conversion",event_label:window.location.pathname,value:10})}))}}),document.querySelectorAll('a[href*="estimate"]').forEach(function(e){e.dataset.gaTracked||(e.dataset.gaTracked="1",e.addEventListener("click",function(){gtag("event","cta_click",{event_category:"engagement",event_label:e.textContent.trim().substring(0,50),value:1})}))}))}function toggleMobileMenu(){var e=document.getElementById("mobileMenu"),t=document.getElementById("hamburger");e.classList.toggle("open"),t.classList.toggle("active"),e.classList.contains("open")||resetMobilePanels()}!function(){var e=document.createElement("script");e.async=!0,e.src="https://www.googletagmanager.com/gtag/js?id=G-QQF68GFQNX",document.head.appendChild(e),window.dataLayer=window.dataLayer||[],window.gtag=function(){dataLayer.push(arguments)},gtag("js",new Date),gtag("config","G-QQF68GFQNX",{anonymize_ip:!0,cookie_flags:"SameSite=None;Secure"})}(),function(){"use strict";function e(e,t){return fetch(e).then(function(e){return e.text()}).then(function(e){var a=document.getElementById(t);a&&(a.innerHTML=e)}).catch(function(t){console.warn("Partial failed:",e,t)})}function t(){return Promise.all([e("partials/menu.html","site-menu"),e("partials/footer.html","site-footer")]).then(function(){document.body.classList.add("site-ready"),setupGATracking()})}"loading"===document.readyState?document.addEventListener("DOMContentLoaded",function(){t(),setupGATracking()}):(t(),setupGATracking())}();var mobileStack=[];function mobileOpen(e){var t=0===mobileStack.length?"root":mobileStack[mobileStack.length-1],a=document.getElementById("panel-"+t),n=document.getElementById("panel-"+e);n&&("root"===t?a.classList.add("pushed"):(a.classList.remove("active"),a.classList.add("prev")),n.classList.add("active"),mobileStack.push(e))}function mobileBack(e){var t=document.getElementById("panel-"+e);mobileStack.pop();var a=0===mobileStack.length?"root":mobileStack[mobileStack.length-1],n=document.getElementById("panel-"+a);t.classList.remove("active"),"root"===a?n.classList.remove("pushed"):(n.classList.remove("prev"),n.classList.add("active"))}function resetMobilePanels(){mobileStack=[],document.querySelectorAll(".m-panel").forEach(function(e){e.classList.remove("active","prev","pushed")});var e=document.getElementById("panel-root");e&&e.classList.add("active")}document.addEventListener("click",function(e){var t=document.getElementById("mobileMenu"),a=document.getElementById("hamburger");t&&a&&t.classList.contains("open")&&!t.contains(e.target)&&!a.contains(e.target)&&(t.classList.remove("open"),a.classList.remove("active"),resetMobilePanels())}),function(){var e,t="/.netlify/functions/track-visit",a=!1;try{e=sessionStorage.getItem("sbc_sid")}catch(e){}if(!e){e="s_"+Date.now().toString(36)+Math.random().toString(36).slice(2,8),a=!0;try{sessionStorage.setItem("sbc_sid",e)}catch(e){}}function n(e){try{return new URLSearchParams(location.search).get(e)||""}catch(e){return""}}var i={source:n("utm_source"),medium:n("utm_medium"),campaign:n("utm_campaign")};function o(n){var o,c={sid:e,type:n,path:location.pathname,title:document.title,referrer:document.referrer||"",utmSource:i.source,utmMedium:i.medium,utmCampaign:i.campaign,device:(o=navigator.userAgent||"",/iPad|Tablet|PlayBook|Silk/i.test(o)?"tablet":/Mobi|Android|iPhone|iPod|Opera Mini|IEMobile/i.test(o)||window.matchMedia&&window.matchMedia("(max-width:768px)").matches?"mobile":"desktop"),first:a};a=!1;try{var r=JSON.stringify(c);navigator.sendBeacon?navigator.sendBeacon(t,new Blob([r],{type:"application/json"})):fetch(t,{method:"POST",headers:{"Content-Type":"application/json"},body:r,keepalive:!0})}catch(e){}}o("pageview"),setInterval(function(){"visible"===document.visibilityState&&o("heartbeat")},2e4),document.addEventListener("visibilitychange",function(){"visible"===document.visibilityState&&o("heartbeat")})}();

/* ===== SBC VISIT + CALL ALERTS — visit: one email per session. call: fires when a tel: link is tapped, includes the page trail. Owner devices: ?owner=1 silences, ?owner=0 un-silences. ===== */
(function(){
  try{
    var q=new URLSearchParams(location.search);
    if(q.get("owner")==="1"){localStorage.setItem("sbc_owner","1");}
    if(q.get("owner")==="0"){localStorage.removeItem("sbc_owner");}
    if(localStorage.getItem("sbc_owner")==="1")return;
    var p=location.pathname;
    if(/dashboard|image-studio|seo-content|keyword-volumes|quote|invoice|contract|agreement/.test(p))return;

    /* page trail for this browser tab session */
    var trail=[];
    try{trail=JSON.parse(sessionStorage.getItem("sbc_pages")||"[]");}catch(e){trail=[];}
    if(trail[trail.length-1]!==p){trail.push(p);if(trail.length>20)trail=trail.slice(-20);}
    try{sessionStorage.setItem("sbc_pages",JSON.stringify(trail));}catch(e){}

    var src="direct";
    try{if(document.referrer){var u=new URL(document.referrer);src=(u.hostname.indexOf("sanibuildingcorp")>-1)?u.pathname:u.hostname;}}catch(e){}

    function send(payload){
      fetch("/.netlify/functions/form-alert",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),keepalive:true}).catch(function(){});
    }

    /* one visit email per session */
    if(!sessionStorage.getItem("sbc_visit_alerted")){
      sessionStorage.setItem("sbc_visit_alerted","1");
      send({type:"visit",page:p,source:src});
    }

    /* CALL CLICK: any tap on a tel: link, one email per session */
    document.addEventListener("click",function(e){
      var a=e.target&&e.target.closest?e.target.closest('a[href^="tel:"]'):null;
      if(!a)return;
      if(sessionStorage.getItem("sbc_call_alerted"))return;
      sessionStorage.setItem("sbc_call_alerted","1");
      var t=[];try{t=JSON.parse(sessionStorage.getItem("sbc_pages")||"[]");}catch(err){}
      send({type:"call",page:location.pathname,source:src,pages:t});
    },true);
  }catch(e){}
})();
