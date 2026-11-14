/* Laboratorium backtestów – silnik (bez DOM; działa w oknie i w Web Workerze).
 *
 * Definicje (te same w niezależnym sprawdzeniu narzedzia/sprawdz-niezaleznie.ps1):
 *  - ceny trzymamy jako logarytmy: lo, lh, ll, lc
 *  - pos[i]   = decyzja strategii po zamknięciu świecy i (1 long, -1 short, 0 brak)
 *  - held[i]  = pozycja trzymana w trakcie świecy i = pos[i-1]
 *  - ret[i]   = held[i] * (lc[i] - lc[i-1])  -  koszt * |held[i] - held[i-1]|  -  held[i] * F[i]
 *    (logarytmiczny zwrot na świecę, dźwignia 1×, koszt = opłata + poślizg za 1 jednostkę obrotu,
 *     F[i] = suma stawek fundingu w czasie trzymania świecy i; bez fundingu F = 0)
 *  - PF okna [a, b) = suma dodatnich ret / |suma ujemnych ret|
 */
(function (g) {
  'use strict';
  const LAB = {};

  // ---------- losowość z ziarnem (powtarzalne permutacje) ----------
  LAB.mulberry32 = function (a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  function tasuj(tab, rng) {
    for (let i = tab.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const x = tab[i]; tab[i] = tab[j]; tab[j] = x;
    }
    return tab;
  }

  // ---------- dane ----------
  LAB.zSwiec = function (swiece) {
    const n = swiece.length;
    const s = { n, t: new Float64Array(n), lo: new Float64Array(n), lh: new Float64Array(n), ll: new Float64Array(n), lc: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      const k = swiece[i];
      s.t[i] = k[0]; s.lo[i] = Math.log(k[1]); s.lh[i] = Math.log(k[2]); s.ll[i] = Math.log(k[3]); s.lc[i] = Math.log(k[4]);
    }
    return s;
  };
  LAB.wytnij = function (s, b) {
    return { n: b, t: s.t.subarray(0, b), lo: s.lo.subarray(0, b), lh: s.lh.subarray(0, b), ll: s.ll.subarray(0, b), lc: s.lc.subarray(0, b),
      F: s.F ? s.F.subarray(0, b) : null };
  };

  /* Funding na świecę: pozycja trzymana w świecy i trwa od zamknięcia i-1 do zamknięcia i,
   * czyli w czasie (t[i-1]+ms, t[i]+ms]. Sumujemy stawki z tego przedziału.
   * Dla świec przed początkiem historii stawek używamy stałej stawki na godzinę. */
  LAB.fundingSwiec = function (s, stawki, ms, stalaNaGodz) {
    const F = new Float64Array(s.n), pierwsza = stawki.length ? stawki[0][0] : Infinity;
    let j = 0, zHistorii = 0;
    for (let i = 1; i < s.n; i++) {
      const od = s.t[i - 1] + ms, doo = s.t[i] + ms;
      if (doo <= pierwsza) { F[i] = stalaNaGodz * (s.t[i] - s.t[i - 1]) / 3600000; continue; }
      while (j < stawki.length && stawki[j][0] <= od) j++;
      let sum = 0;
      while (j < stawki.length && stawki[j][0] <= doo) { sum += stawki[j][1]; j++; }
      F[i] = sum; zHistorii++;
    }
    return { F, pierwsza, zHistorii };
  };

  /* Permutacja świec: świece do indeksu `start` włącznie bez zmian; od start+1 tasujemy
   * osobno "wnętrza" świec (high/low/close względem open) i osobno luki (open względem
   * poprzedniego close). Zachowuje rozkład zwrotów, początek i koniec ceny – niszczy wzorce. */
  LAB.permutuj = function (s, start, ziarno) {
    const n = s.n, rng = LAB.mulberry32(ziarno);
    const p = { n, t: s.t, lo: Float64Array.from(s.lo), lh: Float64Array.from(s.lh), ll: Float64Array.from(s.ll), lc: Float64Array.from(s.lc),
      F: s.F ? Float64Array.from(s.F) : null };
    const m = n - start - 1;
    if (m < 2) return p;
    const rO = new Float64Array(m), rH = new Float64Array(m), rL = new Float64Array(m), rC = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      const i = start + 1 + j;
      rO[j] = s.lo[i] - s.lc[i - 1]; rH[j] = s.lh[i] - s.lo[i]; rL[j] = s.ll[i] - s.lo[i]; rC[j] = s.lc[i] - s.lo[i];
    }
    const iW = tasuj(Array.from({ length: m }, (_, j) => j), rng);
    const iL = tasuj(Array.from({ length: m }, (_, j) => j), rng);
    for (let j = 0; j < m; j++) {
      const i = start + 1 + j, w = iW[j];
      const o = p.lc[i - 1] + rO[iL[j]];
      p.lo[i] = o; p.lh[i] = o + rH[w]; p.ll[i] = o + rL[w]; p.lc[i] = o + rC[w];
      // funding wędruje razem z "wnętrzem" świecy, z której pochodzi
      if (p.F) p.F[i] = s.F[start + 1 + w];
    }
    return p;
  };

  // ---------- strategie ----------
  function ema(lc, dl) {
    const out = new Float64Array(lc.length), al = 2 / (dl + 1);
    out[0] = lc[0];
    for (let i = 1; i < lc.length; i++) out[i] = out[i - 1] + al * (lc[i] - out[i - 1]);
    return out;
  }
  const DLUGOSCI = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200];

  LAB.STRATEGIE = {
    ema: {
      nazwa: 'Przecięcie EMA (zawsze w rynku: long/short)',
      opis: 'Long gdy EMA szybka > EMA wolna z log-ceny zamknięcia, inaczej short.',
      osie: [{ nazwa: 'EMA szybka', wartosci: [5, 10, 15, 20, 25, 30, 40, 50] },
             { nazwa: 'EMA wolna', wartosci: [20, 30, 40, 50, 60, 80, 100, 120, 150, 200] }],
      dozwolone: p => p[0] < p[1],
      pozycje(s, p, pam, out) {
        const kf = 'e' + p[0], ks = 'e' + p[1];
        const f = pam[kf] || (pam[kf] = ema(s.lc, p[0]));
        const w = pam[ks] || (pam[ks] = ema(s.lc, p[1]));
        for (let i = 0; i < s.n; i++) out[i] = i < p[1] ? 0 : (f[i] > w[i] ? 1 : -1);
      }
    },
    donchian: {
      nazwa: 'Wybicie z kanału Donchiana (long/short)',
      opis: 'Long gdy zamknięcie > max z N poprzednich zamknięć, short gdy < min; inaczej trzyma pozycję.',
      osie: [{ nazwa: 'N świec', wartosci: DLUGOSCI }],
      pozycje(s, p, pam, out) {
        const N = p[0], lc = s.lc, n = s.n;
        const qMax = new Int32Array(n), qMin = new Int32Array(n);
        let hMax = 0, tMax = 0, hMin = 0, tMin = 0, poz = 0;
        for (let i = 0; i < n; i++) {
          // kolejki zawierają indeksy z okna [i-N, i-1]
          while (hMax < tMax && qMax[hMax] < i - N) hMax++;
          while (hMin < tMin && qMin[hMin] < i - N) hMin++;
          if (i >= N) {
            if (lc[i] > lc[qMax[hMax]]) poz = 1;
            else if (lc[i] < lc[qMin[hMin]]) poz = -1;
          }
          out[i] = poz;
          while (hMax < tMax && lc[qMax[tMax - 1]] <= lc[i]) tMax--;
          qMax[tMax++] = i;
          while (hMin < tMin && lc[qMin[tMin - 1]] >= lc[i]) tMin--;
          qMin[tMin++] = i;
        }
      }
    },
    momentum: {
      nazwa: 'Momentum (znak zmiany ceny z N świec)',
      opis: 'Long gdy zamknięcie > zamknięcie sprzed N świec, short gdy niżej.',
      osie: [{ nazwa: 'N świec', wartosci: DLUGOSCI }],
      pozycje(s, p, pam, out) {
        const N = p[0], lc = s.lc;
        for (let i = 0; i < s.n; i++) { const d = i < N ? 0 : lc[i] - lc[i - N]; out[i] = d > 0 ? 1 : d < 0 ? -1 : 0; }
      }
    }
  };

  // lista kombinacji parametrów (kolejność ustalona: pierwsza oś zmienia się wolniej)
  LAB.siatka = function (st) {
    const wyn = [];
    (function rek(k, p, ix) {
      if (k === st.osie.length) { if (!st.dozwolone || st.dozwolone(p)) wyn.push({ p: p.slice(), ix: ix.slice() }); return; }
      st.osie[k].wartosci.forEach((v, j) => { p.push(v); ix.push(j); rek(k + 1, p, ix); p.pop(); ix.pop(); });
    })(0, [], []);
    return wyn;
  };

  // ---------- zwroty i miary ----------
  LAB.zwroty = function (s, held, koszt, out) {
    out[0] = 0;
    for (let i = 1; i < s.n; i++) out[i] = held[i] * (s.lc[i] - s.lc[i - 1]) - koszt * Math.abs(held[i] - held[i - 1]);
    if (s.F) for (let i = 1; i < s.n; i++) out[i] -= held[i] * s.F[i];
    return out;
  };
  LAB.trzymana = function (pos, out) { out[0] = 0; for (let i = 1; i < pos.length; i++) out[i] = pos[i - 1]; return out; };
  LAB.pf = function (ret, a, b) {
    let d = 0, u = 0;
    for (let i = a; i < b; i++) { const r = ret[i]; if (r > 0) d += r; else u -= r; }
    return u > 0 ? d / u : (d > 0 ? 999 : 0);
  };
  function pfZ(d, u) { return u > 0 ? d / u : (d > 0 ? 999 : 0); }

  LAB.miary = function (s, ret, held, a, b, swiecRok, koszt) {
    let suma = 0, szczyt = 0, dd = 0, sr = 0, sr2 = 0, zmiany = 0, wRynku = 0, oplaty = 0, d = 0, u = 0, fund = 0;
    for (let i = a; i < b; i++) {
      if (s.F) fund += held[i] * s.F[i];
      const r = ret[i];
      suma += r; if (suma > szczyt) szczyt = suma; if (szczyt - suma > dd) dd = szczyt - suma;
      sr += r; sr2 += r * r;
      if (r > 0) d += r; else u -= r;
      if (i > a && held[i] !== held[i - 1]) zmiany++;
      if (held[i] !== 0) wRynku++;
      oplaty += koszt * Math.abs(held[i] - held[i - 1]);
    }
    const n = b - a, m = sr / n, odch = Math.sqrt(Math.max(0, sr2 / n - m * m));
    return {
      swiec: n, pf: pfZ(d, u), zwrotLog: suma, zwrotProc: (Math.exp(suma) - 1) * 100,
      maxDDProc: (1 - Math.exp(-dd)) * 100, sharpe: odch > 0 ? m / odch * Math.sqrt(swiecRok) : 0,
      zmianPozycji: zmiany, wRynkuProc: wRynku / n * 100, kosztyLogProc: oplaty * 100, fundingLogProc: fund * 100,
      kupTrzymajProc: (Math.exp(s.lc[b - 1] - s.lc[a - 1]) - 1) * 100
    };
  };

  /* Bramka 1 / pojedyncza permutacja bramki 2: optymalizacja PF na oknie [a, b). */
  LAB.optymalizuj = function (s, st, a, b, koszt, zWszystkimi) {
    const kombi = LAB.siatka(st), pam = {};
    const pos = new Int8Array(s.n), held = new Int8Array(s.n), ret = new Float64Array(s.n);
    let naj = -1, najPf = -Infinity;
    const pfs = zWszystkimi ? new Float64Array(kombi.length) : null;
    for (let k = 0; k < kombi.length; k++) {
      st.pozycje(s, kombi[k].p, pam, pos);
      LAB.trzymana(pos, held); LAB.zwroty(s, held, koszt, ret);
      const v = LAB.pf(ret, a, b);
      if (pfs) pfs[k] = v;
      if (v > najPf) { najPf = v; naj = k; }
    }
    return { naj, pf: najPf, parametry: kombi[naj].p, kombi, pfs };
  };

  /* Walk-forward: od indeksu `start` co `krok` świec wybiera parametry o najwyższym PF
   * na poprzednich `trening` świecach i handluje nimi do następnej reoptymalizacji. */
  LAB.walkForward = function (s, st, start, trening, krok, koszt) {
    const kombi = LAB.siatka(st), pam = {}, n = s.n, K = kombi.length;
    const P = [], posy = [];
    const pos = new Int8Array(n), held = new Int8Array(n), ret = new Float64Array(n);
    for (let k = 0; k < K; k++) {
      const pk = new Int8Array(n);
      st.pozycje(s, kombi[k].p, pam, pk);
      LAB.trzymana(pk, held); LAB.zwroty(s, held, koszt, ret);
      const pre = new Float64Array(2 * (n + 1));   // [dodatnie, ujemne] narastająco
      for (let i = 0; i < n; i++) {
        const r = ret[i];
        pre[2 * i + 2] = pre[2 * i] + (r > 0 ? r : 0);
        pre[2 * i + 3] = pre[2 * i + 1] + (r < 0 ? -r : 0);
      }
      P.push(pre); posy.push(pk);
    }
    const wybory = [], hWF = new Int8Array(n);
    for (let T = start; T < n; T += krok) {
      const a = T - trening;
      let naj = 0, najPf = -Infinity;
      for (let k = 0; k < K; k++) {
        const pre = P[k];
        const v = pfZ(pre[2 * T] - pre[2 * a], pre[2 * T + 1] - pre[2 * a + 1]);
        if (v > najPf) { najPf = v; naj = k; }
      }
      wybory.push({ T, k: naj, parametry: kombi[naj].p, pfTrening: najPf });
      const pk = posy[naj], koniec = Math.min(n, T + krok);
      for (let i = T; i < koniec; i++) hWF[i] = pk[i - 1];
    }
    const rWF = new Float64Array(n);
    for (let i = start; i < n; i++) rWF[i] = hWF[i] * (s.lc[i] - s.lc[i - 1]) - koszt * Math.abs(hWF[i] - (i > start ? hWF[i - 1] : 0)) - (s.F ? hWF[i] * s.F[i] : 0);
    // dla miar: pozycja "przed" startem = 0
    const hM = Int8Array.from(hWF); hM[start - 1] = 0;
    return { held: hM, ret: rWF, wybory, pf: LAB.pf(rWF, start, n) };
  };

  /* Symulacja konta z dźwignią na gotowych pozycjach `held` w oknie [a, b), start z kapitałem 1 i bez pozycji.
   * Każda transakcja: depozyt = udzial × wolna gotówka, wartość pozycji N0 = dzwignia × depozyt (stała ilość BTC od wejścia).
   * Wejście i wyjście po cenie zamknięcia świecy, koszt = koszt × wartość pozycji, funding = stawka × bieżąca wartość.
   * Likwidacja, gdy na low (long) / high (short) świecy: depozyt + wynik ≤ mm × wartość pozycji.
   * Wtedy przepada cały depozyt tej transakcji, a konto czeka na następną zmianę sygnału strategii. */
  LAB.symulujDzwignie = function (s, held, a, b, o) {
    const L = o.dzwignia, udzial = o.udzial, koszt = o.koszt, mm = o.mm;
    let gotowka = 1, strona = 0, ostatni = 0, N0 = 0, P0 = 0, baza = 0;
    let szczyt = 1, dd = 0, likw = 0, transakcji = 0, oplaty = 0, fund = 0, wyzerowane = false, kap = 1;
    const krzywa = new Float64Array(b - a);
    for (let i = a; i < b; i++) {
      const h = held[i];
      if (h !== ostatni) {
        const P = Math.exp(s.lc[i - 1]);
        if (strona !== 0) {
          const w = N0 * P / P0, opl = koszt * w;
          gotowka += baza + strona * (w - N0) - opl; oplaty += opl; strona = 0;
        }
        if (h !== 0 && gotowka > 1e-12) {
          const dep = udzial * gotowka; gotowka -= dep;
          N0 = L * dep; P0 = P; const opl = koszt * N0;
          baza = dep - opl; oplaty += opl; strona = h; transakcji++;
        }
        ostatni = h;
      }
      if (strona !== 0) {
        const wAdv = N0 * Math.exp(strona > 0 ? s.ll[i] : s.lh[i]) / P0;
        if (baza + strona * (wAdv - N0) <= mm * wAdv) { likw++; strona = 0; }
        else if (s.F) { const f = strona * s.F[i] * N0 * Math.exp(s.lc[i]) / P0; baza -= f; fund += f; }
      }
      kap = gotowka + (strona !== 0 ? baza + strona * (N0 * Math.exp(s.lc[i]) / P0 - N0) : 0);
      krzywa[i - a] = kap;
      if (kap > szczyt) szczyt = kap;
      if (1 - kap / szczyt > dd) dd = 1 - kap / szczyt;
      if (kap <= 1e-9) { wyzerowane = true; kap = 0; break; }
    }
    return { kapital: kap, zwrotProc: (kap - 1) * 100, maxDDProc: dd * 100, likwidacji: likw, transakcji,
      oplatyProc: oplaty * 100, fundingProc: fund * 100, wyzerowane, krzywa };
  };

  // p-wartość: (1 + liczba permutacji co najmniej tak dobrych) / (N + 1)
  LAB.pWartosc = function (prawdziwy, perm) {
    let c = 0; for (const v of perm) if (v >= prawdziwy) c++;
    return (c + 1) / (perm.length + 1);
  };

  LAB.SWIEC_ROK = { '15m': 35040, '1h': 8760, '4h': 2190, '1d': 365 };
  LAB.MS = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };

  g.LAB = LAB;
})(typeof self !== 'undefined' ? self : this);
