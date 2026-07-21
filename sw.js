// BFMIDI Editor — Service Worker.
//
// Estrategia:
//   - App shell em cache-first com pre-cache no install.
//   - Recursos opcionais (sw.js, manifesto, fontes) — cache opportunistic
//     no fetch.
//   - Nao intercepta cross-origin (chamadas pra device em outro host
//     passam direto pra rede).

const CACHE_NAME = 'bfmidi-editor-v9';
// Arquivos que mudam a cada build do webApp — servir network-first pra
// nao precisar bumpar CACHE_NAME a cada update. Cai pro cache so offline.
const NETWORK_FIRST = [
  './',
  './index.html',
  './app.css',
  './app.jsx',
];
const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './app.jsx',
  './vendor/react.development.js',
  './vendor/react-dom.development.js',
  './vendor/babel.min.js',
  './vendor/fonts/fonts.css',
  './icons/app.svg',
  './icons/app-192.png',
  './icons/app-512.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Cross-origin (ex: API HTTP do dispositivo em outro IP) -> passthrough.
  if (url.origin !== self.location.origin) return;

  // Network-first pros arquivos que mudam a cada build (index/app.jsx/app.css).
  // Evita o problema do PWA servir versao antiga pra sempre quando CACHE_NAME
  // nao e bumpado a cada release.
  const path = url.pathname.replace(/^.*\//, './');
  const isShell = NETWORK_FIRST.includes(path) ||
                  url.pathname === '/' ||
                  url.pathname.endsWith('/index.html') ||
                  url.pathname.endsWith('/app.jsx') ||
                  url.pathname.endsWith('/app.css');

  if (isShell) {
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(req).then((cached) =>
        cached || (req.mode === 'navigate' ? caches.match('./index.html')
                                           : new Response('', { status: 504, statusText: 'offline' }))
      ))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // Cache oportunistic so para assets do app (woff2, jsx, js, css,
        // svg, png, json). Evita guardar respostas grandes / dinamicas.
        if (resp && resp.ok) {
          const p = url.pathname.toLowerCase();
          if (p.endsWith('.woff2') || p.endsWith('.jsx') ||
              p.endsWith('.js')    || p.endsWith('.css') ||
              p.endsWith('.svg')   || p.endsWith('.png') ||
              p.endsWith('.webmanifest') || p.endsWith('.json')) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
        }
        return resp;
      }).catch(() => {
        // Offline + nao cacheado: tenta servir index.html como fallback
        // pra navegacao (SPA-like).
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
