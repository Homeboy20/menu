/**
 * branding-loader.js — Fetches platform branding from /api/public/branding
 * and overrides default logo images + favicon when a custom upload exists.
 *
 * Usage: <script src="/js/branding-loader.js" defer></script>
 *
 * It targets:
 *   - img[data-brand-logo]       → replaced src with site_logo_url
 *   - img[data-brand-logo-dark]  → replaced src with site_logo_url (dark variant)
 *   - img[data-brand-mark]       → replaced src with site_logo_url (icon/mark)
 *   - link[rel="icon"]           → replaced href with site_favicon_url
 */
(function () {
  'use strict';
  var CACHE_KEY  = 'ro_branding';
  var CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

  function applyBranding(data) {
    if (!data) return;
    var logo = (data.site_logo_url || '').trim();
    if (logo) {
      document.querySelectorAll('img[data-brand-logo]').forEach(function (el) { el.src = logo; });
      document.querySelectorAll('img[data-brand-logo-dark]').forEach(function (el) { el.src = logo; });
      document.querySelectorAll('img[data-brand-mark]').forEach(function (el) { el.src = logo; });
    }
    var fav = (data.site_favicon_url || '').trim();
    if (fav) {
      var link = document.querySelector('link[rel="icon"]');
      if (link) link.href = fav;
    }
  }

  // Try sessionStorage cache first
  try {
    var cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    if (cached && Date.now() - cached._ts < CACHE_TTL) {
      applyBranding(cached);
      return;
    }
  } catch (_) {}

  fetch('/api/public/branding')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      try { data._ts = Date.now(); sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {}
      applyBranding(data);
    })
    .catch(function () {});
})();
