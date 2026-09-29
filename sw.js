/* SHK Rechner — Service Worker: macht die App vollständig offline nutzbar.
   Der Scope wird Teil des Cache-Namens, damit parallele Installationen sich nicht beeinflussen. */
var SCOPE_KEY = new URL(self.registration.scope).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
var CACHE_PREFIX = 'shk-tools-' + SCOPE_KEY + '-';
var VERSION = CACHE_PREFIX + 'v20';
var FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys
        .filter(function (k) { return k.indexOf(CACHE_PREFIX) === 0 && k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Seitenaufrufe: erst Netz versuchen (damit Updates ankommen), offline aus dem Cache.
   Alle anderen Dateien: erst Cache, sonst Netz. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (r) {
        if (r && r.ok) {
          var copy = r.clone();
          return caches.open(VERSION).then(function (c) {
            return c.put('./index.html', copy).then(function(){ return r; });
          });
        }
        return r;
      }).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function(r){
        if (r && r.ok && new URL(e.request.url).origin === self.location.origin) {
          var copy=r.clone();
          return caches.open(VERSION).then(function(c){
            return c.put(e.request,copy).then(function(){return r;});
          });
        }
        return r;
      });
    })
  );
});
