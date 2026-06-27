/* AcqVault service worker — offline shell + corpus, leaves live data network-only.
   Bump CACHE on any change here, or when the cached corpus must refresh. */
const CACHE = 'acqvault-v1';
const SHELL = [
  '/',
  '/assets/fonts/inter-latin.woff2',
  '/assets/fonts/inter-latin-ext.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
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

  // Navigations — network-first so a deploy's fresh HTML (with current ?v assets)
  // always wins; fall back to the cached shell only when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return res; })
        .catch(() => caches.match('/'))
    );
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
