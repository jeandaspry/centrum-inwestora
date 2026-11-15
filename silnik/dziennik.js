/* Dziennik tradera – strona (ten sam kod na komputerze i w telefonie).
 * Dane: GET /api/dziennik → { trade (eksport z panelu), wpisy (Twoje opisy), chrome (dziennik Claude w Chrome) },
 *       POST /api/dziennik/wpisy ← wszystkie wpisy (najpierw scalone z najnowszą wersją, np. z telefonu).
 * „Wypełnij za mnie”: SL/TP i kapitał z Hyperliquid (publiczne API po adresie), ruch ceny ze świec 15m, Asystent w chwili
 * wejścia (historia Binance 1h), setupy i etykiety z dziennika Claude w Chrome. Wypełnia tylko puste pola. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DZ = window.DZ, LAB = window.LAB;
  const fin = (x) => typeof x === 'number' && isFinite(x);
  const N = (x) => (x === null || x === undefined || x === '' ? NaN : Number(String(x).replace(',', '.').replace(/\s/g, '')));
  const E_ = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = (d) => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = (x, znak = true) => (fin(x) ? (znak ? (x >= 0 ? '+' : '−') : x < 0 ? '−' : '') + nf(2).format(Math.abs(x)) + ' $' : '–');
  const cena = (x) => (fin(x) ? new Intl.NumberFormat('pl-PL', { maximumFractionDigits: x < 10 ? 4 : x < 1000 ? 2 : 0 }).format(x) : '–');
  const proc = (x, d = 0) => (fin(x) ? nf(d).format(x * 100) + '%' : '–');
  const kl = (x) => (fin(x) ? (x > 0 ? 'plus' : x < 0 ? 'minus' : '') : '');
  const kiedy = (t) => new Date(t).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const czas = (min) => (!fin(min) ? '–' : min < 60 ? Math.round(min) + ' min' : min < 48 * 60 ? nf(1).format(min / 60) + ' h' : nf(1).format(min / 1440) + ' dni');
  const pam = { czytaj(k, d) { try { const v = localStorage.getItem('dziennik-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    pisz(k, v) { try { localStorage.setItem('dziennik-' + k, JSON.stringify(v)); } catch (e) { } } };

  const S = { E: null, C: null, W: DZ.pusteWpisy(), lista: [], wn: null, filtr: pam.czytaj('filtr', 'wszystkie'), swiece: new Map(), zajety: false };

  // ------------------------------------------------------------------ dane
  function stan(rodzaj, tekst) { $('stan').innerHTML = `<span class="kropka ${rodzaj}"></span> ${E_(tekst)}`; }
  async function pobierzDziennik() {
    const r = await fetch('/api/dziennik', { cache: 'no-store' });
    if (!r.ok) { let t = ''; try { t = (await r.text()).slice(0, 200); } catch (e) { } throw new Error(t || 'serwer nie podał dziennika (' + r.status + ')'); }
    return r.json();
  }
  async function wczytaj() {
    stan('laduje', 'wczytuję…');
    const d = await pobierzDziennik();
    S.E = d.trade; S.C = d.chrome; S.W = DZ.scalWpisy(d.wpisy, DZ.pusteWpisy());
    przelicz();
    const ile = S.lista.filter(t => !t.otwarta).length;
    stan(S.E ? 'zywe' : 'blad', S.E ? `${ile} trade'ów · panel ${new Date(S.E.czas).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : 'brak eksportu z panelu');
  }
  function przelicz() { S.lista = DZ.zbuduj(S.E, S.C, S.W); S.wn = DZ.wnioski(S.lista); rysuj(); }
  async function zapisz() {
    let d = null; try { d = await pobierzDziennik(); } catch (e) { /* zapis i tak spróbujemy */ }
    S.W = DZ.scalWpisy(d && d.wpisy, S.W);
    const r = await fetch('/api/dziennik/wpisy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.W) });
    if (!r.ok) throw new Error('zapis wpisów: ' + r.status + ' ' + (await r.text()).slice(0, 80));
  }
  const ustawWpis = (id, w) => { w.zmieniono = Date.now(); S.W.wpisy[id] = w; };

  // nazwa monety na Hyperliquid (Jupiter zapisuje np. „BTC (Jupiter)”)
  const monetaHL = (r) => String(r || '').split(/[\s(]/)[0].toUpperCase();

  // ------------------------------------------------------------------ Hyperliquid (publiczne API po adresie)
  const hl = async (body) => { const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error('Hyperliquid ' + r.status); return r.json(); };
  async function swieceHL(coin, od, doo, iw = '15m', ms = 900000) {
    const wyn = [];
    for (let a = od; a < doo; a += 4900 * ms) {
      const x = await hl({ type: 'candleSnapshot', req: { coin, interval: iw, startTime: a, endTime: Math.min(doo, a + 4900 * ms) } });
      for (const k of x || []) wyn.push({ t: +k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v });
    }
    const u = new Map(); for (const k of wyn) u.set(k.t, k);
    return [...u.values()].sort((a, b) => a.t - b.t);
  }
  function opcjeAsystenta() {
    const u = (() => { try { return JSON.parse(localStorage.getItem('asystent2-ustawienia') || 'null'); } catch (e) { return null; } })() || {};
    const AS = LAB && LAB.AS;
    return { k: +u.k || 2, m: u.m !== undefined && u.m !== '' ? Math.max(0, +u.m) : 1, H: Math.round(+u.H || 30), minN: Math.round(+u.minN || 20), koszt: (+u.koszt || 0.055) / 100,
      cechy: Array.isArray(u.cechy) && u.cechy.length ? u.cechy : (AS ? AS.CECHY : []) };
  }
  async function historia1h() {
    let r = await fetch('../dane/binance-BTCUSDT-1h.json');
    if (!r.ok) {
      postep(0.3, 'Pobieram historię BTC 1h z Binance (raz, ok. 1–2 min)…');
      const p = await fetch('/api/pobierz?zrodlo=binance&interwal=1h&symbol=BTCUSDT', { method: 'POST' });
      if (!p.ok) throw new Error('nie udało się pobrać historii 1h');
      r = await fetch('../dane/binance-BTCUSDT-1h.json');
      if (!r.ok) throw new Error('brak historii 1h');
    }
    return r.json();
  }

  // policz dane automatyczne dla podanych trade'ów (zapisuje je w S.W.auto)
  async function policzAuto(trade) {
    const uwagi = [];
    const adres = S.E && S.E.adresy && S.E.adresy.hyperliquid && S.E.adresy.hyperliquid[0];
    let zlecenia = null, kapital = null, zdarzenia = null;
    if (adres && trade.some(t => t.gielda === 'Hyperliquid')) {
      postep(0.05, 'Pobieram Twoje zlecenia (SL/TP) i kapitał konta z Hyperliquid…');
      try { zlecenia = await hl({ type: 'historicalOrders', user: adres }); } catch (e) { uwagi.push('zlecenia HL: ' + e.message); }
      // kapitał przy wejściu = przelewy na konto i z konta + wyniki zamkniętych trade'ów Hyperliquid (DZ.kapitalWChwili)
      try { kapital = DZ.przelewyHL(await hl({ type: 'userNonFundingLedgerUpdates', user: adres, startTime: 0 }), adres); } catch (e) { uwagi.push('przelewy HL: ' + e.message); }
      zdarzenia = S.lista.filter(t => t.gielda === 'Hyperliquid');
    }
    // świece 15m do ruchu ceny (MFE/MAE) – tylko monety notowane na Hyperliquid
    const sw = new Map();
    const monety = [...new Set(trade.filter(t => !String(t.rynek).startsWith('KF:')).map(t => t.rynek))];
    for (const c of monety) {
      const tt = trade.filter(t => t.rynek === c);
      const c2 = monetaHL(c);
      const od = Math.max(Math.min(...tt.map(t => t.otwarcie)) - 3600000, Date.now() - 50 * 86400000);   // HL trzyma ok. 52 dni świec 15m
      const doo = Math.min(Date.now(), Math.max(...tt.map(t => (t.zamkniecie || Date.now()))) + 4 * 3600000);
      postep(0.15, `Pobieram świece 15m ${c}…`);
      try { if (doo > od) sw.set(c, await swieceHL(c2, od, doo)); } catch (e) { uwagi.push('świece ' + c + ': ' + e.message); }
    }
    // Asystent w chwili wejścia (BTC, także BTC z Jupitera)
    let as = {};
    const btc = trade.filter(t => monetaHL(t.rynek) === 'BTC');
    if (btc.length && LAB && LAB.AS) {
      try {
        postep(0.3, 'Wczytuję historię BTC 1h dla Asystenta…');
        const d = await historia1h();
        const s = LAB.zSwiec(d.swiece), ms = LAB.MS['1h'];
        try { const rf = await fetch('../dane/funding/binance-BTCUSDT.json'); if (rf.ok) { const df = await rf.json(); s.F = LAB.fundingSwiec(s, df.stawki, ms, 0.0001 / 8).F; } } catch (e) { /* bez fundingu */ }
        postep(0.55, 'Liczę, co Asystent pokazywał przy każdym wejściu…');
        await new Promise(r => setTimeout(r, 30));
        const wej = btc.map(t => { const kap = t.gielda === 'Hyperliquid' ? DZ.kapitalWChwili(kapital, zdarzenia, t.otwarcie) : null; return { id: t.id, otwarcie: t.otwarcie, strona: t.strona, dzwignia: kap && t.wartoscMax ? t.wartoscMax / kap : t.dzwignia }; });
        as = DZ.asystentDlaTrade(wej, s, ms, opcjeAsystenta());
      } catch (e) { uwagi.push('Asystent: ' + e.message); }
    }
    for (const t of trade) {
      S.W.auto[t.id] = { policzono: Date.now(), zlecenia: DZ.zleceniaTrade(t, zlecenia), kapital: t.gielda === 'Hyperliquid' ? DZ.kapitalWChwili(kapital, zdarzenia, t.otwarcie) : null,
        ruch: DZ.mfeMae(t, sw.get(t.rynek), 900000), asystent: as[t.id] || (S.W.auto[t.id] && S.W.auto[t.id].asystent) || null };
    }
    return uwagi;
  }
  function postep(u, tekst) {
    const p = $('postep'); if (u === null) { p.classList.add('ukryte'); return; }
    p.classList.remove('ukryte'); p.querySelector('i').style.width = Math.round(u * 100) + '%'; p.querySelector('span').textContent = tekst;
  }

  async function wypelnijWszystko(odNowa) {
    if (S.zajety) return; S.zajety = true; $('wypelnijWszystko').disabled = true; $('odswiezAuto').disabled = true;
    try {
      const doLiczenia = S.lista.filter(t => !t.reczny && !t.otwarta && (odNowa === true || !t.auto.policzono));
      let uwagi = [];
      if (doLiczenia.length) uwagi = await policzAuto(doLiczenia);
      przelicz();
      postep(0.85, 'Wypełniam puste pola…');
      let ile = 0;
      for (const t of S.lista) {
        if (t.otwarta) continue;
        const { wpis, pola } = DZ.wypelnij(S.W.wpisy[t.id], DZ.propozycja(t), odNowa === true);
        if (pola.length) { ustawWpis(t.id, wpis); ile++; }
      }
      await zapisz();
      przelicz();
      postep(1, `Gotowe: uzupełniono ${ile} trade'ów${uwagi.length ? ' · uwagi: ' + uwagi.join('; ') : ''}.`);
      setTimeout(() => postep(null), uwagi.length ? 15000 : 6000);
    } catch (e) { postep(1, 'Błąd: ' + e.message); }
    finally { S.zajety = false; $('wypelnijWszystko').disabled = false; $('odswiezAuto').disabled = false; }
  }

  // ------------------------------------------------------------------ widok: zakładki
  function zakladka(z) {
    if (!['trade', 'wnioski', 'zasady', 'setupy'].includes(z)) z = 'trade';
    for (const x of ['trade', 'wnioski', 'zasady', 'setupy']) $('z-' + x).classList.toggle('ukryte', x !== z);
    document.querySelectorAll('#zakladki a').forEach(a => a.classList.toggle('wl', a.dataset.z === z));
    S.zakl = z; if (location.hash !== '#' + z) history.replaceState(null, '', '#' + z);
    if (z === 'wnioski') rysujKrzywa();
  }
  $('zakladki').addEventListener('click', (e) => { const a = e.target.closest('[data-z]'); if (!a) return; e.preventDefault(); zakladka(a.dataset.z); });

  function rysuj() {
    rysujKafle(); rysujDzis(); rysujPlany(); rysujListe(); rysujWnioski(); rysujZasady(); rysujSetupy();
    if (S.zakl === 'wnioski') rysujKrzywa();
  }
  function rysujKafle() {
    const o = S.wn.ogol, z = S.lista.filter(t => !t.otwarta), czyste = S.wn.czyste;
    const opis = z.filter(t => t.uzupelniony).length;
    $('kafle').innerHTML = [
      ['Trade\'y', String(o.n), `${proc(o.skut)} na plus`],
      ['Wynik netto', `<span class="${kl(o.netto)}">${usd(o.netto)}</span>`, `średnio ${usd(o.srednio)}`],
      ['Zysk / strata', `${usd(o.srW, false)} / ${usd(o.srP, false)}`, o.prog ? `potrzebujesz ${proc(o.prog)} trafień` : '–'],
      ['Opłaty', usd(-o.oplaty), o.netto + o.oplaty > 0 && o.netto < 0 ? `bez opłat byłoby ${usd(o.netto + o.oplaty)}` : S.wn.oplatyUdzial ? `${proc(S.wn.oplatyUdzial)} straty netto` : ''],
      ['Zgodne z zasadami 4–7', `${S.wn.kiedy.n} <span class="b-male">z ${o.n}</span>`, `${usd(S.wn.kiedy.netto)} · wszystkie 9: ${czyste.n}`],
      ['Opisane', `${opis}/${z.length}`, opis < z.length ? 'kliknij „Wypełnij za mnie”' : 'wszystkie']
    ].map(([et, w, p]) => `<div class="kafel"><div class="et">${et}</div><div class="wart">${w}</div><div class="pod">${p}</div></div>`).join('');
  }
  function rysujDzis() {
    const d = DZ.dzis(S.lista);
    const h = (t) => new Date(t).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
    const przerwy = d.przerwy.map(p => `<span class="znacznik uwaga">przerwa do ${h(p.do)} (zasada ${p.zasada}: ${E_(p.powod)})</span>`).join(' ');
    $('kartaDzis').innerHTML = `<h2>Dziś <span class="podtytul">zasady na bieżąco</span></h2>
      <div class="flagi" style="gap:8px">
        <span class="znacznik ${d.trade > d.limit ? 'zle' : d.trade === d.limit ? 'uwaga' : 'ok'}">trade'y dziś: ${d.trade} / ${d.limit}</span>
        <span class="znacznik ${d.netto < 0 ? 'zle' : 'info'}">wynik dziś ${usd(d.netto)}</span>
        ${d.otwarte.length ? `<span class="znacznik info">otwarte: ${d.otwarte.map(t => t.strona.toUpperCase() + ' ' + E_(t.rynek)).join(', ')}</span>` : ''}
        ${przerwy || '<span class="znacznik ok">bez wymaganej przerwy</span>'}
      </div>`;
  }
  function rysujPlany() {
    const pl = S.lista.plany || [];
    $('plany').innerHTML = pl.length ? `<p class="male" style="margin:0 0 6px">Plany czekające na wejście (dopasują się same do trade'u z giełdy w ciągu 12 h):</p>` + pl.map(p =>
      `<button class="wiersz plan-wiersz" data-plan="${E_(p.id)}"><span class="data c-data"><b>${kiedy(p.czas)}</b><span>plan</span></span>
        <span class="c-kier"><span class="kier ${p.strona}">${p.strona.toUpperCase()}</span> <small>${E_(p.rynek)}</small></span>
        <span class="ceny c-ceny">${cena(N(p.wejscie))}<br><span>SL ${cena(N(p.sl))} · TP ${cena(N(p.tp))}</span></span>
        <span class="c-czas"></span><span class="wyn c-wyn"></span><span class="c-setup">${E_(p.setup || '')}</span><span class="flagi c-flagi"><span class="flaga">confidence ${fin(N(p.confidence)) ? N(p.confidence) : '–'}</span></span></button>`).join('') : '';
  }
  const FILTRY = {
    wszystkie: () => true, puste: (t) => !t.uzupelniony && !t.otwarta, setup: (t) => !!t.setup, bezSetupu: (t) => !t.setup,
    zasady: (t) => Object.values(t.zasady).some(z => z.ok === false), revenge: (t) => t.poStracie || t.zmianaKierunku
  };
  function flagiTrade(t) {
    const f = [];
    if (t.otwarta) f.push(['info', 'otwarty']);
    if (t.likwidacja) f.push(['zle', 'likwidacja']);
    if (t.poStracie) f.push(['zle', 'po stracie']);
    if (t.zmianaKierunku) f.push(['zle', 'zmiana kier.']);
    if (t.poDuzymZysku) f.push(['uwaga', 'po dużym zysku']);
    if (t.nrWDniu > 2) f.push(['uwaga', t.nrWDniu + '. dnia']);
    const zl = Object.values(t.zasady).filter(z => z.ok === false).length;
    f.push([zl ? 'zle' : 'ok', zl ? 'zasady ✗' + zl : 'zasady ✓']);
    return f.map(([k, x]) => `<span class="flaga ${k}">${x}</span>`).join('');
  }
  function rysujListe() {
    const f = FILTRY[S.filtr] || FILTRY.wszystkie;
    document.querySelectorAll('#filtry button').forEach(b => b.classList.toggle('wl', b.dataset.f === S.filtr));
    const l = S.lista.filter(f).slice().reverse();
    $('listaPod').textContent = `${l.length} z ${S.lista.length}`;
    const nag = `<div class="wiersz naglowek"><span>Wejście</span><span>Kierunek</span><span>Ceny · SL/TP</span><span>Czas</span><span style="text-align:right">Wynik</span><span>Setup · wpis</span><span>Flagi</span></div>`;
    $('lista').innerHTML = !S.E ? '<div class="ramka uwaga">Brak eksportu trade\'ów z panelu. Otwórz panel inwestora (np. w Centrum) – zapisze go w ciągu minuty.</div>'
      : nag + l.map(t => {
        const ws = t.uzupelniony ? (t.wpis.autoPola && t.wpis.autoPola.length && !t.wpis.recznieOpisany ? ['auto', '◐ wypełniony za Ciebie'] : ['pelny', '● opisany']) : ['', '○ pusty'];
        return `<button class="wiersz" data-id="${E_(t.id)}">
          <span class="data c-data"><b>${kiedy(t.otwarcie)}</b><span>${E_(t.gielda)}</span></span>
          <span class="c-kier"><span class="kier ${t.strona}">${t.strona.toUpperCase()}</span> <small>${E_(t.rynek)}</small></span>
          <span class="ceny c-ceny">${cena(t.wejscie)} → ${cena(t.wyjscie)}<br><span>SL ${cena(t.sl)} · TP ${cena(t.tp)}</span></span>
          <span class="c-czas">${czas(t.czasMin)}</span>
          <span class="wyn c-wyn ${kl(t.netto)}">${t.otwarta ? 'otwarty' : usd(t.netto)}<small>${fin(t.R) ? 'R ' + (t.R >= 0 ? '+' : '') + nf(2).format(t.R) : t.dzwignia ? '~' + Math.round(t.dzwignia) + '× konta' : ''}</small></span>
          <span class="c-setup">${t.setup ? '<b>' + E_(t.setup) + '</b>' : '<span class="b-male">bez setupu</span>'}<br><span class="wpis-stan ${ws[0]}">${ws[1]}</span></span>
          <span class="flagi c-flagi">${flagiTrade(t)}</span></button>`;
      }).join('');
  }
  $('filtry').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; S.filtr = b.dataset.f; pam.pisz('filtr', S.filtr); rysujListe(); });
  $('lista').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) otworzTrade(b.dataset.id); });
  $('plany').addEventListener('click', (e) => { const b = e.target.closest('[data-plan]'); if (b) otworzPlan(b.dataset.plan); });

  // ------------------------------------------------------------------ okno trade'u
  const okno = { pokaz(tytul, html) { $('oknoTytul').innerHTML = tytul; $('oknoTresc').innerHTML = html; $('okno').classList.remove('ukryte'); document.body.style.overflow = 'hidden'; },
    zamknij() { $('okno').classList.add('ukryte'); document.body.style.overflow = ''; } };
  $('oknoZamknij').addEventListener('click', () => okno.zamknij());
  $('okno').addEventListener('click', (e) => { if (e.target === $('okno')) okno.zamknij(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('okno').classList.contains('ukryte')) okno.zamknij(); });

  const chipy = (nazwa, opcje, wybrane) => `<div class="chipy" data-chipy="${nazwa}">${opcje.map(o => `<button type="button" class="${(wybrane || []).includes(o) ? 'wl' : ''}" data-v="${E_(o)}">${E_(o)}</button>`).join('')}</div>`;
  const autoZn = (w, pole) => (w.autoPola || []).includes(pole) ? ' <span class="auto-zn">auto</span>' : '';
  function formularz(w, t) {
    const setupy = (S.C && S.C.setupy) || [];
    return `<div class="pola">
      <label class="pole">Setup${autoZn(w, 'setup')}<select id="f-setup"><option value="">bez setupu</option>${setupy.map(s => `<option value="${E_(s.id)}" ${w.setup === s.id ? 'selected' : ''}>${E_(s.id)} ${E_(s.data.slice(5))} ${E_(s.kierunek)} ${E_(s.typ)} (${cena(s.wejscie)})${t && t.setupAuto === s.id ? ' ← pasuje' : ''}</option>`).join('')}</select></label>
      <label class="pole">Etykieta${autoZn(w, 'etykieta')}<select id="f-etykieta">${['', 'z analizy', 'bez analizy', 'prawdopodobny revenge', 'seria po dużym zysku', 'inne'].map(o => `<option ${w.etykieta === o ? 'selected' : ''} value="${E_(o)}">${o || '–'}</option>`).join('')}</select></label>
      <label class="pole">Ocena procesu${autoZn(w, 'ocena')}<select id="f-ocena">${['', ...DZ.OCENY].map(o => `<option ${w.ocena === o ? 'selected' : ''} value="${o}">${o || '–'}${o === 'A' ? ' – wszystko wg planu' : o === 'D' ? ' – złamane zasady' : ''}</option>`).join('')}</select></label>
      <label class="pole">Plan wejścia${autoZn(w, 'planWejscie')}<input id="f-planWejscie" inputmode="decimal" value="${fin(N(w.planWejscie)) ? N(w.planWejscie) : ''}"></label>
      <label class="pole">Stop loss${autoZn(w, 'sl')}<input id="f-sl" inputmode="decimal" value="${fin(N(w.sl)) ? N(w.sl) : ''}"></label>
      <label class="pole">Take profit${autoZn(w, 'tp')}<input id="f-tp" inputmode="decimal" value="${fin(N(w.tp)) ? N(w.tp) : ''}"></label>
      <label class="pole szer">Powód wejścia${autoZn(w, 'powod')}<textarea id="f-powod" placeholder="Dlaczego tu? Jaki sygnał, poziom, kontekst?">${E_(w.powod || '')}</textarea></label>
      <div class="pole szer">Confidence – jak bardzo byłeś pewny (0–100)${autoZn(w, 'confidence')}<div class="suwak"><input type="range" id="f-confR" min="0" max="100" step="5" value="${fin(N(w.confidence)) ? N(w.confidence) : 50}"><input id="f-conf" style="width:80px" inputmode="numeric" value="${fin(N(w.confidence)) ? N(w.confidence) : ''}" placeholder="–"></div></div>
      <div class="pole szer">Emocje${chipy('emocje', DZ.EMOCJE, w.emocje)}</div>
      <div class="pole szer">Błędy${autoZn(w, 'bledy')}${chipy('bledy', DZ.BLEDY, w.bledy)}</div>
      <label class="pole szer">Notatka / lekcja${autoZn(w, 'notatka')}<textarea id="f-notatka" placeholder="Co zrobiłbyś inaczej?">${E_(w.notatka || '')}</textarea></label>
    </div>`;
  }
  function podepnijFormularz() {
    document.querySelectorAll('#oknoTresc [data-chipy] button').forEach(b => b.addEventListener('click', () => b.classList.toggle('wl')));
    const r = $('f-confR'), n = $('f-conf');
    if (r && n) { r.addEventListener('input', () => { n.value = r.value; }); n.addEventListener('input', () => { if (fin(N(n.value))) r.value = N(n.value); }); }
  }
  function czytajFormularz(stary) {
    const w = Object.assign({}, stary || {});
    const pole = (id) => { const e = $('f-' + id); return e ? e.value.trim() : undefined; };
    const liczba = (id) => { const v = N(pole(id)); return fin(v) ? v : null; };
    w.setup = pole('setup') || ''; w.etykieta = pole('etykieta') || ''; w.ocena = pole('ocena') || '';
    w.planWejscie = liczba('planWejscie'); w.sl = liczba('sl'); w.tp = liczba('tp');
    w.powod = pole('powod') || ''; w.notatka = pole('notatka') || '';
    const c = liczba('conf'); w.confidence = c === null ? null : Math.max(0, Math.min(100, c));
    for (const g of ['emocje', 'bledy']) w[g] = [...document.querySelectorAll(`#oknoTresc [data-chipy="${g}"] button.wl`)].map(b => b.dataset.v);
    // pola zmienione ręcznie przestają być „auto”
    if (w.autoPola) w.autoPola = w.autoPola.filter(p => JSON.stringify(w[p]) === JSON.stringify((stary || {})[p]));
    w.recznieOpisany = true;
    return w;
  }

  function otworzTrade(id) {
    const t = S.lista.find(x => x.id === id); if (!t) return;
    const w = Object.assign({}, t.wpis);
    const a = t.auto.asystent, z = t.auto.zlecenia, r = t.auto.ruch;
    const wart = (et, w2) => `<div><div class="et">${et}</div><div class="w">${w2}</div></div>`;
    const zasadyHtml = DZ.ZASADY.map(zz => { const x = t.zasady[zz.kod]; return `<div><span class="${x.ok === true ? 't' : x.ok === false ? 'f' : 'n'}">${x.ok === true ? '✓' : x.ok === false ? '✗' : '?'}</span><span><b>${zz.kod}.</b> ${E_(zz.krotko)} <span class="b-male">– ${E_(x.opis)}</span></span></div>`; }).join('');
    const tytul = `<span class="kier ${t.strona}">${t.strona.toUpperCase()}</span> ${E_(t.rynek)} · ${kiedy(t.otwarcie)} · <span class="${kl(t.netto)}">${t.otwarta ? 'otwarty' : usd(t.netto)}</span>${fin(t.R) ? ` <span class="znacznik ${t.R >= 0 ? 'ok' : 'zle'}">R ${nf(2).format(t.R)}</span>` : ''}`;
    okno.pokaz(tytul, `
      <div class="dwie-kol">
        <div class="blok"><h3>Wykres 15m <span class="b-male">wejście, wyjście, SL/TP, wypełnienia</span></h3><canvas class="wykres" id="wykres"></canvas><p class="b-male" id="wykresOpis" style="margin:6px 0 0"></p></div>
        <div class="blok"><h3>Z giełdy (${E_(t.gielda)})</h3><div class="siatka-wart">
          ${wart('Wejście (średnio)', cena(t.wejscie))}${wart('Wyjście (średnio)', cena(t.wyjscie))}
          ${wart('Największa pozycja', t.maxWielkosc ? nf(5).format(t.maxWielkosc) + ' ' + E_(t.rynek) : t.ilosc ? nf(5).format(t.ilosc) : '–')}${wart('Wartość pozycji', usd(t.wartoscMax, false) + (t.wartosc && t.wartoscMax && t.wartosc > t.wartoscMax * 1.05 ? ` <span class="b-male">(dokupienia razem ${usd(t.wartosc, false)})</span>` : ''))}
          ${wart('Kapitał konta', t.kapital ? usd(t.kapital, false) : '–')}${wart('Dźwignia vs konto', t.dzwignia ? '~' + nf(1).format(t.dzwignia) + '×' : '–')}
          ${wart('Wynik brutto', usd(t.pnl))}${wart('Opłaty', usd(-t.oplaty) + (t.builder > 0 ? ` <span class="b-male">(Phantom ${usd(-t.builder)})</span>` : ''))}
          ${wart('Funding', usd(t.funding))}${wart('Netto', `<span class="${kl(t.netto)}">${usd(t.netto)}</span>`)}
          ${wart('Czas trzymania', czas(t.czasMin))}${wart('Wejście', t.makerWejscie === null ? '–' : t.makerWejscie ? 'maker (Limit)' : 'taker')}
          ${wart('SL z giełdy', z && z.slPierwszy ? cena(z.slPierwszy) + (z.zmianySl ? ` (zmiany: ${z.zmianySl})` : '') : z ? 'nie było' : '–')}${wart('TP z giełdy', z && z.tpPierwszy ? cena(z.tpPierwszy) + (z.zmianyTp ? ` (zmiany: ${z.zmianyTp})` : '') : z ? 'nie było' : '–')}
          ${wart('Najlepszy ruch (MFE)', r ? nf(2).format(r.mfe) + '%' : '–')}${wart('Najgorszy ruch (MAE)', r ? nf(2).format(r.mae) + '%' : '–')}
          ${wart('Po wyjściu (4 h)', r ? '+' + nf(2).format(r.poWyjsciu) + '%' : '–')}${wart('Ryzyko przy SL', t.ryzyko ? usd(-t.ryzyko) + (t.ryzykoProc ? ` (${nf(1).format(t.ryzykoProc)}% konta)` : '') : '–')}
        </div></div>
      </div>
      <div class="dwie-kol">
        <div class="blok"><h3>Asystent w chwili wejścia</h3>${a ? `<p class="male"><span class="decyzja ${a.decyzja === 'LONG' ? 'long' : a.decyzja === 'SHORT' ? 'short' : 'czekaj'}" style="font-size:1rem;display:inline-block;margin-right:8px">${a.decyzja}</span> przy ${a.L}× · świeca 1h ${kiedy(a.swieca)}</p>
          <p class="male">${E_(DZ.powodZAsystenta(a, t.strona))}</p>` : '<p class="male">Jeszcze nie policzone – kliknij „Wypełnij za mnie”.</p>'}
          ${t.chrome || t.notatkaChrome || t.setupDane ? `<h3>Dziennik Claude w Chrome</h3><p class="male">${t.chrome ? `${E_(t.chrome.id)} · ${E_(t.chrome.etykieta)} · ${E_(t.chrome.trend)}${t.chrome.notatka ? ' · ' + E_(t.chrome.notatka) : ''}<br>` : ''}${t.setupDane ? `Setup ${E_(t.setupDane.id)}: ${E_(t.setupDane.typ)}, plan ${cena(t.setupDane.wejscie)} / SL ${cena(t.setupDane.sl)} / TP ${cena(t.setupDane.tp)} (R:R ${t.setupDane.rr}), ${E_(t.setupDane.status)}${fin(t.setupDane.wynik_r) ? ' ' + nf(2).format(t.setupDane.wynik_r) + 'R' : ''}${t.setupAuto === t.setupDane.id && !(S.W.wpisy[id] || {}).setup ? ' <span class="auto-zn">dopasowany automatycznie</span>' : ''}<br>` : ''}${t.notatkaChrome ? E_(t.notatkaChrome.notatka) : ''}</p>` : ''}
          ${t.plan ? `<h3>Plan sprzed wejścia</h3><p class="male">${kiedy(t.plan.czas)} · wejście ${cena(N(t.plan.wejscie))}, SL ${cena(N(t.plan.sl))}, TP ${cena(N(t.plan.tp))}${t.plan.powod ? ' · ' + E_(t.plan.powod) : ''}</p>` : ''}
        </div>
        <div class="blok"><h3>Zasady metody v3</h3><div class="lista-zasad">${zasadyHtml}</div></div>
      </div>
      <div class="blok"><h3>Twój opis</h3>${formularz(w, t)}
        <div class="przyciski"><button class="glowny" id="f-zapisz">Zapisz</button><button id="f-auto" title="Wypełnia tylko puste pola">Wypełnij za mnie</button>${t.reczny ? '<button id="f-usun">Usuń ten trade</button>' : ''}<span class="b-male" id="f-info"></span></div>
      </div>`);
    podepnijFormularz();
    $('f-zapisz').addEventListener('click', async () => {
      const nowy = czytajFormularz(S.W.wpisy[id] || w);
      if (t.reczny) nowy.reczny = (S.W.wpisy[id] || {}).reczny;
      ustawWpis(id, nowy);
      $('f-info').textContent = 'Zapisuję…';
      try { await zapisz(); przelicz(); okno.zamknij(); } catch (e) { $('f-info').textContent = e.message; }
    });
    $('f-auto').addEventListener('click', async () => {
      $('f-info').textContent = 'Liczę…';
      try {
        if (!t.reczny && !t.auto.policzono) { await policzAuto([t]); przelicz(); postep(null); }
        const tt = S.lista.find(x => x.id === id);
        const { wpis, pola } = DZ.wypelnij(czytajFormularz(S.W.wpisy[id] || w), DZ.propozycja(tt));
        wpis.recznieOpisany = false;
        ustawWpis(id, wpis); await zapisz(); przelicz(); otworzTrade(id);
        $('f-info').textContent = pola.length ? 'Wypełniono: ' + pola.join(', ') + '. Sprawdź i popraw.' : 'Nie było pustych pól do wypełnienia.';
      } catch (e) { $('f-info').textContent = e.message; }
    });
    if ($('f-usun')) $('f-usun').addEventListener('click', async () => {
      if (!confirm('Usunąć ten ręcznie dodany trade z dziennika?')) return;
      ustawWpis(id, Object.assign({}, S.W.wpisy[id], { usuniety: true })); await zapisz(); przelicz(); okno.zamknij();
    });
    rysujWykresTrade(t);
  }

  // wykres świec 15m z Hyperliquid wokół trade'u
  async function rysujWykresTrade(t) {
    const cv = $('wykres'); if (!cv) return;
    const opis = $('wykresOpis');
    if (String(t.rynek).startsWith('KF:') || !t.otwarcie) { opis.textContent = 'Brak świec dla tego rynku.'; return; }
    const kon = t.zamkniecie || Date.now();
    const zakres = Math.max(kon - t.otwarcie, 2 * 3600000);
    const od = t.otwarcie - Math.max(3 * 3600000, zakres * 0.6), doo = Math.min(Date.now(), kon + Math.max(2 * 3600000, zakres * 0.4));
    let sw = S.swiece.get(t.id);
    if (!sw) {
      opis.textContent = 'Pobieram świece…';
      try { sw = await swieceHL(monetaHL(t.rynek), od, doo, zakres > 3 * 86400000 ? '1h' : '15m', zakres > 3 * 86400000 ? 3600000 : 900000); S.swiece.set(t.id, sw); }
      catch (e) { opis.textContent = 'Nie mogę pobrać świec: ' + e.message; return; }
    }
    if (!sw.length) { opis.textContent = 'Hyperliquid nie ma już świec z tego okresu (trzyma ok. 52 dni świec 15m).'; return; }
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const ceny = [t.wejscie, t.wyjscie, t.sl, t.tp, N(t.wpis.planWejscie)].filter(fin);
    let lo = Math.min(...sw.map(x => x.l), ...ceny), hi = Math.max(...sw.map(x => x.h), ...ceny);
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const L = 8, P = 58, G = 10, D = 18;
    const x = (tt) => L + (tt - sw[0].t) / (sw[sw.length - 1].t - sw[0].t || 1) * (W - L - P);
    const y = (v) => G + (hi - v) / (hi - lo) * (H - G - D);
    const sz = Math.max(1, (W - L - P) / sw.length * 0.7);
    c.fillStyle = 'rgba(67,240,198,.08)'; c.fillRect(x(t.otwarcie), G, Math.max(2, x(kon) - x(t.otwarcie)), H - G - D);
    for (const k of sw) {
      const up = k.c >= k.o; c.strokeStyle = c.fillStyle = up ? 'rgba(67,240,198,.85)' : 'rgba(255,120,120,.85)';
      c.beginPath(); c.moveTo(x(k.t), y(k.h)); c.lineTo(x(k.t), y(k.l)); c.stroke();
      c.fillRect(x(k.t) - sz / 2, Math.min(y(k.o), y(k.c)), sz, Math.max(1, Math.abs(y(k.o) - y(k.c))));
    }
    const linia = (v, kolor, tekst, przer) => { if (!fin(v)) return; c.save(); c.strokeStyle = kolor; c.setLineDash(przer ? [5, 4] : []); c.beginPath(); c.moveTo(L, y(v)); c.lineTo(W - P, y(v)); c.stroke(); c.restore();
      c.fillStyle = kolor; c.font = '10px JetBrains Mono, monospace'; c.fillText(tekst + ' ' + cena(v), W - P + 3, y(v) + 3); };
    linia(t.wejscie, '#ffffff', 'wej', false); if (t.wyjscie) linia(t.wyjscie, '#ffd166', 'wyj', false);
    linia(t.sl, '#ff6b6b', 'SL', true); linia(t.tp, '#43f0c6', 'TP', true); linia(N(t.wpis.planWejscie), '#7cc8ff', 'plan', true);
    for (const f of t.wypelnienia || []) {
      const kup = f.side === 'B'; c.fillStyle = kup ? '#43f0c6' : '#ff8a8a';
      const xx = x(f.t), yy = y(f.px); c.beginPath();
      if (kup) { c.moveTo(xx, yy + 2); c.lineTo(xx - 5, yy + 10); c.lineTo(xx + 5, yy + 10); } else { c.moveTo(xx, yy - 2); c.lineTo(xx - 5, yy - 10); c.lineTo(xx + 5, yy - 10); }
      c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,.45)'; c.font = '10px JetBrains Mono, monospace';
    c.fillText(new Date(sw[0].t).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), L, H - 4);
    opis.textContent = `${sw.length} świec z Hyperliquid · trójkąty = Twoje wypełnienia (zielony kupno, czerwony sprzedaż) · jasne pole = czas trade'u`;
  }

  // ------------------------------------------------------------------ plan przed wejściem / trade ręczny
  const teraz = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  function otworzPlan(idPlanu) {
    const st = idPlanu ? (S.W.wpisy[idPlanu] || {}) : {}, p = st.plan || {};
    const tid = idPlanu || 'P|' + Date.now();
    okno.pokaz(idPlanu ? 'Plan przed wejściem' : 'Nowy plan przed wejściem', `
      <p class="male">Wpisz plan, zanim wejdziesz. Gdy w ciągu 12 h pojawi się z giełdy trade w tym kierunku (wejście ≤ 0,5% od planu), plan sam się do niego przypnie.</p>
      <div class="blok"><div class="pola">
        <label class="pole">Rynek<input id="p-rynek" value="${E_(p.rynek || 'BTC')}"></label>
        <label class="pole">Kierunek<select id="p-strona"><option value="long" ${p.strona !== 'short' ? 'selected' : ''}>LONG</option><option value="short" ${p.strona === 'short' ? 'selected' : ''}>SHORT</option></select></label>
        <label class="pole">Kiedy<input id="p-czas" type="datetime-local" value="${p.czas ? new Date(p.czas - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : teraz()}"></label>
      </div></div>
      <div class="blok">${formularz({ setup: p.setup, planWejscie: p.wejscie, sl: p.sl, tp: p.tp, powod: p.powod, confidence: p.confidence, emocje: p.emocje, notatka: p.notatka }, null)}
        <div class="przyciski"><button class="glowny" id="p-zapisz">Zapisz plan</button>${idPlanu ? '<button id="p-usun">Usuń plan</button>' : ''}<span class="b-male" id="p-info"></span></div></div>`);
    podepnijFormularz();
    $('p-zapisz').addEventListener('click', async () => {
      const f = czytajFormularz({});
      const plan = { rynek: $('p-rynek').value.trim().toUpperCase() || 'BTC', strona: $('p-strona').value, czas: new Date($('p-czas').value).getTime() || Date.now(),
        wejscie: f.planWejscie, sl: f.sl, tp: f.tp, setup: f.setup, powod: f.powod, confidence: f.confidence, emocje: f.emocje, notatka: f.notatka };
      ustawWpis(tid, { plan }); $('p-info').textContent = 'Zapisuję…';
      try { await zapisz(); przelicz(); okno.zamknij(); } catch (e) { $('p-info').textContent = e.message; }
    });
    if ($('p-usun')) $('p-usun').addEventListener('click', async () => { ustawWpis(tid, Object.assign({}, S.W.wpisy[tid], { usuniety: true })); await zapisz(); przelicz(); okno.zamknij(); });
  }
  function otworzReczny() {
    const tid = 'R|' + Date.now();
    okno.pokaz('Trade dodany ręcznie', `
      <p class="male">Dla giełd, których panel nie pobiera. Trade'y z Hyperliquid, Jupitera i Kraken Futures pojawiają się same.</p>
      <div class="blok"><div class="pola">
        <label class="pole">Giełda<input id="r-gielda" value="ręcznie"></label>
        <label class="pole">Rynek<input id="r-rynek" value="BTC"></label>
        <label class="pole">Kierunek<select id="r-strona"><option value="long">LONG</option><option value="short">SHORT</option></select></label>
        <label class="pole">Otwarcie<input id="r-otw" type="datetime-local" value="${teraz()}"></label>
        <label class="pole">Zamknięcie (puste = otwarty)<input id="r-zam" type="datetime-local"></label>
        <label class="pole">Wielkość (w monetach)<input id="r-ilosc" inputmode="decimal"></label>
        <label class="pole">Wejście<input id="r-wej" inputmode="decimal"></label>
        <label class="pole">Wyjście<input id="r-wyj" inputmode="decimal"></label>
        <label class="pole">Wynik netto (USD)<input id="r-netto" inputmode="decimal"></label>
      </div></div>
      <div class="blok">${formularz({}, null)}<div class="przyciski"><button class="glowny" id="r-zapisz">Dodaj</button><span class="b-male" id="r-info"></span></div></div>`);
    podepnijFormularz();
    $('r-zapisz').addEventListener('click', async () => {
      const v = (id) => $(id).value.trim();
      const reczny = { gielda: v('r-gielda') || 'ręcznie', rynek: v('r-rynek').toUpperCase() || 'BTC', strona: v('r-strona'), otwarcie: new Date(v('r-otw')).getTime(),
        zamkniecie: v('r-zam') ? new Date(v('r-zam')).getTime() : null, ilosc: N(v('r-ilosc')), wejscie: N(v('r-wej')), wyjscie: N(v('r-wyj')), netto: N(v('r-netto')) };
      if (!fin(reczny.otwarcie) || !fin(reczny.wejscie)) { $('r-info').textContent = 'Podaj co najmniej otwarcie i cenę wejścia.'; return; }
      const w = czytajFormularz({}); w.reczny = reczny;
      ustawWpis(tid, w); $('r-info').textContent = 'Zapisuję…';
      try { await zapisz(); przelicz(); okno.zamknij(); } catch (e) { $('r-info').textContent = e.message; }
    });
  }
  $('dodajPlan').addEventListener('click', () => otworzPlan(null));
  $('dodajReczny').addEventListener('click', otworzReczny);
  $('wypelnijWszystko').addEventListener('click', () => wypelnijWszystko(false));
  $('odswiezAuto').addEventListener('click', () => wypelnijWszystko(true));

  // ------------------------------------------------------------------ wnioski
  function rysujWnioski() {
    const wn = S.wn;
    const maks = Math.max(1e-9, ...wn.porownania.flatMap(p => [Math.abs(p.a.srednio || 0), Math.abs(p.b.srednio || 0)]));
    const pasek = (g) => { const v = g.srednio || 0, s = Math.min(50, 50 * Math.abs(v) / maks); return `<span>${E_(g.nazwa)} <span class="b-male">(${g.n})</span></span><span class="os"><i class="${v >= 0 ? 'p' : 'm'}" style="width:${s}%"></i></span><span class="war ${kl(v)}">${usd(v)} / trade</span>`; };
    $('porownania').innerHTML = wn.porownania.length ? wn.porownania.map(p => `<div class="porownanie"><h3>${E_(p.tytul)}${p.malaProba ? ' <span class="znacznik uwaga">mała próba</span>' : ''}</h3>
      <div class="paski">${pasek(p.a)}${pasek(p.b)}</div><p class="male" style="margin:2px 0 0">${E_(p.tekst)}</p></div>`).join('')
      : '<p class="male">Za mało zamkniętych trade\'ów do porównań (potrzeba co najmniej 3 w każdej grupie).</p>';
    const w = wn.wyjscia;
    $('kartaWyjscia').innerHTML = `<h2>Wyjścia <span class="podtytul">ile zostawiasz na stole</span></h2>` + (w ? `<p class="male">Po wyjściu z zyskiem cena szła średnio jeszcze <b>${nf(2).format(w.poWyjsciuZyski || 0)}%</b> w Twoją stronę w ciągu 4 h (${w.wygrane} zyskownych trade'ów).
      <b>${w.stratyBylyNaPlusie} z ${w.straty}</b> strat było wcześniej co najmniej 0,3% na plusie – tu pomaga zasada 8 (SL na wejście po +1R).</p>` : '<p class="male">Kliknij „Wypełnij za mnie” na zakładce Trade\'y – pobiorę świece i policzę ruch ceny w trakcie i po każdym trade\'zie.</p>');
    $('obserwacje').innerHTML = ((S.C && S.C.obserwacje) || []).map(o => `<li>${E_(o)}</li>`).join('') || '<li>Brak zaimportowanego dziennika.</li>';
  }
  function rysujKrzywa() {
    const cv = $('krzywa'); if (!cv || !cv.clientWidth) return;
    const z = S.lista.filter(t => !t.otwarta).sort((a, b) => a.zamkniecie - b.zamkniecie);
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
    if (z.length < 2) return;
    let a = 0, b = 0; const A = [0], B = [0];
    for (const t of z) { a += t.netto; A.push(a); if (DZ.zgodneKiedy(t)) b += t.netto; B.push(b); }
    const lo = Math.min(...A, ...B, 0), hi = Math.max(...A, ...B, 0), L = 8, P = 70, G = 10, D = 10;
    const x = (i) => L + i / (A.length - 1) * (W - L - P), y = (v) => G + (hi - v) / (hi - lo || 1) * (H - G - D);
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.moveTo(L, y(0)); c.lineTo(W - P, y(0)); c.stroke();
    const rys = (arr, kolor) => { c.strokeStyle = kolor; c.lineWidth = 2; c.beginPath(); arr.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v)))); c.stroke();
      c.fillStyle = kolor; c.font = '11px JetBrains Mono, monospace'; c.fillText(usd(arr[arr.length - 1]), W - P + 4, y(arr[arr.length - 1]) + 4); };
    rys(A, '#43f0c6'); rys(B, '#7cc8ff');
    $('krzywaOpis').textContent = `${z.length} zamkniętych trade'ów. Wszystkie: ${usd(a)}. Gdybyś pominął trade'y łamiące zasady 4–7 (longi pod EMA200, wejście po stracie, po dużym zysku, więcej niż 2 dziennie): ${usd(b)} z ${S.wn.kiedy.n} trade'ów. Wszystkich 9 zasad (z SL i ryzykiem 1–2%) nie spełnił żaden trade. To rachunek wstecz na tych samych danych – nie gwarancja na przyszłość.`;
  }
  window.addEventListener('resize', () => { if (S.zakl === 'wnioski') rysujKrzywa(); });

  function rysujZasady() {
    const zs = (S.C && S.C.zasady) || [];
    $('zasadyTabela').innerHTML = `<div class="przewijana"><table class="tab"><thead><tr><th>Zasada</th><th>Złamana</th><th class="l">Wynik złamanych</th><th>Dotrzymana</th><th class="l">Wynik dotrzymanych</th><th>Bez danych</th></tr></thead><tbody>
      ${S.wn.zasady.map(r => { const opis = zs.find(x => x.nr === r.kod); return `<tr><td><b>${r.kod}. ${E_(opis ? opis.zasada : r.krotko)}</b>${opis ? `<br><span class="b-male">${E_(opis.dlaczego)}</span>` : ''}</td>
        <td>${r.zlamana.n}</td><td class="l ${kl(r.zlamana.netto)}">${r.zlamana.n ? usd(r.zlamana.netto) : '–'}</td><td>${r.dotrzymana.n}</td><td class="l ${kl(r.dotrzymana.netto)}">${r.dotrzymana.n ? usd(r.dotrzymana.netto) : '–'}</td><td>${r.bezDanych}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
  function rysujSetupy() {
    const st = (S.C && S.C.setupy) || [];
    const roz = st.filter(s => fin(s.wynik_r));
    $('setupyPod').textContent = `${st.length} setupów · rozstrzygnięte ${roz.length}: ${roz.filter(s => s.wynik_r > 0).length} na plus, suma ${nf(2).format(roz.reduce((a, s) => a + s.wynik_r, 0))}R`;
    $('setupyTabela').innerHTML = st.length ? `<div class="przewijana"><table class="tab"><thead><tr><th>#</th><th>Data</th><th>Kierunek</th><th>Typ</th><th class="l">Wejście / SL / TP</th><th class="l">R:R</th><th>Status</th><th class="l">Wynik</th><th>Twoje trade'y</th></tr></thead><tbody>
      ${st.map(s => { const tt = S.lista.filter(t => t.setup === s.id); return `<tr><td><b>${E_(s.id)}</b></td><td>${E_(s.data.slice(5))}</td><td><span class="kier ${s.kierunek.toLowerCase()}">${E_(s.kierunek)}</span></td><td>${E_(s.typ)}<br><span class="b-male">${E_(s.uwagi || '')}</span></td>
        <td class="l">${cena(s.wejscie)} / ${cena(s.sl)} / ${cena(s.tp)}</td><td class="l">${E_(s.rr)}</td><td>${E_(s.status)}</td><td class="l ${kl(s.wynik_r)}">${fin(s.wynik_r) ? nf(2).format(s.wynik_r) + 'R' : '–'}</td>
        <td>${tt.length ? tt.map(t => `<a href="#" data-id="${E_(t.id)}">${kiedy(t.otwarcie)} <span class="${kl(t.netto)}">${usd(t.netto)}</span></a>`).join('<br>') : '<span class="b-male">brak</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="male">Brak zaimportowanego dziennika z Chrome.</p>';
  }
  $('setupyTabela').addEventListener('click', (e) => { const a = e.target.closest('[data-id]'); if (a) { e.preventDefault(); otworzTrade(a.dataset.id); } });

  // ------------------------------------------------------------------ start
  zakladka(location.hash.slice(1) || 'trade');
  wczytaj().catch(e => { stan('blad', 'błąd'); $('lista').innerHTML = `<div class="ramka blad">${E_(e.message)}</div>`; });
  // co 2 min odśwież (nowe trade'y z panelu, wpisy z telefonu) – gdy okno opisu jest zamknięte
  setInterval(() => { if (!document.hidden && $('okno').classList.contains('ukryte') && !S.zajety) wczytaj().catch(() => { }); }, 120000);
})();
