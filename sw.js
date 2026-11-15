// Service worker (jak w Bilansie): pliki aplikacji najpierw z sieci (zawsze najnowsza wersja), bez sieci z kopii w telefonie.
// Dane rynkowe (Binance, Hyperliquid) nie przechodzą przez kopię – trzyma je „serwer w telefonie” w IndexedDB.
const WERSJA = 'inwestor-0.6';
const PLIKI = [
  './', 'index.html', 'styl.css', 'manifest.webmanifest', 'telefon-strony.css', 'panel.html', 'panel.css',
  'js/powloka.js', 'js/serwer-w-telefonie.js', 'js/panel-telefon.js', 'js/chmura.js', 'js/konfiguracja.js', 'js/dane-testowe.js', 'js/tylko-w-aplikacji.js',
  'silnik/asystent.html', 'silnik/asystent.css', 'silnik/asystent.js', 'silnik/asystent-silnik.js',
  'silnik/laboratorium.html', 'silnik/laboratorium.css', 'silnik/app.js',
  'silnik/lab.js', 'silnik/worker.js', 'silnik/centrum-most.js',
  'silnik/dziennik.html', 'silnik/dziennik.css', 'silnik/dziennik.js', 'silnik/dziennik-silnik.js', 'silnik/asystent-dziennik.js', 'silnik/dziennik-lab.js', 'silnik/dziennik-wykresy.js', 'silnik/lightweight-charts.js', 'silnik/motyw.js', 'silnik/papier.css',
  'ikony/ikona-180.png', 'ikony/ikona-192.png', 'ikony/ikona-512.png'
];
// czcionki i biblioteki z CDN mają wersję w adresie – wystarczy raz je zapisać
const BIBLIOTEKI = ['https://fonts.googleapis.com/', 'https://fonts.gstatic.com/', 'https://www.gstatic.com/firebasejs/'];

self.addEventListener('install', e => e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI))
  .then(() => bezKopii ? caches.delete(WERSJA) : null).then(() => self.skipWaiting())));
// usuwamy tylko własne stare kopie (inwestor-*): pod tym samym adresem mogą być inne aplikacje, np. Bilans
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(n => Promise.all(n.filter(x => x.startsWith('inwestor-') && x !== WERSJA).map(x => caches.delete(x)))).then(() => self.clients.claim())
));

// „Usuń wszystko” w aplikacji: od tej chwili nic nie zapisuj i usuń własne kopie (strona jest jeszcze obsługiwana
// przez ten service worker, więc bez tego dociągane czcionki albo trwająca instalacja założyłyby kopię na nowo)
var bezKopii = false;
self.addEventListener('message', e => {
  if (e.data && e.data.inwestor === 'usun-kopie') {
    bezKopii = true;
    e.waitUntil(caches.keys().then(n => Promise.all(n.filter(x => x.startsWith('inwestor-')).map(x => caches.delete(x)))));
  }
});
const zapamietaj = (z, o) => { if (!bezKopii && (o.ok || o.type === 'opaque')) { const kopia = o.clone(); caches.open(WERSJA).then(c => c.put(z, kopia)); } return o; };
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
