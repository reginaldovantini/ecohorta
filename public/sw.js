/*
 * Service worker da EcoHorta (PWA).
 *
 * - Arquivos estáticos (_next/static, ícones, fontes): cache-first.
 * - Páginas: rede primeiro; sem conexão, última versão salva ou /offline.
 * - /api: NUNCA passa pelo cache. Dados do captador e liberação de água
 *   exigem conexão real — nenhuma ação física é simulada offline.
 */
const VERSION = "ecohorta-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const isStatic =
    url.pathname.startsWith("/_next/static/") || /\.(?:png|svg|ico|woff2?|webmanifest)$/.test(url.pathname);

  if (isStatic) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(PAGES_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match(OFFLINE_URL))),
    );
  }
});

/*
 * AVISOS DO CAPTADOR.
 *
 * Chegam com o aplicativo fechado — é esse o ponto. O tubo enche de madrugada
 * e no fim de semana, e até existir isto só descobria quem abrisse o app por
 * acaso.
 *
 * `tag` faz o aviso novo SUBSTITUIR o anterior do mesmo captador, em vez de
 * empilhar: três avisos do mesmo tubo na bandeja viram ruído, e ruído a pessoa
 * desliga.
 */
self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = {};
  }
  const titulo = dados.title || "EcoHorta";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.body || "",
      tag: dados.tag || "ecohorta",
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: dados.url || "/" },
    }),
  );
});

/* Tocar no aviso abre a aba que já existe, em vez de abrir mais uma. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((abas) => {
      for (const aba of abas) {
        if (aba.url.includes(self.location.origin)) return aba.focus().then((focada) => focada.navigate(destino));
      }
      return self.clients.openWindow(destino);
    }),
  );
});
