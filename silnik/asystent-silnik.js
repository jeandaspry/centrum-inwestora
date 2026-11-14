/* Asystent – statystyka układów rynku (bez DOM; działa w oknie i w Web Workerze; wymaga lab.js).
 *
 * Definicje (te same w narzedzia/sprawdz-asystenta.ps1):
 *  - cechy świecy i liczone tylko z danych do jej zamknięcia (ceny zwykłe, nie log):
 *      trend:      2 gdy C > EMA50 > EMA200, 0 gdy C < EMA50 < EMA200, inaczej 1
 *      rsi:        RSI14 (Wilder): <30 → 0, <45 → 1, <55 → 2, <70 → 3, inaczej 4
 *      zmiennosc:  (ATR14/C) / średnia z 100 świec tej wartości: <0,8 → 0, >1,25 → 2, inaczej 1
 *      zakres:     położenie C w zakresie low–high ostatnich 20 świec: <0,2 → 0, >0,8 → 2, inaczej 1
 *      funding:    suma stawek z ostatnich 24 h: <0 → 0, >0,06% → 2, inaczej 1 (równo na progu = 1, margines 1e-12)
 *  - wynik transakcji z wejściem na zamknięciu świecy j (C), ryzyko R = m·ATR:
 *      long:  stop C − m·ATR, cel C + k·ATR; w świecach j+1…j+H pierwsze trafienie (stop sprawdzany najpierw).
 *             Bez trafienia: wynik = (C[j+H] − C)/R. Wynik w R minus opłaty 2·koszt·C/R i funding ΣF·C/R.
 *      short: lustrzanie (funding: short dostaje ΣF·C/R).
 *  - epizod: świeca j liczy się do statystyki układu tylko, gdy poprzednia policzona świeca tego samego
 *    układu była co najmniej H świec wcześniej (inaczej te same ruchy liczyłyby się wiele razy).
 *  - decyzja: kierunek, którego średni wynik ma dolną granicę 95% przedziału > 0 przy n ≥ minN; inaczej CZEKAJ.
 *
 *  Wersja z dźwignią (o.dzwignia = L, AS.wynikiDzwignia) – wynik w ułamku depozytu (ROE, −1 = −100%):
 *      likwidacja przy niekorzystnym ruchu ceny o dLik = 1/L − mm (mm = 1,25% – BTC na HL, maks. 40×),
 *      stop m·ATR (m = 0 → bez stopu), cel k·ATR; w świecy najpierw sprawdzamy stratę (likwidację albo stop,
 *      zależnie od tego, co bliżej), potem cel. Likwidacja = −100%. Stop = −L·odl. stopu, cel = +L·odl. celu,
 *      koniec czasu = L·ruch do zamknięcia świecy j+H; od stopu/celu/czasu odejmujemy opłaty 2·koszt·L
 *      i funding L·ΣF (long płaci, short dostaje). Wynik nie spada poniżej −100%.
 */
(function (g) {
  'use strict';
  const LAB = g.LAB, AS = {};
  AS.CECHY = ['trend', 'rsi', 'zmiennosc', 'zakres', 'funding'];
  AS.MNOZNIK = { trend: 1, rsi: 3, zmiennosc: 15, zakres: 45, funding: 135 };
  AS.START = 300;
  AS.OPIS = {
    trend: ['spadkowy (cena < EMA50 < EMA200)', 'mieszany', 'wzrostowy (cena > EMA50 > EMA200)'],
    rsi: ['RSI < 30 (wyprzedanie)', 'RSI 30–45', 'RSI 45–55', 'RSI 55–70', 'RSI > 70 (wykupienie)'],
    zmiennosc: ['niska zmienność', 'zwykła zmienność', 'wysoka zmienność'],
    zakres: ['przy dołku 20 świec', 'w środku zakresu 20 świec', 'przy szczycie 20 świec'],
    funding: ['funding ujemny (shorty płacą)', 'funding zwykły', 'funding wysoki (longi przepłacają)']
  };

  function emaCen(c, dl) {
    const o = new Float64Array(c.length), a = 2 / (dl + 1); o[0] = c[0];
    for (let i = 1; i < c.length; i++) o[i] = o[i - 1] + a * (c[i] - o[i - 1]);
    return o;
  }

  /* Cechy i ATR dla każdej świecy. ms = długość świecy w ms (do okna fundingu 24 h). */
  AS.cechy = function (s, ms) {
    const n = s.n, c = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n);
    for (let i = 0; i < n; i++) { c[i] = Math.exp(s.lc[i]); h[i] = Math.exp(s.lh[i]); l[i] = Math.exp(s.ll[i]); }
    const e50 = emaCen(c, 50), e200 = emaCen(c, 200);
    const rsi = new Float64Array(n).fill(NaN), atr = new Float64Array(n).fill(NaN);
    let ag = 0, al = 0, at = 0;
    for (let i = 1; i < n; i++) {
      const d = c[i] - c[i - 1], zy = d > 0 ? d : 0, st = d < 0 ? -d : 0;
      const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      if (i <= 14) { ag += zy / 14; al += st / 14; at += tr / 14; }
      else { ag = (ag * 13 + zy) / 14; al = (al * 13 + st) / 14; at = (at * 13 + tr) / 14; }
      if (i >= 14) { rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); atr[i] = at; }
    }
    const k = { trend: new Int8Array(n), rsi: new Int8Array(n), zmiennosc: new Int8Array(n), zakres: new Int8Array(n), funding: new Int8Array(n),
      atr, c, h, l, zmiennoscWart: new Float64Array(n).fill(NaN), funding24: new Float64Array(n), rsiWart: rsi, e50, e200 };
    const naDzien = Math.max(1, Math.round(86400000 / ms));
    const atrProc = new Float64Array(n);
    for (let i = 0; i < n; i++) atrProc[i] = atr[i] / c[i];
    for (let i = 0; i < n; i++) {
      // sumy okien liczone wprost (bez sumy kroczącej), żeby wynik nie zależał od kolejności dodawania
      let sumaF = 0;
      if (s.F) for (let j = Math.max(0, i - naDzien + 1); j <= i; j++) sumaF += s.F[j];
      k.funding24[i] = sumaF;
      k.trend[i] = c[i] > e50[i] && e50[i] > e200[i] ? 2 : (c[i] < e50[i] && e50[i] < e200[i] ? 0 : 1);
      const r = rsi[i];
      k.rsi[i] = r < 30 ? 0 : r < 45 ? 1 : r < 55 ? 2 : r < 70 ? 3 : 4;
      if (i >= 113) {
        let sumaAtr = 0; for (let j = i - 99; j <= i; j++) sumaAtr += atrProc[j];
        const ratio = atrProc[i] / (sumaAtr / 100);
        k.zmiennoscWart[i] = ratio;
        k.zmiennosc[i] = ratio < 0.8 ? 0 : ratio > 1.25 ? 2 : 1;
      } else k.zmiennosc[i] = 1;
      let mx = -Infinity, mn = Infinity;
      for (let j = Math.max(0, i - 19); j <= i; j++) { if (h[j] > mx) mx = h[j]; if (l[j] < mn) mn = l[j]; }
      const poz = mx > mn ? (c[i] - mn) / (mx - mn) : 0.5;
      k.zakres[i] = poz < 0.2 ? 0 : poz > 0.8 ? 2 : 1;
      // stawki są okrągłe (np. 3 × 0,02% = równo 0,06%) – wartość równa progowi to „zwykły”, z marginesem na błąd zaokrągleń
      k.funding[i] = sumaF < -1e-12 ? 0 : sumaF > 0.0006 + 1e-12 ? 2 : 1;
    }
    return k;
  };

  AS.klucz = function (k, i, cechy) { let x = 0; for (const f of cechy) x += k[f][i] * AS.MNOZNIK[f]; return x; };

  /* Wyniki transakcji long/short z wejściem na zamknięciu każdej świecy. NaN = nierozstrzygnięte (koniec danych). */
  AS.wyniki = function (s, k, o) {
    const n = s.n, rL = new Float64Array(n).fill(NaN), rS = new Float64Array(n).fill(NaN);
    const kL = new Int32Array(n).fill(-1), kS = new Int32Array(n).fill(-1);
    const tL = new Int8Array(n), tS = new Int8Array(n);       // 1 cel, -1 stop, 0 koniec czasu
    const preF = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) preF[i + 1] = preF[i] + (s.F ? s.F[i] : 0);
    for (let j = AS.START; j < n - 1; j++) {
      const C = k.c[j], A = k.atr[j], R = o.m * A;
      if (!(A > 0)) continue;
      const oplata = 2 * o.koszt * C / R;
      // long
      let wynik = NaN, kon = -1, typ = 0;
      for (let i = j + 1; i <= j + o.H && i < n; i++) {
        if (k.l[i] <= C - o.m * A) { wynik = -1; kon = i; typ = -1; break; }
        if (k.h[i] >= C + o.k * A) { wynik = o.k / o.m; kon = i; typ = 1; break; }
      }
      if (kon < 0 && j + o.H < n) { kon = j + o.H; wynik = (k.c[kon] - C) / R; }
      if (kon >= 0) { rL[j] = wynik - oplata - (preF[kon + 1] - preF[j + 1]) * C / R; kL[j] = kon; tL[j] = typ; }
      // short
      wynik = NaN; kon = -1; typ = 0;
      for (let i = j + 1; i <= j + o.H && i < n; i++) {
        if (k.h[i] >= C + o.m * A) { wynik = -1; kon = i; typ = -1; break; }
        if (k.l[i] <= C - o.k * A) { wynik = o.k / o.m; kon = i; typ = 1; break; }
      }
      if (kon < 0 && j + o.H < n) { kon = j + o.H; wynik = (C - k.c[kon]) / R; }
      if (kon >= 0) { rS[j] = wynik - oplata + (preF[kon + 1] - preF[j + 1]) * C / R; kS[j] = kon; tS[j] = typ; }
    }
    return { rL, rS, kL, kS, tL, tS };
  };

  AS.MM = 0.0125;
  /* Wyniki z dźwignią: tL/tS = 1 cel, −1 stop, −2 likwidacja, 0 koniec czasu; rL/rS w ułamku depozytu. */
  AS.wynikiDzwignia = function (s, k, o) {
    const n = s.n, L = o.dzwignia, mm = o.mm === undefined ? AS.MM : o.mm, dLik = 1 / L - mm;
    const rL = new Float64Array(n).fill(NaN), rS = new Float64Array(n).fill(NaN);
    const kL = new Int32Array(n).fill(-1), kS = new Int32Array(n).fill(-1);
    const tL = new Int8Array(n), tS = new Int8Array(n);
    const preF = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) preF[i + 1] = preF[i] + (s.F ? s.F[i] : 0);
    const oplata = 2 * o.koszt * L;
    for (let j = AS.START; j < n - 1; j++) {
      const C = k.c[j], A = k.atr[j];
      if (!(A > 0)) continue;
      const dSl = o.m > 0 ? o.m * A / C : Infinity, dTp = o.k * A / C;
      const lik = dLik <= dSl, dStrata = lik ? dLik : dSl;
      for (let strona = 1; strona >= -1; strona -= 2) {
        let wynik = NaN, kon = -1, typ = 0;
        for (let i = j + 1; i <= j + o.H && i < n; i++) {
          const niekorz = strona > 0 ? (C - k.l[i]) / C : (k.h[i] - C) / C;
          const korz = strona > 0 ? (k.h[i] - C) / C : (C - k.l[i]) / C;
          if (niekorz >= dStrata) { kon = i; typ = lik ? -2 : -1; wynik = lik ? -1 : -L * dSl - oplata; break; }
          if (korz >= dTp) { kon = i; typ = 1; wynik = L * dTp - oplata; break; }
        }
        if (kon < 0 && j + o.H < n) { kon = j + o.H; wynik = L * strona * (k.c[kon] - C) / C - oplata; }
        if (kon < 0) continue;
        if (typ !== -2) wynik -= strona * L * (preF[kon + 1] - preF[j + 1]);
        if (wynik < -1) wynik = -1;
        if (strona > 0) { rL[j] = wynik; kL[j] = kon; tL[j] = typ; } else { rS[j] = wynik; kS[j] = kon; tS[j] = typ; }
      }
    }
    return { rL, rS, kL, kS, tL, tS };
  };

  /* Znacznik epizodu: pierwsza świeca układu albo co najmniej H świec po poprzedniej policzonej. */
  AS.epizody = function (s, k, cechy, H) {
    const n = s.n, flaga = new Uint8Array(n), klucze = new Int32Array(n), ost = new Map();
    for (let j = AS.START; j < n; j++) {
      const x = AS.klucz(k, j, cechy); klucze[j] = x;
      const p = ost.get(x);
      if (p === undefined || j - p >= H) { flaga[j] = 1; ost.set(x, j); }
    }
    return { flaga, klucze };
  };

  function nowaStat() { return { nL: 0, sL: 0, s2L: 0, celL: 0, stopL: 0, likL: 0, nS: 0, sS: 0, s2S: 0, celS: 0, stopS: 0, likS: 0 }; }
  function dodaj(st, w, j, strona) {
    if (strona === 'L') { const r = w.rL[j], t = w.tL[j]; st.nL++; st.sL += r; st.s2L += r * r; if (t === 1) st.celL++; else if (t === -1) st.stopL++; else if (t === -2) st.likL++; }
    else { const r = w.rS[j], t = w.tS[j]; st.nS++; st.sS += r; st.s2S += r * r; if (t === 1) st.celS++; else if (t === -1) st.stopS++; else if (t === -2) st.likS++; }
  }
  // średnia, błąd standardowy, dolna granica 95%
  AS.podsumuj = function (n, s, s2) {
    if (n < 2) return { n, srednia: n ? s / n : NaN, se: NaN, dolna: NaN };
    const m = s / n, war = Math.max(0, (s2 - n * m * m) / (n - 1)), se = Math.sqrt(war / n);
    return { n, srednia: m, se, dolna: m - 1.96 * se };
  };
  AS.decyzja = function (st, minN) {
    const L = AS.podsumuj(st.nL, st.sL, st.s2L), S = AS.podsumuj(st.nS, st.sS, st.s2S);
    const okL = st.nL >= minN && L.dolna > 0, okS = st.nS >= minN && S.dolna > 0;
    if (okL && (!okS || L.dolna >= S.dolna)) return 1;
    if (okS) return -1;
    return 0;
  };

  /* Statystyka wszystkich epizodów, których wynik był znany do świecy `doIndeksu` włącznie. */
  AS.statystyka = function (w, ep, doIndeksu) {
    const mapa = new Map(), baza = nowaStat();
    for (let j = AS.START; j <= doIndeksu; j++) {
      if (!ep.flaga[j]) continue;
      let st = mapa.get(ep.klucze[j]); if (!st) { st = nowaStat(); mapa.set(ep.klucze[j], st); }
      if (w.kL[j] >= 0 && w.kL[j] <= doIndeksu) { dodaj(st, w, j, 'L'); dodaj(baza, w, j, 'L'); }
      if (w.kS[j] >= 0 && w.kS[j] <= doIndeksu) { dodaj(st, w, j, 'S'); dodaj(baza, w, j, 'S'); }
    }
    return { mapa, baza };
  };

  /* Walk-forward: od świecy `start` na każdym zamknięciu decyzja tylko z wyników znanych do tej chwili.
   * Transakcje się nie nakładają: nowa dopiero po zamknięciu poprzedniej. */
  AS.walkForward = function (s, k, w, ep, o, start) {
    const n = s.n, mapa = new Map();
    // epizody pogrupowane wg świecy, na której znany jest ich wynik (tablice typowane zamiast n list –
    // kolejność w obrębie świecy: rosnąco po j, long przed short)
    const off = new Int32Array(n + 1);
    for (let j = AS.START; j < n; j++) {
      if (!ep.flaga[j]) continue;
      if (w.kL[j] >= 0) off[w.kL[j] + 1]++;
      if (w.kS[j] >= 0) off[w.kS[j] + 1]++;
    }
    for (let t = 0; t < n; t++) off[t + 1] += off[t];
    const lista = new Int32Array(off[n]), poz = off.slice(0, n);
    for (let j = AS.START; j < n; j++) {
      if (!ep.flaga[j]) continue;
      if (w.kL[j] >= 0) lista[poz[w.kL[j]]++] = 2 * j;
      if (w.kS[j] >= 0) lista[poz[w.kS[j]]++] = 2 * j + 1;
    }
    const transakcje = []; let zajetyDo = -1;
    for (let t = AS.START; t < n; t++) {
      for (let q = off[t]; q < off[t + 1]; q++) {
        const j = lista[q] >> 1;
        let st = mapa.get(ep.klucze[j]); if (!st) { st = nowaStat(); mapa.set(ep.klucze[j], st); }
        dodaj(st, w, j, (lista[q] & 1) ? 'S' : 'L');
      }
      if (t < start || t <= zajetyDo) continue;
      const st = mapa.get(AS.klucz(k, t, o.cechy));
      if (!st) continue;
      const dec = AS.decyzja(st, o.minN);
      if (dec === 0) continue;
      const r = dec > 0 ? w.rL[t] : w.rS[t], kon = dec > 0 ? w.kL[t] : w.kS[t];
      if (!Number.isFinite(r)) continue;
      transakcje.push({ t, kierunek: dec, r, koniec: kon, typ: dec > 0 ? w.tL[t] : w.tS[t] });
      zajetyDo = kon;
    }
    let suma = 0, zysk = 0, strata = 0, wygr = 0, szczyt = 0, dd = 0, likw = 0;
    for (const x of transakcje) {
      if (x.typ === -2) likw++;
      suma += x.r; if (x.r > 0) { zysk += x.r; wygr++; } else strata -= x.r;
      if (suma > szczyt) szczyt = suma; if (szczyt - suma > dd) dd = szczyt - suma;
    }
    return { transakcje, sumaR: suma, pf: strata > 0 ? zysk / strata : (zysk > 0 ? 999 : 0),
      skutecznosc: transakcje.length ? wygr / transakcje.length : 0, maxDDR: dd, likwidacji: likw };
  };

  /* Cały przebieg dla jednej serii (prawdziwej albo przetasowanej). Z o.dzwignia – wyniki w ROE z likwidacją. */
  AS.policz = function (s, ms, o, start) {
    const k = AS.cechy(s, ms), w = o.dzwignia ? AS.wynikiDzwignia(s, k, o) : AS.wyniki(s, k, o), ep = AS.epizody(s, k, o.cechy, o.H);
    return { k, w, ep, wf: AS.walkForward(s, k, w, ep, o, start) };
  };

  g.LAB.AS = AS;
})(typeof self !== 'undefined' ? self : this);
