/* AegisMap Service Worker — caches app shell & static assets only.
 * Never caches third-party map tiles (Mapbox, Esri, GIBS) or Workers AI responses.
 */
const SHELL_CACHE = 'aegis-shell-v1.5.0';

const EXCLUDED_HOSTS = [
  'api.mapbox.com',
  'events.mapbox.com',
  'server.arcgisonline.com',
  'gibs.earthdata.nasa.gov',
];

self.addEventListener('install', (event) => {
  const scopeUrl = new URL(self.registration.scope);
  const indexUrl = new URL('index.html', scopeUrl).href;
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([scopeUrl.href, indexUrl])).catch(() => {}),
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

  // Never cache map tiles, imagery, or cross-origin APIs in SW
  if (EXCLUDED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return;
  if (url.pathname.includes('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first with cached shell fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          const direct = await cache.match(req);
          if (direct) return direct;
          const scopeUrl = new URL(self.registration.scope);
          return (await cache.match(scopeUrl.href)) || (await cache.match(new URL('index.html', scopeUrl).href));
        }),
    );
    return;
  }

  // Static same-origin assets: stale-while-revalidate
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(networkPromise);
        return cached;
      }
      const net = await networkPromise;
      return net || Response.error();
    }),
  );
});
