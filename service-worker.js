const CACHE_VERSION = 'v19';
const CORE_CACHE    = `led-chain-core-${CACHE_VERSION}`;

// Core assets — always cached; bump CACHE_VERSION to force update
const CORE_ASSETS = [
  './index.html',
  './style.css',
  './manifest.json',
  './js/core/idgen.js',
  './js/core/nodeTypes.js',
  './js/core/graphOps.js',
  './js/core/state.js',
  './js/core/canvasRenderer.js',
  './js/core/nodeCardRenderer.js',
  './js/core/propertiesPanel.js',
  './js/core/interactions.js',
  './js/devices/devices.js',
  './js/leddesign/specs.js',
  './js/leddesign/betaPanels.js',
  './js/leddesign/betaAreaInchLabel.js',
  './js/leddesign/portAssignment.js',
  './js/leddesign/ledAreaSetup.js',
  './js/leddesign/ledPortGroups.js',
  './js/leddesign/ledDesignView.js',
  './js/validation/capacityRules.js',
  './js/validation/validationEngine.js',
  './js/save/projectState.js',
  './js/save/saveStore.js',
  './js/app.js',
];

// Extra assets — cached opportunistically (failures ignored)
const EXTRA_ASSETS = [
  './',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];


// Install: cache core + extra assets, then skip waiting
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await cache.addAll(CORE_ASSETS);
    await Promise.allSettled(
      EXTRA_ASSETS.map(url => cache.add(url).catch(() => {}))
    );
    await self.skipWaiting();
  })());
});


// Activate: delete old caches
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== CORE_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});


// Fetch: cache-first, fallback to network
self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) { return; }
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request))
      .catch(() => caches.match('./index.html'))
  );
});


// Message: SKIP_WAITING or RECACHE_CORE
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (e.data !== 'RECACHE_CORE') { return; }
  e.waitUntil(
    caches.open(CORE_CACHE).then(cache =>
      Promise.all(CORE_ASSETS.map(url =>
        fetch(url, { cache: 'no-store' })
          .then(res => { if (res.ok) { return cache.put(url, res); } })
          .catch(() => {})
      ))
    )
  );
});
