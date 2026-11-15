/* Dziennik tradera – ruchome wykresy (TradingView Lightweight Charts 4.2.0, plik lightweight-charts.js obok, licencja Apache-2.0).
 * Przesuwanie i przybliżanie palcem/myszą, krzyżyk z ceną i czasem, czas w strefie Polski.
 *   DZW.trade(el, t, swieceHL)  – świece trade'u z wolumenem, wypełnienia (strzałki), linie wejścia/wyjścia/SL/TP/planu,
 *                                przełącznik interwału, odświeżanie co 15 s, gdy trade jest otwarty albo świeży,
 *   DZW.krzywa(el)              – wynik w czasie (wszystkie trade'y i zgodne z zasadami 4–7) z opisem trade'u pod krzyżykiem,
 *   DZW.mini(el)                – mały wykres wyniku w przeglądzie. */
(function (g) {
  'use strict';
  const LW = g.LightweightCharts;
  const DZW = {};
  const STREFA = 'Europe/Warsaw';
  const nf = (d) => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtCena = (p) => (Math.abs(p) >= 1000 ? new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(p) : nf(Math.abs(p) < 10 ? 4 : 2).format(p));
  const fmtUsd = (x) => (x >= 0 ? '+' : '−') + nf(2).format(Math.abs(x)) + ' $';
  const fmtCzas = (t) => new Date(t * 1000).toLocaleString('pl-PL', { timeZone: STREFA, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  function fmtOs(t, typ) {
    const d = new Date(t * 1000), o = { timeZone: STREFA };
    if (typ === 0) return d.toLocaleDateString('pl-PL', Object.assign(o, { year: 'numeric' }));
    if (typ === 1) return d.toLocaleDateString('pl-PL', Object.assign(o, { month: 'short' }));
    if (typ === 2) return d.toLocaleDateString('pl-PL', Object.assign(o, { day: 'numeric', month: 'short' }));
    return d.toLocaleTimeString('pl-PL', Object.assign(o, { hour: '2-digit', minute: '2-digit' }));
  }
  DZW.dostepne = () => !!LW;

  // kolory z motywu: papier.css definiuje zmienne --wyk-*; bez nich (motyw morski) zostają dotychczasowe barwy
  const MORSKI = {
    tekst: 'rgba(236,255,250,.6)', czcionka: '"JetBrains Mono", ui-monospace, monospace', siatkaPion: 'rgba(255,255,255,.035)', siatka: 'rgba(255,255,255,.05)', ramka: 'rgba(255,255,255,.1)',
    celownik: 'rgba(67,240,198,.45)', celownikTlo: '#0b9e7b', celownikMini: 'rgba(255,255,255,.3)',
    wzrost: '#43f0c6', spadek: '#ff7a7a', knotWzrost: 'rgba(67,240,198,.8)', knotSpadek: 'rgba(255,122,122,.8)', wolWzrost: 'rgba(67,240,198,.28)', wolSpadek: 'rgba(255,122,122,.28)',
    wejscie: '#ffffff', wyjscie: '#ffd166', sl: '#ff7a7a', tp: '#43f0c6', plan: '#7cc8ff', kup: '#5ef9d6', sprzedaj: '#ff9d9d',
    krzywa: '#43f0c6', krzywaGora: 'rgba(67,240,198,.32)', krzywaDol: 'rgba(67,240,198,0)', krzywa2: '#7cc8ff', zero: 'rgba(255,255,255,.35)', zeroMini: 'rgba(255,255,255,.3)',
    plus: '#43f0c6', plusGora: 'rgba(67,240,198,.30)', plusDol: 'rgba(67,240,198,0)', minus: '#ff8a8a', minusGora: 'rgba(255,107,107,.26)', minusDol: 'rgba(255,107,107,0)'
  };
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  function paleta() {
    const cs = getComputedStyle(document.documentElement), p = {};
    for (const k in MORSKI) p[k] = cs.getPropertyValue('--wyk-' + kebab(k)).trim() || MORSKI[k];
    return p;
  }
  DZW.paleta = paleta;
  // po zmianie motywu każdy żywy wykres przemalowuje się sam (dane zostają, nic nie jest pobierane ponownie)
  const przemaluj = new Set();
  document.addEventListener('motyw', () => przemaluj.forEach((f) => { try { f(paleta()); } catch (e) { /* wykres usunięty */ } }));
  const kolorySiatki = (p) => ({
    layout: { textColor: p.tekst, fontFamily: p.czcionka },
    grid: { vertLines: { color: p.siatkaPion }, horzLines: { color: p.siatka } },
    rightPriceScale: { borderColor: p.ramka }, timeScale: { borderColor: p.ramka },
    crosshair: { vertLine: { color: p.celownik, labelBackgroundColor: p.celownikTlo }, horzLine: { color: p.celownik, labelBackgroundColor: p.celownikTlo } }
  });

  function wykres(el, extra) {
    const p = paleta();
    return LW.createChart(el, Object.assign({
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: p.tekst, fontFamily: p.czcionka, fontSize: 11 },
      grid: { vertLines: { color: p.siatkaPion }, horzLines: { color: p.siatka } },
      rightPriceScale: { borderColor: p.ramka },
      timeScale: { borderColor: p.ramka, timeVisible: true, secondsVisible: false, tickMarkFormatter: fmtOs, rightOffset: 4 },
      crosshair: { mode: LW.CrosshairMode.Normal,
        vertLine: { color: p.celownik, labelBackgroundColor: p.celownikTlo, width: 1 },
        horzLine: { color: p.celownik, labelBackgroundColor: p.celownikTlo, width: 1 } },
      localization: { locale: 'pl-PL', timeFormatter: fmtCzas, priceFormatter: fmtCena },
      kineticScroll: { touch: true, mouse: false }
    }, extra || {}));
  }

  // ------------------------------------------------------------------ wykres trade'u
  const MS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
  DZW.trade = function (el, t, swieceHL) {
    const otw = t.otwarcie, kon = t.zamkniecie || Date.now(), dl = kon - otw;
    let iw = dl > 4 * 86400000 ? '1h' : dl > 12 * 3600000 ? '15m' : '15m';
    el.innerHTML = `<div class="w-pasek"><span class="w-iw">${Object.keys(MS).map(k => `<button type="button" data-iw="${k}">${k}</button>`).join('')}</span><span class="w-legenda"></span><button type="button" class="w-dopasuj" title="Pokaż cały trade">⤢</button></div><div class="w-plotno"></div><div class="w-stan b-male"></div>`;
    const plotno = el.querySelector('.w-plotno'), legenda = el.querySelector('.w-legenda'), stan = el.querySelector('.w-stan');
    const ch = wykres(plotno);
    let p = paleta();
    const koloryswiec = (p) => ({ upColor: p.wzrost, downColor: p.spadek, borderUpColor: p.wzrost, borderDownColor: p.spadek, wickUpColor: p.knotWzrost, wickDownColor: p.knotSpadek });
    const swiece = ch.addCandlestickSeries(Object.assign(koloryswiec(p), { priceLineVisible: false }));
    const wol = ch.addHistogramSeries({ priceScaleId: 'wol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    ch.priceScale('wol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    const linie = [];   // [linia, klucz koloru]
    const liniaCeny = (cena, klucz, tytul, styl) => { if (!(cena > 0)) return; linie.push([swiece.createPriceLine({ price: cena, color: p[klucz], lineWidth: 1, lineStyle: styl, axisLabelVisible: true, title: tytul }), klucz]); };
    liniaCeny(t.wejscie, 'wejscie', 'wejście', LW.LineStyle.Solid);
    if (t.wyjscie) liniaCeny(t.wyjscie, 'wyjscie', 'wyjście', LW.LineStyle.Solid);
    liniaCeny(t.sl, 'sl', 'SL', LW.LineStyle.Dashed);
    liniaCeny(t.tp, 'tp', 'TP', LW.LineStyle.Dashed);
    liniaCeny(Number(t.wpis && t.wpis.planWejscie), 'plan', 'plan', LW.LineStyle.Dotted);
    const kolorWol = (k) => (k.close >= k.open ? p.wolWzrost : p.wolSpadek);
    let dane = [], timer = null, zniszczony = false;
    const malarz = (nowa) => {
      p = nowa; ch.applyOptions(kolorySiatki(p)); swiece.applyOptions(koloryswiec(p));
      linie.forEach(([l, k]) => l.applyOptions({ color: p[k] }));
      if (dane.length) { wol.setData(dane.map(k => ({ time: k.time, value: k.v || 0, color: kolorWol(k) }))); znaczniki(); }
    };
    przemaluj.add(malarz);

    const dopasuj = () => {
      const ms = MS[iw], pad = Math.max(dl * 0.6, 24 * ms);
      try { ch.timeScale().setVisibleRange({ from: Math.floor((otw - pad) / 1000), to: Math.ceil((Math.min(Date.now(), kon + pad)) / 1000) }); } catch (e) { ch.timeScale().fitContent(); }
    };
    function znaczniki() {
      const ms = MS[iw], m = new Map();
      for (const f of t.wypelnienia || []) {
        const czas = Math.floor(f.t / ms) * ms / 1000, kup = f.side === 'B', k = czas + (kup ? 'B' : 'A');
        const x = m.get(k) || { time: czas, position: kup ? 'belowBar' : 'aboveBar', color: kup ? p.kup : p.sprzedaj, shape: kup ? 'arrowUp' : 'arrowDown', ile: 0, sz: 0 };
        x.ile++; x.sz += f.sz; m.set(k, x);
      }
      const lista = [...m.values()].map(x => ({ time: x.time, position: x.position, color: x.color, shape: x.shape, text: (x.position === 'belowBar' ? 'kupno ' : 'sprzedaż ') + nf(4).format(x.sz) }));
      // tylko w czasie istniejących świec (inaczej biblioteka zgłasza błąd, np. przy świeżo otwartym trade'zie)
      const sa = new Set(dane.map(d => d.time));
      swiece.setMarkers(lista.filter(x => x.text && sa.has(x.time)).sort((a, b) => a.time - b.time));
    }
    async function zaladuj(pierwszy) {
      const ms = MS[iw];
      const min = Date.now() - 4900 * ms;   // Hyperliquid podaje ok. 5000 ostatnich świec
      const od = Math.max(min, otw - Math.max(dl * 2, 200 * ms)), doo = Math.min(Date.now(), kon + Math.max(dl, 100 * ms));
      if (otw < min) { stan.textContent = `Hyperliquid nie ma już świec ${iw} z dnia tego trade'u – wybierz większy interwał.`; swiece.setData([]); wol.setData([]); return; }
      stan.textContent = 'Pobieram świece…';
      try {
        const sw = await swieceHL(String(t.rynek).split(/[\s(]/)[0].toUpperCase(), od, doo, iw, ms);
        if (zniszczony) return;
        dane = sw.map(k => ({ time: k.t / 1000, open: k.o, high: k.h, low: k.l, close: k.c, v: k.v }));
        swiece.setData(dane.map(({ v, ...x }) => x));
        wol.setData(dane.map(k => ({ time: k.time, value: k.v || 0, color: kolorWol(k) })));
        znaczniki(); if (pierwszy !== false) dopasuj();
        stan.textContent = `${dane.length} świec ${iw} z Hyperliquid · przeciągnij, żeby przesunąć · kółko myszy albo dwa palce, żeby przybliżyć`;
        el.querySelectorAll('[data-iw]').forEach(b => b.classList.toggle('wl', b.dataset.iw === iw));
        pokazLegende(dane[dane.length - 1]);
      } catch (e) { stan.textContent = 'Nie mogę pobrać świec: ' + e.message; }
    }
    function pokazLegende(k) {
      if (!k) { legenda.textContent = ''; return; }
      const zm = k.open ? (k.close - k.open) / k.open * 100 : 0;
      legenda.innerHTML = `<span>${fmtCzas(k.time)}</span> O <b>${fmtCena(k.open)}</b> H <b>${fmtCena(k.high)}</b> L <b>${fmtCena(k.low)}</b> C <b class="${zm >= 0 ? 'plus' : 'minus'}">${fmtCena(k.close)}</b> <span class="${zm >= 0 ? 'plus' : 'minus'}">${zm >= 0 ? '+' : ''}${nf(2).format(zm)}%</span>`;
    }
    ch.subscribeCrosshairMove((p) => { const d = p && p.time && p.seriesData ? p.seriesData.get(swiece) : null; pokazLegende(d || dane[dane.length - 1]); });
    el.querySelector('.w-iw').addEventListener('click', (e) => { const b = e.target.closest('[data-iw]'); if (b && b.dataset.iw !== iw) { iw = b.dataset.iw; zaladuj(); } });
    el.querySelector('.w-dopasuj').addEventListener('click', dopasuj);
    // na żywo: trade otwarty albo zamknięty w ostatnich 3 h – dociągamy ostatnie świece co 15 s
    if (t.otwarta || Date.now() - kon < 3 * 3600000) timer = setInterval(async () => {
      if (document.hidden || !dane.length) return;
      try {
        const ms = MS[iw], sw = await swieceHL(String(t.rynek).split(/[\s(]/)[0].toUpperCase(), Date.now() - 3 * ms, Date.now(), iw, ms);
        for (const k of sw) {
          const x = { time: k.t / 1000, open: k.o, high: k.h, low: k.l, close: k.c };
          if (x.time < dane[dane.length - 1].time) continue;
          swiece.update(x); wol.update({ time: x.time, value: k.v || 0, color: kolorWol(x) });
          if (x.time === dane[dane.length - 1].time) dane[dane.length - 1] = Object.assign(x, { v: k.v }); else dane.push(Object.assign(x, { v: k.v }));
        }
        stan.textContent = `na żywo · ${dane.length} świec ${iw} · odświeżane co 15 s`;
      } catch (e) { /* spróbujemy za 15 s */ }
    }, 15000);
    zaladuj();
    return { usun() { zniszczony = true; clearInterval(timer); przemaluj.delete(malarz); try { ch.remove(); } catch (e) { } } };
  };

  // ------------------------------------------------------------------ wynik w czasie
  // punkty: [{ t (ms zamknięcia), wszystkie, zgodne, trade: { netto, opis } }]
  DZW.krzywa = function (el) {
    el.innerHTML = '<div class="w-pasek"><span class="w-legenda"></span><button type="button" class="w-dopasuj" title="Pokaż całość">⤢</button></div><div class="w-plotno"></div>';
    const plotno = el.querySelector('.w-plotno'), legenda = el.querySelector('.w-legenda');
    let kol = paleta();
    const ch = wykres(plotno, { rightPriceScale: { borderColor: kol.ramka, scaleMargins: { top: 0.12, bottom: 0.08 } }, localization: { locale: 'pl-PL', timeFormatter: fmtCzas, priceFormatter: (p) => fmtUsd(p) } });
    const koloryA = (k) => ({ lineColor: k.krzywa, topColor: k.krzywaGora, bottomColor: k.krzywaDol });
    ch.timeScale().applyOptions({ lockVisibleTimeRangeOnResize: true });   // po zmianie szerokości okna cała krzywa zostaje w kadrze
    const a = ch.addAreaSeries(Object.assign(koloryA(kol), { lineWidth: 2, priceLineVisible: false, lastValueVisible: true }));
    const b = ch.addLineSeries({ color: kol.krzywa2, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    const zero = a.createPriceLine({ price: 0, color: kol.zero, lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: false, title: '' });
    let pkt = [], ostI = -1;
    const legendaDla = (i) => {
      ostI = i; const p = pkt[i]; if (!p) { legenda.textContent = ''; return; }
      legenda.innerHTML = `<span>${fmtCzas(p.time)}</span> wszystkie <b class="${p.a >= 0 ? 'plus' : 'minus'}">${fmtUsd(p.a)}</b> · zasady 4–7 <b style="color:${kol.krzywa2}">${fmtUsd(p.b)}</b>${p.opis ? ` · <span>${p.opis}</span> <b class="${p.netto >= 0 ? 'plus' : 'minus'}">${fmtUsd(p.netto)}</b>` : ''}`;
    };
    ch.subscribeCrosshairMove((p) => { if (!p || !p.time) { legendaDla(pkt.length - 1); return; } const i = pkt.findIndex(x => x.time === p.time); legendaDla(i >= 0 ? i : pkt.length - 1); });
    el.querySelector('.w-dopasuj').addEventListener('click', () => ch.timeScale().fitContent());
    const malarz = (nowa) => {
      kol = nowa; ch.applyOptions(kolorySiatki(kol)); a.applyOptions(koloryA(kol)); b.applyOptions({ color: kol.krzywa2 }); zero.applyOptions({ color: kol.zero });
      legendaDla(ostI);
    };
    przemaluj.add(malarz);
    return {
      ustaw(punkty) {
        let ost = 0; pkt = punkty.map(p => { let time = Math.floor(p.t / 1000); if (time <= ost) time = ost + 1; ost = time; return Object.assign({}, p, { time }); });
        a.setData(pkt.map(p => ({ time: p.time, value: p.a })));
        b.setData(pkt.map(p => ({ time: p.time, value: p.b })));
        ch.timeScale().fitContent(); legendaDla(pkt.length - 1);
      },
      usun() { przemaluj.delete(malarz); try { ch.remove(); } catch (e) { } }
    };
  };

  // ------------------------------------------------------------------ mały wykres w przeglądzie
  DZW.mini = function (el) {
    // logo TradingView tylko na dużych wykresach – tu podpis jest w stopce strony (wymóg licencji: atrybucja)
    let kol = paleta(), naPlusie = true;
    const ch = wykres(el, { layout: { background: { type: 'solid', color: 'transparent' }, textColor: kol.tekst, fontFamily: kol.czcionka, fontSize: 11, attributionLogo: false },
      rightPriceScale: { visible: false }, leftPriceScale: { visible: false }, timeScale: { visible: false, borderVisible: false, lockVisibleTimeRangeOnResize: true },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } }, handleScroll: false, handleScale: false,
      crosshair: { mode: LW.CrosshairMode.Magnet, horzLine: { visible: false, labelVisible: false }, vertLine: { color: kol.celownikMini, labelVisible: false, width: 1 } },
      localization: { locale: 'pl-PL', timeFormatter: fmtCzas, priceFormatter: (p) => fmtUsd(p) } });
    const s = ch.addAreaSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 4 });
    const zero = s.createPriceLine({ price: 0, color: kol.zeroMini, lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: false, title: '' });
    const podpis = document.createElement('div'); podpis.className = 'w-mini-podpis'; el.appendChild(podpis);
    let pkt = [];
    ch.subscribeCrosshairMove((p) => { const x = p && p.time ? pkt.find(q => q.time === p.time) : null; podpis.innerHTML = x ? `${fmtCzas(x.time)} · <b>${fmtUsd(x.value)}</b>` : ''; });
    const koloryS = () => (naPlusie ? { lineColor: kol.plus, topColor: kol.plusGora, bottomColor: kol.plusDol } : { lineColor: kol.minus, topColor: kol.minusGora, bottomColor: kol.minusDol });
    const malarz = (nowa) => {
      kol = nowa; ch.applyOptions({ layout: { textColor: kol.tekst, fontFamily: kol.czcionka }, crosshair: { vertLine: { color: kol.celownikMini } } });
      zero.applyOptions({ color: kol.zeroMini }); s.applyOptions(koloryS());
    };
    przemaluj.add(malarz);
    return {
      ustaw(punkty, plus) {
        let ost = 0; pkt = punkty.map(p => { let time = Math.floor(p.t / 1000); if (time <= ost) time = ost + 1; ost = time; return { time, value: p.v }; });
        naPlusie = !!plus; s.applyOptions(koloryS());
        s.setData(pkt); ch.timeScale().fitContent();
      },
      usun() { przemaluj.delete(malarz); try { ch.remove(); } catch (e) { } }
    };
  };

  g.DZW = DZW;
})(typeof self !== 'undefined' ? self : this);
