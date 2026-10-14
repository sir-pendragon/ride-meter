// 自転車旅メーター service worker: アプリ本体を端末に保存し、電波がなくても起動できるようにする。
// 地図タイルは保存しません（電波がない場所では地図の背景は表示されません）。
const CACHE = 'ride-meter-v2';
const SHELL = ['./', 'index.html', 'core.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'leaflet/leaflet.js', 'leaflet/leaflet.css', 'leaflet/images/layers.png', 'leaflet/images/layers-2x.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // 地図タイル・フォントは通常どおり
  // 本体は「まずネット、だめなら保存分」: 更新をすぐ反映しつつ圏外でも起動できる
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
