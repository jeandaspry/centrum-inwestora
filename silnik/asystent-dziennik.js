/* Asystent → karta „Twoje trade'y”: dyscyplina na dziś (zasady 5–7 z dziennika) i jak wypadały Twoje trade'y,
 * gdy rynek był w takim samym układzie jak teraz (ten sam klucz cech na świecy przed wejściem, interwał Asystenta).
 * Dane z dziennika tradera (/api/dziennik – na telefonie z Firebase). Tylko odczyt. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DZ = window.DZ, AS = window.LAB && window.LAB.AS;
  const E_ = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd = (x) => (isFinite(x) ? (x >= 0 ? '+' : '−') + nf2.format(Math.abs(x)) + ' $' : '–');
  const kl = (x) => (x > 0 ? 'plus' : x < 0 ? 'minus' : '');
  const godz = (t) => new Date(t).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
  let lista = null, blad = null;

  async function wczytaj() {
    try {
      const r = await fetch('/api/dziennik', { cache: 'no-store' });
      if (!r.ok) throw new Error('dziennik niedostępny (' + r.status + ')');
      const d = await r.json();
      lista = d && d.trade ? DZ.zbuduj(d.trade, d.chrome, d.wpisy) : [];
      blad = null;
    } catch (e) { blad = e.message; }
    rysuj();
  }

  // indeks ostatniej świecy zamkniętej przed chwilą t
  function indeks(s, ms, t) { let lo = 0, hi = s.n - 1, j = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s.t[m] + ms <= t) { j = m; lo = m + 1; } else hi = m - 1; } return j; }
  function grupa(l) { const z = l.filter(t => !t.otwarta); return { n: z.length, w: z.filter(t => t.netto > 0).length, netto: z.reduce((s, t) => s + t.netto, 0) }; }
  const opisGrupy = (g) => g.n ? `${g.n} trade'ów, ${g.w} na plus, razem <b class="${kl(g.netto)}">${usd(g.netto)}</b>` : 'brak';

  function rysuj() {
    const el = $('mojeTrade'); if (!el) return;
    const nag = '<h2>Twoje trade\'y <span class="podtytul">z dziennika tradera</span></h2>';
    if (blad) { el.innerHTML = nag + `<p class="male">${E_(blad)}</p>`; return; }
    if (!lista) { el.innerHTML = nag + '<p class="male">Wczytuję dziennik…</p>'; return; }
    if (!lista.length) { el.innerHTML = nag + '<p class="male">Dziennik jest pusty – trade\'y pojawią się, gdy panel inwestora je wyeksportuje.</p>'; return; }
    const d = DZ.dzis(lista);
    const przerwy = d.przerwy.map(p => `<span class="znacznik uwaga">przerwa do ${godz(p.do)} – zasada ${p.zasada} (${E_(p.powod)})</span>`).join(' ');
    let uklad = '<p class="male">Układ rynku policzę, gdy Asystent wczyta statystykę.</p>';
    const st = window.ASYSTENT_STAN;
    if (st && st.hist && st.live && AS) {
      const h = st.hist, L2 = st.live, cechy = h.o.cechy;
      const btc = lista.filter(t => !t.otwarta && String(t.rynek).split(/[\s(]/)[0].toUpperCase() === 'BTC');
      const klucz = (k, i, c) => AS.klucz(k, i, c);
      const teraz = klucz(L2.k2, L2.i, cechy), cz = cechy.slice(0, 2), terazCz = klucz(L2.k2, L2.i, cz);
      const tenSam = [], podobny = [];
      for (const t of btc) {
        const j = indeks(h.s, h.ms, t.otwarcie); if (j < AS.START) continue;
        if (klucz(h.k, j, cechy) === teraz) tenSam.push(t);
        if (klucz(h.k, j, cz) === terazCz) podobny.push(t);
      }
      const opisUkl = cechy.map(f => AS.OPIS[f][L2.k2[f][L2.i]]).join(', ');
      const gL = grupa(tenSam.filter(t => t.strona === 'long')), gS = grupa(tenSam.filter(t => t.strona === 'short'));
      uklad = `<p class="male">Teraz (świece ${E_(h.dane.interwal)}): ${E_(opisUkl)}.</p>
        <div class="kafle" style="margin-top:6px">
          <div class="kafel"><div class="et">Ten sam układ</div><div class="wart">${tenSam.length}</div><div class="pod">long: ${opisGrupy(gL)}<br>short: ${opisGrupy(gS)}</div></div>
          <div class="kafel"><div class="et">Podobny (${E_(cz.map(f => ({ trend: 'trend', rsi: 'RSI', zmiennosc: 'zmienność', zakres: 'zakres', funding: 'funding' }[f])).join(' + '))})</div><div class="wart">${podobny.length}</div><div class="pod">long: ${opisGrupy(grupa(podobny.filter(t => t.strona === 'long')))}<br>short: ${opisGrupy(grupa(podobny.filter(t => t.strona === 'short')))}</div></div>
        </div>
        <p class="b-male" style="margin-top:6px">Twoje trade'y BTC z dziennika, których świeca ${E_(h.dane.interwal)} przed wejściem miała ten sam układ. Mała liczba = przypadek, nie reguła.</p>`;
    }
    el.innerHTML = nag + `<div class="flagi" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <span class="znacznik ${d.trade > d.limit ? 'zle' : d.trade === d.limit ? 'uwaga' : 'ok'}">trade'y dziś: ${d.trade} / ${d.limit} (zasada 7)</span>
        <span class="znacznik ${d.netto < 0 ? 'zle' : 'info'}">wynik dziś ${usd(d.netto)}</span>
        ${d.otwarte.length ? `<span class="znacznik info">otwarte: ${d.otwarte.map(t => E_(t.strona.toUpperCase() + ' ' + t.rynek)).join(', ')}</span>` : ''}
        ${przerwy || '<span class="znacznik ok">bez wymaganej przerwy (zasady 5–6)</span>'}
      </div>${uklad}
      <p class="male" style="margin-top:8px"><a href="dziennik.html" data-centrum="dziennik">Otwórz dziennik tradera →</a></p>`;
  }

  document.addEventListener('asystent-odswiezony', rysuj);
  wczytaj();
  setInterval(() => { if (!document.hidden) wczytaj(); }, 5 * 60000);
})();
