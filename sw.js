// Service worker (jak w Bilansie): pliki aplikacji najpierw z sieci (zawsze najnowsza wersja), bez sieci z kopii w telefonie.
// Dane rynkowe (Binance, Hyperliquid) nie przechodzą przez kopię – trzyma je „serwer w telefonie” w IndexedDB.
const WERSJA = 'inwestor-0.2';
const PLIKI = [
  './', 'index.html', 'styl.css', 'manifest.webmanifest', 'telefon-strony.css', 'panel.html', 'panel.css',
  'js/powloka.js', 'js/serwer-w-telefonie.js', 'js/panel-telefon.js', 'js/chmura.js', 'js/konfiguracja.js', 'js/dane-testowe.js',
  'silnik/asystent.html', 'silnik/asystent.css', 'silnik/asystent.js', 'silnik/asystent-silnik.js',
  'silnik/laboratorium.html', 'silnik/laboratorium.css', 'silnik/app.js',
  'silnik/lab.js', 'silnik/worker.js', 'silnik/centrum-most.js',
  'ikony/ikona-180.png', 'ikony/ikona-192.png', 'ikony/ikona-512.png'
];
// czcionki i biblioteki z CDN mają wersję w adresie – wystarczy raz je zapisać
const BIBLIOTEKI = ['https://fonts.googleapis.com/', 'https://fonts.gstatic.com/', 'https://www.gstatic.com/firebasejs/'];

self.addEventListener('install', e => e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(n => Promise.all(n.filter(x => x !== WERSJA).map(x => caches.delete(x)))).then(() => self.clients.claim())
));

const zapamietaj = (z, o) => { if (o.ok || o.type === 'opaque') { const kopia = o.clone(); caches.open(WERSJA).then(c => c.put(z, kopia)); } return o; };
const zKopii = async z => (await caches.match(z, { ignoreSearch: true })) || (z.mode === 'navigate' ? caches.match('index.html') : undefined);

// słaba sieć: po 3 s bierzemy kopię, żeby aplikacja nie wisiała; bez kopii czekamy na sieć
function odpowiedz(z) {
  return new Promise(gotowe => {
    let wyslano = false;
    const wyslij = o => { if (!wyslano) { wyslano = true; gotowe(o); } };
    const zegar = setTimeout(async () => { const k = await zKopii(z); if (k) wyslij(k); }, 3000);
    fetch(z).then(o => { clearTimeout(zegar); wyslij(zapamietaj(z, o)); }, async () => { clearTimeout(zegar); wyslij((await zKopii(z)) || Response.error()); });
  });
}

self.addEventListener('fetch', e => {
  const z = e.request;
  if (z.method !== 'GET') return;
  if (BIBLIOTEKI.some(p => z.url.startsWith(p))) e.respondWith(caches.match(z).then(k => k || fetch(z).then(o => zapamietaj(z, o))));
  else if (new URL(z.url).origin === location.origin) e.respondWith(odpowiedz(z));
});
