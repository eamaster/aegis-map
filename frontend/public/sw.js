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
  if (relPath.endsWith('.svg')) {
    return ct.includes('image/svg+xml');
  }
  if (relPath.endsWith('.png')) {
    return ct.includes('image/png');
  }
  if (relPath.endsWith('.ico')) {
    return ct.includes('icon') || ct.includes('image/') || ct.includes('octet-stream');
  }
  if (relPath.endsWith('.webmanifest')) {
    return ct.includes('json') && !ct.includes('html');
  }
  return !ct.includes('html');
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

function getScopeHref() {
  return (self.registration && self.registration.scope) || new URL('./', self.location.href).href;
}

function sanitizeStructuredRoute(rawRoute) {
  if (!rawRoute || typeof rawRoute !== 'object') return null;
  const lat = Number(rawRoute.lat);
  const lng = Number(rawRoute.lng);
  const warningId = typeof rawRoute.warningId === 'string' ? rawRoute.warningId.trim() : '';
  const countryCode = typeof rawRoute.countryCode === 'string' ? rawRoute.countryCode.trim().toUpperCase() : '';
  const placeName = typeof rawRoute.placeName === 'string' ? rawRoute.placeName.trim().slice(0, 120) : '';
  const msgType = rawRoute.msgType === 'Cancel' || rawRoute.msgType === 'Update' ? rawRoute.msgType : 'Alert';
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return null;
  }
  return {
    view: 'near-me',
    lat,
    lng,
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : '',
    warningId,
    ...(placeName ? { placeName } : {}),
    msgType,
  };
}

function buildScopedNotificationUrl(payload) {
  const scopeBase = new URL(getScopeHref());
  const defaultNearMe = `${scopeBase.href.replace(/\/$/, '')}/?view=near-me`;

  const route = sanitizeStructuredRoute(payload && payload.route);
  if (route) {
    const target = new URL('./', scopeBase);
    target.searchParams.set('view', 'near-me');
    target.searchParams.set('lat', String(route.lat));
    target.searchParams.set('lng', String(route.lng));
    if (route.countryCode) target.searchParams.set('country', route.countryCode);
    if (route.warningId) target.searchParams.set('warningId', route.warningId);
    if (route.placeName) target.searchParams.set('place', route.placeName);
    if (route.msgType === 'Cancel') target.searchParams.set('noticeStatus', 'cancelled');
    return target.href;
  }

  const rawUrl = payload && typeof payload.url === 'string' ? payload.url : '';
  if (rawUrl) {
    try {
      const resolved = new URL(rawUrl, scopeBase);
      if (resolved.origin === scopeBase.origin && resolved.pathname.startsWith(scopeBase.pathname)) {
        return resolved.href;
      }
    } catch {
      // ignore malformed URL and fall back to Near me
    }
  }
  return defaultNearMe;
}

self.addEventListener('push', (event) => {
  let payload = null;
  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed;
      }
    } catch {
      payload = null;
    }
  }

  const scopeHref = getScopeHref();
  const validRoute = sanitizeStructuredRoute(payload && payload.route);
  const hasValidTitle = Boolean(payload && typeof payload.title === 'string' && payload.title.trim());
  const hasValidBody = Boolean(payload && typeof payload.body === 'string' && payload.body.trim());
  const warningId =
    (validRoute && validRoute.warningId) ||
    (payload && typeof payload.warningId === 'string' ? payload.warningId.trim() : '');

  // Missing or malformed push payloads must NEVER fabricate an official warning.
  if (!payload || (!hasValidTitle && !validRoute && !warningId)) {
    const safeUrl = buildScopedNotificationUrl(null);
    event.waitUntil(
      self.registration.showNotification('AegisMap', {
        body: 'Open Near me to check current official warning status.',
        icon: new URL('icons/icon-192.png', scopeHref).href,
        badge: new URL('icons/favicon-32x32.png', scopeHref).href,
        tag: 'aegis-status-check',
        renotify: false,
        data: { url: safeUrl, warningId: '', route: null, malformed: true },
      }),
    );
    return;
  }

  const title = hasValidTitle ? payload.title.trim().slice(0, 140) : 'AegisMap Notice';
  const body = hasValidBody
    ? payload.body.trim().slice(0, 320)
    : 'Open Near me to inspect the official bulletin.';
  const targetUrl = buildScopedNotificationUrl(payload);
  const tag =
    typeof payload.tag === 'string' && payload.tag.trim()
      ? payload.tag.trim().slice(0, 64)
      : warningId
        ? `aegis-warning-${warningId.slice(0, 48)}`
        : 'aegis-warning';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: new URL('icons/icon-192.png', scopeHref).href,
      badge: new URL('icons/favicon-32x32.png', scopeHref).href,
      tag,
      renotify: true,
      data: {
        url: targetUrl,
        warningId,
        route: validRoute,
        msgType: payload.msgType === 'Cancel' || payload.msgType === 'Update' ? payload.msgType : 'Alert',
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification && event.notification.data ? event.notification.data : {};
  const scopeHref = getScopeHref();
  const targetUrl = buildScopedNotificationUrl(data);
  const route = sanitizeStructuredRoute(data.route);
  const warningId = (route && route.warningId) || (typeof data.warningId === 'string' ? data.warningId : '');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (client.url && client.url.startsWith(scopeHref)) {
          if (typeof client.focus === 'function') {
            await client.focus();
          }
          if (typeof client.navigate === 'function' && client.url !== targetUrl) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // SPA listener handles navigation message if navigate rejects
            }
          }
          if (typeof client.postMessage === 'function') {
            client.postMessage({ type: 'AEGIS_WARNING_CLICK', url: targetUrl, warningId, route });
          }
          return client;
        }
      }
      if (typeof self.clients.openWindow === 'function') {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    }),
  );
});
