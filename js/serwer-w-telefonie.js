/* „Serwer w telefonie”.
 * Na komputerze Asystent i Laboratorium pytają lokalny serwer (PowerShell) o dane: /api/dane, ../dane/…, /api/pobierz,
 * /api/zapisz, ../wyniki/…, /api/zewn. Na telefonie serwera nie ma, więc te same adresy obsługuje ten skrypt:
 *  - świece i funding pobiera wprost z Binance / Hyperliquid (publiczne dane, bez konta) i trzyma w pamięci telefonu (IndexedDB),
 *    przy każdym użyciu dociąga tylko nowe, zamknięte świece,
 *  - wyniki (dziennik testów, dziennik sygnałów) zapisuje w tej samej pamięci telefonu.
 * Dzięki temu strony Asystenta i Laboratorium działają na telefonie bez żadnych zmian w ich kodzie.
 * Format danych jest taki sam jak w plikach z narzedzia/pobierz-swiece.ps1 i pobierz-funding.ps1. */
(function () {
  'use strict';
  const BAZA = 'inwestor-dane';
  const MS = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  const DOMYSLNE_PLIKI = ['binance-BTCUSDT-4h.json', 'binance-BTCUSDT-1h.json', 'binance-BTCUSDT-15m.json', 'binance-BTCUSDT-1d.json', 'hyperliquid-BTC-4h.json', 'hyperliquid-BTC-1h.json'];
  const oryginalnyFetch = window.fetch.bind(window);

  // ---------- pamięć telefonu (IndexedDB) ----------
  let bazaP = null;
  function baza() {
    if (!bazaP) bazaP = new Promise((ok, blad) => {
      const r = indexedDB.open(BAZA, 1);
      r.onupgradeneeded = () => { const d = r.result; for (const m of ['swiece', 'funding', 'pliki']) if (!d.objectStoreNames.contains(m)) d.createObjectStore(m); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => blad(r.error);
    });
    return bazaP;
  }
  async function operacja(magazyn, tryb, f) {
    const d = await baza();
    return new Promise((ok, blad) => {
      const t = d.transaction(magazyn, tryb), r = f(t.objectStore(magazyn));
      t.oncomplete = () => ok(r && 'result' in r ? r.result : undefined);
      t.onerror = () => blad(t.error); t.onabort = () => blad(t.error);
    });
  }
  const czytaj = (m, k) => operacja(m, 'readonly', s => s.get(k));
  const zapisz = (m, k, v) => operacja(m, 'readwrite', s => s.put(v, k));
  const klucze = m => operacja(m, 'readonly', s => s.getAllKeys());
  // jedna aktualizacja danego pliku naraz (Asystent i Laboratorium mogą poprosić o to samo w tej samej chwili)
  const zamek = (nazwa, f) => (navigator.locks && navigator.locks.request) ? navigator.locks.request('inwestor-' + nazwa, f) : f();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* bez trwałej pamięci */ }

  // ---------- postęp widoczny na stronie ----------
  function postep(tekst) { const el = document.getElementById('status'); if (el) el.textContent = tekst; }
  const czekaj = ms => new Promise(r => setTimeout(r, ms));
  async function pobierzJson(url, opcje, proby = 5) {
    for (let p = 1; ; p++) {
      try {
        const r = await oryginalnyFetch(url, opcje);
        if (r.status === 429 || r.status >= 500) throw new Error('serwer ' + r.status);
        if (!r.ok) throw Object.assign(new Error(`${new URL(url).host}: ${r.status}`), { koniec: true });
        return await r.json();
      } catch (e) {
        if (e.koniec || p >= proby) throw e;
        postep(`Serwer danych odmówił (${e.message}) – ponawiam za ${2 * p} s…`);
        await czekaj(2000 * p);
      }
    }
  }
  const liczba = x => parseFloat(x);
  const tys = n => n.toLocaleString('pl-PL');

  // ---------- świece ----------
  async function swiece(zrodlo, symbol, iw, wymus) {
    const nazwa = `${zrodlo}-${symbol}-${iw}.json`, ms = MS[iw];
    return zamek(nazwa, async () => {
      const zapis = (await czytaj('swiece', nazwa)) || { zrodlo, symbol, interwal: iw, swiece: [] };
      const w = zapis.swiece, teraz = Date.now();
      let ostatni = w.length ? w[w.length - 1][0] : -1, nowych = 0;
      const dodaj = (t, o, h, l, c, v) => {
        if (t + ms > teraz || t <= ostatni) return;     // tylko zamknięte świece i bez powtórzeń
        w.push([t, liczba(o), liczba(h), liczba(l), liczba(c), liczba(v)]); ostatni = t; nowych++;
      };
      if (zrodlo === 'binance') {
        let start = w.length ? ostatni + ms : 1500000000000;
        while (start <= teraz) {
          const p = await pobierzJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${iw}&startTime=${start}&limit=1000`);
          if (!p.length) break;
          for (const k of p) dodaj(k[0], k[1], k[2], k[3], k[4], k[5]);
          start = p[p.length - 1][0] + ms;
          postep(`Pobieram świece ${iw} z Binance: ${tys(w.length)} (do ${new Date(Math.min(start, teraz)).toISOString().slice(0, 10)})…`);
          if (p.length < 1000) break;
        }
      } else {
        // Hyperliquid udostępnia ok. 5000 ostatnich świec – pobieramy je i dokładamy nowsze od zapisanych
        const p = await pobierzJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'candleSnapshot', req: { coin: symbol, interval: iw, startTime: 0, endTime: teraz } }) });
        for (const k of p) dodaj(k.t, k.o, k.h, k.l, k.c, k.v);
      }
      if (w.length < 100) throw new Error(`Za mało świec (${w.length}) – sprawdź połączenie z internetem.`);
      zapis.pobrano = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      if (nowych || wymus || !zapis.zapisano) { zapis.zapisano = zapis.pobrano; await zapisz('swiece', nazwa, zapis); }
      return { zapis, nowych };
    });
  }

  // ---------- funding ----------
  async function funding(zrodlo, symbol) {
    const nazwa = `${zrodlo}-${symbol}.json`;
    return zamek('funding-' + nazwa, async () => {
      const zapis = (await czytaj('funding', nazwa)) || { zrodlo, symbol, stawki: [] };
      const s = zapis.stawki, teraz = Date.now();
      let ostatni = s.length ? s[s.length - 1][0] : -1, nowych = 0;
      const dodaj = (t, r) => { t = Math.round(t / 60000) * 60000; if (t <= ostatni) return; s.push([t, liczba(r)]); ostatni = t; nowych++; };
      if (zrodlo === 'binance') {
        let start = s.length ? ostatni + 1 : 1567000000000;
        for (;;) {
          const p = await pobierzJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&startTime=${start}&limit=1000`);
          if (!p.length) break;
          for (const x of p) dodaj(x.fundingTime, x.fundingRate);
          start = p[p.length - 1].fundingTime + 1;
          postep(`Pobieram funding z Binance: ${tys(s.length)} stawek…`);
          if (p.length < 1000) break;
        }
      } else {
        let start = s.length ? ostatni + 1 : 0;
        for (;;) {
          const p = await pobierzJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'fundingHistory', coin: symbol, startTime: start }) }, 8);
          if (!p.length) break;
          for (const x of p) dodaj(x.time, x.fundingRate);
          start = p[p.length - 1].time + 1;
          postep(`Pobieram funding z Hyperliquid: ${tys(s.length)} stawek…`);
          if (p.length < 400 || start > teraz) break;
          await czekaj(250);
        }
      }
      zapis.pobrano = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      if (nowych || !zapis.zapisano) { zapis.zapisano = zapis.pobrano; await zapisz('funding', nazwa, zapis); }
      return { zapis, nowych };
    });
  }

  // ---------- odpowiedzi w kształcie odpowiedzi serwera ----------
  const odp = (status, cialo) => ({
    ok: status >= 200 && status < 300, status, headers: new Headers(),
    async json() { return typeof cialo === 'string' ? JSON.parse(cialo) : cialo; },
    async text() { return typeof cialo === 'string' ? cialo : JSON.stringify(cialo); }
  });
  const rozbierzPlik = n => {
    const m = /^(binance|hyperliquid)-([A-Z0-9]{1,20})-(15m|1h|4h|1d)\.json$/.exec(n);
    return m ? { zrodlo: m[1], symbol: m[2], iw: m[3] } : null;
  };
  const PUSTY_RSS = '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>';

  async function obsluz(url, opcje) {
    const sciezka = decodeURIComponent(url.pathname), metoda = ((opcje && opcje.method) || 'GET').toUpperCase(), q = url.searchParams;
    let m;
    if (/\/api\/dane$/.test(sciezka)) {
      const zapisane = await klucze('swiece');
      const lista = [...new Set(DOMYSLNE_PLIKI.concat(zapisane))].sort();
      const wynik = [];
      for (const plik of lista) {
        const z = zapisane.includes(plik) ? await czytaj('swiece', plik) : null;
        wynik.push({ plik, rozmiar: z ? z.swiece.length * 48 : 0, zmieniono: (z && z.zapisano) || new Date().toISOString() });
      }
      return odp(200, wynik);
    }
    if ((m = /\/dane\/funding\/([^/]+)\.json$/.exec(sciezka))) {
      const r = /^(binance|hyperliquid)-([A-Z0-9]{1,20})$/.exec(m[1]);
      if (!r) return odp(404, 'brak pliku');
      const { zapis } = await funding(r[1], r[2]);
      return odp(200, { zrodlo: zapis.zrodlo, symbol: zapis.symbol, pobrano: zapis.pobrano, stawki: zapis.stawki });
    }
    if ((m = /\/dane\/([^/]+\.json)$/.exec(sciezka))) {
      const r = rozbierzPlik(m[1]);
      if (!r) return odp(404, 'brak pliku');
      const { zapis } = await swiece(r.zrodlo, r.symbol, r.iw);
      return odp(200, { zrodlo: zapis.zrodlo, symbol: zapis.symbol, interwal: zapis.interwal, pobrano: zapis.pobrano, swiece: zapis.swiece });
    }
    if (/\/api\/pobierz$/.test(sciezka) && metoda === 'POST') {
      const zrodlo = q.get('zrodlo'), iw = q.get('interwal'), symbol = (q.get('symbol') || '') || (zrodlo === 'binance' ? 'BTCUSDT' : 'BTC');
      if (!/^(binance|hyperliquid)$/.test(zrodlo) || !MS[iw] || !/^[A-Z0-9]{1,20}$/.test(symbol)) return odp(400, 'zle parametry');
      try {
        const s = await swiece(zrodlo, symbol, iw, true), f = await funding(zrodlo, symbol);
        return odp(200, `Zapisano ${s.zapis.swiece.length} swiec (nowych: ${s.nowych}) -> pamięć telefonu\nZapisano ${f.zapis.stawki.length} stawek fundingu -> pamięć telefonu`);
      } catch (e) { return odp(500, 'Blad: ' + e.message); }
    }
    if (/\/api\/zapisz$/.test(sciezka) && metoda === 'POST') {
      const nazwa = (q.get('plik') || '').split('/').pop();
      if (!/^[\w.-]+\.json$/.test(nazwa)) return odp(400, 'zla nazwa pliku');
      const cialo = opcje && opcje.body != null ? String(opcje.body) : '';
      await zapisz('pliki', nazwa, cialo);
      return odp(200, 'ok');
    }
    if ((m = /\/wyniki\/([\w.-]+\.json)$/.exec(sciezka))) {
      const t = await czytaj('pliki', m[1]);
      return t == null ? odp(404, 'brak pliku') : odp(200, t);
    }
    if (/\/api\/zewn$/.test(sciezka)) {
      if (q.get('co') === 'fng') {
        try { return odp(200, await pobierzJson('https://api.alternative.me/fng/?limit=8', undefined, 2)); } catch (e) { return odp(502, 'blad zrodla'); }
      }
      return odp(200, PUSTY_RSS);   // serwisy z newsami nie pozwalają telefonowi pobierać ich wprost – nagłówki są w Centrum na komputerze
    }
    // Dziennik tradera: kopia z komputera w Twoim prywatnym Firebase – czyta i zapisuje zalogowana powłoka aplikacji
    if (/\/api\/dziennik(\/wpisy)?$/.test(sciezka)) {
      const C = window.parent !== window && window.parent.CHMURA;
      if (!C) return odp(503, 'Dziennik działa w aplikacji po zalogowaniu.');
      try {
        if (/\/wpisy$/.test(sciezka) && metoda === 'POST') { await C.zapisz('dziennik-wpisy', JSON.parse(String((opcje && opcje.body) || '{}'))); return odp(200, 'ok'); }
        if (metoda === 'GET') {
          const [trade, wpisy, chrome] = await Promise.all([C.pobierz('dziennik-trade'), C.pobierz('dziennik-wpisy'), C.pobierz('dziennik-chrome')]);
          return odp(200, { trade, wpisy, chrome });
        }
      } catch (e) { return odp(503, 'Dziennik z chmury: ' + (e && e.message)); }
    }
    return null;
  }

  window.fetch = async function (wejscie, opcje) {
    let url;
    try { url = new URL(typeof wejscie === 'string' ? wejscie : wejscie.url, location.href); } catch (e) { return oryginalnyFetch(wejscie, opcje); }
    if (url.origin === location.origin && /\/(api\/(dane|pobierz|zapisz|zewn|dziennik|dziennik\/wpisy)|dane\/.+\.json|wyniki\/[\w.-]+\.json)$/.test(url.pathname)) {
      try {
        const o = await obsluz(url, opcje);
        if (o) return o;
      } catch (e) {
        return odp(500, 'Blad: ' + (e && e.message));
      }
    }
    return oryginalnyFetch(wejscie, opcje);
  };

  // dla ekranu „Więcej” w aplikacji: co jest zapisane i ile zajmuje
  window.SERWER_W_TELEFONIE = {
    async stan() {
      const w = [];
      for (const k of await klucze('swiece')) { const z = await czytaj('swiece', k); w.push({ rodzaj: 'świece', nazwa: k, ile: z.swiece.length, od: z.swiece.length ? z.swiece[0][0] : null, zapisano: z.zapisano }); }
      for (const k of await klucze('funding')) { const z = await czytaj('funding', k); w.push({ rodzaj: 'funding', nazwa: k, ile: z.stawki.length, od: z.stawki.length ? z.stawki[0][0] : null, zapisano: z.zapisano }); }
      for (const k of await klucze('pliki')) { const t = await czytaj('pliki', k); w.push({ rodzaj: 'wyniki', nazwa: k, ile: (t || '').length, zapisano: null }); }
      return w;
    },
    async usunDaneRynkowe() { await operacja('swiece', 'readwrite', s => s.clear()); await operacja('funding', 'readwrite', s => s.clear()); },
    // zamyka połączenie z pamięcią telefonu (potrzebne przed usunięciem całej bazy)
    async zamknij() { if (bazaP) { try { (await bazaP).close(); } catch (e) { /* już zamknięta */ } bazaP = null; } },
    swiece, funding
  };
})();
