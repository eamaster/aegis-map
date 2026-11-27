/* AegisMap Service Worker — caches app shell & content-hashed static assets cleanly.
 * Never caches third-party map tiles (Mapbox, Esri, GIBS, Open-Meteo) or API responses.
 * Ensures atomic HTML + hashed CSS/JS upgrades across releases while preserving offline visits.
 */
const SHELL_CACHE = 'aegis-shell-v1.5.2';

const EXCLUDED_HOSTS = [
  'api.mapbox.com',
  'events.mapbox.com',
  'tiles.mapbox.com',
  'server.arcgisonline.com',
  'gibs.earthdata.nasa.gov',
  'geocoding-api.open-meteo.com',
  'api.open-meteo.com',
];

self.addEventListener('install', (event) => {
  const scopeUrl = new URL(self.registration.scope);
  const indexUrl = new URL('index.html', scopeUrl).href;
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.all([
          cache.put(scopeUrl.href, fetch(new Request(scopeUrl.href, { cache: 'reload' })).then((r) => (r.ok ? r : Promise.reject()))).catch(() => {}),
          cache.put(indexUrl, fetch(new Request(indexUrl, { cache: 'reload' })).then((r) => (r.ok ? r : Promise.reject()))).catch(() => {}),
        ]),
      )
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('aegis-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache map tiles, imagery, or API endpoints in SW
  if (EXCLUDED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return;
  if (url.pathname.includes('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first so new deployments always deliver matching HTML + hashed CSS
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            const scopeUrl = new URL(self.registration.scope);
            caches
              .open(SHELL_CACHE)
              .then((c) => {
                c.put(req, copy.clone()).catch(() => {});
                c.put(scopeUrl.href, copy).catch(() => {});
              })
              .catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          const direct = await cache.match(req);
          if (direct) return direct;
          const scopeUrl = new URL(self.registration.scope);
          return (
            (await cache.match(scopeUrl.href)) ||
            (await cache.match(new URL('index.html', scopeUrl).href)) ||
            Response.error()
          );
        }),
    );
    return;
  }

  // Content-hashed Vite assets (/assets/*): cache-first (immutable per filename hash), fallback to network & cache
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const net = await fetch(req);
          if (net.ok) {
            cache.put(req, net.clone()).catch(() => {});
          }
          return net;
        } catch {
          return Response.error();
        }
      }),
    );
    return;
  }

  // Other same-origin static files (manifest, icons): network-first with cache fallback
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      try {
        const net = await fetch(req);
        if (net.ok) {
          cache.put(req, net.clone()).catch(() => {});
        }
        return net;
      } catch {
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    }),
  );
});
