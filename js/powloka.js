/* Powłoka aplikacji na telefon: cztery ekrany (Panel, Asystent, Laboratorium, Więcej) i karty na dole.
 * Panel, Asystent i Laboratorium to osobne strony w ramkach (ta sama domena) – raz otwarte zostają w pamięci,
 * więc przełączanie kart nie liczy wszystkiego od nowa. */
(function () {
  'use strict';
  const WERSJA = '0.2';
  const $ = id => document.getElementById(id);
  const KARTY = ['panel', 'asystent', 'laboratorium', 'wiecej'];
  const pam = {
    czytaj(k, d) { try { const v = localStorage.getItem('inwestor-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    pisz(k, v) { try { localStorage.setItem('inwestor-' + k, JSON.stringify(v)); } catch (e) { /* tryb prywatny */ } }
  };
  const ekrany = {};
  for (const k of KARTY) ekrany[k] = { el: $('ekran-' + k), ramka: null };
  let biezaca = null;

  function pokaz(k) {
    if (!ekrany[k]) k = 'asystent';
    biezaca = k;
    for (const x of KARTY) {
      const akt = x === k;
      ekrany[x].el.classList.toggle('aktywny', akt);
      const b = $('zakl-' + x); b.setAttribute('aria-selected', String(akt)); b.tabIndex = akt ? 0 : -1;
    }
    const e = ekrany[k];
    if (e.el.dataset.ramka && !e.ramka) {
      e.el.innerHTML = '<div class="wczytywanie"></div>';
      const f = document.createElement('iframe');
      f.title = e.el.dataset.tytul || k;
      f.addEventListener('load', () => { const w = e.el.querySelector('.wczytywanie'); if (w) w.remove(); });
      f.src = e.el.dataset.ramka;
      e.el.appendChild(f); e.ramka = f;
    }
    const nowe = $('zakl-' + k).querySelector('.nowe'); if (nowe) nowe.remove();
    if (k === 'wiecej') pokazWiecej();
    pam.pisz('karta', k);
    if (location.hash !== '#' + k) history.replaceState(null, '', '#' + k);
  }
  document.querySelector('.zakladki').addEventListener('click', e => { const b = e.target.closest('[data-karta]'); if (b) pokaz(b.dataset.karta); });

  // ---------- wiadomości ze stron w ramkach (ten sam most co w Centrum na komputerze) ----------
  function kartaZrodla(zr) { return KARTY.find(k => ekrany[k].ramka && ekrany[k].ramka.contentWindow === zr) || null; }
  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.centrum !== 'string') return;
    if (d.centrum === 'przejdz' && ekrany[d.karta]) pokaz(d.karta);
    else if (d.centrum === 'zgoda-powiadomien') {
      const odp = st => { try { e.source.postMessage({ centrum: 'zgoda', stan: st }, e.origin); } catch (x) { /* ramki już nie ma */ } };
      if (!('Notification' in window)) odp('denied');
      else if (Notification.permission !== 'default') odp(Notification.permission);
      else Notification.requestPermission().then(odp, () => odp('denied'));
    } else if (d.centrum === 'powiadom') {
      const k = kartaZrodla(e.source) || 'asystent';
      baner(String(d.tytul || '').slice(0, 140), String(d.tekst || '').slice(0, 400), k);
      if (k !== biezaca && !$('zakl-' + k).querySelector('.nowe')) { const s = document.createElement('span'); s.className = 'nowe'; $('zakl-' + k).appendChild(s); }
    }
  });
  let banerCzas = null;
  function baner(tytul, tekst, k) {
    const b = $('baner'); b.innerHTML = '';
    const t = document.createElement('b'); t.textContent = tytul; const s = document.createElement('span'); s.textContent = tekst;
    b.append(t, s); b.hidden = false; b.onclick = () => { b.hidden = true; pokaz(k); };
    clearTimeout(banerCzas); banerCzas = setTimeout(() => { b.hidden = true; }, 15000);
  }

  // ---------- ekran „Więcej” ----------
  const NAZWY = { '15m': '15 min', '1h': '1 h', '4h': '4 h', '1d': '1 dzień' };
  function opisDanych(x) {
    let m = /^(binance|hyperliquid)-([A-Z0-9]+)-(15m|1h|4h|1d)\.json$/.exec(x.nazwa);
    if (m) return `${m[1] === 'binance' ? 'Binance' : 'Hyperliquid'} ${m[2]} · świece ${NAZWY[m[3]]}`;
    m = /^(binance|hyperliquid)-([A-Z0-9]+)\.json$/.exec(x.nazwa);
    if (m) return `${m[1] === 'binance' ? 'Binance' : 'Hyperliquid'} ${m[2]} · funding`;
    return { 'dziennik.json': 'Dziennik testów laboratorium', 'sygnaly-asystenta.json': 'Dziennik sygnałów asystenta', 'ostatni-wynik.json': 'Ostatni wynik laboratorium', 'ostatni-asystent.json': 'Ostatnia walidacja asystenta' }[x.nazwa] || x.nazwa;
  }
  async function pokazWiecej() {
    $('wersja').textContent = 'Centrum inwestora na telefon · wersja ' + WERSJA;
    try {
      const s = await window.SERWER_W_TELEFONIE.stan();
      const rynek = s.filter(x => x.rodzaj !== 'wyniki');
      $('stanDanych').innerHTML = rynek.length
        ? `<table class="tabela-danych">${rynek.map(x => `<tr><td><b>${opisDanych(x)}</b><br>${x.ile.toLocaleString('pl-PL')} ${x.rodzaj === 'świece' ? 'świec' : 'stawek'}${x.od ? ' od ' + new Date(x.od).getUTCFullYear() + ' r.' : ''}</td><td>${x.zapisano ? new Date(x.zapisano).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</td></tr>`).join('')}</table>`
          + (s.some(x => x.rodzaj === 'wyniki') ? `<p class="male" style="margin-top:8px">Zapisane wyniki: ${s.filter(x => x.rodzaj === 'wyniki').map(opisDanych).join(', ')}.</p>` : '')
        : 'Jeszcze nic nie pobrano. Dane pobiorą się przy pierwszym otwarciu Asystenta albo Laboratorium.';
    } catch (e) { $('stanDanych').textContent = 'Nie mogę odczytać pamięci telefonu: ' + e.message; }
  }
  $('usunDane').addEventListener('click', async () => {
    if (!confirm('Usunąć pobrane świece i funding z pamięci telefonu? Pobiorą się ponownie przy następnym użyciu. Dzienniki wyników zostają.')) return;
    await window.SERWER_W_TELEFONIE.usunDaneRynkowe();
    pokazWiecej();
  });

  // ---------- „Usuń wszystko z tego telefonu” ----------
  // Kasuje wszystko, co ta aplikacja zapisała w telefonie: bazy IndexedDB (świece, funding, dzienniki, logowanie i kopia
  // migawek Firebase), localStorage/sessionStorage, kopię offline (Cache Storage) i rejestrację service workera.
  // Najpierw zamyka strony w kartach, bo otwarte połączenie z bazą blokuje jej usunięcie. Na koniec sprawdza, co zostało.
  const usunBaze = (nazwa) => new Promise(ok => {
    let koniec = false; const zakoncz = (w) => { if (!koniec) { koniec = true; ok(w); } };
    try {
      const r = indexedDB.deleteDatabase(nazwa);
      r.onsuccess = () => zakoncz(true); r.onerror = () => zakoncz(false);
      r.onblocked = () => setTimeout(() => zakoncz(false), 4000);   // ktoś jeszcze trzyma bazę
    } catch (e) { zakoncz(false); }
  });
  async function nazwyBaz() {
    const znane = ['inwestor-dane', 'firebaseLocalStorageDb', 'firebase-heartbeat-database', 'firebase-installations-database'];
    try { if (indexedDB.databases) return [...new Set((await indexedDB.databases()).map(d => d.name).filter(Boolean).concat(znane))]; } catch (e) { /* starszy iOS */ }
    return znane;
  }
  async function stanPamieci() {
    let bazy = [];
    try { if (indexedDB.databases) bazy = (await indexedDB.databases()).map(d => d.name).filter(Boolean); } catch (e) { bazy = ['(nie da się sprawdzić)']; }
    const kopie = 'caches' in window ? await caches.keys() : [];
    const sw = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
    let ls = 0; try { ls = localStorage.length + sessionStorage.length; } catch (e) { /* brak dostępu */ }
    return { bazy, kopie, sw: sw.length, ls };
  }
  async function usunWszystko() {
    const b = $('usunWszystko'), info = $('wynikUsuwania');
    if (!confirm('Usunąć WSZYSTKO, co ta aplikacja zapisała w telefonie?\n\nPobrane dane rynkowe, dzienniki wyników i sygnałów, ustawienia, kopia offline i logowanie do konta. Tego nie da się cofnąć.\n\nDane w chmurze (Firebase) zostają.')) return;
    b.disabled = true; info.textContent = 'Usuwam…';
    // 1. zamknij strony w kartach i własne połączenie z bazą
    for (const k of KARTY) if (ekrany[k].ramka) { try { ekrany[k].ramka.src = 'about:blank'; } catch (e) { } ekrany[k].ramka.remove(); ekrany[k].ramka = null; }
    await new Promise(r => setTimeout(r, 300));
    if (window.SERWER_W_TELEFONIE && window.SERWER_W_TELEFONIE.zamknij) await window.SERWER_W_TELEFONIE.zamknij();
    // 2. bazy IndexedDB (dane rynkowe, dzienniki, logowanie i kopia Firestore)
    const nieudane = [];
    for (const n of await nazwyBaz()) if (!(await usunBaze(n))) nieudane.push(n);
    // 3. ustawienia, kopia offline, service worker
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { nieudane.push('localStorage'); }
    try { if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k); } catch (e) { nieudane.push('kopia offline'); }
    try { if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) { nieudane.push('service worker'); }
    // 4. sprawdzenie, co zostało
    const s = await stanPamieci();
    const zostalo = [].concat(s.bazy.length ? ['bazy: ' + s.bazy.join(', ')] : [], s.kopie.length ? ['kopia offline: ' + s.kopie.join(', ')] : [],
      s.sw ? ['service worker'] : [], s.ls ? ['ustawienia (' + s.ls + ')'] : []);
    const ekran = document.createElement('div'); ekran.className = 'usunieto';
    ekran.innerHTML = zostalo.length
      ? `<div><h1>Prawie wszystko usunięte</h1><p>Nie udało się usunąć:</p><ul>${zostalo.concat(nieudane.filter(n => !zostalo.some(z => z.includes(n)))).map(t => `<li>${t.replace(/[<>&]/g, '')}</li>`).join('')}</ul>
          <p>Zamknij aplikację w przełączniku aplikacji, otwórz ją i użyj przycisku jeszcze raz – albo usuń dane w Ustawienia → Safari → Zaawansowane → Dane witryn.</p></div>`
      : `<div><h1>Wszystko usunięte</h1><p>W telefonie nie zostały żadne dane tej aplikacji: dane rynkowe, dzienniki, ustawienia, kopia offline i logowanie są skasowane.</p>
          <p>Ikonę usuniesz, przytrzymując ją na ekranie początkowym i wybierając „Usuń z ekranu początkowego”.</p>
          <p>Dane w chmurze (Firebase) zostały – usuwa się je w konsoli Firebase.</p></div>`;
    document.body.appendChild(ekran);
  }
  $('usunWszystko').addEventListener('click', usunWszystko);

  // ---------- działanie bez internetu i aktualizacje ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* bez kopii offline */ });

  const zAdresu = location.hash.slice(1);
  pokaz(ekrany[zAdresu] ? zAdresu : pam.czytaj('karta', 'asystent'));
})();
