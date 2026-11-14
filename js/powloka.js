/* Powłoka aplikacji na telefon: ekran logowania, a po zalogowaniu cztery ekrany (Panel, Asystent, Laboratorium, Więcej)
 * i karty na dole. Bez zalogowania żadna karta się nie wczytuje (strony w kartach same też tego pilnują – js/tylko-w-aplikacji.js).
 * Panel, Asystent i Laboratorium to osobne strony w ramkach (ta sama domena) – raz otwarte zostają w pamięci,
 * więc przełączanie kart nie liczy wszystkiego od nowa. */
(function () {
  'use strict';
  const WERSJA = '0.3';
  window.INWESTOR_POWLOKA = true;
  const $ = id => document.getElementById(id);
  const KARTY = ['panel', 'asystent', 'laboratorium', 'wiecej'];
  const pam = {
    czytaj(k, d) { try { const v = localStorage.getItem('inwestor-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    pisz(k, v) { try { localStorage.setItem('inwestor-' + k, JSON.stringify(v)); } catch (e) { /* tryb prywatny */ } }
  };
  // zadania na następny start strony (wylogowanie, „Usuń wszystko”): wykonują się, zanim cokolwiek otworzy bazy
  const zadanie = {
    jest(k) { try { return sessionStorage.getItem('inwestor-zadanie-' + k) === '1'; } catch (e) { return false; } },
    zlec(k) { try { sessionStorage.setItem('inwestor-zadanie-' + k, '1'); } catch (e) { /* bez sesji zadanie się nie wykona */ } },
    zdejmij(k) { try { sessionStorage.removeItem('inwestor-zadanie-' + k); } catch (e) { } }
  };
  // podgląd bez logowania tylko na tym komputerze (localhost, ?test) – do sprawdzania przed publikacją
  const TEST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('test');
  const ekrany = {};
  for (const k of KARTY) ekrany[k] = { el: $('ekran-' + k), ramka: null };
  let biezaca = null, zalogowany = null;
  const naNowo = () => location.replace(location.pathname + (TEST ? '?test' : ''));

  function pokaz(k) {
    if (!zalogowany) return;
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

  // zamyka strony w kartach (ich połączenia z bazami znikają razem z nimi)
  function zamknijRamki() {
    for (const k of KARTY) {
      const e = ekrany[k];
      if (e.ramka) { try { e.ramka.src = 'about:blank'; } catch (x) { } e.ramka.remove(); e.ramka = null; }
      if (e.el.dataset.ramka) e.el.innerHTML = '';
    }
  }

  // ---------- logowanie ----------
  function bramka(stan, blad) {
    zalogowany = null; zamknijRamki();
    $('aplikacja').hidden = true; $('bramka').hidden = false;
    const sprawdzam = stan === 'sprawdzam';
    $('bramkaOpis').textContent = sprawdzam ? 'Sprawdzam logowanie…'
      : 'Zaloguj się kontem, które połączyłeś z panelem na komputerze. Bez logowania aplikacja niczego nie pokazuje.';
    $('formLogowania').hidden = sprawdzam; $('usunZBramki').hidden = sprawdzam;
    $('bladLogowania').textContent = blad || '';
  }
  function wpusc(u) {
    zalogowany = u || { email: '' };
    $('bramka').hidden = true; $('aplikacja').hidden = false;
    $('kontoEmail').textContent = u && u.email ? u.email : 'podgląd bez logowania (tylko na tym komputerze)';
    const zAdresu = location.hash.slice(1);
    pokaz(ekrany[zAdresu] ? zAdresu : pam.czytaj('karta', 'asystent'));
  }
  function komunikat(x) {
    const c = (x && x.code) || '';
    if (/wrong-password|invalid-credential|user-not-found|invalid-email|missing-password|invalid-login/.test(c)) return 'Zły e-mail albo hasło.';
    if (/too-many-requests/.test(c)) return 'Za dużo prób. Spróbuj ponownie za kilka minut.';
    if (/network-request-failed/.test(c)) return 'Brak połączenia z internetem.';
    if (/user-disabled/.test(c)) return 'To konto jest wyłączone.';
    return 'Nie udało się zalogować: ' + (c || (x && x.message) || x);
  }
  $('formLogowania').addEventListener('submit', async e => {
    e.preventDefault();
    const b = e.target.querySelector('button[type=submit]'); b.disabled = true; $('bladLogowania').textContent = '';
    try { const u = await window.CHMURA.zaloguj($('email').value.trim(), $('haslo').value); $('haslo').value = ''; wpusc(u); }
    catch (x) { $('bladLogowania').textContent = komunikat(x); }
    finally { b.disabled = false; }
  });
  async function wyloguj() {
    const b = $('wyloguj'); b.disabled = true;
    zalogowany = null; zamknijRamki();
    try { await window.CHMURA.wyloguj(); } catch (e) { /* kopia i tak zniknie przy starcie */ }
    zadanie.zlec('wyczysc-kopie');
    naNowo();
  }
  $('wyloguj').addEventListener('click', wyloguj);

  // ---------- wiadomości ze stron w ramkach (ten sam most co w Centrum na komputerze) ----------
  function kartaZrodla(zr) { return KARTY.find(k => ekrany[k].ramka && ekrany[k].ramka.contentWindow === zr) || null; }
  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.centrum !== 'string' || !kartaZrodla(e.source)) return;
    if (d.centrum === 'przejdz' && ekrany[d.karta]) pokaz(d.karta);
    else if (d.centrum === 'wyloguj') wyloguj();
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

  // ---------- usuwanie z pamięci telefonu ----------
  // Bazy usuwamy przy starcie strony (po przeładowaniu), zanim cokolwiek je otworzy: otwartej bazy nie da się usunąć,
  // a biblioteka Firebase nie zwalnia swojej, dopóki strona żyje.
  const usunBaze = (nazwa) => new Promise(ok => {
    let koniec = false; const zakoncz = (w) => { if (!koniec) { koniec = true; ok(w); } };
    try {
      const r = indexedDB.deleteDatabase(nazwa);
      r.onsuccess = () => zakoncz(true); r.onerror = () => zakoncz(false);
      r.onblocked = () => setTimeout(() => zakoncz(false), 4000);   // ktoś jeszcze trzyma bazę
    } catch (e) { zakoncz(false); }
  });
  async function nazwyBaz(filtr, znane) {
    try { if (indexedDB.databases) return [...new Set((await indexedDB.databases()).map(d => d.name).filter(Boolean).concat(znane))].filter(filtr); } catch (e) { /* starszy iOS */ }
    return znane.filter(filtr);
  }
  // po wylogowaniu: kopia migawek panelu (Firestore) – bazy firestore/* i jej znaczniki w localStorage
  async function wyczyscKopieMigawek() {
    for (const n of await nazwyBaz(n => n.startsWith('firestore/'), ['firestore/[DEFAULT]/centrum-inwestora/main'])) await usunBaze(n);
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('firestore_')) localStorage.removeItem(k); } catch (e) { }
  }
  async function stanPamieci() {
    let bazy = [];
    try { if (indexedDB.databases) bazy = (await indexedDB.databases()).map(d => d.name).filter(Boolean); } catch (e) { bazy = ['(nie da się sprawdzić)']; }
    const kopie = 'caches' in window ? await caches.keys() : [];
    const sw = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
    let ls = 0; try { ls = localStorage.length + sessionStorage.length; } catch (e) { /* brak dostępu */ }
    return { bazy, kopie, sw: sw.length, ls };
  }
  function zlecUsuniecie() {
    if (!confirm('Usunąć WSZYSTKO, co ta aplikacja zapisała w telefonie?\n\nPobrane dane rynkowe, dzienniki wyników i sygnałów, ustawienia, kopia offline, logowanie i kopia migawek panelu. Tego nie da się cofnąć.\n\nDane w chmurze (Firebase) zostają – usuniesz je na komputerze na stronie telefon.html.')) return;
    zalogowany = null; zamknijRamki();
    zadanie.zlec('usun-wszystko');
    naNowo();
  }
  $('usunWszystko').addEventListener('click', zlecUsuniecie);
  $('usunZBramki').addEventListener('click', zlecUsuniecie);

  async function usunWszystko() {
    zadanie.zdejmij('usun-wszystko');
    const ekran = document.createElement('div'); ekran.className = 'usunieto';
    ekran.innerHTML = '<div><h1>Usuwam…</h1></div>';
    document.body.appendChild(ekran);
    if (window.SERWER_W_TELEFONIE && window.SERWER_W_TELEFONIE.zamknij) { try { await window.SERWER_W_TELEFONIE.zamknij(); } catch (e) { } }
    // 1. bazy IndexedDB (dane rynkowe, dzienniki, logowanie, kopia Firestore)
    const nieudane = [];
    for (const n of await nazwyBaz(() => true, ['inwestor-dane', 'firebaseLocalStorageDb', 'firebase-heartbeat-database', 'firebase-installations-database', 'firestore/[DEFAULT]/centrum-inwestora/main']))
      if (!(await usunBaze(n))) nieudane.push(n);
    // 2. ustawienia, kopia offline, service worker
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { nieudane.push('localStorage'); }
    try { if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k); } catch (e) { nieudane.push('kopia offline'); }
    try { if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) { nieudane.push('service worker'); }
    // 3. sprawdzenie, co zostało
    const s = await stanPamieci();
    const zostalo = [].concat(s.bazy.length ? ['bazy: ' + s.bazy.join(', ')] : [], s.kopie.length ? ['kopia offline: ' + s.kopie.join(', ')] : [],
      s.sw ? ['service worker'] : [], s.ls ? ['ustawienia (' + s.ls + ')'] : []);
    ekran.innerHTML = zostalo.length
      ? `<div><h1>Prawie wszystko usunięte</h1><p>Nie udało się usunąć:</p><ul>${zostalo.concat(nieudane.filter(n => !zostalo.some(z => z.includes(n)))).map(t => `<li>${t.replace(/[<>&]/g, '')}</li>`).join('')}</ul>
          <p>Zamknij aplikację w przełączniku aplikacji, otwórz ją i użyj przycisku jeszcze raz – albo usuń dane w Ustawienia → Safari → Zaawansowane → Dane witryn.</p></div>`
      : `<div><h1>Wszystko usunięte</h1><p>W telefonie nie zostały żadne dane tej aplikacji: dane rynkowe, dzienniki, ustawienia, kopia offline, logowanie i kopia migawek są skasowane.</p>
          <p>Ikonę usuniesz, przytrzymując ją na ekranie początkowym i wybierając „Usuń z ekranu początkowego”.</p>
          <p>Dane w chmurze (Firebase) zostały – usuniesz je na komputerze: localhost:8777/telefon.html → „Usuń wszystko”.</p></div>`;
  }

  // ---------- start ----------
  async function start() {
    if (zadanie.jest('usun-wszystko')) { await usunWszystko(); return; }   // bez service workera i bez logowania
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* bez kopii offline */ });
    if (zadanie.jest('wyczysc-kopie')) { zadanie.zdejmij('wyczysc-kopie'); await wyczyscKopieMigawek(); }
    if (TEST || !window.CHMURA || !window.CHMURA.skonfigurowana()) { wpusc(null); return; }
    bramka('sprawdzam');
    let u = null;
    try { u = await window.CHMURA.uzytkownik(); }
    catch (e) { bramka('logowanie', 'Nie mogę sprawdzić logowania (' + ((e && (e.code || e.message)) || e) + '). Sprawdź internet i otwórz aplikację ponownie.'); return; }
    if (u) wpusc(u); else bramka('logowanie');
    window.CHMURA.naZmiane(x => { if (!x && zalogowany) bramka('logowanie'); }).catch(() => { });
  }
  start();
})();
