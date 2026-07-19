/* AcqVault service worker — offline shell + corpus, leaves live data network-only.
   Bump CACHE on any change here, or when the cached corpus must refresh. */
const CACHE = 'acqvault-v69';
const SHELL = [
  '/',
  '/assets/fonts/inter-latin.woff2',
  '/assets/fonts/inter-latin-ext.woff2'
];

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
      const timer = setTimeout(() => caches.match('/').then(finish), 3000);
      fetch(req).then((res) => {
        clearTimeout(timer);
        // Only cache a genuine same-origin 2xx shell — never poison '/' with an
        // error page, redirect, or opaque response.
        if (res && res.ok && res.type === 'basic') {
          caches.open(CACHE).then((c) => c.put('/', res.clone()));
        }
        finish(res);
      }).catch(() => { clearTimeout(timer); caches.match('/').then((c) => finish(c || Response.error())); });
    }));
    return;
  }

  // Static assets (?v-busted) + the corpus — cache-first; a new ?v is a new key,
  // so deploys self-refresh and old entries are pruned on the next CACHE bump.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/output/')) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
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
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
