/* Asystent rynku (wersja 2) – wygląd jak panel, wszystko liczone przy wybranej dźwigni 1–40×.
 * Statystyka z historii Binance (+ funding), bieżący układ z Hyperliquid, walidacja walk-forward + permutacje,
 * dziennik sygnałów, newsy (tylko podgląd), powiadomienia. Silnik: asystent-silnik.js (AS.wynikiDzwignia). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const AS = LAB.AS, HL = 'https://api.hyperliquid.xyz/info';
  const TABELA_L = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40], SZYBKIE = [1, 3, 5, 10, 20, 25, 40];
  const NAZWY_CECH = { trend: 'Trend', rsi: 'RSI 14', zmiennosc: 'Zmienność', zakres: 'Zakres 20 świec', funding: 'Funding 24 h' };

  // ---------- formatowanie ----------
  const fmt = (v, m = 2) => Number.isFinite(v) ? v.toLocaleString('pl-PL', { minimumFractionDigits: m, maximumFractionDigits: m }) : '–';
  const cena$ = v => Number.isFinite(v) ? v.toLocaleString('pl-PL', { maximumFractionDigits: 0 }) + ' $' : '–';
  const usd = (v, m = 2) => Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('pl-PL', { minimumFractionDigits: m, maximumFractionDigits: m }) + ' $' : '–';
  const proc = (v, m = 0) => Number.isFinite(v) ? fmt(v * 100, m) + '%' : '–';
  const procZ = (v, m = 1) => Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v) * 100, m) + '%' : '–';
  const kl = v => v > 0 ? 'plus' : v < 0 ? 'minus' : '';
  const czas = t => new Date(t).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const godz = t => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pam = { czytaj(k, d) { try { const v = localStorage.getItem('asystent2-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    pisz(k, v) { try { localStorage.setItem('asystent2-' + k, JSON.stringify(v)); } catch (e) { /* tryb prywatny */ } } };
  const dLik = L => 1 / L - AS.MM;

  const S = { iw: pam.czytaj('interwal', '4h'), L: pam.czytaj('dzwignia', 10), kierunekPoz: null, hist: null, live: null, sygnaly: [],
    walidacja: null, walidGen: 0, workery: [], walidTimer: null };

  function tresc(id, html) { $(id).querySelector('.tresc').innerHTML = html; }
  function status(t, f) { $('status').textContent = t; if (f !== undefined) $('postep').style.width = (f * 100).toFixed(1) + '%'; }
  function stan(klasa, t) { $('stan').innerHTML = `<span class="kropka ${klasa}"></span> ${t}`; }
  const kafel = (et, wart, pod, klasa = '') => `<div class="kafel ${klasa}"><div class="et">${et}</div><div class="wart">${wart}</div>${pod ? `<div class="pod">${pod}</div>` : ''}</div>`;
  const czekaj = ms => new Promise(r => setTimeout(r, ms));

  // ---------- ustawienia ----------
  $('cechy').innerHTML = AS.CECHY.map(f => `<label class="check"><input type="checkbox" id="c-${f}"> ${{ trend: 'Trend (EMA 50/200)', rsi: 'RSI 14', zmiennosc: 'Zmienność (ATR)', zakres: 'Położenie w zakresie 20 świec', funding: 'Funding z 24 h' }[f]}</label>`).join('');
  const zapis = pam.czytaj('ustawienia', {});
  AS.CECHY.forEach(f => { $('c-' + f).checked = (zapis.cechy || ['trend', 'rsi', 'zmiennosc']).includes(f); });
  const POLA = ['k', 'm', 'H', 'minN', 'koszt', 'lata', 'nperm', 'depozyt'];
  POLA.forEach(id => { if (zapis[id] !== undefined) $(id).value = zapis[id]; });
  function zapiszUstawienia() {
    const o = { cechy: AS.CECHY.filter(f => $('c-' + f).checked) };
    POLA.forEach(id => { o[id] = $(id).value; });
    pam.pisz('ustawienia', o);
  }
  function opcjeBazowe() {
    return { k: +$('k').value, m: Math.max(0, +$('m').value), H: Math.round(+$('H').value), minN: Math.round(+$('minN').value), koszt: +$('koszt').value / 100,
      cechy: AS.CECHY.filter(f => $('c-' + f).checked) };
  }
  const depozyt = () => Math.max(1, +$('depozyt').value || 150);

  // ---------- dźwignia ----------
  $('szybkie').innerHTML = SZYBKIE.map(L => `<button data-l="${L}">${L}×</button>`).join('');
  $('dzwignia').value = S.L;
  function pokazDzwignie() {
    $('dzwWart').textContent = S.L + '×';
    $('dzwOpis').innerHTML = `likwidacja przy ruchu ceny<br>o ok. ${fmt(dLik(S.L) * 100, 2)}%`;
    document.querySelectorAll('#szybkie button').forEach(b => b.classList.toggle('wl', +b.dataset.l === S.L));
    const proc = (S.L - 1) / 39 * 100;
    $('dzwignia').style.background = `linear-gradient(90deg, #1fdaa9 0%, #ffd166 ${Math.max(30, proc * .7)}%, #ff6b6b 100%)`;
  }
  function ustawL(L) {
    L = Math.min(40, Math.max(1, Math.round(L)));
    if (L === S.L && S.hist && S.hist.biez && S.hist.biez.L === L) return;
    S.L = L; pam.pisz('dzwignia', L); $('dzwignia').value = L; pokazDzwignie();
    if (!S.hist) return;
    S.hist.biez = policzL(L);
    renderWszystko();
    clearTimeout(S.walidTimer); S.walidTimer = setTimeout(walidacja, 700);
  }
  $('dzwignia').addEventListener('input', () => ustawL(+$('dzwignia').value));
  $('szybkie').addEventListener('click', e => { const b = e.target.closest('button'); if (b) ustawL(+b.dataset.l); });
  $('depozyt').addEventListener('change', () => { zapiszUstawienia(); renderWszystko(); });
  $('kierunekPoz').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.kierunekPoz = +b.dataset.k; renderPoziomy(); } });
  pokazDzwignie();

  // ---------- interwał ----------
  function pokazInterwal() { document.querySelectorAll('#interwaly button').forEach(b => b.classList.toggle('wl', b.dataset.iw === S.iw)); }
  $('interwaly').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.dataset.iw === S.iw) return;
    S.iw = b.dataset.iw; pam.pisz('interwal', S.iw); pokazInterwal(); przelicz();
  });
  pokazInterwal();

  // ---------- liczenie dla jednej dźwigni ----------
  function opcjeL(L) { return Object.assign({}, S.hist.o, { dzwignia: L }); }
  function policzL(L) {
    const h = S.hist, o = opcjeL(L);
    const w = AS.wynikiDzwignia(h.s, h.k, o);
    return { L, w, stat: AS.statystyka(w, h.ep, h.s.n - 1), wf: AS.walkForward(h.s, h.k, w, h.ep, o, h.start) };
  }
  function danaL(L) { return S.hist.biez && S.hist.biez.L === L ? S.hist.biez : S.hist.perL.get(L); }

  // ---------- statystyka z historii ----------
  async function przelicz() {
    zapiszUstawienia();
    $('przelicz').disabled = true; $('pobierzHist').classList.add('ukryte');
    S.walidGen++; S.workery.forEach(w => w.terminate()); S.workery = []; S.walidacja = null;
    try {
      const o = opcjeBazowe();
      if (!o.cechy.length) throw new Error('Zaznacz co najmniej jedną cechę układu.');
      const plik = `binance-BTCUSDT-${S.iw}.json`;
      status('Wczytuję historię ' + S.iw + '…', 0.02); stan('laduje', 'liczę statystykę…');
      const r = await fetch('../dane/' + plik);
      if (!r.ok) {
        $('pobierzHist').classList.remove('ukryte');
        throw new Error(`Brak historii świec ${S.iw} (dane/${plik}). Kliknij „Pobierz historię tego interwału” (dla 15m trwa to kilka minut).`);
      }
      const dane = await r.json();
      const ms = LAB.MS[dane.interwal], rok = LAB.SWIEC_ROK[dane.interwal];
      const s = LAB.zSwiec(dane.swiece);
      let opisF = 'bez fundingu';
      const rf = await fetch(`../dane/funding/${dane.zrodlo}-${dane.symbol}.json`);
      if (rf.ok) { const df = await rf.json(); s.F = LAB.fundingSwiec(s, df.stawki, ms, 0.0001 / 8).F; opisF = `funding Binance od ${new Date(df.stawki[0][0]).toISOString().slice(0, 7)}`; }
      const start = AS.START + Math.round(+$('lata').value * rok);
      if (start > s.n - rok / 2) throw new Error('Za mało historii na naukę i sprawdzenie – zmniejsz liczbę lat do nauki.');
      status('Liczę cechy układów…', 0.05); await czekaj(10);
      const k = AS.cechy(s, ms), ep = AS.epizody(s, k, o.cechy, o.H);
      S.hist = { plik, dane: { zrodlo: dane.zrodlo, symbol: dane.symbol, interwal: dane.interwal }, s, ms, rok, o, start, k, ep, opisF, perL: new Map(), biez: null };
      for (let q = 0; q < TABELA_L.length; q++) {
        status(`Liczę wyniki przy ${TABELA_L[q]}×…`, 0.08 + 0.6 * q / TABELA_L.length); await czekaj(0);
        const x = policzL(TABELA_L[q]);
        S.hist.perL.set(x.L, { L: x.L, stat: x.stat, wf: x.wf });
      }
      S.hist.biez = policzL(S.L);
      status(`Gotowe: ${s.n.toLocaleString('pl-PL')} świec ${S.iw} od ${new Date(s.t[0]).getUTCFullYear()} r.`, 0.7);
      await odswiezNaZywo(true);
      walidacja();
    } catch (e) {
      status('Błąd: ' + e.message, 0); stan('blad', 'brak statystyki');
      $('decyzja').textContent = '–'; $('decyzja').className = 'decyzja czekaj'; $('zdanie').textContent = e.message;
    }
    $('przelicz').disabled = false;
  }
  $('przelicz').onclick = przelicz;
  $('pobierzHist').onclick = async () => {
    $('pobierzHist').disabled = true; status(`Pobieram historię ${S.iw} z Binance… (15m: kilka minut, nie zamykaj strony)`, 0.02);
    try {
      const r = await fetch(`/api/pobierz?zrodlo=binance&interwal=${S.iw}`, { method: 'POST' });
      const t = await r.text();
      if (!r.ok) throw new Error(t.trim().split('\n').slice(-2).join(' '));
      $('pobierzHist').classList.add('ukryte'); await przelicz();
    } catch (e) { status('Błąd pobierania: ' + e.message); }
    $('pobierzHist').disabled = false;
  };

  // ---------- walidacja (permutacje w wątkach) dla bieżącej dźwigni ----------
  function walidacja() {
    const h = S.hist; if (!h || !h.biez) return;
    const gen = ++S.walidGen, L = S.L;
    S.workery.forEach(w => w.terminate()); S.workery = []; S.walidacja = null;
    renderWiarygodnosc();
    const N = Math.max(20, Math.round(+$('nperm').value)), ziarna = Array.from({ length: N }, (_, i) => 700001 + i);
    const ile = Math.max(1, Math.min(N, (navigator.hardwareConcurrency || 4) - 1));
    const paczki = Array.from({ length: ile }, () => []); ziarna.forEach((z, i) => paczki[i % ile].push(z));
    const wyniki = []; let gotowe = 0; const t0 = performance.now();
    paczki.forEach(p => {
      const w = new Worker('worker.js'); S.workery.push(w);
      w.postMessage({ typ: 'init', n: h.s.n, lo: h.s.lo, lh: h.s.lh, ll: h.s.ll, lc: h.s.lc, F: h.s.F || null });
      w.onmessage = e => {
        if (gen !== S.walidGen) return;
        if (e.data.koniec) {
          w.terminate();
          if (++gotowe === ile) koniecWalidacji(gen, L, N, wyniki, (performance.now() - t0) / 1000);
          return;
        }
        wyniki.push(e.data);
        $('wiarPod').textContent = `liczę ${L}×: permutacja ${wyniki.length} z ${N}`;
      };
      w.onerror = e => { if (gen === S.walidGen) $('wiarPod').textContent = 'błąd walidacji: ' + e.message; };
      w.postMessage({ typ: 'as', ziarna: p, start: h.start, ms: h.ms, opcje: opcjeL(L) });
    });
  }
  function koniecWalidacji(gen, L, N, wyniki, sekund) {
    if (gen !== S.walidGen) return;
    S.workery = [];
    wyniki.sort((a, b) => a.ziarno - b.ziarno);
    const h = S.hist, wf = danaL(L).wf, sumy = wyniki.map(x => x.wynik);
    const p = wf.transakcje.length ? (1 + sumy.filter(v => v >= wf.sumaR).length) / (N + 1) : 1;
    S.walidacja = { L, p, N, sumy, sekund };
    renderWszystko();
    status(`Gotowe: ${h.s.n.toLocaleString('pl-PL')} świec ${h.dane.interwal}, walidacja ${L}× w ${fmt(sekund, 1)} s.`, 1);
    // zapis do niezależnego sprawdzenia (narzedzia/sprawdz-asystenta.ps1)
    const ost = h.s.n - 1, klucz = AS.klucz(h.k, ost, h.o.cechy);
    fetch('/api/zapisz?plik=ostatni-asystent.json', { method: 'POST', body: JSON.stringify({
      kiedy: new Date().toISOString(), plik: h.plik, opcje: opcjeL(L), start: h.start, funding: !!h.s.F, swiec: h.s.n,
      wf: { transakcji: wf.transakcje.length, sumaR: wf.sumaR, pf: wf.pf, skutecznosc: wf.skutecznosc, maxDDR: wf.maxDDR, likwidacji: wf.likwidacji, transakcje: wf.transakcje },
      ostatniaSwieca: { indeks: ost, klucz, stat: danaL(L).stat.mapa.get(klucz) || null },
      tabela: TABELA_L.map(x => { const d = S.hist.perL.get(x); return { L: x, transakcji: d.wf.transakcje.length, sumaR: d.wf.sumaR, likwidacji: d.wf.likwidacji }; }),
      p, permutacji: N, pierwsze: wyniki.slice(0, 3) }, null, 1) }).catch(() => { });
  }
  function zaufane(L) {
    const h = S.hist, v = S.walidacja; if (!h || !v || v.L !== L) return null;
    const wf = danaL(L).wf;
    return wf.transakcje.length >= 30 && wf.sumaR > 0 && v.p < 0.05;
  }

  // ---------- na żywo z Hyperliquid ----------
  async function hl(cialo) {
    const r = await fetch(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cialo) });
    if (!r.ok) throw new Error('Hyperliquid ' + r.status);
    return r.json();
  }
  async function odswiezNaZywo(szybko) {
    const h = S.hist; if (!h) return;
    try {
      const ms = h.ms, teraz = Date.now();
      const [swiece, fund, mids] = await Promise.all([
        hl({ type: 'candleSnapshot', req: { coin: 'BTC', interval: h.dane.interwal, startTime: teraz - 1200 * ms, endTime: teraz } }),
        hl({ type: 'fundingHistory', coin: 'BTC', startTime: teraz - 3 * 86400000 }),
        hl({ type: 'allMids' })]);
      const zamkniete = swiece.filter(k => k.t + ms <= teraz).map(k => [k.t, +k.o, +k.h, +k.l, +k.c, +k.v]);
      const s2 = LAB.zSwiec(zamkniete);
      s2.F = LAB.fundingSwiec(s2, fund.map(f => [Math.round(f.time / 60000) * 60000, +f.fundingRate]), ms, 0.0001 / 8).F;
      const k2 = AS.cechy(s2, ms), i = s2.n - 1;
      S.live = { s2, k2, i, cena: +mids.BTC, swiece: zamkniete, czasSwiecy: s2.t[i] + ms, ostatniFunding: fund.length ? +fund[fund.length - 1].fundingRate : NaN, kiedy: teraz };
      renderWszystko();
      if (!szybko) await obsluzSygnal();
    } catch (e) {
      stan('blad', 'brak danych z Hyperliquid – ponowię za minutę');
    }
  }

  // ---------- statystyka bieżącego układu ----------
  function statUkladu(L, cechy) {
    const h = S.hist, L2 = S.live, d = danaL(L);
    if (!d) return null;
    if (!cechy || cechy.join() === h.o.cechy.join()) return d.stat.mapa.get(AS.klucz(L2.k2, L2.i, h.o.cechy)) || null;
    // przybliżenie z mniejszej liczby cech – tylko dla bieżącej dźwigni (są pełne wyniki)
    const ep = AS.epizody(h.s, h.k, cechy, h.o.H);
    return AS.statystyka(d.w, ep, h.s.n - 1).mapa.get(AS.klucz(L2.k2, L2.i, cechy)) || null;
  }
  function biezacy() {
    const h = S.hist, o = h.o;
    let st = statUkladu(S.L), cechy = o.cechy.slice(), przybl = false;
    while ((!st || st.nL < o.minN) && cechy.length > 1) { cechy = cechy.slice(0, -1); st = statUkladu(S.L, cechy); przybl = true; }
    const dec = !przybl && st ? AS.decyzja(st, o.minN) : 0;
    return { st, cechy, przybl, dec };
  }
  function podsum(st, strona) {
    const n = st ? st['n' + strona] : 0;
    const p = AS.podsumuj(n, st ? st['s' + strona] : 0, st ? st['s2' + strona] : 0);
    return Object.assign(p, { n, cel: n ? st['cel' + strona] / n : NaN, stop: n ? st['stop' + strona] / n : NaN, lik: n ? st['lik' + strona] / n : NaN,
      czas: n ? (n - st['cel' + strona] - st['stop' + strona] - st['lik' + strona]) / n : NaN });
  }

  // ---------- rysowanie ----------
  function renderWszystko() {
    if (!S.hist || !S.live) return;
    const B = biezacy();
    renderTeraz(B); renderPoziomy(B); renderUklad(); renderDzwignie(); renderWiarygodnosc(); renderDziennik();
    // dla karty „Twoje trade'y” (asystent-dziennik.js): stan tylko do odczytu
    window.ASYSTENT_STAN = { hist: S.hist, live: S.live, L: S.L, decyzja: B.dec };
    document.dispatchEvent(new CustomEvent('asystent-odswiezony'));
    const L2 = S.live;
    stan('zywe', `HL na żywo · świeca ${S.hist.dane.interwal} ${godz(L2.czasSwiecy)} · następna ${godz(L2.czasSwiecy + S.hist.ms)}`);
    $('cenaTytul').textContent = cena$(L2.cena);
  }

  function renderTeraz(B) {
    const h = S.hist, L = S.L, o = h.o, nazwa = B.dec > 0 ? 'LONG' : B.dec < 0 ? 'SHORT' : 'CZEKAJ';
    $('decEt').textContent = `Sygnał przy ${L}× · świeca ${h.dane.interwal} z ${czas(S.live.czasSwiecy)}`;
    $('decyzja').textContent = nazwa; $('decyzja').className = 'decyzja ' + nazwa.toLowerCase();
    const zauf = zaufane(L);
    $('decZnaczniki').innerHTML = B.dec === 0 ? '<span class="znacznik">brak przewagi przy tej dźwigni</span>'
      : zauf === null ? '<span class="znacznik info">walidacja w toku…</span>'
      : zauf ? '<span class="znacznik ok">z potwierdzeniem w walidacji</span>' : '<span class="znacznik uwaga">bez potwierdzenia w walidacji</span>';
    $('terazPod').textContent = `historia BTC od ${new Date(h.s.t[0]).getUTCFullYear()} r. · ${h.dane.interwal}`;
    const Lg = podsum(B.st, 'L'), Sh = podsum(B.st, 'S');
    // zdanie
    const nazwaK = d => d > 0 ? 'long' : 'short';
    const lepszy = (Lg.srednia || -9) >= (Sh.srednia || -9) ? 1 : -1, P = lepszy > 0 ? Lg : Sh;
    let zd;
    if (!B.st) zd = 'Ten układ jeszcze nie wystąpił w historii – brak podstaw do oceny.';
    else if (B.dec !== 0) {
      const X = B.dec > 0 ? Lg : Sh;
      zd = `W <b>${X.n}</b> podobnych układach ${nazwaK(B.dec)} przy ${L}× doszedł do celu w <b>${proc(X.cel)}</b>, a likwidacja przyszła pierwsza w <b>${proc(X.lik)}</b>. Średnio <b class="${kl(X.srednia)}">${procZ(X.srednia)}</b> depozytu na transakcję (95%: ${procZ(X.dolna)} … ${procZ(X.srednia + 1.96 * X.se)}).`;
    } else if (P.srednia < 0 && P.srednia + 1.96 * P.se < 0) {
      zd = `Przy ${L}× w podobnych układach <b>oba kierunki średnio tracą</b>: long <b class="minus">${procZ(Lg.srednia)}</b>, short <b class="${kl(Sh.srednia)}">${procZ(Sh.srednia)}</b> depozytu na transakcję.`;
      const lik = Math.max(Lg.lik || 0, Sh.lik || 0);
      if (lik >= 0.2) zd += ` Likwidacja przychodziła pierwsza w <b>${proc(lik)}</b> przypadków.`;
    } else {
      zd = `Brak wyraźnej przewagi przy ${L}×. Lepiej wypadał ${nazwaK(lepszy)}: średnio <b class="${kl(P.srednia)}">${procZ(P.srednia)}</b> depozytu, ale 95% przedział (${procZ(P.dolna)} … ${procZ(P.srednia + 1.96 * P.se)}) obejmuje ${P.srednia >= 0 ? 'stratę' : 'zero'}.`;
      if (P.lik >= 0.2) zd += ` W <b>${proc(P.lik)}</b> podobnych przypadków cena najpierw dotknęła likwidacji.`;
    }
    // przy jakich dźwigniach ten układ miał przewagę
    if (!B.przybl && B.st) {
      const dz = TABELA_L.map(x => ({ L: x, dec: AS.decyzja(statUkladu(x) || {}, o.minN) }));
      const zPrzewaga = dz.filter(x => x.dec !== 0);
      if (zPrzewaga.length) {
        const kier = zPrzewaga[0].dec, maks = Math.max(...zPrzewaga.filter(x => x.dec === kier).map(x => x.L));
        const pierwszaBez = dz.find(x => x.L > maks);
        zd += `<br><span class="male">Ten układ miał przewagę (${nazwaK(kier)}) do <b>${maks}×</b>${pierwszaBez ? `. Od ${pierwszaBez.L}× likwidacje i opłaty ją zjadają` : ''}.</span>`;
      } else zd += '<br><span class="male">Przy żadnej dźwigni od 1× do 40× ten układ nie miał statystycznej przewagi.</span>';
    }
    $('zdanie').innerHTML = zd;
    // paski szans
    const pasek = (nazwa, X) => X.n ? `<div><div class="szansa-g"><b>${nazwa}</b><span>${X.n} przypadków · średnio <b class="${kl(X.srednia)}">${procZ(X.srednia)}</b> depozytu · 95%: ${procZ(X.dolna)} … ${procZ(X.srednia + 1.96 * X.se)}</span></div>
      <div class="pasek-szans" role="img" aria-label="${nazwa}: cel ${proc(X.cel)}, czas ${proc(X.czas)}, stop ${proc(X.stop)}, likwidacja ${proc(X.lik)}">
        <i class="c" style="width:${X.cel * 100}%" title="cel ${proc(X.cel)}"></i><i class="t" style="width:${X.czas * 100}%" title="czas minął ${proc(X.czas)}"></i><i class="s" style="width:${X.stop * 100}%" title="stop ${proc(X.stop)}"></i><i class="l" style="width:${X.lik * 100}%" title="likwidacja ${proc(X.lik)}"></i></div>
      <div class="legenda" style="margin-top:4px"><span style="--k:#43f0c6">${proc(X.cel)}</span><span style="--k:rgba(255,255,255,.28)">${proc(X.czas)}</span><span style="--k:#ffd166">${proc(X.stop)}</span><span style="--k:#ff6b6b">${proc(X.lik)}</span></div></div>`
      : `<div><div class="szansa-g"><b>${nazwa}</b><span>brak przypadków</span></div></div>`;
    $('szanse').innerHTML = pasek('Long', Lg) + pasek('Short', Sh);
    let uw = '';
    if (B.przybl) uw += `<div class="ramka uwaga">Ten dokładny układ był za rzadko (mniej niż ${o.minN} razy). Pokazuję przybliżenie z cech: ${B.cechy.map(f => NAZWY_CECH[f]).join(', ')}. Z przybliżenia nie daję sygnału.</div>`;
    if (B.dec !== 0 && zauf === false) uw += `<div class="ramka uwaga"><b>Kierunek wynika z historii podobnych układów, ale przy ${L}× ta metoda nie przeszła walidacji</b> (karta „Wiarygodność”). To opis przeszłości, a nie sprawdzona przewaga.</div>`;
    uw += `<p class="b-male" style="margin-top:12px">Cel ${fmt(o.k, 2)}× ATR, stop ${o.m > 0 ? fmt(o.m, 2) + '× ATR' : 'brak (tylko likwidacja)'}, maks. ${o.H} świec, po opłatach (${fmt(o.koszt * 100, 3)}% za stronę) i fundingu. Gdy w jednej świecy cena dotknęła i straty, i celu, liczę stratę. Kolejne świece tego samego ruchu liczą się jako jeden przypadek.</p>`;
    $('terazUwagi').innerHTML = uw;
  }

  function renderPoziomy(B) {
    B = B || biezacy();
    const L = S.L, o = S.hist.o, L2 = S.live, D = depozyt();
    const Lg = podsum(B.st, 'L'), Sh = podsum(B.st, 'S');
    const kier = S.kierunekPoz || (B.dec !== 0 ? B.dec : ((Lg.srednia || -9) >= (Sh.srednia || -9) ? 1 : -1));
    document.querySelectorAll('#kierunekPoz button').forEach(b => b.classList.toggle('wl', +b.dataset.k === kier));
    const cena = L2.cena, atr = L2.k2.atr[L2.i], N = D * L, btc = N / cena;
    const dl = dLik(L), likw = cena * (1 - kier * dl);
    const dTp = o.k * atr / cena, tp = cena * (1 + kier * dTp);
    const dSl = o.m > 0 ? o.m * atr / cena : Infinity, stopDziala = dSl < dl, sl = o.m > 0 ? cena * (1 - kier * dSl) : NaN;
    const oplaty = 2 * o.koszt * N;
    const zTp = N * dTp - oplaty, zSl = stopDziala ? -(N * dSl + oplaty) : NaN, zLik = -D;
    const fundDzien = Number.isFinite(L2.ostatniFunding) ? -kier * L2.ostatniFunding * 24 * N : NaN;
    const X = kier > 0 ? Lg : Sh;
    const poz = [{ n: 'Cel', c: tp, k: '#43f0c6' }, { n: 'Wejście', c: cena, k: '#a7cdc4', przer: true }, { n: 'Likwidacja', c: likw, k: '#ff6b6b' }];
    if (o.m > 0) poz.push({ n: stopDziala ? 'Stop' : 'Stop (za likw.)', c: sl, k: stopDziala ? '#ffd166' : 'rgba(255,209,102,.4)' });
    tresc('poziomy', `
      <div class="drabinka-uklad">
        <div class="drabinka">${drabinka(poz, cena, kier)}</div>
        <div class="kafle" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
          ${kafel('Cel · ' + fmt(dTp * 100, 2) + '% ceny', cena$(tp), `<span class="plus">${usd(zTp)}</span> · ${procZ(zTp / D)}`, 'tp')}
          ${kafel('Wejście ~', cena$(cena), `pozycja ${fmt(N, 0)} $ = ${fmt(btc, 5)} BTC`, 'we')}
          ${o.m > 0 ? kafel('Stop · ' + fmt(dSl * 100, 2) + '% ceny', cena$(sl), stopDziala ? `<span class="minus">${usd(zSl)}</span> · ${procZ(zSl / D)}` : '<span class="ostrz">likwidacja wcześniej – stop nie zadziała</span>', 'sl') : ''}
          ${kafel('Likwidacja · ' + fmt(dl * 100, 2) + '% ceny', cena$(likw), `<span class="minus">${usd(zLik)}</span> · −100%`, 'lik')}
        </div>
      </div>
      ${o.m > 0 && !stopDziala ? `<div class="ramka blad"><b>Przy ${L}× likwidacja (${fmt(dl * 100, 2)}% od wejścia) wypada przed stopem (${fmt(dSl * 100, 2)}%).</b> Zwykłe wahanie BTC na świecach ${S.hist.dane.interwal} (ATR ${fmt(atr / cena * 100, 2)}%) wystarczy, żeby zamknąć pozycję z utratą całego depozytu. Statystyka przy tej dźwigni już to uwzględnia.</div>` : ''}
      <div class="kafle" style="margin-top:12px">
        ${kafel('W historii (' + (kier > 0 ? 'long' : 'short') + ', ' + L + '×)', X.n ? `<span class="${kl(X.srednia)}">${usd(X.srednia * D)}</span>` : '–', X.n ? `średnio na transakcję · ${X.n} przypadków` : 'brak przypadków')}
        ${kafel('Opłaty (otwarcie + zamknięcie)', usd(-oplaty), fmt(o.koszt * 100, 3) + '% × 2 od pozycji')}
        ${kafel('Funding teraz', Number.isFinite(fundDzien) ? `<span class="${kl(fundDzien)}">${usd(fundDzien)}</span>` : '–', Number.isFinite(L2.ostatniFunding) ? `na dobę · stawka HL ${fmt(L2.ostatniFunding * 100, 4)}%/h` : '')}
      </div>
      <p class="b-male" style="margin-top:10px">Poziomy liczone od bieżącej ceny BTC na HL i ATR ostatniej świecy ${S.hist.dane.interwal}. Likwidacja w przybliżeniu (1/dźwignia − 1,25%). Dokładną cenę pokazuje giełda po otwarciu pozycji.</p>`);
  }

  function drabinka(poz, cena, kier) {
    const W = 250, H = 300, gora = 22, dol = 10;
    const ceny = poz.map(p => p.c).filter(Number.isFinite);
    let mn = Math.min(...ceny), mx = Math.max(...ceny); const pad = (mx - mn) * 0.08 || cena * 0.002; mn -= pad; mx += pad;
    const Y = c => gora + (mx - c) / (mx - mn) * (H - gora - dol);
    const cel = poz.find(p => p.n === 'Cel'), lik = poz.find(p => p.n === 'Likwidacja');
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Poziomy cen: cel, wejście, stop i likwidacja">`;
    s += `<rect x="0" y="${Math.min(Y(cel.c), Y(cena))}" width="${W}" height="${Math.abs(Y(cel.c) - Y(cena))}" fill="rgba(67,240,198,.08)"/>`;
    s += `<rect x="0" y="${Math.min(Y(lik.c), Y(cena))}" width="${W}" height="${Math.abs(Y(lik.c) - Y(cena))}" fill="rgba(255,107,107,.08)"/>`;
    // etykiety bez nachodzenia na siebie
    // etykiety nad liniami; gdy linie są blisko siebie, etykiety rozsuwamy (min. 17 px) i łączymy kreską z linią
    const etyk = poz.filter(p => Number.isFinite(p.c)).map(p => ({ p, y: Y(p.c) })).sort((a, b) => a.y - b.y);
    etyk.forEach((e, q) => { e.yt = Math.max(e.y - 5, q ? etyk[q - 1].yt + 17 : 14); });
    for (const e of etyk) {
      s += `<line x1="0" x2="${W}" y1="${e.y}" y2="${e.y}" stroke="${e.p.k}" stroke-width="${e.p.przer ? 1.4 : 2}" ${e.p.przer ? 'stroke-dasharray="4 4"' : ''}/>`;
      if (e.yt > e.y - 5 + 0.5) s += `<line x1="${W - 92}" x2="${W - 92}" y1="${e.y}" y2="${e.yt - 10}" stroke="${e.p.k}" stroke-width="1" opacity=".6"/>`;
      s += `<text x="2" y="${e.yt}" fill="${e.p.k}">${e.p.n}</text><text x="${W - 2}" y="${e.yt}" fill="#ecfffa" text-anchor="end">${cena$(e.p.c)}</text>`;
    }
    return s + '</svg>';
  }

  function renderUklad() {
    const h = S.hist, L2 = S.live, k2 = L2.k2, i = L2.i, c = k2.c[i], w = f => h.o.cechy.includes(f);
    $('ukladPod').textContent = `świeca ${h.dane.interwal} z ${czas(L2.czasSwiecy)}`;
    const wiersz = (f, wart, miernik) => `<div class="cecha${w(f) ? '' : ' poza'}"><div class="n">${NAZWY_CECH[f]}<small>${w(f) ? 'w statystyce' : 'poza statystyką'}</small></div><div class="w">${wart}${miernik || ''}</div></div>`;
    const znak = (x, a, b) => Math.max(0, Math.min(100, (x - a) / (b - a) * 100));
    const tr = k2.trend[i], rsi = k2.rsiWart[i], zm = k2.zmiennoscWart[i];
    let mx = -Infinity, mn = Infinity; for (let j = i - 19; j <= i; j++) { mx = Math.max(mx, k2.h[j]); mn = Math.min(mn, k2.l[j]); }
    const pozZ = mx > mn ? (c - mn) / (mx - mn) : 0.5;
    tresc('uklad', `<div class="cechy-lista">
      ${wiersz('trend', `<span class="znacznik ${tr === 2 ? 'ok' : tr === 0 ? 'zle' : ''}">${AS.OPIS.trend[tr]}</span><div class="b-male" style="margin-top:4px">EMA50 ${cena$(k2.e50[i])} · EMA200 ${cena$(k2.e200[i])}</div>`)}
      ${wiersz('rsi', `<b>${fmt(rsi, 0)}</b> · ${['wyprzedanie (< 30)', 'słabo (30–45)', 'neutralnie (45–55)', 'mocno (55–70)', 'wykupienie (> 70)'][k2.rsi[i]]}`, `<div class="miernik strefy"><i style="left:${znak(rsi, 0, 100)}%"></i></div>`)}
      ${wiersz('zmiennosc', `<b>${fmt(k2.atr[i] / c * 100, 2)}%</b> ceny na świecę · ${fmt(zm, 2)}× średniej ze 100 świec`, `<div class="miernik"><i style="left:${znak(zm, 0.4, 2)}%"></i></div>`)}
      ${wiersz('zakres', `<b>${proc(pozZ)}</b> zakresu ${cena$(mn)} – ${cena$(mx)}`, `<div class="miernik"><i style="left:${pozZ * 100}%"></i></div>`)}
      ${wiersz('funding', `<b>${fmt(k2.funding24[i] * 100, 4)}%</b> w 24 h · ${AS.OPIS.funding[k2.funding[i]]}`)}
    </div>`);
  }

  function renderDzwignie() {
    const h = S.hist, o = h.o, D = depozyt(), lat = (h.s.n - h.start) / h.rok;
    const lista = [...new Set(TABELA_L.concat([S.L]))].sort((a, b) => a - b);
    const kom = (X, strona) => X.n ? `<td class="${strona ? 'gr' : ''}">${proc(X.cel)}</td><td>${proc(X.lik)}<span class="mini"><i style="width:${X.lik * 100}%"></i></span></td><td class="${kl(X.srednia)}">${procZ(X.srednia)}</td>` : `<td class="${strona ? 'gr' : ''}">–</td><td>–</td><td>–</td>`;
    const w1 = lista.map(L => {
      const st = statUkladu(L), Lg = podsum(st, 'L'), Sh = podsum(st, 'S'), dec = st ? AS.decyzja(st, o.minN) : 0;
      return `<tr data-l="${L}" class="${L === S.L ? 'wazny' : ''}" style="cursor:pointer"><td><b>${L}×</b> <span class="b-male">${fmt(dLik(L) * 100, 2)}%</span></td>${kom(Lg, 1)}${kom(Sh, 1)}<td class="gr ${dec > 0 ? 'plus' : dec < 0 ? 'minus' : ''}">${dec > 0 ? 'LONG' : dec < 0 ? 'SHORT' : '—'}</td></tr>`;
    }).join('');
    const w2 = lista.map(L => {
      const d = danaL(L) || policzL(L), wf = d.wf, n = wf.transakcje.length;
      return `<tr data-l="${L}" class="${L === S.L ? 'wazny' : ''}" style="cursor:pointer"><td><b>${L}×</b></td><td>${n}</td><td>${n ? proc(wf.skutecznosc) : '–'}</td><td class="${wf.likwidacji ? 'minus' : ''}">${n ? wf.likwidacji : '–'}</td>
        <td class="${kl(wf.sumaR)}"><b>${n ? usd(wf.sumaR * D, 0) : '–'}</b></td><td>${n ? usd(-wf.maxDDR * D, 0) : '–'}</td></tr>`;
    }).join('');
    tresc('dzwignie', `
      <h3 style="margin-top:0">W bieżącym układzie rynku</h3>
      <div class="przewin"><table><thead><tr><th>Dźwignia · likw.</th><th class="gr" style="text-align:right">Long: cel</th><th>likwidacja</th><th>średnio</th><th class="gr">Short: cel</th><th>likwidacja</th><th>średnio</th><th class="gr">Sygnał</th></tr></thead><tbody id="tabDz1">${w1}</tbody></table></div>
      <p class="b-male" style="margin-top:6px">„Średnio” = przeciętny wynik jednej transakcji w % depozytu (po opłatach i fundingu). Kliknij wiersz, żeby wybrać dźwignię.</p>
      <h3>Gdybyś przez ostatnie ${fmt(lat, 1)} r. brał każdy sygnał asystenta (depozyt ${fmt(D, 0)} $ na transakcję)</h3>
      <div class="przewin"><table><thead><tr><th>Dźwignia</th><th>Transakcji</th><th>Trafione</th><th>Likwidacje</th><th>Wynik</th><th>Najgłębsze obsunięcie</th></tr></thead><tbody id="tabDz2">${w2}</tbody></table></div>
      <p class="b-male" style="margin-top:6px">Walk-forward: przy każdej świecy decyzja tylko z przeszłości, jedna transakcja naraz, po opłatach i fundingu. Lata ${new Date(h.s.t[h.start]).getUTCFullYear()}–${new Date(h.s.t[h.s.n - 1]).getUTCFullYear()} nie były użyte do nauki.</p>`);
    $('dzwignie').querySelectorAll('tr[data-l]').forEach(tr => tr.addEventListener('click', () => ustawL(+tr.dataset.l)));
  }

  function renderWiarygodnosc() {
    const h = S.hist; if (!h || !h.biez) return;
    const L = S.L, wf = h.biez.wf, D = depozyt(), v = S.walidacja && S.walidacja.L === L ? S.walidacja : null, ok = zaufane(L);
    const n = wf.transakcje.length, longi = wf.transakcje.filter(x => x.kierunek > 0).length, lat = (h.s.n - h.start) / h.rok;
    if (v) $('wiarPod').innerHTML = ok ? '<span class="znacznik ok">potwierdzone</span>' : '<span class="znacznik zle">niepotwierdzone</span>';
    tresc('wiarygodnosc', `
      <p class="male">Przez ostatnie ${fmt(lat, 1)} r. asystent „grał” przy ${L}× na ślepo: przy każdej świecy decydował tylko z przeszłości i brał każdy swój sygnał.
      Potem to samo na ${v ? v.N : '…'} przetasowanych wersjach rynku, w których żadnych wzorców nie ma.</p>
      <div class="kafle">
        ${kafel('Sygnałów (long / short)', `${n}`, `${longi} / ${n - longi}`)}
        ${kafel(`Wynik przy ${fmt(D, 0)} $ na transakcję`, `<span class="${kl(wf.sumaR)}">${n ? usd(wf.sumaR * D, 0) : '–'}</span>`, n ? `suma ${procZ(wf.sumaR, 0)} depozytu` : '')}
        ${kafel('Trafione', n ? proc(wf.skutecznosc) : '–', 'transakcji na plus')}
        ${kafel('Likwidacje', n ? `<span class="${wf.likwidacji ? 'minus' : ''}">${wf.likwidacji}</span>` : '–', n ? proc(wf.likwidacji / n) + ' transakcji' : '')}
        ${kafel('Profit factor', n ? fmt(wf.pf, 2) : '–', 'zyski / straty')}
        ${kafel('p-wartość', v ? (n ? proc(v.p, 1) : '–') : '…', v ? (n ? 'losowe dane ≥ wynik' : 'brak sygnałów') : 'liczę permutacje')}
      </div>
      ${v ? `<div class="ramka ${ok ? 'ok' : 'blad'}">${ok
        ? `<b>Sygnały przy ${L}× mają pokrycie w danych.</b> W latach spoza nauki były zyskowne, a na losowych danych tak dobry wynik wyszedł tylko w ${proc(v.p, 1)} przypadków. To nie gwarancja na przyszłość.`
        : n === 0 ? `<b>Przy ${L}× asystent w latach spoza nauki nie dał ani jednego sygnału</b>: żaden układ nie miał przy tej dźwigni wyraźnej przewagi. Nie ma więc czego potwierdzać.`
        : `<b>Sygnały przy ${L}× nie mają potwierdzonej przewagi.</b> ${n < 30 ? `Za mało sygnałów (${n}, potrzeba co najmniej 30). ` : ''}${wf.sumaR <= 0 ? 'W latach spoza nauki przyniosłyby stratę. ' : `Podobny wynik wychodził też na losowych danych (${proc(v.p, 1)}). `}Kierunek w karcie „Sygnał” traktuj jako opis historii. Każda zmiana ustawień to kolejna próba i coraz łatwiej trafić na fałszywego zwycięzcę.`}</div>
        <canvas id="cHist" aria-label="Rozkład wyników na przetasowanych danych"></canvas>` : ''}
      <p class="b-male" style="margin-top:10px">Wyniki po opłatach i fundingu (${h.opisF}). „Potwierdzone” wymaga co najmniej 30 sygnałów, wyniku powyżej zera i p &lt; 5%.</p>`);
    if (v) histogram($('cHist'), v.sumy.map(x => x * D), wf.sumaR * D);
  }

  function histogram(c, wartosci, prawdziwy) {
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
    const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.font = '11px "JetBrains Mono", Consolas, monospace';
    const w = r.width, h = r.height, L = 10, R = 10, T = 22, B = 22;
    let mn = Math.min(prawdziwy, ...wartosci), mx = Math.max(prawdziwy, ...wartosci);
    const pad = (mx - mn) * 0.05 || 1; mn -= pad; mx += pad;
    const K = 40, kosze = new Array(K).fill(0);
    for (const v of wartosci) kosze[Math.min(K - 1, Math.floor((v - mn) / (mx - mn) * K))]++;
    const maxK = Math.max(1, ...kosze), bw = (w - L - R) / K;
    kosze.forEach((k, i) => { const hh = (h - T - B) * k / maxK; x.fillStyle = 'rgba(167,205,196,.35)'; x.beginPath(); x.roundRect ? x.roundRect(L + i * bw + 1, h - B - hh, bw - 2, hh, 2) : x.rect(L + i * bw + 1, h - B - hh, bw - 2, hh); x.fill(); });
    x.fillStyle = '#7fa79e'; x.textAlign = 'center';
    for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4; x.fillText(usd(v, 0), L + 30 + (w - L - R - 60) * k / 4, h - 6); }
    const px = L + (w - L - R) * (prawdziwy - mn) / (mx - mn);
    x.strokeStyle = '#43f0c6'; x.lineWidth = 2; x.shadowColor = 'rgba(67,240,198,.8)'; x.shadowBlur = 8;
    x.beginPath(); x.moveTo(px, T - 6); x.lineTo(px, h - B); x.stroke(); x.shadowBlur = 0;
    x.fillStyle = '#43f0c6'; x.textAlign = px > w / 2 ? 'right' : 'left';
    x.fillText('prawdziwe dane: ' + usd(prawdziwy, 0), px + (px > w / 2 ? -6 : 6), T);
    x.fillStyle = '#7fa79e'; x.textAlign = 'left'; x.fillText('wynik sygnałów na przetasowanych danych', L, 11);
  }

  // ---------- dziennik sygnałów ----------
  async function obsluzSygnal() {
    const L2 = S.live, h = S.hist; if (!L2 || !h) return;
    const B = biezacy(); if (B.dec === 0) return;
    const swieca = L2.czasSwiecy, L = S.L;
    if (S.sygnaly.some(x => x.swieca === swieca && x.interwal === h.dane.interwal && (x.dzwignia || 1) === L)) return;
    const wej = Math.exp(L2.s2.lc[L2.i]), atr = L2.k2.atr[L2.i], o = h.o;
    const syg = { swieca, interwal: h.dane.interwal, kierunek: B.dec, dzwignia: L, wejscie: wej,
      stop: o.m > 0 && o.m * atr / wej < dLik(L) ? wej - B.dec * o.m * atr : null, cel: wej + B.dec * o.k * atr, likwidacja: wej * (1 - B.dec * dLik(L)),
      H: o.H, cechy: o.cechy, potwierdzone: !!zaufane(L), zapisano: new Date().toISOString() };
    S.sygnaly.push(syg);
    fetch('/api/zapisz?plik=sygnaly-asystenta.json', { method: 'POST', body: JSON.stringify(S.sygnaly, null, 1) }).catch(() => { });
    const klucz = swieca + '-' + L;
    if (pam.czytaj('powiadomiono', '') !== klucz) {
      pam.pisz('powiadomiono', klucz);
      await powiadom(`BTC ${syg.kierunek > 0 ? 'LONG' : 'SHORT'} ${L}× (${h.dane.interwal})${syg.potwierdzone ? '' : ' – bez potwierdzenia'}`,
        `Wejście ~${cena$(wej)}, cel ${cena$(syg.cel)}${syg.stop ? ', stop ' + cena$(syg.stop) : ''}, likwidacja ~${cena$(syg.likwidacja)}.`);
    }
    renderDziennik();
  }
  function ocenSygnal(x) {
    const sw = S.live ? S.live.swiece : [], ms = LAB.MS[x.interwal], L = x.dzwignia || 1;
    if (!S.hist || x.interwal !== S.hist.dane.interwal) return { stan: 'inny interwał', r: NaN };
    const po = sw.filter(k => k[0] >= x.swieca && k[0] + ms <= Date.now()).slice(0, x.H);
    const ruch = c => x.kierunek * (c - x.wejscie) / x.wejscie;
    for (const k of po) {
      const niek = x.kierunek > 0 ? k[3] : k[2], korz = x.kierunek > 0 ? k[2] : k[3];
      if (x.likwidacja && (x.kierunek > 0 ? niek <= x.likwidacja : niek >= x.likwidacja) && (!x.stop || (x.kierunek > 0 ? x.likwidacja >= x.stop : x.likwidacja <= x.stop))) return { stan: 'likwidacja', r: -1 };
      if (x.stop && (x.kierunek > 0 ? niek <= x.stop : niek >= x.stop)) return { stan: 'stop', r: L * ruch(x.stop) };
      if (x.kierunek > 0 ? korz >= x.cel : korz <= x.cel) return { stan: 'cel', r: L * ruch(x.cel) };
    }
    if (po.length >= x.H) return { stan: 'czas minął', r: Math.max(-1, L * ruch(po[po.length - 1][4])) };
    return { stan: `otwarty (${po.length}/${x.H})`, r: NaN };
  }
  function renderDziennik() {
    if (!S.sygnaly.length) { tresc('dziennik', '<p class="male">Brak sygnałów. Każdy LONG/SHORT na zamkniętej świecy zapisuje się tutaj (i w wyniki/sygnaly-asystenta.json) i jest potem rozliczany z prawdziwymi cenami Hyperliquid.</p>'); return; }
    const D = depozyt(); let suma = 0, ile = 0;
    const wiersze = S.sygnaly.slice().reverse().map(x => {
      const o = ocenSygnal(x); if (Number.isFinite(o.r)) { suma += o.r; ile++; }
      return `<tr><td>${czas(x.swieca)}</td><td>${x.interwal}</td><td class="${x.kierunek > 0 ? 'plus' : 'minus'}"><b>${x.kierunek > 0 ? 'LONG' : 'SHORT'}</b></td><td>${x.dzwignia || 1}×</td><td>${cena$(x.wejscie)}</td><td>${cena$(x.cel)}</td><td>${x.stop ? cena$(x.stop) : '–'}</td><td>${x.likwidacja ? cena$(x.likwidacja) : '–'}</td>
        <td>${x.potwierdzone ? '<span class="znacznik ok">tak</span>' : '<span class="znacznik">nie</span>'}</td><td>${o.stan}</td><td class="${kl(o.r)}">${Number.isFinite(o.r) ? procZ(o.r) + ' · ' + usd(o.r * D, 0) : '–'}</td></tr>`;
    }).join('');
    tresc('dziennik', `<p class="male">Rozliczone: <b>${ile}</b> · suma <b class="${kl(suma)}">${procZ(suma, 0)}</b> depozytu (${usd(suma * D, 0)} przy ${fmt(D, 0)} $ na transakcję, przed opłatami). Po kilkudziesięciu sygnałach zobaczysz, czy zgadza się to z walidacją.</p>
      <div class="przewin"><table><thead><tr><th>Świeca</th><th>Int.</th><th>Kierunek</th><th>Dźwignia</th><th>Wejście</th><th>Cel</th><th>Stop</th><th>Likwidacja</th><th>Potwierdzony</th><th>Stan</th><th>Wynik</th></tr></thead><tbody>${wiersze}</tbody></table></div>`);
  }

  // ---------- powiadomienia ----------
  let temat = pam.czytaj('temat', '') || (function () { try { return JSON.parse(localStorage.getItem('asystent-temat')) || ''; } catch (e) { return ''; } })();
  if (!temat) { const a = new Uint8Array(9); crypto.getRandomValues(a); temat = 'btc-asystent-' + Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); }
  pam.pisz('temat', temat); $('temat').value = temat;
  $('pulpit').checked = pam.czytaj('pulpit', false); $('telefon').checked = pam.czytaj('telefon', false);
  $('temat').onchange = () => pam.pisz('temat', $('temat').value.trim());
  $('telefon').onchange = () => pam.pisz('telefon', $('telefon').checked);
  // w Centrum inwestora (strona w ramce) o zgodę na powiadomienia pyta Centrum – ramka z innego portu nie może
  const wCentrum = !!(window.CENTRUM && window.CENTRUM.osadzony);
  $('pulpit').onchange = async () => {
    if ($('pulpit').checked && wCentrum) {
      const p = await window.CENTRUM.prosOZgode();
      if (p !== 'granted') { $('pulpit').checked = false; $('statusPowiad').textContent = 'Przeglądarka nie zezwoliła na powiadomienia (prośba z Centrum).'; }
    } else if ($('pulpit').checked && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { $('pulpit').checked = false; $('statusPowiad').textContent = 'Przeglądarka nie zezwoliła na powiadomienia.'; }
    }
    pam.pisz('pulpit', $('pulpit').checked);
  };
  async function powiadom(tytul, tekst) {
    const w = [];
    if ($('pulpit').checked && wCentrum) { window.CENTRUM.powiadom(tytul, tekst); w.push('pulpit (przez Centrum)'); }
    else if ($('pulpit').checked && 'Notification' in window && Notification.permission === 'granted') { new Notification(tytul, { body: tekst }); w.push('pulpit'); }
    if ($('telefon').checked && $('temat').value.trim()) {
      try { const r = await fetch('https://ntfy.sh/' + encodeURIComponent($('temat').value.trim()), { method: 'POST', body: tytul + '\n' + tekst }); w.push(r.ok ? 'telefon' : 'telefon: błąd ' + r.status); }
      catch (e) { w.push('telefon: ' + e.message); }
    }
    return w;
  }
  $('test').onclick = async () => {
    const w = await powiadom('Asystent BTC – test', 'Powiadomienia działają. ' + new Date().toLocaleTimeString('pl-PL'));
    $('statusPowiad').textContent = w.length ? 'Wysłano: ' + w.join(', ') : 'Zaznacz najpierw sposób powiadamiania.';
  };

  // ---------- newsy (tylko podgląd) ----------
  async function newsy() {
    const kont = document.createElement('div');
    try {
      const d = ((await (await fetch('/api/zewn?co=fng')).json()).data) || [];
      if (d.length) {
        const opis = { 'Extreme Fear': 'skrajny strach', 'Fear': 'strach', 'Neutral': 'neutralnie', 'Greed': 'chciwość', 'Extreme Greed': 'skrajna chciwość' }[d[0].value_classification] || '';
        kont.insertAdjacentHTML('beforeend', `<div class="fng"><b>${+d[0].value}</b><div style="flex:1"><div class="male">Indeks strachu i chciwości · ${opis}</div><div class="miernik"><i style="left:${+d[0].value}%"></i></div><div class="b-male" style="margin-top:6px">poprzednie dni: ${d.slice(1).map(x => +x.value).join(' · ')}</div></div></div>`);
      }
    } catch (e) { kont.insertAdjacentHTML('beforeend', '<p class="male">Indeks strachu: brak danych.</p>'); }
    for (const [co, nazwa] of [['cointelegraph', 'Cointelegraph'], ['coindesk', 'CoinDesk']]) {
      const h3 = document.createElement('h3'); h3.textContent = nazwa; kont.appendChild(h3);
      const ul = document.createElement('ul'); kont.appendChild(ul);
      try {
        const xml = new DOMParser().parseFromString(await (await fetch('/api/zewn?co=' + co)).text(), 'text/xml');
        Array.from(xml.querySelectorAll('item')).slice(0, 5).forEach(it => {
          const li = document.createElement('li'), a = document.createElement('a');
          const link = ((it.querySelector('link') || {}).textContent || '').trim();
          a.textContent = ((it.querySelector('title') || {}).textContent || '').trim();
          if (/^https:\/\//.test(link)) { a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
          li.appendChild(a);
          const d = new Date((it.querySelector('pubDate') || {}).textContent || '');
          if (!isNaN(d)) { const sp = document.createElement('span'); sp.textContent = ' · ' + czas(d); li.appendChild(sp); }
          ul.appendChild(li);
        });
        if (!ul.children.length) ul.innerHTML = '<li class="male">brak wpisów</li>';
      } catch (e) { ul.innerHTML = '<li class="male">nie udało się pobrać</li>'; }
    }
    const t = $('newsy').querySelector('.tresc'); t.innerHTML = ''; t.appendChild(kont);
  }

  // ---------- start ----------
  async function start() {
    try { const r = await fetch('../wyniki/sygnaly-asystenta.json'); if (r.ok) S.sygnaly = await r.json(); } catch (e) { /* brak dziennika */ }
    newsy(); setInterval(newsy, 15 * 60000);
    await przelicz();
    setInterval(() => odswiezNaZywo(false), 60000);
    // pierwsze rozliczenie sygnału na bieżącej świecy po zakończeniu walidacji (żeby zapisać, czy był potwierdzony)
    setTimeout(() => odswiezNaZywo(false), 20000);
  }
  start();
  window.addEventListener('resize', () => { if (S.walidacja && S.hist) renderWiarygodnosc(); });
})();
