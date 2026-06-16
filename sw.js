// VITALE Service Worker — estratégia NETWORK-FIRST
// Regra de ouro: NUNCA servir versão velha do app se há rede.
// O cache só entra quando está offline (fallback).
const CACHE = 'vitale-v1';
const OFFLINE_URLS = ['/app.html', '/assets/css/vitale.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Nunca intercepta chamadas de API ou de outros domínios (Supabase, etc.)
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        // Atualiza o cache em segundo plano com a versão fresca
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('/app.html')))
  );
});
