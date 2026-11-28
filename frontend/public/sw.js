/* AegisMap Service Worker — atomic, interruption-safe offline app shell.
 * Pre-caches the exact build-manifest shell, CSS, entry JS, and lazy NearMeView
 * route chunks into a new versioned cache BEFORE retiring the previous shell.
 * Never caches third-party map tiles (Mapbox, Esri, GIBS, Open-Meteo) or API responses.
 */
/* __AEGIS_PRECACHE_INJECT__ */

const CACHE_PREFIX = 'aegis-shell-';
const PRECACHE_MANIFEST = self.__AEGIS_PRECACHE__ || {
  version: 'unbuilt',
  assets: ['./', 'index.html', 'manifest.webmanifest'],
};
const SHELL_CACHE = `${CACHE_PREFIX}${PRECACHE_MANIFEST.version}`;

const EXCLUDED_HOSTS = [
  'api.mapbox.com',
  'events.mapbox.com',
  'tiles.mapbox.com',
  'server.arcgisonline.com',
  'gibs.earthdata.nasa.gov',
  'geocoding-api.open-meteo.com',
  'api.open-meteo.com',
];

function validateAssetContentType(relPath, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (relPath.endsWith('.js')) {
    return ct.includes('javascript') || ct.includes('ecmascript');
  }
  if (relPath.endsWith('.css')) {
    return ct.includes('css');
  }
  if (relPath === './' || relPath === 'index.html') {
    return ct.includes('html');
  }
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const scopeUrl = new URL(self.registration.scope);
      const cache = await caches.open(SHELL_CACHE);
      try {
        const stagedEntries = await Promise.all(
          PRECACHE_MANIFEST.assets.map(async (relPath) => {
            const targetUrl = new URL(relPath, scopeUrl).href;
            const response = await fetch(new Request(targetUrl, { cache: 'reload' }));
            if (!response.ok) {
              throw new Error(`Precache HTTP ${response.status} for ${targetUrl}`);
            }
            const ct = response.headers.get('content-type') || '';
            if (!validateAssetContentType(relPath, ct)) {
              throw new Error(`Invalid content-type "${ct}" for ${targetUrl}`);
            }
            const body = await response.arrayBuffer();
            if (body.byteLength === 0) {
              throw new Error(`Empty response body for ${targetUrl}`);
            }
            return {
              targetUrl,
              response: new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              }),
            };
          }),
        );

        for (const entry of stagedEntries) {
          await cache.put(entry.targetUrl, entry.response);
        }

        // Only advance to activate once every required asset in the new build is verified in SHELL_CACHE
        await self.skipWaiting();
      } catch (err) {
        // Delete partial staging cache and fail install so the previous active SW & cache stay intact
        await caches.delete(SHELL_CACHE).catch(() => {});
        throw err;
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
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

  if (EXCLUDED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return;
  if (url.pathname.includes('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first when online; fallback to the atomic pre-cached shell when offline.
  // Never overwrite SHELL_CACHE with unverified HTML during navigation so interrupted deployments cannot mix versions.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        const scopeUrl = new URL(self.registration.scope);
        return (
          (await cache.match(req)) ||
          (await cache.match(scopeUrl.href)) ||
          (await cache.match(new URL('index.html', scopeUrl).href)) ||
          Response.error()
        );
      }),
    );
    return;
  }

  // Same-origin static & content-hashed assets: serve from verified SHELL_CACHE first, else network
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch {
        return Response.error();
      }
    }),
  );
});
