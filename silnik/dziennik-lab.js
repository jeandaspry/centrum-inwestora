/* Laboratorium → karta „Twoje wejścia kontra przypadek” (dane z dziennika tradera).
 * Test permutacyjny jak w bramkach laboratorium: dla każdego Twojego trade'u BTC losujemy wejście w tym samym okresie,
 * w tym samym kierunku i z tym samym czasem trzymania (w świecach 15m z Hyperliquid). Statystyka = średni ruch ceny
 * na trade w Twoją stronę (bez opłat – sprawdzamy sam timing wejść i wyjść). p = odsetek losowych zestawów co najmniej
 * tak dobrych jak Twój. p < 5% → przewaga w timingu (na tej próbie); inaczej Twój wynik mieści się w przypadku. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LAB = window.LAB, DZ = window.DZ;
  const el = $('twojeTrade'); if (!el || !LAB || !DZ) return;
  const nf = (d) => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const E_ = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MS = 900000, LOS = 4000;
  const hl = async (body) => { const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error('Hyperliquid ' + r.status); return r.json(); };
  const naglowek = (znak, tekst) => `<h2>Twoje wejścia kontra przypadek <span class="znak ${znak}">${tekst}</span></h2>`;

  async function swiece(od, doo) {
    const w = new Map();
    for (let a = od; a < doo; a += 4900 * MS) for (const k of await hl({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '15m', startTime: a, endTime: Math.min(doo, a + 4900 * MS) } }) || []) w.set(+k.t, +k.c);
    return [...w.entries()].sort((a, b) => a[0] - b[0]);
  }

  async function licz() {
    el.innerHTML = naglowek('czeka', 'liczę…') + '<div class="tresc"><p class="maly">Wczytuję Twoje trade\'y i świece 15m z Hyperliquid…</p></div>';
    try {
      const r = await fetch('/api/dziennik', { cache: 'no-store' });
      if (!r.ok) throw new Error('dziennik niedostępny (' + r.status + ')');
      const d = await r.json();
      const lista = d && d.trade ? DZ.zbuduj(d.trade, d.chrome, d.wpisy) : [];
      const od0 = Date.now() - 50 * 86400000;   // Hyperliquid trzyma ok. 52 dni świec 15m
      const tr = lista.filter(t => !t.otwarta && t.zamkniecie && t.wyjscie && String(t.rynek).split(/[\s(]/)[0].toUpperCase() === 'BTC' && t.otwarcie >= od0);
      if (tr.length < 8) { el.innerHTML = naglowek('czeka', 'za mało danych') + `<div class="tresc"><p class="maly">Potrzeba co najmniej 8 zamkniętych trade'ów BTC z ostatnich ~50 dni (jest ${tr.length}).</p></div>`; return; }
      const od = Math.min(...tr.map(t => t.otwarcie)) - 86400000, doo = Math.max(...tr.map(t => t.zamkniecie)) + 3600000;
      const c = await swiece(od, Math.min(doo, Date.now()));
      if (c.length < 200) throw new Error('za mało świec');
      const n = c.length, ceny = c.map(x => x[1]);
      // Twój ruch ceny na trade (w Twoją stronę) i czas trzymania w świecach
      const moje = tr.map(t => ({ s: t.strona === 'long' ? 1 : -1, ruch: (t.strona === 'long' ? 1 : -1) * (t.wyjscie - t.wejscie) / t.wejscie, h: Math.max(1, Math.round((t.zamkniecie - t.otwarcie) / MS)) }));
      const sr = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const mojSr = sr(moje.map(m => m.ruch)), mojTraf = moje.filter(m => m.ruch > 0).length / moje.length;
      const rnd = LAB.mulberry32(20261115);
      let lepsze = 0, sumaLos = 0, trafLos = 0;
      for (let p = 0; p < LOS; p++) {
        let s = 0, tt = 0;
        for (const m of moje) {
          const i = Math.floor(rnd() * (n - m.h - 1)), j = i + m.h;
          const ruch = m.s * (ceny[j] - ceny[i]) / ceny[i];
          s += ruch; if (ruch > 0) tt++;
        }
        const srL = s / moje.length; sumaLos += srL; trafLos += tt / moje.length;
        if (srL >= mojSr) lepsze++;
      }
      const pW = (lepsze + 1) / (LOS + 1), srLos = sumaLos / LOS;
      const ok = pW < 0.05;
      const opl = sr(tr.map(t => t.oplaty / (t.wartoscMax || t.wartosc || 1)));
      el.innerHTML = naglowek(ok ? 'ok' : 'pom', ok ? 'przewaga w timingu' : 'w zasięgu przypadku') + `<div class="tresc">
        <p>${tr.length} Twoich trade'ów BTC (${new Date(od + 86400000).toLocaleDateString('pl-PL')} – ${new Date(doo).toLocaleDateString('pl-PL')}). Średni ruch ceny w Twoją stronę na trade:
          <b>${nf(3).format(mojSr * 100)}%</b> (trafione ${nf(0).format(mojTraf * 100)}%). Losowe wejścia w tym samym kierunku i z tym samym czasem trzymania:
          <b>${nf(3).format(srLos * 100)}%</b> (trafione ${nf(0).format(trafLos / LOS * 100)}%).</p>
        <p><b>p = ${nf(3).format(pW)}</b> – ${ok ? 'tylko ' + nf(1).format(pW * 100) + '% losowych zestawów było równie dobrych. Twój timing coś daje (na tej próbie – sprawdzaj dalej).'
          : nf(0).format(pW * 100) + '% losowych zestawów było co najmniej tak dobrych. Na tej próbie nie widać, żeby wejścia i wyjścia były lepsze od przypadku – wynik robią dźwignia, opłaty i dyscyplina.'}</p>
        <p class="maly">Opłaty zabierają średnio ${nf(3).format(opl * 100)}% wartości pozycji na trade – tyle musi dać sam timing, żeby wyjść na zero. ${LOS.toLocaleString('pl-PL')} losowań, świece 15m z Hyperliquid, bez opłat i fundingu. To test timingu, nie rada inwestycyjna.</p>
        <p class="maly"><a href="dziennik.html" data-centrum="dziennik">Szczegóły w dzienniku tradera →</a></p></div>`;
    } catch (e) { el.innerHTML = naglowek('zle', 'błąd') + `<div class="tresc"><p class="maly">${E_(e.message)}</p></div>`; }
  }
  licz();
})();
