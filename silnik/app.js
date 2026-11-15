/* Laboratorium backtestów – interfejs. Obliczenia są w lab.js (i w worker.js dla permutacji). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PROG = { g1: { pf: 1.05, sasiedzi: 1.0, zmian: 20 }, g2: 0.01, g3: 1.0 };
  let aktywne = [], przerwano = false;

  // ---------- formatowanie ----------
  const fmt = (v, m = 2) => Number.isFinite(v) ? v.toLocaleString('pl-PL', { minimumFractionDigits: m, maximumFractionDigits: m }) : '–';
  const proc = (v, m = 1) => `<span class="${v >= 0 ? 'plus' : 'minus'}">${v >= 0 ? '+' : ''}${fmt(v, m)}%</span>`;
  const data = t => new Date(t).toISOString().slice(0, 10);
  const pTxt = p => p < 0.001 ? fmt(p * 100, 2) + '%' : fmt(p * 100, 1) + '%';
  const kolor = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // kolor serii może być nazwą zmiennej motywu ('--akcent') – wtedy po zmianie motywu wykres przerysuje się w nowych kolorach
  const kol = k => (typeof k === 'string' && k.startsWith('--') ? kolor(k) : k);
  const rysunki = new Map();   // ostatni rysunek każdego płótna – do przerysowania po zmianie motywu
  document.addEventListener('motyw', () => { for (const f of rysunki.values()) { try { f(); } catch (e) { /* płótno zniknęło */ } } });

  function ustawBramke(id, stan, tekstZnaku, html) {
    const k = $(id), z = k.querySelector('.znak');
    z.className = 'znak ' + stan; z.textContent = tekstZnaku;
    if (html !== undefined) k.querySelector('.tresc').innerHTML = html;
  }
  function status(t, ulamek) { $('status').textContent = t; if (ulamek !== undefined) $('postep').style.width = (ulamek * 100).toFixed(1) + '%'; }
  function kafle(lista) { return '<div class="liczby">' + lista.map(([n, v]) => `<div><b>${v}</b><span>${n}</span></div>`).join('') + '</div>'; }

  // ---------- wykresy (canvas) ----------
  function plotno(c) {
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
    const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0);
    x.font = '11px system-ui, sans-serif';
    return { x, w: r.width, h: r.height };
  }
  // serie: [{y: [...] (log-zwrot narastająco), kolor, nazwa}], czasy: [...]
  function wykresKrzywej(c, czasy, serie) {
    rysunki.set(c, () => wykresKrzywej(c, czasy, serie));
    const { x, w, h } = plotno(c), L = 46, R = 8, T = 18, B = 20;
    let mn = 0, mx = 0;
    for (const s of serie) for (const v of s.y) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn < 1e-9) mx = mn + 0.01;
    const X = i => L + (w - L - R) * i / Math.max(1, czasy.length - 1), Y = v => T + (h - T - B) * (mx - v) / (mx - mn);
    x.strokeStyle = kolor('--linia'); x.fillStyle = kolor('--szary'); x.lineWidth = 1; x.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      const v = mn + (mx - mn) * k / 4, y = Y(v);
      x.beginPath(); x.moveTo(L, y); x.lineTo(w - R, y); x.stroke();
      const pr = (Math.exp(v) - 1) * 100;
      x.fillText((pr >= 0 ? '+' : '') + (Math.abs(pr) >= 100 ? pr.toFixed(0) : pr.toFixed(1)) + '%', L - 4, y + 4);
    }
    x.textAlign = 'center';
    for (let k = 0; k <= 4; k++) { const i = Math.round((czasy.length - 1) * k / 4); x.fillText(data(czasy[i]), Math.min(w - 34, Math.max(L + 30, X(i))), h - 5); }
    let lx = L + 4;
    for (const s of serie) {
      x.strokeStyle = kol(s.kolor); x.lineWidth = s.gruba ? 2 : 1.3; x.beginPath();
      const krok = Math.max(1, Math.floor(s.y.length / 1500));
      for (let i = 0; i < s.y.length; i += krok) { i === 0 ? x.moveTo(X(i), Y(s.y[i])) : x.lineTo(X(i), Y(s.y[i])); }
      x.lineTo(X(s.y.length - 1), Y(s.y[s.y.length - 1])); x.stroke();
      x.fillStyle = kol(s.kolor); x.textAlign = 'left'; x.fillRect(lx, 5, 10, 3); x.fillStyle = kolor('--tekst'); x.fillText(s.nazwa, lx + 14, 11); lx += x.measureText(s.nazwa).width + 30;
    }
  }
  function histogram(c, wartosci, prawdziwy) {
    rysunki.set(c, () => histogram(c, wartosci, prawdziwy));
    const { x, w, h } = plotno(c), L = 34, R = 10, T = 18, B = 22;
    let mn = Math.min(prawdziwy, ...wartosci), mx = Math.max(prawdziwy, ...wartosci);
    const pad = (mx - mn) * 0.05 || 0.05; mn -= pad; mx += pad;
    const K = 40, kosze = new Array(K).fill(0);
    for (const v of wartosci) kosze[Math.min(K - 1, Math.floor((v - mn) / (mx - mn) * K))]++;
    const maxK = Math.max(...kosze), bw = (w - L - R) / K;
    x.fillStyle = kolor('--wykres2');
    kosze.forEach((k, i) => { const hh = (h - T - B) * k / maxK; x.fillRect(L + i * bw + 1, h - B - hh, bw - 2, hh); });
    x.strokeStyle = kolor('--linia'); x.beginPath(); x.moveTo(L, h - B); x.lineTo(w - R, h - B); x.stroke();
    x.fillStyle = kolor('--szary'); x.textAlign = 'center';
    for (let k = 0; k <= 5; k++) { const v = mn + (mx - mn) * k / 5; x.fillText(fmt(v, 2), L + (w - L - R) * k / 5, h - 6); }
    const px = L + (w - L - R) * (prawdziwy - mn) / (mx - mn);
    x.strokeStyle = kolor('--akcent'); x.lineWidth = 2; x.beginPath(); x.moveTo(px, T - 4); x.lineTo(px, h - B); x.stroke();
    x.fillStyle = kolor('--akcent'); x.textAlign = px > w / 2 ? 'right' : 'left';
    x.fillText('prawdziwe dane: PF ' + fmt(prawdziwy, 3), px + (px > w / 2 ? -6 : 6), T + 4);
    x.fillStyle = kolor('--szary'); x.textAlign = 'left'; x.fillText('PF najlepszych parametrów na przetasowanych danych', L, 11);
  }
  function mapaParametrow(c, st, kombi, pfs, naj) {
    rysunki.set(c, () => mapaParametrow(c, st, kombi, pfs, naj));
    const { x, w, h } = plotno(c);
    const barwa = v => {               // czerwony < 1 < zielony
      const t = Math.max(-1, Math.min(1, (v - 1) / 0.3));
      const a = t >= 0 ? kolor('--zysk') : kolor('--strata');
      return { a, alfa: 0.15 + 0.85 * Math.abs(t) };
    };
    if (st.osie.length === 2) {
      const L = 70, B = 34, T = 10, R = 8, nx = st.osie[1].wartosci.length, ny = st.osie[0].wartosci.length;
      const cw = (w - L - R) / nx, ch = (h - T - B) / ny;
      x.textAlign = 'center';
      kombi.forEach((k, i) => {
        const cx = L + k.ix[1] * cw, cy = T + k.ix[0] * ch, b = barwa(pfs[i]);
        x.globalAlpha = b.alfa; x.fillStyle = b.a; x.fillRect(cx + 1, cy + 1, cw - 2, ch - 2); x.globalAlpha = 1;
        x.fillStyle = kolor('--tekst'); x.fillText(fmt(pfs[i], 2), cx + cw / 2, cy + ch / 2 + 4);
        if (i === naj) { x.strokeStyle = kolor('--akcent'); x.lineWidth = 2; x.strokeRect(cx + 1, cy + 1, cw - 2, ch - 2); }
      });
      x.fillStyle = kolor('--szary');
      st.osie[1].wartosci.forEach((v, j) => x.fillText(v, L + j * cw + cw / 2, h - B + 14));
      x.fillText(st.osie[1].nazwa + ' →', L + (w - L - R) / 2, h - 4);
      x.textAlign = 'right';
      st.osie[0].wartosci.forEach((v, j) => x.fillText(v, L - 6, T + j * ch + ch / 2 + 4));
      x.save(); x.translate(12, T + (h - T - B) / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.fillText(st.osie[0].nazwa + ' →', 0, 0); x.restore();
    } else {
      const L = 40, B = 34, T = 14, R = 8, n = kombi.length;
      let mn = Math.min(0.8, ...pfs), mx = Math.max(1.2, ...pfs);
      const X = i => L + (w - L - R) * (i + 0.5) / n, Y = v => T + (h - T - B) * (mx - v) / (mx - mn);
      x.strokeStyle = kolor('--szary'); x.setLineDash([4, 4]); x.beginPath(); x.moveTo(L, Y(1)); x.lineTo(w - R, Y(1)); x.stroke(); x.setLineDash([]);
      kombi.forEach((k, i) => { const b = barwa(pfs[i]); x.fillStyle = b.a; x.globalAlpha = Math.max(0.5, b.alfa); const y = Y(pfs[i]), y1 = Y(1); x.fillRect(X(i) - (w - L - R) / n * 0.35, Math.min(y, y1), (w - L - R) / n * 0.7, Math.abs(y1 - y)); x.globalAlpha = 1; });
      x.strokeStyle = kolor('--akcent'); x.lineWidth = 2; x.strokeRect(X(naj) - (w - L - R) / n * 0.42, T, (w - L - R) / n * 0.84, h - T - B);
      x.fillStyle = kolor('--szary'); x.textAlign = 'center';
      kombi.forEach((k, i) => { if (n <= 20 || i % 2 === 0) x.fillText(k.p[0], X(i), h - B + 14); });
      x.fillText(st.osie[0].nazwa + ' →', L + (w - L - R) / 2, h - 4);
      x.textAlign = 'right'; for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4; x.fillText(fmt(v, 2), L - 4, Y(v) + 4); }
    }
  }
  function narastajaco(ret, a, b) { const y = new Float64Array(b - a); let s = 0; for (let i = a; i < b; i++) { s += ret[i]; y[i - a] = s; } return y; }
  function kupTrzymaj(s, a, b) { const y = new Float64Array(b - a); for (let i = a; i < b; i++) y[i - a] = s.lc[i] - s.lc[a - 1]; return y; }

  // ---------- permutacje w wątkach ----------
  function permutacje(s, typ, ziarna, zadanie, naPostep) {
    return new Promise((ok, blad) => {
      const ile = Math.max(1, Math.min(ziarna.length, (navigator.hardwareConcurrency || 4) - 1));
      const wyniki = [], paczki = Array.from({ length: ile }, () => []);
      ziarna.forEach((z, i) => paczki[i % ile].push(z));
      let gotowe = 0;
      aktywne = paczki.map(p => {
        const w = new Worker('worker.js');
        w.postMessage({ typ: 'init', n: s.n, lo: s.lo, lh: s.lh, ll: s.ll, lc: s.lc, F: s.F || null });
        w.onmessage = e => {
          if (e.data.koniec) { w.terminate(); if (++gotowe === ile) { aktywne = []; ok(wyniki); } return; }
          wyniki.push(e.data); naPostep(wyniki.length / ziarna.length);
        };
        w.onerror = e => { aktywne.forEach(x => x.terminate()); aktywne = []; blad(new Error(e.message)); };
        w.postMessage(Object.assign({ typ, ziarna: p }, zadanie));
        return w;
      });
      aktywne.przerwij = () => blad(new Error('przerwano'));
    });
  }
  function zatrzymaj() { przerwano = true; const p = aktywne.przerwij; aktywne.forEach(w => w.terminate()); aktywne = []; if (p) p(); }

  // ---------- symulacja konta z dźwignią (pozycje z walk-forward) ----------
  function symulacjaDzwigni(s, held, b, koszt, raport) {
    const L = Math.min(50, Math.max(1, Number($('dzwignia').value) || 1));
    const udzial = Math.min(1, Math.max(0.01, Number($('udzial').value) / 100)), mm = Math.max(0, Number($('mm').value) / 100);
    const lat = (s.t[s.n - 1] - s.t[b - 1]) / (365.25 * 86400000);
    const lista = [...new Set([1, 2, 3, 5, 10, 20, 40, L])].sort((x, y) => x - y);
    const wyn = lista.map(d => ({ d, w: LAB.symulujDzwignie(s, held, b, s.n, { dzwignia: d, udzial, koszt, mm }) }));
    const moj = wyn.find(x => x.d === L).w, jeden = wyn.find(x => x.d === 1).w;
    raport.dzwignia = { udzial, mm, wybrana: L, wyniki: wyn.map(x => ({ dzwignia: x.d, zwrotProc: x.w.zwrotProc, maxDDProc: x.w.maxDDProc,
      likwidacji: x.w.likwidacji, transakcji: x.w.transakcji, oplatyProc: x.w.oplatyProc, fundingProc: x.w.fundingProc, wyzerowane: x.w.wyzerowane })) };
    const rocznie = w => w.kapital > 0 ? (Math.pow(w.kapital, 1 / lat) - 1) * 100 : -100;
    // znacznik pokazuje wynik konta (zielony tylko przy zysku), a likwidacje jako dopisek
    const wynikTxt = (moj.zwrotProc >= 0 ? '+' : '−') + fmt(Math.abs(moj.zwrotProc), 0) + '%';
    const znak = moj.wyzerowane ? ['zle', 'konto wyzerowane przy ' + L + '×']
      : [moj.zwrotProc >= 0 ? (moj.likwidacji ? 'pom' : 'ok') : 'zle', `${wynikTxt} przy ${L}×` + (moj.likwidacji ? ` · ${moj.likwidacji} likwidacji` : '')];
    ustawBramke('dz', znak[0], znak[1], `
      <p>Te same pozycje co w bramce 3, ale na prawdziwym koncie. Każda transakcja bierze ${fmt(udzial * 100, 0)}% wolnej gotówki jako depozyt, a wartość pozycji to depozyt × dźwignia.
      Likwidacja zabiera cały depozyt tej transakcji. Potem konto czeka na następny sygnał.</p>
      ${kafle([['Wynik przy ' + L + '×', moj.wyzerowane ? '<span class="minus">−100%</span>' : proc(moj.zwrotProc, 0)], ['Rocznie', proc(rocznie(moj), 1)], ['Maks. obsunięcie', fmt(moj.maxDDProc, 1) + '%'],
        ['Likwidacje', moj.likwidacji], ['Transakcje', moj.transakcji], ['Opłaty (% kapitału startowego)', fmt(moj.oplatyProc, 1) + '%'], ['Funding (% kapitału startowego)', fmt(moj.fundingProc, 1) + '%']])}
      <canvas id="cdz"></canvas>
      <div class="przewin"><table><tr><th>Dźwignia</th><th>Wynik</th><th>Rocznie</th><th>Maks. obsunięcie</th><th>Likwidacje</th><th>Transakcje</th><th>Opłaty</th><th>Funding</th></tr>
      ${wyn.map(x => `<tr${x.d === L ? ' style="font-weight:700"' : ''}><td>${x.d}×</td><td>${x.w.wyzerowane ? '<span class="minus">konto wyzerowane</span>' : proc(x.w.zwrotProc, 0)}</td><td>${proc(rocznie(x.w), 1)}</td>
        <td>${fmt(x.w.maxDDProc, 1)}%</td><td>${x.w.likwidacji}</td><td>${x.w.transakcji}</td><td>${fmt(x.w.oplatyProc, 1)}%</td><td>${fmt(x.w.fundingProc, 1)}%</td></tr>`).join('')}</table></div>
      <div class="maly" style="margin-top:6px">Opłaty i funding podane w % kapitału startowego (z dźwignią rosną razem z wartością pozycji). Likwidację sprawdzam na najniższej/najwyższej cenie każdej świecy,
      przy depozycie podtrzymującym ${fmt(mm * 100, 2)}%. Wynik 1× może się wyraźnie różnić od bramki 3. Tu wartość pozycji jest stała od wejścia (jak na giełdzie), a bramki odnawiają pozycję co świecę. ${fmt(lat, 1)} r. danych spoza próby.</div>`);
    const doWykresu = k => { const y = new Float64Array(k.krzywa.length); for (let i = 0; i < y.length; i++) y[i] = Math.log(Math.max(0.01, k.krzywa[i] || (k.wyzerowane ? 0 : 1))); return y; };
    const serie = [{ y: doWykresu(jeden), kolor: '--wykres2', nazwa: '1×' }];
    if (L !== 1) serie.push({ y: doWykresu(moj), kolor: moj.wyzerowane ? '--strata' : '--akcent', nazwa: L + '×', gruba: true });
    wykresKrzywej($('cdz'), s.t.subarray(b, s.n), serie);
  }

  // ---------- główny przebieg ----------
  async function uruchom() {
    przerwano = false;
    $('start').disabled = true; $('stop').classList.remove('ukryj');
    ['g1', 'g2', 'g3', 'dz', 'g4'].forEach(g => ustawBramke(g, 'czeka', 'czeka', ''));
    ustawBramke('kartaWerdykt', 'czeka', 'liczę…'); $('werdykt').textContent = 'Trwa liczenie…';
    const plik = $('plik').value, klucz = $('strategia').value, st = LAB.STRATEGIE[klucz];
    const raport = { kiedy: new Date().toISOString(), plik, strategia: klucz };
    try {
      status('Wczytuję dane…', 0);
      const dane = await (await fetch('../dane/' + plik)).json();
      const s = LAB.zSwiec(dane.swiece), rok = LAB.SWIEC_ROK[dane.interwal];
      const koszt = Number($('koszt').value) / 100, lata = Number($('lata').value);
      const trening = Math.round(lata * rok), krok = Math.max(1, Math.round(Number($('krok').value) * rok / 365));
      const a = 250, b = a + trening, ziarno = Math.floor(Number($('ziarno').value) || 0);
      const lataOOS = (s.n - b) / rok;
      if (b > s.n - Math.round(rok / 4)) throw new Error(`Za mało danych: ${s.n} świec, a trening ${lata} lat + rozgrzewka wymaga ${b} i jeszcze co najmniej kwartału na test spoza próby. Zmniejsz liczbę lat treningu albo wybierz dłuższe dane.`);
      Object.assign(raport, { interwal: dane.interwal, zrodlo: dane.zrodlo, symbol: dane.symbol, swiec: s.n, a, b, trening, krok, koszt, ziarno,
        okresTreningu: [data(s.t[a]), data(s.t[b - 1])], okresTestu: [data(s.t[b]), data(s.t[s.n - 1])] });
      // funding: rzeczywiste stawki z tej samej giełdy, przed początkiem historii stała stawka
      let opisFundingu = 'Funding wyłączony.';
      if ($('funding').value === 'tak') {
        const plikF = `${dane.zrodlo}-${dane.symbol}.json`;
        const rf = await fetch('../dane/funding/' + plikF);
        if (!rf.ok) throw new Error(`Brak historii fundingu (dane/funding/${plikF}). Pobierz świece tego źródła ponownie (przycisk „Pobierz świece” pobiera też funding) albo wyłącz funding.`);
        const df = await rf.json();
        const stalyNaGodz = Number($('fundingStaly').value) / 100 / 8;
        const fs = LAB.fundingSwiec(s, df.stawki, LAB.MS[dane.interwal], stalyNaGodz);
        s.F = fs.F;
        raport.funding = { plik: plikF, stalyNaGodz, pierwsza: fs.pierwsza, swiecZHistorii: fs.zHistorii };
        opisFundingu = `Funding: rzeczywiste stawki ${dane.zrodlo} od ${data(fs.pierwsza)}` + (fs.pierwsza > s.t[a] ? `, wcześniej stała ${fmt(Number($('fundingStaly').value), 3)}% na 8 h.` : '.');
      }
      const pokazWszystkie = $('wszystkie').checked;
      let porazka = 0;
      const opisOkresu = `Trening: ${data(s.t[a])} – ${data(s.t[b - 1])} (${fmt(lata, 1)} r.), test spoza próby: ${data(s.t[b])} – ${data(s.t[s.n - 1])} (${fmt(lataOOS, 1)} r.).`;

      // ===== Bramka 1 =====
      status('Bramka 1: optymalizacja w próbie…', 0.02);
      const opt = LAB.optymalizuj(s, st, a, b, koszt, true);
      const pos = new Int8Array(s.n), held = new Int8Array(s.n), ret = new Float64Array(s.n);
      st.pozycje(s, opt.parametry, {}, pos); LAB.trzymana(pos, held); LAB.zwroty(s, held, koszt, ret);
      const m1 = LAB.miary(s, ret, held, a, b, rok, koszt);
      const nk = opt.kombi[opt.naj];
      const sasiedzi = []; opt.kombi.forEach((k, i) => { if (i !== opt.naj && k.ix.every((v, j) => Math.abs(v - nk.ix[j]) <= 1)) sasiedzi.push(opt.pfs[i]); });
      sasiedzi.sort((x, y) => x - y);
      const medS = sasiedzi.length ? sasiedzi[Math.floor((sasiedzi.length - 1) / 2)] : 0;
      const udzialZysk = Array.from(opt.pfs).filter(v => v > 1).length / opt.pfs.length;
      const ok1 = m1.pf >= PROG.g1.pf && medS >= PROG.g1.sasiedzi && m1.zmianPozycji >= PROG.g1.zmian;
      const nazwyP = st.osie.map((o, j) => `${o.nazwa} ${opt.parametry[j]}`).join(', ');
      raport.g1 = { ok: ok1, parametry: opt.parametry, pf: m1.pf, medianaSasiadow: medS, udzialZyskownych: udzialZysk, miary: m1 };
      ustawBramke('g1', ok1 ? 'ok' : 'zle', ok1 ? 'zaliczona' : 'odrzucona', `
        <div class="maly">${opisOkresu} ${opisFundingu}</div>
        <p>Najlepsze parametry: <b>${nazwyP}</b> (sprawdzono ${opt.kombi.length} kombinacji).</p>
        ${kafle([['Profit factor (PF)', fmt(m1.pf, 3)], ['Zwrot w modelu bramek', proc(m1.zwrotProc, 0)], ['Kup i trzymaj', proc(m1.kupTrzymajProc, 0)], ['Maks. obsunięcie', fmt(m1.maxDDProc, 1) + '%'], ['Sharpe (roczny)', fmt(m1.sharpe, 2)], ['Zmian pozycji', m1.zmianPozycji], ['Koszty (log)', fmt(m1.kosztyLogProc, 1) + '%'], ...(s.F ? [['Funding zapłacony (log)', fmt(m1.fundingLogProc, 1) + '%']] : []), ['PF sąsiednich ustawień (mediana)', fmt(medS, 3)]])}
        ${m1.pf > 2 ? '<div class="ostrzezenie">PF powyżej 2 na historii to często znak dopasowania do szumu albo błędu. Tym ważniejsza jest bramka 2.</div>' : ''}
        <div class="maly">Warunek: PF ≥ ${fmt(PROG.g1.pf, 2)}, mediana PF sąsiednich ustawień ≥ ${fmt(PROG.g1.sasiedzi, 2)} (plateau, nie pojedynczy szczyt), co najmniej ${PROG.g1.zmian} zmian pozycji. Zyskownych jest ${fmt(udzialZysk * 100, 0)}% wszystkich ustawień.</div>
        <h3>Wynik dla każdego ustawienia (PF)</h3><canvas class="wysoki" id="c1m"></canvas>
        <h3>Krzywa w modelu bramek (1×, po kosztach)</h3><canvas id="c1k"></canvas>`);
      mapaParametrow($('c1m'), st, opt.kombi, opt.pfs, opt.naj);
      wykresKrzywej($('c1k'), s.t.subarray(a, b), [{ y: kupTrzymaj(s, a, b), kolor: '--wykres2', nazwa: 'kup i trzymaj' }, { y: narastajaco(ret, a, b), kolor: '--akcent', nazwa: 'strategia', gruba: true }]);
      if (!ok1 && !porazka) porazka = 1;
      if (porazka && !pokazWszystkie) return zakoncz(raport, porazka);

      // ===== Bramka 2 =====
      const N2 = Math.max(10, Math.floor(Number($('n2').value)));
      ustawBramke('g2', 'pom', 'liczę…');
      const t2 = performance.now();
      const w2 = await permutacje(s, 'g2', Array.from({ length: N2 }, (_, k) => ziarno * 1000003 + k), { strategia: klucz, a, b, koszt },
        f => status(`Bramka 2: permutacja ${Math.round(f * N2)} z ${N2}…`, 0.05 + 0.45 * f));
      w2.sort((x, y) => x.ziarno - y.ziarno);
      const pf2 = w2.map(r => r.wynik), p2 = LAB.pWartosc(m1.pf, pf2), ok2 = p2 < PROG.g2;
      const lepsze2 = pf2.filter(v => v >= m1.pf).length;
      raport.g2 = { ok: ok2, p: p2, permutacji: N2, lepszych: lepsze2, pierwsze: w2.slice(0, 5), sekund: (performance.now() - t2) / 1000 };
      ustawBramke('g2', ok2 ? 'ok' : 'zle', ok2 ? 'zaliczona' : 'odrzucona', `
        <p>Przetasowałem świece z okresu treningu ${N2} razy: rozkład zwrotów ten sam, ale prawdziwe wzorce zniszczone. Na każdej wersji optymalizacja szukała najlepszych parametrów.
        Na <b>${lepsze2}</b> z ${N2} przetasowanych wersji wynik był co najmniej tak dobry jak na prawdziwych danych.</p>
        ${kafle([['p-wartość', pTxt(p2)], ['próg', '< ' + pTxt(PROG.g2)], ['PF prawdziwy', fmt(m1.pf, 3)], ['PF permutacji (mediana)', fmt(pf2.slice().sort((x, y) => x - y)[Math.floor(N2 / 2)], 3)]])}
        <div class="maly">${ok2 ? 'Prawdziwe dane wyraźnie wyróżniają się na tle szumu.' : 'Optymalizacja znajduje podobny „zysk” w losowym szumie, więc ten wynik mógł być przypadkiem.'} Liczono ${fmt((performance.now() - t2) / 1000, 1)} s.</div>
        <canvas id="c2"></canvas>`);
      histogram($('c2'), pf2, m1.pf);
      if (!ok2 && !porazka) porazka = 2;
      if (porazka && !pokazWszystkie) return zakoncz(raport, porazka);

      // ===== Bramka 3 =====
      status('Bramka 3: walk-forward…', 0.52);
      await new Promise(r => setTimeout(r, 20));
      const wf = LAB.walkForward(s, st, b, trening, krok, koszt);
      const m3 = LAB.miary(s, wf.ret, wf.held, b, s.n, rok, koszt);
      const ok3 = m3.pf > PROG.g3 && m3.zwrotLog > 0;
      const czest = {}; wf.wybory.forEach(w => { const k = w.parametry.join('/'); czest[k] = (czest[k] || 0) + 1; });
      const topP = Object.entries(czest).sort((x, y) => y[1] - x[1]).slice(0, 6);
      const lataTab = {}; for (let i = b; i < s.n; i++) { const r = new Date(s.t[i]).getUTCFullYear(); const o = lataTab[r] || (lataTab[r] = { s: 0, bh: 0 }); o.s += wf.ret[i]; o.bh += s.lc[i] - s.lc[i - 1]; }
      raport.g3 = { ok: ok3, pf: m3.pf, miary: m3, reoptymalizacji: wf.wybory.length, wybory: wf.wybory.map(w => ({ T: w.T, parametry: w.parametry })) };
      ustawBramke('g3', ok3 ? 'ok' : 'zle', ok3 ? 'zaliczona' : 'odrzucona', `
        <p>Jak w prawdziwym handlu: co ${$('krok').value} dni parametry są dobierane tylko na podstawie poprzednich ${fmt(lata, 1)} lat i używane przez kolejny okres. Reoptymalizacji: ${wf.wybory.length}.</p>
        ${kafle([['PF poza próbą', fmt(m3.pf, 3)], ['Zwrot w modelu bramek', proc(m3.zwrotProc, 0)], ['Kup i trzymaj', proc(m3.kupTrzymajProc, 0)], ['Maks. obsunięcie', fmt(m3.maxDDProc, 1) + '%'], ['Sharpe (roczny)', fmt(m3.sharpe, 2)], ['Zmian pozycji', m3.zmianPozycji], ['Koszty (log)', fmt(m3.kosztyLogProc, 1) + '%'], ...(s.F ? [['Funding zapłacony (log)', fmt(m3.fundingLogProc, 1) + '%']] : [])])}
        <div class="maly">Warunek: PF > ${fmt(PROG.g3, 2)} i zwrot po kosztach powyżej zera. Słabiej niż w próbie to normalne.<br>
        Zwrot w modelu bramek to miara statystyczna: pozycja jest odnawiana na każdej świecy (zwroty logarytmiczne). Przy shortach w czasie wzrostów zawyża on wynik.
        Realny wynik konta, z pozycją stałą od wejścia, pokazuje karta „Symulacja konta z dźwignią”.</div>
        <canvas id="c3"></canvas>
        <div class="przewin"><table><tr><th>Rok</th>${Object.keys(lataTab).map(r => `<th>${r}</th>`).join('')}</tr>
        <tr><td>Strategia</td>${Object.values(lataTab).map(o => `<td>${proc((Math.exp(o.s) - 1) * 100, 0)}</td>`).join('')}</tr>
        <tr><td>Kup i trzymaj</td>${Object.values(lataTab).map(o => `<td>${proc((Math.exp(o.bh) - 1) * 100, 0)}</td>`).join('')}</tr></table></div>
        <div class="maly" style="margin-top:6px">Najczęściej wybierane parametry: ${topP.map(([k, v]) => `${k} (${v}×)`).join(', ')}.</div>`);
      wykresKrzywej($('c3'), s.t.subarray(b, s.n), [{ y: kupTrzymaj(s, b, s.n), kolor: '--wykres2', nazwa: 'kup i trzymaj' }, { y: narastajaco(wf.ret, b, s.n), kolor: '--akcent', nazwa: 'walk-forward', gruba: true }]);
      symulacjaDzwigni(s, wf.held, b, koszt, raport);
      if (!ok3 && !porazka) porazka = 3;
      if (porazka && !pokazWszystkie) return zakoncz(raport, porazka);

      // ===== Bramka 4 =====
      const N4 = Math.max(10, Math.floor(Number($('n4').value)));
      const prog4 = lataOOS >= 2 ? 0.01 : 0.05;
      ustawBramke('g4', 'pom', 'liczę…');
      const t4 = performance.now();
      const w4 = await permutacje(s, 'g4', Array.from({ length: N4 }, (_, k) => ziarno * 1000003 + 500000 + k), { strategia: klucz, b, trening, krok, koszt },
        f => status(`Bramka 4: walk-forward na permutacji ${Math.round(f * N4)} z ${N4}…`, 0.55 + 0.43 * f));
      w4.sort((x, y) => x.ziarno - y.ziarno);
      const pf4 = w4.map(r => r.wynik), p4 = LAB.pWartosc(m3.pf, pf4), ok4 = p4 < prog4;
      const lepsze4 = pf4.filter(v => v >= m3.pf).length;
      raport.g4 = { ok: ok4, p: p4, prog: prog4, permutacji: N4, lepszych: lepsze4, pierwsze: w4.slice(0, 3), sekund: (performance.now() - t4) / 1000 };
      ustawBramke('g4', ok4 ? 'ok' : 'zle', ok4 ? 'zaliczona' : 'odrzucona', `
        <p>Przetasowałem tylko dane po pierwszym oknie treningu (${N4} razy) i na każdej wersji powtórzyłem cały walk-forward.
        Na <b>${lepsze4}</b> z ${N4} wersji wynik był co najmniej tak dobry jak prawdziwy.</p>
        ${kafle([['p-wartość', pTxt(p4)], ['próg', '< ' + pTxt(prog4)], ['PF walk-forward', fmt(m3.pf, 3)], ['PF permutacji (mediana)', fmt(pf4.slice().sort((x, y) => x - y)[Math.floor(N4 / 2)], 3)]])}
        <div class="maly">Próg ${pTxt(prog4)}, bo test spoza próby trwa ${fmt(lataOOS, 1)} r. (${lataOOS >= 2 ? '2 lata lub więcej → 1%' : 'krócej niż 2 lata → 5%'}). Liczono ${fmt((performance.now() - t4) / 1000, 1)} s.</div>
        <canvas id="c4"></canvas>`);
      histogram($('c4'), pf4, m3.pf);
      if (!ok4 && !porazka) porazka = 4;
      return zakoncz(raport, porazka);
    } catch (e) {
      if (przerwano) { status('Przerwano.', 0); $('werdykt').textContent = 'Przerwano – nic nie zapisano.'; ustawBramke('kartaWerdykt', 'czeka', 'przerwano'); }
      else { status('Błąd: ' + e.message); $('werdykt').textContent = e.message; ustawBramke('kartaWerdykt', 'zle', 'błąd'); }
    } finally {
      $('start').disabled = false; $('stop').classList.add('ukryj');
    }
  }

  async function zakoncz(raport, oblana) {
    raport.oblanaBramka = oblana;
    const st = LAB.STRATEGIE[raport.strategia];
    if (oblana === 0) {
      ustawBramke('kartaWerdykt', 'ok', 'przeszła 4 bramki');
      $('werdykt').innerHTML = `<b>${st.nazwa}</b> przeszła wszystkie bramki na tych danych. To kwalifikuje ją do <b>papierowego handlu</b>, a nie do prawdziwych pieniędzy. Sprawdzaj co tydzień bramkę 4 na nowych danych: przewagi wygasają.`;
    } else {
      ustawBramke('kartaWerdykt', 'zle', 'odrzucona na bramce ' + oblana);
      $('werdykt').innerHTML = `<b>${st.nazwa}</b> odpada na bramce ${oblana}. ${oblana < 4 && !$('wszystkie').checked ? 'Dalszych bramek nie liczyłem, żeby nie zużywać danych spoza próby.' : ''}`;
    }
    status('Gotowe. Zapisuję wynik…', 1);
    try {
      await fetch('/api/zapisz?plik=ostatni-wynik.json', { method: 'POST', body: JSON.stringify(raport, null, 1) });
      let dz = [];
      try { const r = await fetch('../wyniki/dziennik.json'); if (r.ok) dz = await r.json(); } catch (e) { /* pierwszy wpis */ }
      dz.push({ kiedy: raport.kiedy, plik: raport.plik, strategia: raport.strategia, koszt: raport.koszt, trening: raport.trening, krok: raport.krok,
        parametryG1: raport.g1 && raport.g1.parametry, pfG1: raport.g1 && raport.g1.pf, pG2: raport.g2 && raport.g2.p,
        pfG3: raport.g3 && raport.g3.pf, zwrotG3: raport.g3 && raport.g3.miary.zwrotProc, pG4: raport.g4 && raport.g4.p, oblanaBramka: oblana });
      await fetch('/api/zapisz?plik=dziennik.json', { method: 'POST', body: JSON.stringify(dz, null, 1) });
      pokazDziennik(dz);
      status('Gotowe. Wynik zapisany w wyniki/.', 1);
    } catch (e) { status('Gotowe, ale nie udało się zapisać wyniku: ' + e.message, 1); }
  }

  function pokazDziennik(dz) {
    if (!dz.length) { $('dziennik').innerHTML = '<p class="maly">Brak wpisów.</p>'; return; }
    const doOOS = {}; dz.forEach(d => { if (d.pfG3 !== undefined && d.pfG3 !== null) doOOS[d.plik] = (doOOS[d.plik] || 0) + 1; });
    const ostrz = Object.entries(doOOS).filter(([, v]) => v >= 5).map(([k, v]) => `${k}: ${v} testów doszło do danych spoza próby`).join('; ');
    $('dziennik').innerHTML = (ostrz ? `<div class="ostrzezenie">Uwaga na wielokrotne testowanie – ${ostrz}. Najlepszy z wielu wyników spoza próby jest zawyżony.</div>` : '') +
      `<table><tr><th>Kiedy</th><th>Dane</th><th>Strategia</th><th>Parametry</th><th>PF w próbie</th><th>p (b2)</th><th>PF poza próbą</th><th>p (b4)</th><th>Wynik</th></tr>` +
      dz.slice().reverse().map(d => `<tr><td>${d.kiedy.slice(0, 16).replace('T', ' ')}</td><td>${d.plik.replace('.json', '')}</td><td>${d.strategia}</td><td>${(d.parametryG1 || []).join('/')}</td>
        <td>${fmt(d.pfG1, 3)}</td><td>${d.pG2 != null ? pTxt(d.pG2) : '–'}</td><td>${d.pfG3 != null ? fmt(d.pfG3, 3) : '–'}</td><td>${d.pG4 != null ? pTxt(d.pG4) : '–'}</td>
        <td><span class="znak ${d.oblanaBramka === 0 ? 'ok' : 'zle'}">${d.oblanaBramka === 0 ? 'przeszła' : 'bramka ' + d.oblanaBramka}</span></td></tr>`).join('') + '</table>';
  }

  async function wczytajListe(wybierz) {
    const lista = await (await fetch('/api/dane')).json();
    $('plik').innerHTML = lista.map(d => `<option value="${d.plik}">${d.plik.replace('.json', '')}</option>`).join('');
    const zapamietany = wybierz || (function () { try { return localStorage.getItem('lab-plik'); } catch (e) { return null; } })();
    if (zapamietany && lista.some(d => d.plik === zapamietany)) $('plik').value = zapamietany;
    else if (lista.some(d => d.plik === 'binance-BTCUSDT-4h.json')) $('plik').value = 'binance-BTCUSDT-4h.json';
    opisDanych(lista);
    $('plik').onchange = () => { try { localStorage.setItem('lab-plik', $('plik').value); } catch (e) { } opisDanych(lista); };
  }
  function opisDanych(lista) {
    const d = lista.find(x => x.plik === $('plik').value);
    const hl = $('plik').value.startsWith('hyperliquid');
    $('opisDanych').textContent = d ? `Pobrano ${d.zmieniono.slice(0, 10)}. ${hl ? 'Hyperliquid daje tylko ~5000 ostatnich świec – ustaw krótszy trening.' : 'Binance spot BTCUSDT: długa historia, ceny prawie identyczne z perpem na HL.'}` : '';
  }

  // ---------- start ----------
  $('strategia').innerHTML = Object.entries(LAB.STRATEGIE).map(([k, s]) => `<option value="${k}">${s.nazwa}</option>`).join('');
  const opisSt = () => { $('opisStrategii').textContent = LAB.STRATEGIE[$('strategia').value].opis; };
  $('strategia').onchange = opisSt; opisSt();
  $('start').onclick = uruchom;
  $('stop').onclick = zatrzymaj;
  $('pobierz').onclick = async () => {
    $('pobierz').disabled = true; $('statusPobierania').textContent = 'Pobieram… (Binance 1h trwa ok. minuty)';
    try {
      const r = await fetch(`/api/pobierz?zrodlo=${$('zrodlo').value}&interwal=${$('interwal').value}&symbol=${encodeURIComponent($('symbol').value.trim().toUpperCase())}`, { method: 'POST' });
      const t = await r.text();
      $('statusPobierania').textContent = r.ok ? t.trim().split('\n').filter(x => /Zapisano|Funding/.test(x)).join(' · ') : 'Błąd: ' + t.trim().split('\n').slice(-3).join(' ');
      if (r.ok) await wczytajListe();
    } catch (e) { $('statusPobierania').textContent = 'Błąd: ' + e.message; }
    $('pobierz').disabled = false;
  };
  wczytajListe().catch(e => status('Nie mogę wczytać listy danych: ' + e.message));
  fetch('../wyniki/dziennik.json').then(r => r.ok ? r.json() : []).then(pokazDziennik).catch(() => pokazDziennik([]));
})();
