// 自転車ルート予想 service worker: 本体を端末に保存(地図・ルート計算・標高は通信が必要です)
const CACHE = 'route-v47';
const SHELL = ['./', 'index.html', 'fetchcore.js', 'aicheck.js', 'parse-tables.js', 'parse-tokyo-pdf.js', 'parse-yamanashi.js', 'parse-kanagawa.js', 'parse-city.js', 'parse-road.js', 'muni-registry.js', 'locate.js', 'closures.js', 'gm-shim.js', 'config.js', 'store.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'leaflet/leaflet.js', 'leaflet/leaflet.css', 'leaflet/images/layers.png', 'leaflet/images/layers-2x.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
