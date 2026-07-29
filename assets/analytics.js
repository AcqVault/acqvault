/* AcqVault analytics beacon — cookieless, storage-free, same-origin.
 *
 * Deliberately NOT Plausible/GA/Vercel Analytics: every one of those is a
 * third-party script origin, and this site's whole premise is that it works from
 * a locked-down .mil desktop. The CSP is script-src 'self' / connect-src 'self',
 * and this file honours that — it talks to /api/feedback on our own origin and
 * nowhere else.
 *
 * It sets no cookie, writes nothing to localStorage or sessionStorage, and reads
 * no device characteristic beyond a viewport-width bucket. See api/_analytics.js
 * for the full list of what the server keeps (and what it refuses to keep).
 *
 * Nothing on the page depends on this file. Every listener is passive, every send
 * is fire-and-forget, and a total failure here is invisible to the user.
 */
(function () {
  'use strict';

  // Global Privacy Control is a real opt-out signal (and law in several states).
  // We collect nothing personal, but honouring it costs one line and one visitor.
  if (navigator.globalPrivacyControl === true) return;

  var ENDPOINT = '/api/feedback';
  var sent = 0, MAX = 60;   // a hard per-page ceiling; a loop in a listener can't flood

  function send(payload) {
    if (sent++ >= MAX) return;
    payload.kind = 'px';    // the mode marker api/feedback.js dispatches on
    var json;
    try { json = JSON.stringify(payload); } catch (e) { return; }
    try {
      // sendBeacon survives the page being closed mid-request, which a plain
      // fetch does not — it is the difference between counting a visit and
      // losing it when someone clicks straight through to a part page.
      if (navigator.sendBeacon) {
        var blob = new Blob([json], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
        credentials: 'omit'
      }).catch(function () {});
    } catch (e) { /* analytics must never surface an error to the user */ }
  }

  // Three buckets, from the viewport only. Not a fingerprint: no UA string, no
  // screen size, no platform, no plugin/font/canvas probing.
  function deviceClass() {
    var w = window.innerWidth || document.documentElement.clientWidth || 1024;
    if (w < 640) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function pageview() {
    send({
      a: 'view',
      p: location.pathname,     // path only — never the query string
      r: document.referrer,     // server reduces this to a hostname and drops the rest
      d: deviceClass()
    });
  }

  // Don't count a speculative prerender as a visit; count it if it's activated.
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', pageview, { once: true });
  } else {
    pageview();
  }

  // ── engagement ─────────────────────────────────────────────────────────────
  // These ride events app.js already dispatches. `n` is the result count the user
  // actually saw, so a search that found nothing is distinguishable from one that
  // worked — that difference is the whole reason for collecting queries at all.
  document.addEventListener('acqvault:searched', function (e) {
    var d = (e && e.detail) || {};
    send({ a: 'search', q: d.q || '', n: Number(d.n) || 0 });
  });

  document.addEventListener('acqvault:asked', function (e) {
    var d = (e && e.detail) || {};
    send({ a: 'ask', q: d.q || '', n: Number(d.n) || 0 });
  });

  // A search that ends in an opened document is a search that worked. The ratio of
  // this to 'search' is the closest thing to a success metric the site has.
  document.addEventListener('acqvault:draweropen', function () {
    send({ a: 'open' });
  });

  // Which lane people use. 'search' is the default view, so counting it here would
  // just shadow the pageview — only the two lanes a user has to choose are logged.
  document.addEventListener('acqvault:mode', function (e) {
    var m = (e && e.detail && e.detail.mode) || '';
    if (m === 'browse' || m === 'fulltext') send({ a: m });
  });
})();
