/* Dziennik tradera – silnik (bez DOM; ten sam kod na komputerze i w telefonie).
 *
 * Dane wejściowe:
 *   E – eksport z panelu inwestora (dane/panel/dziennik-trade.json): trade'y od otwarcia do zera z wypełnieniami,
 *   C – zaimportowany dziennik Claude w Chrome (setupy, zasady v3, etykiety 44 trade'ów, notatki, obserwacje),
 *   W – Twoje wpisy { wpisy: {id: wpis}, auto: {id: dane policzone automatycznie} }.
 * Definicje (opisane też na stronie):
 *   - dzień = dzień kalendarzowy w Polsce; „strata” = trade z wynikiem netto < −1 USDC (jak w dzienniku z Chrome),
 *   - prawdopodobny revenge = wejście ≤ 2 h po zamknięciu trade'u ze stratą,
 *   - zmiana kierunku = wejście w przeciwną stronę ≤ 60 min po zamknięciu poprzedniego trade'u,
 *   - po dużym zysku = wejście ≤ 4 h po trade'zie z zyskiem ≥ max(3 USDC, 2 × mediana |wyniku|),
 *   - trend = cena zamknięcia ostatniej pełnej świecy 1h przed wejściem względem EMA200 (long nad = z trendem, short pod = z trendem),
 *   - R = wynik netto / ryzyko przy pierwszym stop lossie (|wejście − SL| × wielkość); bez SL – brak R.
 * Wnioski to opis Twoich danych z liczbą przypadków – przy małej próbie mogą być przypadkiem. Nie są radą inwestycyjną. */
(function (g) {
  'use strict';
  const DZ = {};
  const N = (x) => (x === null || x === undefined || x === '' ? NaN : Number(x));
  const fin = (x) => typeof x === 'number' && isFinite(x);
  const DZIEN_PL = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
  DZ.dzien = (t) => DZIEN_PL.format(new Date(t));
  const GODZ = 3600000, MIN = 60000;
  DZ.STRATA = -1; DZ.REVENGE_MS = 2 * GODZ; DZ.ZMIANA_MS = 60 * MIN; DZ.PO_ZYSKU_MS = 4 * GODZ;

  DZ.EMOCJE = ['spokój', 'pewność siebie', 'FOMO', 'strach', 'chciwość', 'nuda', 'zemsta', 'zmęczenie', 'presja'];
  DZ.BLEDY = ['bez SL', 'za duża pozycja', 'wejście bez sygnału', 'pod prąd', 'przesunięty SL', 'za wczesne wyjście', 'przesuwanie TP', 'revenge', 'za dużo trade\'ów', 'wejście za późno'];
  DZ.OCENY = ['A', 'B', 'C', 'D'];

  // ------------------------------------------------------------------ wpisy: scalanie (PC ↔ telefon) po czasie zmiany
  DZ.pusteWpisy = () => ({ wersja: 1, wpisy: {}, auto: {} });
  DZ.scalWpisy = function (a, b) {
    const w = DZ.pusteWpisy(); a = a || {}; b = b || {};
    for (const zb of ['wpisy', 'auto']) {
      const A = a[zb] || {}, B = b[zb] || {}, pole = zb === 'wpisy' ? 'zmieniono' : 'policzono';
      for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
        const x = A[id], y = B[id];
        w[zb][id] = !x ? y : !y ? x : (N(y[pole]) > N(x[pole]) ? y : x);
      }
    }
    return w;
  };

  // ------------------------------------------------------------------ dopasowanie do dziennika z Chrome
  // etykiety 44 trade'ów (T01…): ta sama minuta otwarcia (±60 s), kierunek i rynek
  DZ.etykietaChrome = function (t, C) {
    if (!C || !C.trade) return null;
    const x = C.trade.find(c => c.rynek === t.rynek && c.kierunek.toLowerCase() === t.strona && Math.abs(Date.parse(c.otwarcie) - t.otwarcie) <= MIN);
    return x ? { id: x.id, etykieta: x.etykieta, notatka: x.notatka || '', trend: x.trend, revenge: x.revenge, seria: x.seria_po_zysku, dzwignia: x.dzwignia, mfe: x.mfe_pct, mae: x.mae_pct } : null;
  };
  // notatki do pojedynczych trade'ów (1.11, 9.11): ten sam dzień w Polsce, kierunek, wejście ±15 USD
  DZ.notatkaChrome = function (t, C) {
    if (!C || !C.notatkiTrade) return null;
    return C.notatkiTrade.find(n => n.rynek === t.rynek && n.kierunek.toLowerCase() === t.strona && (n.data === DZ.dzien(t.otwarcie) || n.data === new Date(t.otwarcie).toISOString().slice(0, 10)) && Math.abs(n.wejscie - t.wejscie) <= 15) || null;
  };
  // setup z analiz: ten sam kierunek, BTC, wejście w dniu setupu lub do 2 dni później, cena wejścia blisko planu
  // (≤ połowy odległości do SL albo ≤ 0,25%) – wybieramy najbliższy
  DZ.setupChrome = function (t, C) {
    if (!C || !C.setupy || String(t.rynek).split(/[\s(]/)[0].toUpperCase() !== 'BTC') return null;
    let best = null;
    for (const s of C.setupy) {
      if (s.kierunek.toLowerCase() !== t.strona) continue;
      const od = Date.parse(s.data + 'T00:00:00Z'), dni = (t.otwarcie - od) / 86400000;
      if (!(dni >= 0 && dni <= 3)) continue;
      const odl = Math.abs(t.wejscie - s.wejscie), tol = Math.max(0.0025 * s.wejscie, 0.5 * Math.abs(s.wejscie - s.sl));
      if (odl > tol) continue;
      if (!best || odl < best.odl) best = { id: s.id, odl, setup: s };
    }
    return best;
  };

  // ------------------------------------------------------------------ zlecenia Hyperliquid (historicalOrders) → SL/TP trade'u
  // Zlecenia tej monety, złożone od 10 min przed otwarciem do zamknięcia, po przeciwnej stronie (zamykające):
  // Stop … → stop loss (cena triggera), Take Profit … albo zwykły limit reduce-only → take profit.
  DZ.zleceniaTrade = function (t, zlecenia) {
    if (!zlecenia || t.gielda !== 'Hyperliquid') return null;
    const strZam = t.strona === 'long' ? 'A' : 'B', kon = t.zamkniecie || Date.now();
    const sl = [], tp = [];
    for (const z of zlecenia) {
      const o = z.order || z; if (o.coin !== t.rynek || o.side !== strZam) continue;
      const ts = N(o.timestamp); if (!(ts >= t.otwarcie - 10 * MIN && ts <= kon)) continue;
      const typ = String(o.orderType || ''), trig = N(o.triggerPx), lim = N(o.limitPx);
      const wpis = { t: ts, cena: /Stop|Take/.test(typ) && trig > 0 ? trig : lim, typ, status: z.status || null, oid: o.oid };
      if (/Stop/.test(typ)) sl.push(wpis);
      else if (/Take Profit/.test(typ) || (o.reduceOnly && /Limit/.test(typ))) tp.push(wpis);
    }
    if (!sl.length && !tp.length) return { sl: null, tp: null, slPierwszy: null, tpPierwszy: null, zmianySl: 0, zmianyTp: 0 };
    sl.sort((a, b) => a.t - b.t); tp.sort((a, b) => a.t - b.t);
    // stop poniżej wejścia dla longa (powyżej dla shorta) to prawdziwy SL; stop po stronie zysku to przesunięty BE/trailing
    const poStronieStraty = (c) => t.strona === 'long' ? c < t.wejscie : c > t.wejscie;
    const slStrata = sl.filter(x => poStronieStraty(x.cena));
    return {
      slPierwszy: slStrata.length ? slStrata[0].cena : (sl.length ? sl[0].cena : null),
      sl: sl.length ? sl[sl.length - 1].cena : null,
      tpPierwszy: tp.length ? tp[0].cena : null,
      tp: tp.length ? tp[tp.length - 1].cena : null,
      zmianySl: Math.max(0, sl.length - 1), zmianyTp: Math.max(0, tp.length - 1),
      slWykonany: sl.some(x => /filled|triggered/.test(x.status || '')), statusySl: sl.map(x => x.status)
    };
  };

  // ------------------------------------------------------------------ MFE/MAE ze świec (np. 15m z Hyperliquid)
  // sw: posortowane [{t, h, l, c}] (t = otwarcie świecy). Ruch w % od średniej ceny wejścia; „po wyjściu” = najdalszy
  // ruch w kierunku trade'u w 4 h po zamknięciu (ile zostawiłeś na stole).
  DZ.mfeMae = function (t, sw, msSwiecy) {
    if (!sw || !sw.length || !t.zamkniecie) return null;
    const s = t.strona === 'long' ? 1 : -1, E = t.wejscie;
    let mfe = 0, mae = 0, po = 0, ile = 0;
    for (const x of sw) {
      const kon = x.t + msSwiecy;
      if (kon > t.otwarcie && x.t < t.zamkniecie) { ile++; mfe = Math.max(mfe, s > 0 ? (x.h - E) / E : (E - x.l) / E); mae = Math.max(mae, s > 0 ? (E - x.l) / E : (x.h - E) / E); }
      if (x.t >= t.zamkniecie && x.t < t.zamkniecie + 4 * GODZ && t.wyjscie) po = Math.max(po, s > 0 ? (x.h - t.wyjscie) / t.wyjscie : (t.wyjscie - x.l) / t.wyjscie);
    }
    return ile ? { mfe: mfe * 100, mae: mae * 100, poWyjsciu: po * 100, swiec: ile } : null;
  };

  // ------------------------------------------------------------------ kapitał konta Hyperliquid w chwili wejścia
  // = przelewy na konto (wpłaty z Phantoma przychodzą jako „send”) − przelewy z konta (z opłatą) + wyniki netto trade'ów
  // Hyperliquid zamkniętych przed wejściem. (Historia wartości konta z API jest za rzadka – punkt co kilka dni.)
  // Sprawdzone 15.11: zgodne z dziennikiem z Chrome (mediana 1,007) i z wartością konta w panelu (160,42 $).
  DZ.przelewyHL = function (ledger, adres) {
    const a = String(adres || '').toLowerCase(), w = [];
    for (const x of ledger || []) {
      const d = x.delta || {}, t = N(x.time);
      const kwota = fin(N(d.usdcValue)) ? N(d.usdcValue) : fin(N(d.usdc)) ? N(d.usdc) : fin(N(d.amount)) && d.token === 'USDC' ? N(d.amount) : NaN;
      if (!fin(kwota)) continue;
      if (d.type === 'deposit') w.push([t, kwota]);
      else if (d.type === 'withdraw') w.push([t, -(kwota + (N(d.fee) || 0))]);
      else if (d.type === 'send' || d.type === 'spotTransfer' || d.type === 'internalTransfer') {
        const doMnie = String(d.destination || '').toLowerCase() === a, odeMnie = String(d.user || '').toLowerCase() === a || !d.user;
        if (doMnie && !(odeMnie && d.user)) w.push([t, kwota]); else if (!doMnie) w.push([t, -(kwota + (N(d.fee) || 0))]);
      }
    }
    return w.sort((x, y) => x[0] - y[0]);
  };
  DZ.kapitalWChwili = function (przelewy, tradeHL, t) {
    if (!przelewy || !przelewy.length) return null;
    let v = 0;
    for (const [ts, d] of przelewy) if (ts <= t) v += d;
    for (const x of tradeHL || []) if (!x.otwarta && x.zamkniecie && x.zamkniecie <= t) v += x.netto;
    return v > 0 ? v : null;
  };

  // ------------------------------------------------------------------ Asystent w chwili wejścia (wymaga LAB.AS)
  // Dla każdego trade'u: ostatnia pełna świeca 1h przed wejściem, układ rynku z tej świecy i statystyka tego układu
  // policzona WYŁĄCZNIE z przypadków rozstrzygniętych do tej świecy – czyli to, co Asystent pokazałby wtedy.
  DZ.TABELA_L = [1, 3, 5, 10, 20, 25, 40];
  DZ.najblizszaDzwignia = (x) => DZ.TABELA_L.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), 10);
  DZ.asystentDlaTrade = function (lista, s, ms, oBaza) {
    const LAB = g.LAB, AS = LAB && LAB.AS; if (!AS) throw new Error('brak silnika Asystenta');
    const k = AS.cechy(s, ms), cechy = oBaza.cechy || AS.CECHY;
    const ep = AS.epizody(s, k, cechy, oBaza.H);
    const wgL = new Map(), wynik = {};
    for (const t of lista) {
      // ostatnia świeca zamknięta przed wejściem: t[j] + ms <= otwarcie
      let lo = 0, hi = s.n - 1, j = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (s.t[m] + ms <= t.otwarcie) { j = m; lo = m + 1; } else hi = m - 1; }
      if (j < AS.START || j >= s.n) { wynik[t.id] = null; continue; }
      const L = DZ.najblizszaDzwignia(t.dzwignia > 0 ? t.dzwignia : 10);
      if (!wgL.has(L)) wgL.set(L, AS.wynikiDzwignia(s, k, Object.assign({}, oBaza, { dzwignia: L })));
      const w = wgL.get(L), klucz = AS.klucz(k, j, cechy);
      const st = AS.statystyka(w, ep, j).mapa.get(klucz) || { nL: 0, sL: 0, s2L: 0, celL: 0, nS: 0, sS: 0, s2S: 0, celS: 0 };
      const dec = AS.decyzja(st, oBaza.minN);
      const strL = t.strona === 'long', n = strL ? st.nL : st.nS, cel = strL ? st.celL : st.celS;
      const P = strL ? AS.podsumuj(st.nL, st.sL, st.s2L) : AS.podsumuj(st.nS, st.sS, st.s2S);
      const c = k.c[j], e200 = k.e200[j], e50 = k.e50[j];
      wynik[t.id] = {
        L, swieca: s.t[j], decyzja: dec > 0 ? 'LONG' : dec < 0 ? 'SHORT' : 'CZEKAJ', zgodny: (dec > 0 && strL) || (dec < 0 && !strL),
        n, szansa: n ? Math.round(100 * cel / n) : null, srednia: fin(P.srednia) ? P.srednia : null, dolna: fin(P.dolna) ? P.dolna : null,
        uklad: cechy.map(f => AS.OPIS[f][k[f][j]]),
        kontekst: { cena: c, ema50: e50, ema200: e200, rsi: k.rsiWart[j], atr: k.atr[j], nadEma200: c > e200 }
      };
    }
    return wynik;
  };
  // powód i confidence „za Ciebie” z wyniku Asystenta
  DZ.powodZAsystenta = function (a, strona) {
    if (!a) return null;
    const pr = (x) => (fin(x) ? (x >= 0 ? '+' : '') + Math.round(x * 100) + '% depozytu' : '–');
    return `Asystent 1h (${a.L}×): ${a.decyzja}${a.zgodny ? ' – zgodnie z Twoim wejściem' : a.decyzja === 'CZEKAJ' ? ' – brak przewagi' : ' – przeciwnie do Twojego wejścia'}. `
      + `Układ: ${a.uklad.join(', ')}. ${strona === 'long' ? 'Long' : 'Short'} w takim układzie wcześniej: ${a.n} razy, cel przed stopem ${a.szansa === null ? '–' : a.szansa + '%'}, średnio ${pr(a.srednia)}.`
      + ` Cena ${a.kontekst.nadEma200 ? 'nad' : 'pod'} EMA200 1h, RSI ${fin(a.kontekst.rsi) ? Math.round(a.kontekst.rsi) : '–'}.`;
  };

  // ------------------------------------------------------------------ scalanie w jedną listę
  // zwraca trade'y (z eksportu + ręczne) z polami: wpis, auto, chrome, setup, sl/tp (wpis > auto), flagi, zasady
  DZ.zbuduj = function (E, C, W) {
    W = W || DZ.pusteWpisy();
    const wpisy = W.wpisy || {}, auto = W.auto || {};
    const lista = [];
    for (const t of (E && E.trade) || []) lista.push(Object.assign({}, t, { reczny: false }));
    for (const [id, w] of Object.entries(wpisy)) if (w && w.reczny && !w.usuniety) {
      const r = w.reczny;
      lista.push({ id, gielda: r.gielda || 'ręcznie', rynek: r.rynek || 'BTC', strona: r.strona, otwarcie: N(r.otwarcie), zamkniecie: N(r.zamkniecie) || null, otwarta: !r.zamkniecie,
        wejscie: N(r.wejscie), wyjscie: N(r.wyjscie) || null, ilosc: N(r.ilosc) || null, wartosc: N(r.wejscie) * N(r.ilosc) || null,
        pnl: N(r.netto) || 0, oplaty: N(r.oplaty) || 0, builder: 0, funding: 0, netto: N(r.netto) || 0, liczbaWypelnien: 0, likwidacja: false, udzialMaker: null, wypelnienia: [], reczny: true });
    }
    lista.sort((a, b) => a.otwarcie - b.otwarcie);
    // plany wpisane przed wejściem → trade z giełdy: ten sam rynek i kierunek, wejście od 30 min przed do 12 h po planie,
    // cena wejścia ≤ 0,5% od planu (jeśli podana); najbliższy w czasie
    const plany = Object.entries(wpisy).filter(([, w]) => w && w.plan && !w.usuniety).map(([id, w]) => Object.assign({ id, zmieniono: w.zmieniono }, w.plan)).sort((a, b) => a.czas - b.czas);
    const uzyte = new Set();
    for (const p of plany) {
      let best = null;
      for (const t of lista) {
        if (t.reczny || t.plan || t.rynek !== p.rynek || t.strona !== p.strona) continue;
        const dt = t.otwarcie - p.czas; if (dt < -30 * MIN || dt > 12 * GODZ) continue;
        if (fin(N(p.wejscie)) && Math.abs(t.wejscie - N(p.wejscie)) > 0.005 * N(p.wejscie)) continue;
        if (!best || Math.abs(dt) < Math.abs(best.otwarcie - p.czas)) best = t;
      }
      if (best) { best.plan = p; uzyte.add(p.id); }
    }
    lista.plany = plany.filter(p => !uzyte.has(p.id));
    const pusty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    for (const t of lista) {
      // wpis trade'u ma pierwszeństwo, puste pola uzupełnia plan
      const wl = wpisy[t.id] || {};
      if (t.plan) {
        const zPlanu = { setup: t.plan.setup, planWejscie: t.plan.wejscie, sl: t.plan.sl, tp: t.plan.tp, powod: t.plan.powod, confidence: t.plan.confidence, emocje: t.plan.emocje, notatka: t.plan.notatka };
        t.wpis = Object.assign({}, wl);
        for (const [k, v] of Object.entries(zPlanu)) if (pusty(t.wpis[k]) && !pusty(v)) t.wpis[k] = v;
      } else t.wpis = wl;
      t.auto = auto[t.id] || {};
      t.chrome = DZ.etykietaChrome(t, C);
      t.notatkaChrome = DZ.notatkaChrome(t, C);
      const sc = DZ.setupChrome(t, C);
      t.setupAuto = sc ? sc.id : null;
      t.setup = t.wpis.setup !== undefined && t.wpis.setup !== null ? t.wpis.setup : (t.notatkaChrome && /^#\d+/.test(t.notatkaChrome.setup || '') ? t.notatkaChrome.setup.match(/^#\d+/)[0] : t.setupAuto);
      t.setupDane = t.setup && C && C.setupy ? C.setupy.find(s => s.id === t.setup) || null : null;
      const z = t.auto.zlecenia || {};
      t.sl = fin(N(t.wpis.sl)) ? N(t.wpis.sl) : (fin(z.slPierwszy) ? z.slPierwszy : null);
      t.tp = fin(N(t.wpis.tp)) ? N(t.wpis.tp) : (fin(z.tpPierwszy) ? z.tpPierwszy : null);
      t.slZGieldy = !fin(N(t.wpis.sl)) && fin(z.slPierwszy);
      // dźwignia względem całego konta: największa pozycja trzymana naraz / kapitał przy wejściu (bez kapitału – z dziennika
      // Claude w Chrome). Suma dokupień (t.wartosc) zawyżałaby ją przy dokładaniu po częściowym zamknięciu.
      const wielk = fin(t.maxWielkosc) && t.maxWielkosc > 0 ? t.maxWielkosc : t.ilosc;
      t.wartoscMax = wielk && t.wejscie ? wielk * t.wejscie : t.wartosc;
      t.kapital = fin(t.auto.kapital) ? t.auto.kapital : null;
      t.dzwignia = t.kapital && t.wartoscMax ? t.wartoscMax / t.kapital : (t.chrome && fin(t.chrome.dzwignia) ? t.chrome.dzwignia : null);
      if (!t.kapital && t.dzwignia && t.wartoscMax) t.kapital = t.wartoscMax / t.dzwignia;
      t.ryzyko = t.sl && wielk ? Math.abs(t.wejscie - t.sl) * wielk : null;
      t.R = t.ryzyko > 0 && !t.otwarta ? t.netto / t.ryzyko : null;
      t.ryzykoProc = t.ryzyko && t.kapital ? 100 * t.ryzyko / t.kapital : null;
      t.czasMin = t.zamkniecie ? (t.zamkniecie - t.otwarcie) / MIN : null;
      const a = t.auto.asystent;
      t.trend = a && a.kontekst ? ((t.strona === 'long') === a.kontekst.nadEma200 ? 'z trendem' : 'pod prąd') : (t.chrome ? t.chrome.trend : null);
      t.makerWejscie = t.wypelnienia && t.wypelnienia.length ? t.wypelnienia[0].maker : null;
      t.powod = t.wpis.powod || '';
      t.confidence = fin(N(t.wpis.confidence)) ? N(t.wpis.confidence) : null;
      t.uzupelniony = !!(t.wpis.powod || t.wpis.notatka || (t.wpis.emocje && t.wpis.emocje.length) || t.wpis.ocena || fin(N(t.wpis.confidence)));
    }
    DZ.flagi(lista);
    for (const t of lista) t.zasady = DZ.sprawdzZasady(t);
    return lista;
  };

  // ------------------------------------------------------------------ „Wypełnij za mnie”: propozycja pól wpisu
  // Tylko z danych: giełda (SL/TP), setup z Chrome, notatki z Chrome, Asystent w chwili wejścia, flagi i zasady.
  // Emocji nie zgadujemy – to Twoja część.
  DZ.propozycja = function (t) {
    const a = t.auto.asystent, z = t.auto.zlecenia || {}, sd = t.setupDane, p = {};
    p.setup = t.setup || '';
    p.planWejscie = sd ? sd.wejscie : null;
    p.sl = fin(z.slPierwszy) ? z.slPierwszy : (sd ? sd.sl : null);
    p.tp = fin(z.tpPierwszy) ? z.tpPierwszy : (sd ? sd.tp : null);
    const cz = [];
    if (sd) cz.push(`Setup ${sd.id} z analizy Claude (${sd.typ}): plan ${sd.wejscie} / SL ${sd.sl} / TP ${sd.tp}${sd.uwagi ? ' – ' + sd.uwagi : ''}.`);
    if (t.chrome && t.chrome.notatka) cz.push(t.chrome.notatka + '.');
    if (t.notatkaChrome) cz.push(t.notatkaChrome.notatka);
    const pa = DZ.powodZAsystenta(a, t.strona); if (pa) cz.push(pa);
    p.powod = cz.join(' ');
    p.confidence = a && a.szansa !== null && a.szansa !== undefined ? a.szansa : null;
    p.etykieta = t.chrome && t.chrome.etykieta ? t.chrome.etykieta : sd ? 'z analizy' : t.poDuzymZysku ? 'seria po dużym zysku' : t.poStracie ? 'prawdopodobny revenge' : 'bez analizy';
    const b = [];
    if (!p.sl && !t.sl) b.push('bez SL');
    if (t.dzwignia > 15 || (t.ryzykoProc && t.ryzykoProc > 2.5)) b.push('za duża pozycja');
    if (!sd) b.push('wejście bez sygnału');
    if (t.strona === 'long' && t.trend === 'pod prąd' && !sd) b.push('pod prąd');
    if (t.poStracie || t.zmianaKierunku) b.push('revenge');
    if (t.nrWDniu > 2) b.push('za dużo trade\'ów');
    if (z.zmianyTp >= 2) b.push('przesuwanie TP');
    if (t.zasady && t.zasady[8] && t.zasady[8].ok === false) b.push('za wczesne wyjście');
    p.bledy = b;
    const zl = t.zasady ? Object.values(t.zasady).filter(x => x.ok === false).length : 0;
    p.ocena = zl === 0 ? 'A' : zl === 1 ? 'B' : zl <= 3 ? 'C' : 'D';
    p.notatka = t.notatkaChrome && t.notatkaChrome.lekcje && t.notatkaChrome.lekcje.length ? 'Lekcje z dziennika Claude: ' + t.notatkaChrome.lekcje.join(' ') : '';
    return p;
  };
  // dopisuje propozycję tylko do pustych pól (z odswiez: także do pól wypełnionych wcześniej automatycznie, których
  // nie poprawiałeś); zwraca nowy wpis i listę wypełnionych pól
  DZ.wypelnij = function (wpis, prop, odswiez) {
    const w = Object.assign({}, wpis || {}), pola = [];
    const pusty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    const auto = new Set(w.autoPola || []);
    for (const [k, v] of Object.entries(prop)) {
      if (pusty(v)) continue;
      if (pusty(w[k]) || (odswiez && auto.has(k) && JSON.stringify(w[k]) !== JSON.stringify(v))) { w[k] = v; pola.push(k); }
    }
    if (pola.length) w.autoPola = [...new Set([...(w.autoPola || []), ...pola])];
    return { wpis: w, pola };
  };

  // ------------------------------------------------------------------ flagi z kolejności trade'ów
  DZ.flagi = function (lista) {
    const zam = lista.filter(t => !t.otwarta);
    const abs = zam.map(t => Math.abs(t.netto)).sort((a, b) => a - b);
    const med = abs.length ? abs[Math.floor(abs.length / 2)] : 0;
    DZ.progDuzegoZysku = Math.max(3, 2 * med);
    const wgDnia = new Map();
    for (const t of lista) {
      const d = DZ.dzien(t.otwarcie); if (!wgDnia.has(d)) wgDnia.set(d, []); wgDnia.get(d).push(t);
      t.dzienPL = d;
      // poprzednie trade'y zamknięte przed tym wejściem
      const wczesniej = zam.filter(p => p !== t && p.zamkniecie && p.zamkniecie <= t.otwarcie);
      const ost = wczesniej.length ? wczesniej.reduce((a, b) => (b.zamkniecie > a.zamkniecie ? b : a)) : null;
      t.przerwaMin = ost ? (t.otwarcie - ost.zamkniecie) / MIN : null;
      const strataPrzed = wczesniej.filter(p => p.netto < DZ.STRATA && t.otwarcie - p.zamkniecie <= DZ.REVENGE_MS);
      t.poStracie = strataPrzed.length > 0;
      t.zmianaKierunku = !!(ost && ost.strona !== t.strona && t.otwarcie - ost.zamkniecie <= DZ.ZMIANA_MS);
      t.poDuzymZysku = wczesniej.some(p => p.netto >= DZ.progDuzegoZysku && t.otwarcie - p.zamkniecie <= DZ.PO_ZYSKU_MS);
      t.poStracieDnia = wczesniej.some(p => DZ.dzien(p.otwarcie) === d && p.netto < DZ.STRATA);
    }
    for (const [, l] of wgDnia) l.forEach((t, i) => { t.nrWDniu = i + 1; t.tradeWDniu = l.length; });
    return lista;
  };

  // ------------------------------------------------------------------ zasady metody v3 (dziennik z Chrome, 1.11.2026)
  // ok: true/false, albo null = nie da się sprawdzić (brak danych)
  DZ.ZASADY = [
    { kod: 1, krotko: 'Setup z sygnałem + SL od razu' },
    { kod: 2, krotko: 'Ryzyko ~1–2% konta' },
    { kod: 3, krotko: 'Wejście jako maker (Limit ALO)' },
    { kod: 4, krotko: 'Bez longów pod EMA200 (wyjątek: setup)' },
    { kod: 5, krotko: 'Po stracie przerwa, bez zmiany kierunku ≤ 1 h' },
    { kod: 6, krotko: 'Po dużym zysku 4 h przerwy' },
    { kod: 7, krotko: 'Maks. 2 trade\'y dziennie' },
    { kod: 8, krotko: 'Trzymasz do TP, SL na BE po +1R' },
    { kod: 9, krotko: 'Etykieta: setup albo „bez analizy”' }
  ];
  DZ.sprawdzZasady = function (t) {
    const z = {};
    const maSl = !!t.sl;
    z[1] = !t.setup ? { ok: false, opis: 'bez setupu z dziennika' } : maSl ? { ok: true, opis: 'setup ' + t.setup + ', SL ' + Math.round(t.sl) } : { ok: false, opis: 'setup ' + t.setup + ', ale bez znanego SL' };
    z[2] = t.ryzykoProc !== null ? (t.ryzykoProc <= 2.5 ? { ok: true, opis: 'ryzyko ' + t.ryzykoProc.toFixed(1) + '% konta' } : { ok: false, opis: 'ryzyko ' + t.ryzykoProc.toFixed(1) + '% konta' })
      : t.dzwignia ? (t.dzwignia > 15 ? { ok: false, opis: 'bez SL przy dźwigni ~' + Math.round(t.dzwignia) + '× konta' } : { ok: null, opis: 'brak SL – nie da się policzyć ryzyka' }) : { ok: null, opis: 'brak danych' };
    z[3] = t.makerWejscie === null ? { ok: null, opis: 'brak danych' } : t.makerWejscie ? { ok: true, opis: 'pierwsze wypełnienie jako maker' } : { ok: false, opis: 'wejście jako taker' };
    z[4] = t.strona !== 'long' ? { ok: true, opis: 'short' } : t.trend === null ? { ok: null, opis: 'brak danych o trendzie' } : t.trend === 'z trendem' ? { ok: true, opis: 'long nad EMA200' } : t.setup ? { ok: true, opis: 'long pod EMA200, ale z setupu ' + t.setup } : { ok: false, opis: 'long pod EMA200 bez setupu' };
    z[5] = t.zmianaKierunku ? { ok: false, opis: 'zmiana kierunku ' + Math.round(t.przerwaMin) + ' min po zamknięciu' } : t.poStracie ? { ok: false, opis: 'wejście ≤ 2 h po stracie' } : t.poStracieDnia ? { ok: false, opis: 'kolejny trade po stracie tego dnia' } : { ok: true, opis: 'bez straty tuż przed' };
    z[6] = t.poDuzymZysku ? { ok: false, opis: 'wejście ≤ 4 h po dużym zysku' } : { ok: true, opis: 'ok' };
    z[7] = t.nrWDniu > 2 ? { ok: false, opis: t.nrWDniu + '. trade tego dnia' } : { ok: true, opis: t.nrWDniu + '. trade tego dnia' };
    if (t.otwarta) z[8] = { ok: null, opis: 'trade otwarty' };
    else if (t.tp && t.wyjscie) {
      const doszedl = t.strona === 'long' ? t.wyjscie >= t.tp * 0.999 : t.wyjscie <= t.tp * 1.001;
      z[8] = doszedl ? { ok: true, opis: 'wyjście na TP' } : t.netto > 0 ? { ok: false, opis: 'wyjście z zyskiem przed TP' } : { ok: null, opis: 'wyjście przed TP ze stratą' };
    } else z[8] = { ok: null, opis: 'brak TP' };
    z[9] = t.setup || (t.chrome && t.chrome.etykieta) || t.wpis.etykieta || (t.wpis.bledy && t.wpis.bledy.length) ? { ok: true, opis: t.setup ? 'setup ' + t.setup : (t.wpis.etykieta || (t.chrome && t.chrome.etykieta) || 'opisany') } : { ok: false, opis: 'bez etykiety' };
    return z;
  };

  // ------------------------------------------------------------------ statystyka grupy i wnioski
  DZ.grupa = function (l) {
    const z = l.filter(t => !t.otwarta);
    const w = z.filter(t => t.netto > 0), p = z.filter(t => t.netto <= 0);
    const s = (a, f) => a.reduce((x, t) => x + (t[f] || 0), 0);
    const sW = s(w, 'netto'), sP = s(p, 'netto');
    const avgW = w.length ? sW / w.length : null, avgP = p.length ? -sP / p.length : null;
    return { n: z.length, wygrane: w.length, skut: z.length ? w.length / z.length : null, netto: s(z, 'netto'), brutto: s(z, 'pnl'), oplaty: s(z, 'oplaty'), funding: s(z, 'funding'),
      srW: avgW, srP: avgP, pf: sP < 0 ? sW / -sP : null, srednio: z.length ? s(z, 'netto') / z.length : null,
      prog: avgW && avgP ? 1 / (1 + avgW / avgP) : null };
  };
  const NF2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd = (x) => (fin(x) ? (x >= 0 ? '+' : '−') + NF2.format(Math.abs(x)) + ' $' : '–');
  const proc = (x) => (fin(x) ? Math.round(x * 100) + '%' : '–');
  // „kiedy wchodzić”: zasady 4–7 (longi pod EMA200, po stracie, po dużym zysku, maks. 2 dziennie) – da się ich trzymać
  // niezależnie od SL i wielkości pozycji; to ten sam rachunek „co gdyby” co w dzienniku z Chrome
  DZ.ZASADY_KIEDY = [4, 5, 6, 7];
  DZ.zgodneKiedy = (t) => DZ.ZASADY_KIEDY.every(k => !t.zasady[k] || t.zasady[k].ok !== false);
  function porownanie(tytul, A, nA, B, nB, tekstFn, id) {
    const a = DZ.grupa(A), b = DZ.grupa(B);
    if (a.n < 3 || b.n < 3) return null;
    return { id, tytul, a: Object.assign(a, { nazwa: nA }), b: Object.assign(b, { nazwa: nB }), tekst: tekstFn(a, b), waga: Math.abs((a.srednio || 0) - (b.srednio || 0)) * Math.min(a.n, b.n), malaProba: Math.min(a.n, b.n) < 10 };
  }
  DZ.wnioski = function (lista) {
    const z = lista.filter(t => !t.otwarta);
    const ogol = DZ.grupa(z), out = [];
    const opis2 = (a, b, co) => `${a.nazwa}: ${a.n} trade'ów, ${proc(a.skut)} na plus, razem ${usd(a.netto)} (średnio ${usd(a.srednio)}). ${b.nazwa}: ${b.n}, ${proc(b.skut)} na plus, razem ${usd(b.netto)} (średnio ${usd(b.srednio)}).${co ? ' ' + co : ''}`;
    const dodaj = (x) => { if (x) out.push(x); };
    dodaj(porownanie('Long czy short', z.filter(t => t.strona === 'long'), 'Long', z.filter(t => t.strona === 'short'), 'Short', (a, b) => opis2(a, b), 'kierunek'));
    dodaj(porownanie('Z trendem czy pod prąd (EMA200 1h)', z.filter(t => t.trend === 'z trendem'), 'Z trendem', z.filter(t => t.trend === 'pod prąd'), 'Pod prąd', (a, b) => opis2(a, b), 'trend'));
    dodaj(porownanie('Longi pod EMA200', z.filter(t => t.strona === 'long' && t.trend === 'pod prąd'), 'Longi pod EMA200', z.filter(t => !(t.strona === 'long' && t.trend === 'pod prąd')), 'Reszta', (a, b) => opis2(a, b, 'Zasada 4 mówi: nie otwieraj longów pod EMA200 bez setupu.'), 'longiPod'));
    dodaj(porownanie('Z setupem z analizy czy bez', z.filter(t => t.setup), 'Z setupem', z.filter(t => !t.setup), 'Bez setupu', (a, b) => opis2(a, b), 'setup'));
    dodaj(porownanie('Wejście ≤ 2 h po stracie (prawdopodobny revenge)', z.filter(t => t.poStracie), 'Po stracie', z.filter(t => !t.poStracie), 'Reszta', (a, b) => opis2(a, b), 'revenge'));
    dodaj(porownanie('Zmiana kierunku ≤ 60 min po zamknięciu', z.filter(t => t.zmianaKierunku), 'Ze zmianą kierunku', z.filter(t => !t.zmianaKierunku), 'Reszta', (a, b) => opis2(a, b), 'zmiana'));
    dodaj(porownanie('Po dużym zysku (≤ 4 h)', z.filter(t => t.poDuzymZysku), 'Po dużym zysku', z.filter(t => !t.poDuzymZysku), 'Reszta', (a, b) => opis2(a, b, `Duży zysk = ≥ ${DZ.progDuzegoZysku.toFixed(2)} USD (2 × mediana).`), 'poZysku'));
    dodaj(porownanie('1. i 2. trade dnia czy kolejne', z.filter(t => t.nrWDniu <= 2), '1.–2. trade dnia', z.filter(t => t.nrWDniu > 2), '3. i dalsze', (a, b) => opis2(a, b), 'ileDziennie'));
    dodaj(porownanie('Pora wejścia: Europa (7–13 UTC) czy USA (13–20 UTC)', z.filter(t => { const h = new Date(t.otwarcie).getUTCHours(); return h >= 7 && h < 13; }), 'Europa', z.filter(t => { const h = new Date(t.otwarcie).getUTCHours(); return h >= 13 && h < 20; }), 'USA', (a, b) => opis2(a, b), 'sesja'));
    dodaj(porownanie('Czas trzymania < 30 min czy dłużej', z.filter(t => t.czasMin < 30), 'Krócej niż 30 min', z.filter(t => t.czasMin >= 30), '30 min i dłużej', (a, b) => opis2(a, b), 'czas'));
    dodaj(porownanie('Wejście jako maker czy taker', z.filter(t => t.makerWejscie === true), 'Maker (Limit ALO)', z.filter(t => t.makerWejscie === false), 'Taker', (a, b) => opis2(a, b), 'maker'));
    dodaj(porownanie('Ze stop lossem czy bez', z.filter(t => t.sl), 'Z SL', z.filter(t => !t.sl), 'Bez SL', (a, b) => opis2(a, b), 'sl'));
    dodaj(porownanie('Dźwignia do 10× czy wyższa (względem konta)', z.filter(t => t.dzwignia && t.dzwignia <= 10), 'Do 10×', z.filter(t => t.dzwignia && t.dzwignia > 10), 'Powyżej 10×', (a, b) => opis2(a, b), 'dzwignia'));
    dodaj(porownanie('Zgodnie z Asystentem czy wbrew', z.filter(t => t.auto.asystent && t.auto.asystent.zgodny), 'Asystent w tę samą stronę', z.filter(t => t.auto.asystent && !t.auto.asystent.zgodny), 'Asystent CZEKAJ albo przeciw', (a, b) => opis2(a, b), 'asystent'));
    const zConf = z.filter(t => t.confidence !== null);
    if (zConf.length >= 6) dodaj(porownanie('Twoje confidence: wysokie czy niskie', zConf.filter(t => t.confidence >= 60), 'Confidence ≥ 60', zConf.filter(t => t.confidence < 60), 'Confidence < 60', (a, b) => opis2(a, b, a.skut > b.skut ? 'Twoja pewność coś mówi.' : 'Twoja pewność na razie nie przekłada się na wynik.'), 'confidence'));
    for (const em of DZ.EMOCJE) { const zE = z.filter(t => (t.wpis.emocje || []).includes(em)); if (zE.length >= 3) dodaj(porownanie('Emocja: ' + em, zE, 'Z emocją „' + em + '”', z.filter(t => !(t.wpis.emocje || []).includes(em) && (t.wpis.emocje || []).length), 'Inne emocje', (a, b) => opis2(a, b), 'em-' + em)); }
    out.sort((a, b) => b.waga - a.waga);
    // koszt łamania zasad
    const zasady = DZ.ZASADY.map(r => {
      const zl = z.filter(t => t.zasady[r.kod] && t.zasady[r.kod].ok === false), ok = z.filter(t => t.zasady[r.kod] && t.zasady[r.kod].ok === true);
      return { kod: r.kod, krotko: r.krotko, zlamana: DZ.grupa(zl), dotrzymana: DZ.grupa(ok), bezDanych: z.length - zl.length - ok.length };
    });
    const czyste = z.filter(t => DZ.ZASADY.every(r => !t.zasady[r.kod] || t.zasady[r.kod].ok !== false));
    // wyjścia: zostawione na stole i straty, które były na plusie
    const zMfe = z.filter(t => t.auto.ruch);
    const wyjscia = zMfe.length >= 5 ? {
      n: zMfe.length,
      poWyjsciuZyski: (() => { const w = zMfe.filter(t => t.netto > 0); return w.length ? w.reduce((s, t) => s + t.auto.ruch.poWyjsciu, 0) / w.length : null; })(),
      wygrane: zMfe.filter(t => t.netto > 0).length,
      stratyBylyNaPlusie: zMfe.filter(t => t.netto <= 0 && t.auto.ruch.mfe >= 0.3).length, straty: zMfe.filter(t => t.netto <= 0).length
    } : null;
    const oplatyUdzial = ogol.netto < 0 && ogol.oplaty > 0 ? ogol.oplaty / -Math.min(-1e-9, ogol.netto - 0) : null;
    return { ogol, porownania: out, zasady, czyste: DZ.grupa(czyste), kiedy: DZ.grupa(z.filter(DZ.zgodneKiedy)), wyjscia, oplatyUdzial };
  };

  // ------------------------------------------------------------------ podsumowanie jednego dnia (karta „Dzień”)
  DZ.podsumowanieDnia = function (tt) {
    const z = tt.filter(t => !t.otwarta);
    return { n: tt.length, zamkniete: z.length, netto: z.reduce((s, t) => s + t.netto, 0), wygrane: z.filter(t => t.netto > 0).length,
      oplaty: z.reduce((s, t) => s + t.oplaty, 0), zlamane: tt.filter(t => t.zasady && Object.values(t.zasady).some(x => x.ok === false)).length };
  };

  // ------------------------------------------------------------------ do Asystenta: dziś i ostatnie trade'y (dyscyplina na żywo)
  DZ.dzis = function (lista, teraz) {
    teraz = teraz || Date.now();
    const d = DZ.dzien(teraz), dzis = lista.filter(t => t.dzienPL === d);
    const zam = lista.filter(t => !t.otwarta && t.zamkniecie).sort((a, b) => b.zamkniecie - a.zamkniecie);
    const ost = zam[0] || null;
    const ostStrata = zam.find(t => t.netto < DZ.STRATA) || null;
    const ostDuzy = zam.find(t => t.netto >= DZ.progDuzegoZysku) || null;
    const przerwy = [];
    if (ostStrata && teraz - ostStrata.zamkniecie < 4 * GODZ) przerwy.push({ zasada: 5, do: ostStrata.zamkniecie + 4 * GODZ, powod: 'strata ' + usd(ostStrata.netto) });
    if (ostDuzy && teraz - ostDuzy.zamkniecie < DZ.PO_ZYSKU_MS) przerwy.push({ zasada: 6, do: ostDuzy.zamkniecie + DZ.PO_ZYSKU_MS, powod: 'duży zysk ' + usd(ostDuzy.netto) });
    return { trade: dzis.length, limit: 2, netto: dzis.filter(t => !t.otwarta).reduce((s, t) => s + t.netto, 0), ostatni: ost, przerwy, otwarte: lista.filter(t => t.otwarta) };
  };

  g.DZ = DZ;
})(typeof self !== 'undefined' ? self : this);
