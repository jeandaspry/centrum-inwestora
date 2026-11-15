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
    rysujPrzeglad(); rysujDzis(); rysujPlany(); rysujListe(); rysujWnioski(); rysujZasady(); rysujSetupy();
    if (S.zakl === 'wnioski') rysujKrzywa();
  }
  const odmiana = (n, a, b, c) => (n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
  const ileTrade = (n) => n + ' ' + odmiana(n, 'trade', 'trade\'y', 'trade\'ów');
  const godzina = (t) => new Date(t).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
  const dzienLadnie = (d) => { const x = new Date(d + 'T12:00:00Z'); const dzis = DZ.dzien(Date.now()), wczoraj = DZ.dzien(Date.now() - 86400000);
    const n = x.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }); return d === dzis ? 'Dziś · ' + n : d === wczoraj ? 'Wczoraj · ' + n : n.charAt(0).toUpperCase() + n.slice(1); };
  const rynekLadnie = (r) => String(r || '').replace(/^KF:/, 'Kraken Futures ');

  // wykres liniowy (mini w przeglądzie i duży w Wnioskach): serie [{dane, kolor, wypelnij}]
  function wykresLinia(cv, serie, o = {}) {
    if (!cv || !cv.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
    const wsz = serie.flatMap(s => s.dane); if (wsz.length < 2) return;
    const lo = Math.min(0, ...wsz), hi = Math.max(0, ...wsz);
    const L = o.L || 0, P = o.P || 0, G = o.G || 6, D = o.D || 6, n = Math.max(...serie.map(s => s.dane.length));
    const x = (i) => L + i / Math.max(1, n - 1) * (W - L - P), y = (v) => G + (hi - v) / (hi - lo || 1) * (H - G - D);
    if (o.siatka) {
      c.font = '600 11px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(255,255,255,.4)'; c.textAlign = 'right';
      for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; c.strokeStyle = 'rgba(255,255,255,.06)'; c.beginPath(); c.moveTo(L, y(v)); c.lineTo(W - P, y(v)); c.stroke(); c.fillText(Math.round(v) + ' $', L - 6, y(v) + 4); }
      c.textAlign = 'left';
    }
    c.save(); c.strokeStyle = 'rgba(255,255,255,.28)'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(L, y(0)); c.lineTo(W - P, y(0)); c.stroke(); c.restore();
    for (const s of serie) {
      const sciezka = () => { c.beginPath(); s.dane.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v)))); };
      if (s.wypelnij) {
        const gr = c.createLinearGradient(0, G, 0, H - D); gr.addColorStop(0, s.wypelnij); gr.addColorStop(1, 'rgba(0,0,0,0)');
        sciezka(); c.lineTo(x(s.dane.length - 1), y(0)); c.lineTo(x(0), y(0)); c.closePath(); c.fillStyle = gr; c.fill();
      }
      c.strokeStyle = s.kolor; c.lineWidth = s.grubosc || 2.2; c.lineJoin = 'round'; c.lineCap = 'round'; sciezka(); c.stroke();
      const ost = s.dane[s.dane.length - 1], xx = x(s.dane.length - 1), yy = y(ost);
      c.fillStyle = s.kolor; c.beginPath(); c.arc(xx, yy, 3.5, 0, Math.PI * 2); c.fill();
      if (o.etykiety) {
        const t = usd(ost); c.font = '700 12px "JetBrains Mono", monospace'; const sz = c.measureText(t).width + 12;
        c.fillStyle = 'rgba(2,20,17,.92)'; c.strokeStyle = s.kolor; c.lineWidth = 1;
        const bx = Math.min(W - sz - 2, xx + 8), by = yy - 11; c.beginPath(); c.roundRect ? c.roundRect(bx, by, sz, 22, 7) : c.rect(bx, by, sz, 22); c.fill(); c.stroke();
        c.fillStyle = s.kolor; c.fillText(t, bx + 6, by + 15);
      }
    }
  }

  function rysujPrzeglad() {
    const o = S.wn.ogol, z = S.lista.filter(t => !t.otwarta).sort((a, b) => a.zamkniecie - b.zamkniecie), czyste = S.wn.czyste;
    const opis = z.filter(t => t.uzupelniony).length;
    let acc = 0; const seria = [0, ...z.map(t => (acc += t.netto))];
    $('hero').className = 'hero-wynik' + (o.netto < 0 ? ' strata' : '');
    $('hero').innerHTML = `<div class="et">Wynik netto · ${ileTrade(o.n)}</div>
      <div class="kwota ${kl(o.netto)}">${usd(o.netto)}</div>
      <div class="opis">średnio <b class="num ${kl(o.srednio)}">${usd(o.srednio)}</b> na trade${z.length ? ' · od ' + new Date(z[0].otwarcie).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' }) : ''}</div>
      <div class="w-mini" id="heroWykres"></div>`;
    if (S.wHero) { S.wHero.usun(); S.wHero = null; }
    if (window.DZW && DZW.dostepne()) { let s = 0; S.wHero = DZW.mini($('heroWykres')); S.wHero.ustaw([{ t: (z[0] ? z[0].otwarcie : Date.now()) - 60000, v: 0 }, ...z.map(t => ({ t: t.zamkniecie, v: (s += t.netto) }))], o.netto >= 0); }
    else wykresLinia($('heroWykres'), [{ dane: seria, kolor: o.netto >= 0 ? '#43f0c6' : '#ff8a8a', wypelnij: o.netto >= 0 ? 'rgba(67,240,198,.30)' : 'rgba(255,107,107,.26)' }]);
    const kafel = (et, w, p) => `<div class="kafel"><div class="et">${et}</div><div class="wart">${w}</div><div class="pod">${p}</div></div>`;
    $('kafle').innerHTML = [
      kafel('Skuteczność', proc(o.skut), `${o.wygrane} z ${o.n} na plus`),
      kafel('Średni zysk / strata', `<span class="plus">${usd(o.srW, false)}</span><small> / </small><span class="minus">${usd(o.srP, false)}</span>`, o.prog ? `do zera potrzeba ${proc(o.prog)} trafień` : '–'),
      kafel('Opłaty', `<span class="minus">${usd(-o.oplaty)}</span>`, o.netto < 0 && o.netto + o.oplaty > 0 ? `bez nich byłoby <b class="plus">${usd(o.netto + o.oplaty)}</b>` : S.wn.oplatyUdzial ? `${proc(S.wn.oplatyUdzial)} straty netto` : ''),
      kafel('Zgodne z zasadami 4–7', `${S.wn.kiedy.n}<small> / ${o.n}</small>`, `razem <b class="${kl(S.wn.kiedy.netto)}">${usd(S.wn.kiedy.netto)}</b>`),
      kafel('Wszystkie 9 zasad', `${czyste.n}<small> / ${o.n}</small>`, czyste.n ? `razem <b class="${kl(czyste.netto)}">${usd(czyste.netto)}</b>` : 'z SL i ryzykiem 1–2% – jeszcze żaden'),
      kafel('Opisane', `${opis}<small> / ${z.length}</small>`, opis < z.length ? 'kliknij „Wypełnij za mnie”' : 'wszystkie trade\'y')
    ].join('');
  }
  // ---- karta „Dzień”: dziś albo wybrany dzień z paska ostatnich dni (dni z trade'ami + dziś)
  function dniZTrade() {
    const m = new Map();
    for (const t of S.lista) { const x = m.get(t.dzienPL) || { d: t.dzienPL, tt: [] }; x.tt.push(t); m.set(t.dzienPL, x); }
    const dzis = DZ.dzien(Date.now()); if (!m.has(dzis)) m.set(dzis, { d: dzis, tt: [] });
    return [...m.values()].sort((a, b) => (a.d < b.d ? -1 : 1)).map(x => Object.assign(x, DZ.podsumowanieDnia(x.tt)));
  }
  function rysujDzis() {
    const dni = dniZTrade(), dzis = DZ.dzien(Date.now());
    if (!S.dzien || !dni.some(x => x.d === S.dzien)) S.dzien = dzis;
    const i = dni.findIndex(x => x.d === S.dzien), D = dni[i], toDzis = S.dzien === dzis;
    const pole = (k, ik, tyt, op) => `<div class="dzis-pole ${k}"><span class="ikona" aria-hidden="true">${ik}</span><div><b>${tyt}</b><span>${op}</span></div></div>`;
    const limit = 2;
    const pola = [
      pole(D.n > limit ? 'zle' : D.n === limit ? 'uwaga' : 'ok', '🎯', `${ileTrade(D.n)}${toDzis ? ` z ${limit}` : ''}`, D.n > limit ? `ponad limit ${limit} dziennie (zasada 7)` : 'limit dzienny – zasada 7'),
      pole(D.netto < 0 ? 'zle' : D.n ? 'ok' : '', D.netto < 0 ? '📉' : '📈', `<span class="num ${kl(D.netto)}">${usd(D.netto)}</span>`, toDzis ? 'wynik dziś' : 'wynik tego dnia'),
      ...(D.n ? [pole(D.wygrane * 2 >= D.zamkniete ? 'ok' : 'uwaga', '✔️', `${D.wygrane} z ${D.zamkniete} na plus`, `opłaty ${usd(-D.oplaty)}`)] : []),
      ...(D.n ? [pole(D.zlamane ? 'zle' : 'ok', D.zlamane ? '⚠️' : '🛡️', D.zlamane ? `${D.zlamane} ${odmiana(D.zlamane, 'trade łamie', 'trade\'y łamią', 'trade\'ów łamie')} zasady` : 'bez złamanych zasad', 'zasady metody v3')] : [])
    ];
    if (toDzis) {
      const d = DZ.dzis(S.lista);
      pola.push(...(d.przerwy.length ? d.przerwy.map(p => pole('uwaga', '⏸️', `przerwa do ${godzina(p.do)}`, `zasada ${p.zasada}: ${E_(p.powod)}`)) : [pole('ok', '✅', 'bez wymaganej przerwy', 'zasady 5–6 spełnione')]));
      if (d.otwarte.length) pola.push(pole('info', '🔓', d.otwarte.map(t => t.strona.toUpperCase() + ' ' + E_(rynekLadnie(t.rynek))).join(', '), 'otwarte teraz'));
    }
    const krotko = (d) => { const x = new Date(d + 'T12:00:00Z'); return { dzien: x.toLocaleDateString('pl-PL', { weekday: 'short' }), data: x.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' }) }; };
    const pasek = dni.slice().reverse().map(x => { const k = krotko(x.d);
      return `<button class="dzien-chip ${x.d === S.dzien ? 'wl' : ''} ${x.n ? kl(x.netto) : 'pusty'}" data-dzien="${x.d}" title="${E_(dzienLadnie(x.d))}">
        <span class="dz">${x.d === dzis ? 'dziś' : k.dzien}</span><span class="dt">${k.data}</span><span class="wn">${x.n ? usd(x.netto) : '–'}</span><span class="ile">${x.n ? ileTrade(x.n) : 'brak'}</span></button>`; }).join('');
    $('kartaDzis').innerHTML = `<div class="sekcja-tytul"><h2>${toDzis ? 'Dziś' : 'Dzień'}</h2>
        <div class="dzien-nawig"><button class="maly" data-krok="-1" ${i <= 0 ? 'disabled' : ''} aria-label="Dzień wcześniej">‹</button><span>${E_(dzienLadnie(S.dzien))}</span><button class="maly" data-krok="1" ${i >= dni.length - 1 ? 'disabled' : ''} aria-label="Dzień później">›</button></div></div>
      <div class="dni-pasek" id="dniPasek">${pasek}</div>
      <div class="dzis">${pola.join('')}</div>
      ${D.n ? `<div class="przyciski" style="margin-top:12px"><button id="pokazDzien">${S.dzienFiltr === S.dzien ? '✕ Pokaż wszystkie dni' : '↓ Pokaż trade\'y z tego dnia'}</button></div>` : ''}`;
  }
  $('kartaDzis').addEventListener('click', (e) => {
    const ch = e.target.closest('[data-dzien]'), kr = e.target.closest('[data-krok]');
    if (ch) { S.dzien = ch.dataset.dzien; if (S.dzienFiltr) S.dzienFiltr = S.dzien; rysujDzis(); rysujListe(); return; }
    if (kr) { const dni = dniZTrade(), i = dni.findIndex(x => x.d === S.dzien), j = i + Number(kr.dataset.krok); if (dni[j]) { S.dzien = dni[j].d; if (S.dzienFiltr) S.dzienFiltr = S.dzien; rysujDzis(); rysujListe(); } return; }
    if (e.target.closest('#pokazDzien')) {
      S.dzienFiltr = S.dzienFiltr === S.dzien ? null : S.dzien; rysujDzis(); rysujListe();
      if (S.dzienFiltr) $('lista').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  function rysujPlany() {
    const pl = S.lista.plany || [];
    $('plany').innerHTML = pl.length ? `<p class="plany-tytul">Plany czekające na wejście · przypną się same do trade'u z giełdy w ciągu 12 h</p><div class="lista-trade" style="margin-bottom:16px">` + pl.map(p =>
      `<button class="trade plan" data-plan="${E_(p.id)}">
        <div class="kol-a"><span class="kier ${p.strona}">${p.strona.toUpperCase()}</span><span class="godz">${kiedy(p.czas)}</span></div>
        <div class="kol-b"><div class="tytul">${E_(p.rynek)} <span class="cena-t">wejście ${cena(N(p.wejscie))}</span></div>
          <div class="meta"><span>SL <span class="num">${cena(N(p.sl))}</span></span><span>TP <span class="num">${cena(N(p.tp))}</span></span>${p.setup ? `<span>setup ${E_(p.setup)}</span>` : ''}</div></div>
        <div class="kol-c"><span class="flaga info">plan</span>${fin(N(p.confidence)) ? `<span class="r">pewność ${N(p.confidence)}</span>` : ''}</div></button>`).join('') + '</div>' : '';
  }
  const FILTRY = {
    wszystkie: () => true, puste: (t) => !t.uzupelniony && !t.otwarta, setup: (t) => !!t.setup, bezSetupu: (t) => !t.setup,
    zasady: (t) => Object.values(t.zasady).some(z => z.ok === false), revenge: (t) => t.poStracie || t.zmianaKierunku,
    plus: (t) => !t.otwarta && t.netto > 0, minus: (t) => !t.otwarta && t.netto <= 0
  };
  function flagiTrade(t) {
    const f = [];
    if (t.otwarta) f.push(['info', 'otwarty']);
    if (t.likwidacja) f.push(['zle', 'likwidacja']);
    if (t.poStracie) f.push(['zle', 'po stracie']);
    if (t.zmianaKierunku) f.push(['zle', 'zmiana kierunku']);
    if (t.poDuzymZysku) f.push(['uwaga', 'po dużym zysku']);
    if (t.nrWDniu > 2) f.push(['uwaga', t.nrWDniu + '. trade dnia']);
    const zl = Object.values(t.zasady).filter(z => z.ok === false).length;
    f.push([zl ? 'zle' : 'ok', zl ? 'zasady ✗ ' + zl : 'zasady ✓']);
    return f.map(([k, x]) => `<span class="flaga ${k}">${x}</span>`).join('');
  }
  function kartaTrade(t) {
    const ws = t.uzupelniony ? (t.wpis.autoPola && t.wpis.autoPola.length && !t.wpis.recznieOpisany ? ['wpis-auto', '◐ opisany za Ciebie'] : ['wpis-pelny', '● opisany']) : ['wpis-pusty', '○ do opisania'];
    return `<button class="trade ${t.otwarta ? '' : kl(t.netto)}" data-id="${E_(t.id)}">
      <div class="kol-a"><span class="kier ${t.strona}">${t.strona.toUpperCase()}</span><span class="godz">${godzina(t.otwarcie)}</span></div>
      <div class="kol-b"><div class="tytul">${E_(rynekLadnie(t.rynek))} <span class="cena-t">${cena(t.wejscie)} → ${cena(t.wyjscie)}</span></div>
        <div class="meta"><span>⏱ <span class="num">${czas(t.czasMin)}</span></span>${t.dzwignia ? `<span>dźwignia <span class="num">~${Math.round(t.dzwignia)}×</span></span>` : ''}<span>SL <span class="num">${cena(t.sl)}</span></span><span>TP <span class="num">${cena(t.tp)}</span></span><span>${E_(t.gielda)}</span></div></div>
      <div class="kol-c"><span class="kwota ${kl(t.netto)}">${t.otwarta ? 'otwarty' : usd(t.netto)}</span>${fin(t.R) ? `<span class="r">R ${(t.R >= 0 ? '+' : '') + nf(2).format(t.R)}</span>` : ''}</div>
      <div class="flagi">${t.setup ? `<span class="flaga setup">setup ${E_(t.setup)}</span>` : ''}${flagiTrade(t)}<span class="flaga ${ws[0]}">${ws[1]}</span></div></button>`;
  }
  function rysujListe() {
    const f = FILTRY[S.filtr] || FILTRY.wszystkie;
    document.querySelectorAll('#filtry button').forEach(b => {
      b.classList.toggle('wl', b.dataset.f === S.filtr);
      const ile = S.lista.filter(FILTRY[b.dataset.f] || FILTRY.wszystkie).length;
      let s = b.querySelector('.ile'); if (!s) { s = document.createElement('span'); s.className = 'ile'; b.appendChild(s); } s.textContent = ile;
    });
    const l = S.lista.filter(f).filter(t => !S.dzienFiltr || t.dzienPL === S.dzienFiltr).slice().reverse();
    $('listaPod').textContent = l.length === S.lista.length ? ileTrade(l.length) : `${l.length} z ${S.lista.length}`;
    $('filtrDnia').innerHTML = S.dzienFiltr ? `<button class="flaga info" id="zdejmijDzien">tylko ${E_(dzienLadnie(S.dzienFiltr))} ✕</button>` : '';
    if (!S.E) { $('lista').innerHTML = '<div class="pusto">Brak eksportu trade\'ów z panelu. Otwórz panel inwestora (np. w Centrum) – zapisze go w ciągu minuty.</div>'; return; }
    if (!l.length) { $('lista').innerHTML = '<div class="pusto">Żaden trade nie pasuje do tego filtra.</div>'; return; }
    const dni = new Map(); for (const t of l) { if (!dni.has(t.dzienPL)) dni.set(t.dzienPL, []); dni.get(t.dzienPL).push(t); }
    $('lista').innerHTML = [...dni.entries()].map(([d, tt]) => { const nt = tt.filter(t => !t.otwarta).reduce((s, t) => s + t.netto, 0);
      return `<div class="dzien-naglowek"><span>${E_(dzienLadnie(d))}</span><span>${ileTrade(tt.length)} · <span class="kwota num ${kl(nt)}">${usd(nt)}</span></span></div>` + tt.map(kartaTrade).join(''); }).join('');
  }
  $('filtry').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; S.filtr = b.dataset.f; pam.pisz('filtr', S.filtr); rysujListe(); });
  $('filtrDnia').addEventListener('click', (e) => { if (e.target.closest('#zdejmijDzien')) { S.dzienFiltr = null; rysujDzis(); rysujListe(); } });
  $('lista').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) otworzTrade(b.dataset.id); });
  $('plany').addEventListener('click', (e) => { const b = e.target.closest('[data-plan]'); if (b) otworzPlan(b.dataset.plan); });

  // ------------------------------------------------------------------ okno trade'u
  const okno = { pokaz(tytul, html) { $('oknoTytul').innerHTML = tytul; $('oknoTresc').innerHTML = html; $('okno').classList.remove('ukryte'); document.body.style.overflow = 'hidden'; },
    zamknij() { $('okno').classList.add('ukryte'); document.body.style.overflow = ''; if (S.wTrade) { S.wTrade.usun(); S.wTrade = null; } } };
  $('oknoZamknij').addEventListener('click', () => okno.zamknij());
  $('okno').addEventListener('click', (e) => { if (e.target === $('okno')) okno.zamknij(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('okno').classList.contains('ukryte')) okno.zamknij(); });

  const IKONY_EMOCJI = { 'spokój': '😌', 'pewność siebie': '😎', 'FOMO': '🏃', 'strach': '😨', 'chciwość': '🤑', 'nuda': '🥱', 'zemsta': '😤', 'zmęczenie': '😴', 'presja': '⏱️' };
  const chipy = (nazwa, opcje, wybrane, ikony) => `<div class="chipy ${nazwa}" data-chipy="${nazwa}">${opcje.map(o => `<button type="button" class="${(wybrane || []).includes(o) ? 'wl' : ''}" data-v="${E_(o)}">${ikony && ikony[o] ? ikony[o] + ' ' : ''}${E_(o)}</button>`).join('')}</div>`;
  const autoZn = (w, pole) => (w.autoPola || []).includes(pole) ? ' <span class="auto-zn">auto</span>' : '';
  const OPIS_OCEN = { A: 'wszystko wg planu', B: 'drobne odstępstwo', C: 'kilka błędów', D: 'złamane zasady' };
  function formularz(w, t) {
    const setupy = (S.C && S.C.setupy) || [];
    const conf = fin(N(w.confidence)) ? N(w.confidence) : null;
    return `<div class="pola">
      <label class="pole">Setup${autoZn(w, 'setup')}<select id="f-setup"><option value="">bez setupu</option>${setupy.map(s => `<option value="${E_(s.id)}" ${w.setup === s.id ? 'selected' : ''}>${E_(s.id)} · ${E_(s.data.slice(8, 10) + '.' + s.data.slice(5, 7))} · ${E_(s.kierunek)} · ${E_(s.typ)} (${cena(s.wejscie)})${t && t.setupAuto === s.id ? ' ← pasuje' : ''}</option>`).join('')}</select></label>
      <label class="pole">Etykieta${autoZn(w, 'etykieta')}<select id="f-etykieta">${['', 'z analizy', 'bez analizy', 'prawdopodobny revenge', 'seria po dużym zysku', 'inne'].map(o => `<option ${w.etykieta === o ? 'selected' : ''} value="${E_(o)}">${o || '–'}</option>`).join('')}</select></label>
      <div class="pole">Ocena procesu${autoZn(w, 'ocena')}<div class="oceny" data-oceny>${DZ.OCENY.map(o => `<button type="button" data-v="${o}" class="${w.ocena === o ? 'wl' : ''}" title="${OPIS_OCEN[o]}">${o}</button>`).join('')}</div><span class="b-male" id="f-ocenaOpis">${w.ocena ? OPIS_OCEN[w.ocena] : 'A – wszystko wg planu … D – złamane zasady'}</span></div>
      <label class="pole">Plan wejścia${autoZn(w, 'planWejscie')}<input id="f-planWejscie" inputmode="decimal" value="${fin(N(w.planWejscie)) ? N(w.planWejscie) : ''}" placeholder="np. 78 650"></label>
      <label class="pole">Stop loss${autoZn(w, 'sl')}<input id="f-sl" inputmode="decimal" value="${fin(N(w.sl)) ? N(w.sl) : ''}" placeholder="cena SL"></label>
      <label class="pole">Take profit${autoZn(w, 'tp')}<input id="f-tp" inputmode="decimal" value="${fin(N(w.tp)) ? N(w.tp) : ''}" placeholder="cena TP"></label>
      <label class="pole szer">Powód wejścia${autoZn(w, 'powod')}<textarea id="f-powod" placeholder="Dlaczego tu? Jaki sygnał, poziom, kontekst?">${E_(w.powod || '')}</textarea></label>
      <div class="pole szer">Pewność (confidence) – jak bardzo byłeś pewny, 0–100${autoZn(w, 'confidence')}
        <div class="suwak"><input type="range" id="f-confR" min="0" max="100" step="5" value="${conf === null ? 50 : conf}" aria-label="Pewność"><input id="f-conf" class="wartosc-conf" inputmode="numeric" value="${conf === null ? '' : conf}" placeholder="–" aria-label="Pewność w liczbach"></div></div>
      <div class="pole szer">Emocje${chipy('emocje', DZ.EMOCJE, w.emocje, IKONY_EMOCJI)}</div>
      <div class="pole szer">Błędy${autoZn(w, 'bledy')}${chipy('bledy', DZ.BLEDY, w.bledy)}</div>
      <label class="pole szer">Notatka / lekcja${autoZn(w, 'notatka')}<textarea id="f-notatka" placeholder="Co zrobiłbyś inaczej następnym razem?">${E_(w.notatka || '')}</textarea></label>
    </div>`;
  }
  function podepnijFormularz() {
    document.querySelectorAll('#oknoTresc [data-chipy] button').forEach(b => b.addEventListener('click', () => b.classList.toggle('wl')));
    document.querySelectorAll('#oknoTresc [data-oceny] button').forEach(b => b.addEventListener('click', () => {
      const wl = !b.classList.contains('wl');
      b.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('wl'));
      if (wl) b.classList.add('wl');
      const op = $('f-ocenaOpis'); if (op) op.textContent = wl ? OPIS_OCEN[b.dataset.v] : 'bez oceny';
    }));
    const r = $('f-confR'), n = $('f-conf');
    if (r && n) { r.addEventListener('input', () => { n.value = r.value; }); n.addEventListener('input', () => { if (fin(N(n.value))) r.value = N(n.value); }); }
  }
  function czytajFormularz(stary) {
    const w = Object.assign({}, stary || {});
    const pole = (id) => { const e = $('f-' + id); return e ? e.value.trim() : undefined; };
    const liczba = (id) => { const v = N(pole(id)); return fin(v) ? v : null; };
    const oc = document.querySelector('#oknoTresc [data-oceny] button.wl');
    w.setup = pole('setup') || ''; w.etykieta = pole('etykieta') || ''; w.ocena = oc ? oc.dataset.v : '';
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
    const zasadyHtml = DZ.ZASADY.map(zz => { const x = t.zasady[zz.kod]; const k = x.ok === true ? 't' : x.ok === false ? 'f' : 'n';
      return `<div><span class="ikonka ${k}">${x.ok === true ? '✓' : x.ok === false ? '✗' : '?'}</span><span><b>${zz.kod}. ${E_(zz.krotko)}</b><span class="opis-z">${E_(x.opis)}</span></span></div>`; }).join('');
    const tytul = `<span class="kier ${t.strona}">${t.strona.toUpperCase()}</span><span>${E_(rynekLadnie(t.rynek))}</span><span class="b-male">${kiedy(t.otwarcie)} · ${E_(t.gielda)}</span>
      <span class="kwota num ${kl(t.netto)}">${t.otwarta ? 'otwarty' : usd(t.netto)}</span>${fin(t.R) ? `<span class="flaga ${t.R >= 0 ? 'ok' : 'zle'}">R ${(t.R >= 0 ? '+' : '') + nf(2).format(t.R)}</span>` : ''}`;
    const asystentHtml = a ? `<p class="tekst-blok"><span class="decyzja-mala ${a.decyzja === 'LONG' ? 'long' : a.decyzja === 'SHORT' ? 'short' : 'czekaj'}">${a.decyzja}</span>
        <span class="b-male" style="margin-left:8px">przy ${a.L}× · świeca 1h ${kiedy(a.swieca)}</span></p><p class="tekst-blok">${E_(DZ.powodZAsystenta(a, t.strona))}</p>`
      : '<p class="tekst-blok">Jeszcze nie policzone – kliknij „Wypełnij za mnie”.</p>';
    const chromeHtml = t.chrome || t.notatkaChrome || t.setupDane ? `<h3 style="margin-top:14px">Dziennik Claude w Chrome</h3>
      ${t.chrome ? `<p class="tekst-blok"><b>${E_(t.chrome.id)}</b> · ${E_(t.chrome.etykieta)} · ${E_(t.chrome.trend)}${t.chrome.notatka ? '<br>' + E_(t.chrome.notatka) : ''}</p>` : ''}
      ${t.setupDane ? `<p class="tekst-blok"><b>Setup ${E_(t.setupDane.id)}</b> – ${E_(t.setupDane.typ)}: plan <span class="num">${cena(t.setupDane.wejscie)}</span> / SL <span class="num">${cena(t.setupDane.sl)}</span> / TP <span class="num">${cena(t.setupDane.tp)}</span> (R:R ${t.setupDane.rr}), ${E_(t.setupDane.status)}${fin(t.setupDane.wynik_r) ? ' <b class="' + kl(t.setupDane.wynik_r) + '">' + nf(2).format(t.setupDane.wynik_r) + 'R</b>' : ''}${t.setupAuto === t.setupDane.id && !(S.W.wpisy[id] || {}).setup ? ' <span class="auto-zn">dopasowany</span>' : ''}</p>` : ''}
      ${t.notatkaChrome ? `<p class="tekst-blok">${E_(t.notatkaChrome.notatka)}</p>` : ''}` : '';
    const planHtml = t.plan ? `<h3 style="margin-top:14px">Plan sprzed wejścia</h3><p class="tekst-blok">${kiedy(t.plan.czas)} · wejście <span class="num">${cena(N(t.plan.wejscie))}</span>, SL <span class="num">${cena(N(t.plan.sl))}</span>, TP <span class="num">${cena(N(t.plan.tp))}</span>${t.plan.powod ? '<br>' + E_(t.plan.powod) : ''}</p>` : '';
    okno.pokaz(tytul, `
      <div class="dwie-kol">
        <div class="blok"><h3>Wykres <span class="b-male">przeciągnij i przybliżaj · wejście, wyjście, SL/TP, Twoje wypełnienia</span></h3><div class="wykres-lw" id="wykres"></div></div>
        <div class="blok"><h3>Z giełdy</h3><div class="siatka-wart">
          ${wart('Wejście (średnio)', cena(t.wejscie))}${wart('Wyjście (średnio)', cena(t.wyjscie))}
          ${wart('Największa pozycja', t.maxWielkosc ? nf(5).format(t.maxWielkosc) + ' ' + E_(String(t.rynek).split(/[\s(]/)[0]) : t.ilosc ? nf(5).format(t.ilosc) : '–')}${wart('Wartość pozycji', usd(t.wartoscMax, false) + (t.wartosc && t.wartoscMax && t.wartosc > t.wartoscMax * 1.05 ? ` <span class="b-male">(dokupienia razem ${usd(t.wartosc, false)})</span>` : ''))}
          ${wart('Kapitał konta', t.kapital ? usd(t.kapital, false) : '–')}${wart('Dźwignia vs konto', t.dzwignia ? '~' + nf(1).format(t.dzwignia) + '×' : '–')}
          ${wart('Wynik brutto', `<span class="${kl(t.pnl)}">${usd(t.pnl)}</span>`)}${wart('Opłaty', `<span class="minus">${usd(-t.oplaty)}</span>` + (t.builder > 0 ? ` <span class="b-male">(Phantom ${usd(-t.builder)})</span>` : ''))}
          ${wart('Funding', `<span class="${kl(t.funding)}">${usd(t.funding)}</span>`)}${wart('Netto', `<span class="${kl(t.netto)}">${usd(t.netto)}</span>`)}
          ${wart('Czas trzymania', czas(t.czasMin))}${wart('Wejście', t.makerWejscie === null ? '–' : t.makerWejscie ? 'maker (Limit)' : 'taker')}
          ${wart('SL z giełdy', z && z.slPierwszy ? cena(z.slPierwszy) + (z.zmianySl ? ` <span class="b-male">zmiany: ${z.zmianySl}</span>` : '') : z ? 'nie było' : '–')}${wart('TP z giełdy', z && z.tpPierwszy ? cena(z.tpPierwszy) + (z.zmianyTp ? ` <span class="b-male">zmiany: ${z.zmianyTp}</span>` : '') : z ? 'nie było' : '–')}
          ${wart('Najlepszy ruch (MFE)', r ? '<span class="plus">+' + nf(2).format(r.mfe) + '%</span>' : '–')}${wart('Najgorszy ruch (MAE)', r ? '<span class="minus">−' + nf(2).format(r.mae) + '%</span>' : '–')}
          ${wart('Po wyjściu (4 h)', r ? '+' + nf(2).format(r.poWyjsciu) + '%' : '–')}${wart('Ryzyko przy SL', t.ryzyko ? usd(-t.ryzyko) + (t.ryzykoProc ? ` <span class="b-male">${nf(1).format(t.ryzykoProc)}% konta</span>` : '') : '–')}
        </div></div>
      </div>
      <div class="dwie-kol">
        <div class="blok"><h3>Asystent w chwili wejścia</h3>${asystentHtml}${chromeHtml}${planHtml}</div>
        <div class="blok"><h3>Zasady metody v3</h3><div class="lista-zasad">${zasadyHtml}</div></div>
      </div>
      <div class="blok"><h3>Twój opis <span class="b-male">„Wypełnij za mnie” uzupełnia tylko puste pola – resztę piszesz Ty</span></h3>${formularz(w, t)}
        <div class="przyciski"><button class="glowny" id="f-zapisz">Zapisz</button><button id="f-auto" title="Wypełnia tylko puste pola">✦ Wypełnij za mnie</button>${t.reczny ? '<button id="f-usun">Usuń ten trade</button>' : ''}<span class="b-male" id="f-info"></span></div>
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

  // ruchomy wykres trade'u (dziennik-wykresy.js): świece z Hyperliquid, przesuwanie i przybliżanie, odświeżanie na żywo
  function rysujWykresTrade(t) {
    const el = $('wykres'); if (!el) return;
    if (S.wTrade) { S.wTrade.usun(); S.wTrade = null; }
    if (String(t.rynek).startsWith('KF:')) { el.innerHTML = '<p class="b-male">Brak świec dla tego rynku.</p>'; return; }
    if (!window.DZW || !DZW.dostepne()) { el.innerHTML = '<p class="b-male">Nie wczytała się biblioteka wykresów.</p>'; return; }
    S.wTrade = DZW.trade(el, t, swieceHL);
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
    const pasek = (g) => { const v = g.srednio || 0, s = Math.min(50, 50 * Math.abs(v) / maks);
      return `<span class="nazwa">${E_(g.nazwa)}<small>${g.n}</small></span><span class="os"><i class="${v >= 0 ? 'p' : 'm'}" style="width:${s}%"></i></span><span class="war ${kl(v)}">${usd(v)}</span>`; };
    $('porownania').innerHTML = wn.porownania.length ? wn.porownania.map(p => {
      const lep = (p.a.srednio || 0) >= (p.b.srednio || 0) ? p.a : p.b, gor = lep === p.a ? p.b : p.a;
      const zdanie = `${lep.nazwa}: ${usd(lep.srednio)} na trade, a ${gor.nazwa.charAt(0).toLowerCase() + gor.nazwa.slice(1)}: ${usd(gor.srednio)}`;
      return `<div class="wniosek"><div class="temat">${E_(p.tytul)}</div>
        <div class="naglowek"><h3>${E_(zdanie)}</h3>${p.malaProba ? '<span class="flaga uwaga">mała próba</span>' : ''}</div>
        <div class="paski">${pasek(p.a)}${pasek(p.b)}</div><p class="opis">${E_(p.tekst)}</p></div>`; }).join('')
      : '<p class="male">Za mało zamkniętych trade\'ów do porównań (potrzeba co najmniej 3 w każdej grupie).</p>';
    const w = wn.wyjscia;
    $('kartaWyjscia').innerHTML = `<div class="sekcja-tytul"><h2>Wyjścia</h2><span class="b-male">ile zostawiasz na stole</span></div>` + (w ? `<div class="wyjscia-siatka">
        <div class="kafel"><div class="et">Po wyjściu z zyskiem (4 h)</div><div class="wart plus">+${nf(2).format(w.poWyjsciuZyski || 0)}%</div><div class="pod">średnio tyle cena szła jeszcze w Twoją stronę (${ileTrade(w.wygrane)})</div></div>
        <div class="kafel"><div class="et">Straty, które były na plusie</div><div class="wart">${w.stratyBylyNaPlusie}<small> / ${w.straty}</small></div><div class="pod">co najmniej +0,3% zanim skończyły się stratą – tu pomaga zasada 8 (SL na wejście po +1R)</div></div>
      </div>` : '<p class="male">Kliknij „Wypełnij za mnie” na zakładce Trade\'y – pobiorę świece i policzę ruch ceny w trakcie i po każdym trade\'zie.</p>');
    $('obserwacje').innerHTML = ((S.C && S.C.obserwacje) || []).map(o => `<li>${E_(o)}</li>`).join('') || '<li>Brak zaimportowanego dziennika.</li>';
  }
  function rysujKrzywa() {
    const el = $('krzywa'); if (!el) return;
    const z = S.lista.filter(t => !t.otwarta).sort((a, b) => a.zamkniecie - b.zamkniecie);
    let a = 0, b = 0; const pkt = [{ t: (z[0] ? z[0].otwarcie : Date.now()) - 60000, a: 0, b: 0 }];
    for (const t of z) { a += t.netto; if (DZ.zgodneKiedy(t)) b += t.netto; pkt.push({ t: t.zamkniecie, a, b, netto: t.netto, opis: t.strona.toUpperCase() + ' ' + rynekLadnie(t.rynek) }); }
    if (window.DZW && DZW.dostepne()) { if (!S.wKrzywa) S.wKrzywa = DZW.krzywa(el); S.wKrzywa.ustaw(pkt); }
    else el.innerHTML = '<p class="b-male">Nie wczytała się biblioteka wykresów.</p>';
    $('krzywaOpis').textContent = `${ileTrade(z.length)}. Wszystkie razem: ${usd(a)}. Gdybyś pominął trade'y łamiące zasady 4–7 (longi pod EMA200, wejście po stracie, po dużym zysku, więcej niż 2 dziennie): ${usd(b)} z ${ileTrade(S.wn.kiedy.n)}. Wszystkich 9 zasad (z SL i ryzykiem 1–2%) nie spełnił żaden trade. To rachunek wstecz na tych samych danych – nie gwarancja na przyszłość.`;
  }
  function rysujZasady() {
    const zs = (S.C && S.C.zasady) || [];
    $('zasadyTabela').innerHTML = `<div class="zasady-siatka">${S.wn.zasady.map(r => {
      const opis = zs.find(x => x.nr === r.kod), razem = r.zlamana.n + r.dotrzymana.n, udz = razem ? 100 * r.dotrzymana.n / razem : 0;
      return `<div class="zasada"><h3><span class="nr">${r.kod}</span><span>${E_(opis ? opis.zasada : r.krotko)}</span></h3>
        ${opis ? `<p class="dlaczego">${E_(opis.dlaczego)}</p>` : ''}
        <div class="pasek-z" title="dotrzymana ${r.dotrzymana.n}, złamana ${r.zlamana.n}"><i style="width:${udz.toFixed(1)}%"></i></div>
        <div class="liczby">
          <div><div class="et">Dotrzymana · ${r.dotrzymana.n}</div><div class="w ${kl(r.dotrzymana.netto)}">${r.dotrzymana.n ? usd(r.dotrzymana.netto) : '–'}</div></div>
          <div><div class="et">Złamana · ${r.zlamana.n}</div><div class="w ${kl(r.zlamana.netto)}">${r.zlamana.n ? usd(r.zlamana.netto) : '–'}</div></div>
        </div>${r.bezDanych ? `<span class="b-male">bez danych: ${ileTrade(r.bezDanych)}</span>` : ''}</div>`; }).join('')}</div>`;
  }
  function rysujSetupy() {
    const st = (S.C && S.C.setupy) || [];
    const roz = st.filter(s => fin(s.wynik_r)), plus = roz.filter(s => s.wynik_r > 0).length, sumaR = roz.reduce((a, s) => a + s.wynik_r, 0);
    $('setupyPod').textContent = `${st.length} setupów z analiz`;
    $('setupyKafle').innerHTML = [
      ['Rozstrzygnięte', `${roz.length}<small> / ${st.length}</small>`, 'z wynikiem TP albo SL'],
      ['Trafione', `${plus}<small> / ${roz.length}</small>`, roz.length ? proc(plus / roz.length) + ' skuteczności' : '–'],
      ['Suma', `<span class="${kl(sumaR)}">${(sumaR >= 0 ? '+' : '') + nf(2).format(sumaR)}R</span>`, roz.length ? 'średnio ' + nf(2).format(sumaR / roz.length) + 'R na setup' : '–'],
      ['Twoje trade\'y z setupem', String(S.lista.filter(t => t.setup).length), 'dopasowane do setupów']
    ].map(([et, w, p]) => `<div class="kafel"><div class="et">${et}</div><div class="wart">${w}</div><div class="pod">${p}</div></div>`).join('');
    $('setupyTabela').innerHTML = st.length ? `<div class="przewijana"><table class="tab karty-mobilne"><thead><tr><th>#</th><th>Data</th><th>Kierunek</th><th>Typ</th><th class="l">Wejście / SL / TP</th><th class="l">R:R</th><th>Status</th><th class="l">Wynik</th><th>Twoje trade'y</th></tr></thead><tbody>
      ${st.slice().reverse().map(s => { const tt = S.lista.filter(t => t.setup === s.id); return `<tr><td><b>${E_(s.id)}</b></td><td data-et="Data">${E_(s.data.slice(8, 10) + '.' + s.data.slice(5, 7))}</td><td><span class="kier ${s.kierunek.toLowerCase()}">${E_(s.kierunek)}</span></td><td>${E_(s.typ)}<span class="b-male">${E_(s.uwagi || '')}</span></td>
        <td class="l" data-et="Plan">${cena(s.wejscie)} / ${cena(s.sl)} / ${cena(s.tp)}</td><td class="l" data-et="R:R">${E_(s.rr)}</td><td data-et="Status">${E_(s.status)}</td><td class="l ${kl(s.wynik_r)}" data-et="Wynik">${fin(s.wynik_r) ? nf(2).format(s.wynik_r) + 'R' : '–'}</td>
        <td data-et="Twoje trade'y">${tt.length ? tt.map(t => `<a href="#" data-id="${E_(t.id)}">${kiedy(t.otwarcie)} <span class="${kl(t.netto)}">${usd(t.netto)}</span></a>`).join('<br>') : '<span class="b-male">brak</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="male">Brak zaimportowanego dziennika z Chrome.</p>';
  }
  $('setupyTabela').addEventListener('click', (e) => { const a = e.target.closest('[data-id]'); if (a) { e.preventDefault(); otworzTrade(a.dataset.id); } });

  // ------------------------------------------------------------------ start
  zakladka(location.hash.slice(1) || 'trade');
  wczytaj().catch(e => { stan('blad', 'błąd'); $('lista').innerHTML = `<div class="ramka blad">${E_(e.message)}</div>`; });
  // co 2 min odśwież (nowe trade'y z panelu, wpisy z telefonu) – gdy okno opisu jest zamknięte
  setInterval(() => { if (!document.hidden && $('okno').classList.contains('ukryte') && !S.zajety) wczytaj().catch(() => { }); }, 120000);
})();
