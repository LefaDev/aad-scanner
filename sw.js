// @ts-check
const CACHE_NAME = 'aad-gate-v1.4.4';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/walkin.css',
  './css/print.css',
  './js/app.js',
  './vendor/qrcode.js',
  './js/config/events.js',
  './js/config/gates.js',
  './js/config/columns.js',
  './js/config/sources.js',
  './js/config/passes.js',
  './js/config/strings.js',
  './js/core/state.js',
  './js/core/security.js',
  './js/core/camera.js',
  './js/core/parser.js',
  './js/core/rules.js',
  './js/core/counters.js',
  './js/core/csv.js',
  './js/core/storage.js',
  './js/core/audio.js',
  './js/core/cloud.js',
  './js/core/report.js',
  './js/core/scanner.js',
  './js/core/export.js',
  './js/core/importer.js',
  './js/core/lookup.js',
  './js/core/session.js',
  './js/core/walkins.js',
  './js/ui/dom.js',
  './js/ui/toast.js',
  './js/ui/shell.js',
  './js/ui/scan.js',
  './js/ui/result.js',
  './js/ui/stats.js',
  './js/ui/activity.js',
  './js/ui/report-modal.js',
  './js/ui/settings.js',
  './js/ui/walkin.js',
  './assets/aad-logo.png',
  './assets/icons.svg',
  './assets/fonts/nunito-sans-600.woff2',
  './assets/fonts/roboto-400.woff2',
  './assets/fonts/roboto-500.woff2',
  './assets/fonts/roboto-700.woff2',
  './assets/fonts/roboto-900.woff2',
  './brand/aad-logo.png',
  './brand/icon-192.png',
  './brand/icon-512.png',
  './brand/favicon.png',
  './samples/sample-aad-manifest.csv'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => console.warn('[sw] precache skipped', asset, err))
        )
      );
    }).then(async () => {
      // CRITICAL FIX: Only auto-skipWaiting if NO gate tab is currently open.
      // Previously unconditional skipWaiting() + controllerchange force-reloaded
      // volunteer tablets mid-scan or mid-walk-in registration!
      const openClients = await self.clients.matchAll({ type: 'window' });
      if (openClients.length === 0) {
        await self.skipWaiting();
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // 1. HTML navigations: Network-first with cached shell fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 2. Cloud APIs: Network-only, never cache
  if (url.pathname.startsWith('/.netlify/functions/') || url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Network offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 3. Same-origin JS & CSS: Stale-While-Revalidate (instant offline load + prevents cache skew)
  if (url.origin === self.location.origin && (url.pathname.includes('/js/') || url.pathname.includes('/css/'))) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                cache.put(event.request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);
          return cachedResponse || fetchPromise;
        })
      )
    );
    return;
  }

  // 4. Fonts, icons, images, samples: Cache-first
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
