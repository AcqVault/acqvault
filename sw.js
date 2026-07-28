/* AcqVault service worker — offline shell + corpus, leaves live data network-only.
   Bump CACHE on any change here, or when the cached corpus must refresh. */
const CACHE = 'acqvault-v155';
const SHELL = [
  '/',
  '/assets/fonts/inter-latin.woff2',
  '/assets/fonts/inter-latin-ext.woff2',
  // Referenced only from app.css, so the install-time parse of index.html never reaches
  // them and the mono faces were missing offline.
  '/assets/fonts/ibm-plex-mono-latin.woff2',
  '/assets/fonts/ibm-plex-mono-sb-latin.woff2'
];
// Cap how many non-root navigated pages we keep offline. Part pages run 1-2.5MB of HTML
// each, so without a bound the cache grew unbounded until the next CACHE bump. FIFO-evict
// the oldest once over the cap; '/' and the precached SHELL/asset entries are exempt.
const NAV_MAX = 15;
async function trimNavCache(c) {
  try {
    const keys = await c.keys();
    const shell = new Set(SHELL.map((u) => new URL(u, self.location.origin).href));
    // Navigated HTML pages only: not the precached shell, not '/', and not one of the
    // cache-first asset/corpus entries that share this cache (r.mode isn't reliable on
    // cached Requests, so filter by path).
    const nav = keys.filter((r) => {
      if (shell.has(r.url)) return false;
      const pth = new URL(r.url).pathname;
      return pth !== '/' && !/^\/(assets|output|pdfs)\//.test(pth);
    });
    for (let i = 0; i < nav.length - NAV_MAX; i++) await c.delete(nav[i]);
  } catch (e) { /* best effort */ }
}

self.addEventListener('install', (event) => {
  // Don't skipWaiting automatically — wait for the page's "Refresh" prompt so an open
  // tab isn't swapped out from under the user mid-task.
  // Precache the render-critical assets so a freshly-installed PWA opened cold-offline
  // still styles, runs, and searches. We PARSE the live HTML for its current versioned
  // asset URLs rather than hardcoding them — so it stays correct across deploys with no
  // SW maintenance. Anything that fails here degrades to the existing on-demand caching.
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL).catch(() => {});
    try {
      const res = await fetch('/', { cache: 'reload' });
      if (res && res.ok) {
        const html = await res.clone().text();
        await c.put('/', res);
        const urls = new Set(['/output/doc-hashes.json', '/output/corpus-meta.json']);
        const re = /\/assets\/[^"'\s)]+/g;
        let m;
        while ((m = re.exec(html))) { if (/\.(?:js|css|woff2)(?:\?|$)/.test(m[0])) urls.add(m[0]); }
        await Promise.all([...urls].map((u) => c.add(u).catch(() => {})));
      }
    } catch (e) { /* offline or asset error at install — on-demand caching still applies */ }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Third-party (usaspending, zenquotes, federalregister) — never touch; let it hit network.
  if (url.origin !== self.location.origin) return;

  // Keyed API (search/market-research) — network-only; the app falls back to the
  // local corpus for search when offline, so we never serve stale API responses.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations — network-first, but race the network against a 3s timeout before
  // falling back to the cached shell. A slow-but-online phone then waits for FRESH
  // HTML (so it never gets pinned to a stale '/' that points at old ?v assets);
  // a truly offline client still gets the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(new Promise((resolve) => {
      let settled = false;
      const finish = (r) => { if (!settled && r) { settled = true; resolve(r); } };
      // Offline fallback prefers THIS page, then the home shell.
      const cachedFallback = () => caches.match(req).then((r) => r || caches.match('/'));
      const timer = setTimeout(() => cachedFallback().then(finish), 3000);
      fetch(req).then((res) => {
        clearTimeout(timer);
        // Only cache a genuine same-origin 2xx HTML shell. Guards, in order: never poison
        // the cache with an error/redirect/opaque response; only text/html (a PDF opened in
        // a tab is also a 'navigate' — without this it was stored forever); '/' is always
        // kept; other pages are bounded to the most-recent NAV_MAX so the cache can't grow
        // without limit (activate only prunes on a CACHE bump). put() is caught so a
        // QuotaExceededError is observed, not left as an unhandled rejection.
        const ct = res && res.headers ? (res.headers.get('content-type') || '') : '';
        if (res && res.ok && res.type === 'basic' && ct.indexOf('text/html') === 0) {
          const copy = res.clone();
          const isRoot = new URL(req.url).pathname === '/';
          caches.open(CACHE).then((c) => {
            const put = isRoot ? c.put('/', copy.clone()) : c.put(req, copy.clone());
            return Promise.resolve(put).then(() => { if (!isRoot) return trimNavCache(c); });
          }).catch(() => {});
        }
        finish(res);
      }).catch(() => { clearTimeout(timer); cachedFallback().then((c) => finish(c || Response.error())); });
    }));
    return;
  }

  // Static assets (?v-busted) + the corpus — cache-first; a new ?v is a new key,
  // so deploys self-refresh and old entries are pruned on the next CACHE bump.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/output/')) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
          return res;
        })
      )
    );
    return;
  }
  // Everything else same-origin: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
