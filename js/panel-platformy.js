/* Panel na telefonie – „Platformy”: ile wpłaciłeś na każdej platformie (Hyperliquid, Kraken, Phantom, XTB…) i kiedy, ile masz
 * teraz i ile musisz zarobić, żeby wyjść na zero – w USD, PLN albo EUR, z historią (wykres) i listą wpłat i wypłat.
 * Liczby przychodzą gotowe w migawce z panelu na komputerze (te same funkcje co zakładka „Platformy” w panelu).
 * Telefon dolicza tylko zmianę otwartych pozycji Hyperliquid na żywo – tak samo jak wynik na górze panelu. */
(function () {
  'use strict';
  const WAL = ['USD', 'PLN', 'EUR'], ZNAK = { USD: '$', PLN: 'zł', EUR: '€' };
  const MIEJSC = { Kraken: 'na Krakenie', Phantom: 'w Phantomie', Hyperliquid: 'na Hyperliquid', XTB: 'w XTB' };
  const PRAWIE_PUSTE = 10;   // do zera brakuje ponad 10× tego, co jest na koncie – procent nic już nie mówi
  const nf = (m) => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: m, maximumFractionDigits: m });
  const E = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ok = (x) => x !== null && x !== undefined && Number.isFinite(x);
  const kw = (x, w, o) => { o = o || {}; if (!ok(x)) return '—'; const z = Math.abs(x) < 0.005 ? 0 : x; return (o.znak ? (z > 0 ? '+' : z < 0 ? '−' : '') : (z < 0 ? '−' : '')) + (o.przybl ? '≈' : '') + nf(2).format(Math.abs(z)) + ' ' + ZNAK[w]; };
  const proc = (x, znak) => !ok(x) ? '—' : (znak && x > 0 ? '+' : x < 0 ? '−' : '') + nf(Math.abs(x) < 0.1 ? 1 : 0).format(Math.abs(x * 100)) + '%';
  const kl = (x) => (ok(x) && x > 0.004 ? 'plus' : ok(x) && x < -0.004 ? 'minus' : '');
  const data = (ms) => ms ? new Date(ms).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  const dataCzas = (ms) => new Date(ms).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dataKr = (ms) => new Date(ms).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
  const odmiana = (n, j, d, m) => { const r10 = n % 10, r100 = n % 100; return n + ' ' + (n === 1 ? j : r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? d : m); };
  const gdzie = (g) => g.wszystkie ? 'na wszystkich platformach razem' : (MIEJSC[g.nazwa] || 'na ' + g.nazwa);
  const doZeraTxt = (a) => a.procentDoZera === null ? 'konto puste' : a.procentDoZera > PRAWIE_PUSTE ? 'prawie puste' : proc(a.procentDoZera, true);

  const st = { wybor: null, waluta: 'USD', wykres: null, rysuj: null, pam: null };

  // grupa z migawki + zmiana otwartych pozycji Hyperliquid na żywo (tylko w grupach, w których jest to konto)
  function zZywym(g, m, live) {
    if (!live || !live.d || !live.konto || !(g.kontaIds || []).includes(live.konto)) return g;
    const K = m.platformy.kursy || {}, przel = { USD: 1, PLN: K.USDPLN || m.kursUSDPLN || null, EUR: K.EURUSD ? 1 / K.EURUSD : null };
    const w = {};
    for (const x of WAL) {
      const a = Object.assign({}, g.w[x]), dx = przel[x] ? live.d * przel[x] : 0;
      if (ok(a.wartosc) && dx) {
        a.wartosc += dx; a.wynik = a.wartosc - a.netto; a.doZera = Math.max(0, -a.wynik);
        a.procentDoZera = !a.doZera ? 0 : a.wartosc > 0.005 ? a.doZera / a.wartosc : null;
        a.procentWplat = a.netto > 0.005 ? a.wynik / a.netto : null;   // część „kurs dolara” się nie zmienia – rośnie i wynik, i handel
      }
      w[x] = a;
    }
    const seria = g.seria.map(p => p.teraz ? { t: p.t, teraz: true, w: p.w.map((v, j) => ok(v) && przel[WAL[j]] ? v + live.d * przel[WAL[j]] : v) } : p);
    return Object.assign({}, g, { w, seria, zywyHL: true });
  }

  // ---------- kafelki w panelu ----------
  function kafle(m, live) {
    const P = m.platformy; if (!P || !P.grupy || !P.grupy.length) return '';
    const w = st.waluta;
    return `<section class="karta pl-karta"><h2>Platformy <small>ile do zera · dotknij</small></h2>
      <div class="pl-kafle">${P.grupy.map(g0 => { const g = zZywym(g0, m, live), a = g.w[w];
        return `<button type="button" class="pl-kafel${g.wszystkie ? ' pl-wszystkie' : ''}" data-pl="${E(g.klucz)}">
          <span class="n">${g.wszystkie ? '' : `<span class="kropka ${g.naZywo && !g.brakDanych.length ? 'zywe' : ''}"></span>`}${E(g.nazwa)}</span>
          <span class="w ${kl(a.wynik)}">${kw(a.wynik, w, { znak: true })}</span>
          <span class="p">${a.doZera > 0.005 ? 'do zera ' + doZeraTxt(a) : 'na plusie'}</span></button>`; }).join('')}</div>
      ${przelacznikWalut()}</section>`;
  }
  // waluta tylko przelicza kwoty – zawsze widać wszystkie konta (rachunek w innej walucie jest przeliczony, nie ukryty)
  const przelacznikWalut = () => `<span class="pl-wal"><span class="b-male">kwoty w</span><span class="przelacznik pl-waluty" role="group" aria-label="Pokaż kwoty w walucie">${WAL.map(x => `<button type="button" data-pl-waluta="${x}" class="${x === st.waluta ? 'wl' : ''}" aria-pressed="${x === st.waluta}">${x}</button>`).join('')}</span></span>`;

  // ---------- rachunki i salda (np. XTB: rachunek USD, rachunek PLN, IKE) ----------
  function przelicznik(m, w) { const K = m.platformy.kursy || {}; return w === 'USD' ? 1 : w === 'PLN' ? (K.USDPLN || m.kursUSDPLN || null) : (K.EURUSD ? 1 / K.EURUSD : null); }
  // Hyperliquid na żywo: zmiana wyniku otwartych pozycji dochodzi do salda USDC tego rachunku
  function rachunekZywy(rc, m, live) {
    if (!live || !live.d || rc.id !== live.konto) return rc;
    const g = zZywym({ kontaIds: [rc.id], w: rc.w, seria: [] }, m, live);
    const salda = rc.salda.map(x => x.r === 'reszta' ? Object.assign({}, x, { v: x.v.map((v, j) => ok(v) && przelicznik(m, WAL[j]) ? v + live.d * przelicznik(m, WAL[j]) : v), nat: ok(x.nat) ? x.nat + live.d * (przelicznik(m, rc.waluta) || 0) : x.nat, ilosc: ok(x.ilosc) && x.jedn === 'USDC' ? x.ilosc + live.d : x.ilosc }) : x);
    return Object.assign({}, rc, { w: g.w, salda, zywyHL: true });
  }
  function rachunek(rc0, m, live, w, iw) {
    const rc = rachunekZywy(rc0, m, live), a = rc.w[w], wal = rc.waluta, inna = wal !== w && rc.w[wal], przel = przelicznik(m, w);
    const wynik = (x) => (!ok(x.wu) ? null : w === wal && ok(x.wn) ? x.wn : przel ? x.wu * przel : null);
    const ile = (x) => (ok(x.ilosc) ? new Intl.NumberFormat('pl-PL', { maximumFractionDigits: Math.abs(x.ilosc) >= 1000 ? 2 : Math.abs(x.ilosc) >= 1 ? 4 : 8 }).format(x.ilosc) + (x.jedn && x.jedn !== x.nazwa ? ' ' + x.jedn : '') : '');
    const cena = (x) => (x.c ? new Intl.NumberFormat('pl-PL', { maximumFractionDigits: x.c >= 100 ? 2 : x.c >= 1 ? 3 : 6 }).format(x.c) + ' ' + (x.cw || '') : '');
    return `<div class="pl-rach">
      <div class="g"><b>${E(rc.nazwa)}</b><b class="wart">${kw(a.wartosc, w)}</b></div>
      <div class="s">waluta rachunku ${E(wal)} · ${E(rc.zrodlo)}${rc.zywyHL ? ' · Hyperliquid na żywo' : ''}</div>
      <div class="s">wpłacone netto ${kw(a.netto, w)} · wynik <span class="${kl(a.wynik)}">${kw(a.wynik, w, { znak: true })}</span> · ${a.doZera > 0.005 ? 'do zera ' + kw(a.doZera, w) + ' (' + doZeraTxt(a) + ')' : 'na plusie'}</div>
      ${inna ? `<div class="s"><b>w walucie rachunku (${E(wal)}):</b> masz ${kw(rc.w[wal].wartosc, wal)}, wpłacone netto ${kw(rc.w[wal].netto, wal)}, wynik <span class="${kl(rc.w[wal].wynik)}">${kw(rc.w[wal].wynik, wal, { znak: true })}</span></div>` : ''}
      ${rc.salda.map(x => { const wy = wynik(x), op = [x.opis, ile(x), cena(x)].filter(Boolean).join(' · ');
        return `<div class="pl-saldo${x.r === 'drobne' || x.r === 'airdrop' ? ' poza' : ''}"><span class="n">${E(x.nazwa)}${op ? `<small>${E(op)}</small>` : ''}${x.bc ? '<small class="minus">brak ceny – liczone 0</small>' : ''}</span>
          <span class="v"><b>${kw(x.v[iw], w)}</b>${inna ? `<small>${kw(x.nat, wal)}</small>` : ''}${wy !== null ? `<small class="${kl(wy)}">${kw(wy, w, { znak: true })}</small>` : ''}</span></div>`; }).join('')}
      ${rc.pozycje && rc.pozycje.length ? `<div class="s">Otwarte pozycje (wynik jest już w saldzie): ${rc.pozycje.map(p => E(p.nazwa) + ' ' + kw(przel && ok(p.wu) ? p.wu * przel : null, w, { znak: true })).join(', ')}</div>` : ''}
    </div>`;
  }
  function sekcjaRachunkow(g, m, live, w, iw) {
    const R = (m.platformy.rachunki || []).filter(rc => g.wszystkie || rc.platforma === g.nazwa);
    if (!R.length) return null;
    const nota = `<p class="b-male pl-akapit">Kwoty w ${ZNAK[w]}: każdy rachunek przeliczony po dzisiejszym kursie – nic nie jest ukryte. Rachunek w innej walucie ma też kwoty w swojej walucie (mniejszy druk). Pod kwotą pozycji: wynik od ceny zakupu.</p>`;
    if (!g.wszystkie) return `<section class="karta"><h2>Rachunki i salda <small>${E(g.nazwa)} · ${odmiana(R.length, 'rachunek', 'rachunki', 'rachunków')}</small></h2>${R.map(rc => rachunek(rc, m, live, w, iw)).join('')}${nota}</section>`;
    const platformy = [...new Set(R.map(rc => rc.platforma))];
    return `<section class="karta"><h2>Wszystkie salda <small>${odmiana(R.length, 'rachunek', 'rachunki', 'rachunków')}</small></h2>${platformy.map(p => `<h3 class="pl-grupa">${E(p)}</h3>${R.filter(rc => rc.platforma === p).map(rc => rachunek(rc, m, live, w, iw)).join('')}`).join('')}${nota}</section>`;
  }

  // ---------- widok jednej platformy ----------
  function widok(m, live) {
    const P = m.platformy, g0 = P && P.grupy.find(x => x.klucz === st.wybor);
    if (!g0) { st.wybor = null; return null; }
    const g = zZywym(g0, m, live), w = st.waluta, a = g.w[w], iw = WAL.indexOf(w);
    const tu = gdzie(g), Tu = tu.charAt(0).toUpperCase() + tu.slice(1);
    let zero;
    if (!ok(a.wynik)) zero = '<b>Brak wartości konta – nie da się policzyć wyniku.</b>';
    else if (a.wynik < -0.005 && a.wartosc > 0.005 && a.procentDoZera !== null && a.procentDoZera <= PRAWIE_PUSTE) zero = `Żeby wyjść na zero ${E(tu)}, musisz zarobić <b class="minus">${kw(a.doZera, w)}</b>, czyli <b>${proc(a.procentDoZera, true)}</b> tego, co masz teraz (${kw(a.wartosc, w)}). Na zero wychodzisz przy wartości <b>${kw(a.netto, w)}</b> – tyle wpłaciłeś netto.`;
    else if (a.wynik < -0.005) zero = `${E(Tu)} ${a.wartosc > 0.005 ? 'zostało już tylko ' + kw(a.wartosc, w) : 'nic już nie zostało'} – strata <b class="minus">${kw(a.doZera, w)}</b> jest praktycznie zamknięta. Z tego, co zostało, nie da się jej odrobić – tylko zyskiem z nowych pieniędzy.`;
    else zero = `Jesteś na plusie: masz o <b class="plus">${kw(a.wynik, w)}</b> więcej, niż wpłaciłeś netto (${kw(a.netto, w)}).${a.wartosc > 0.005 ? ` Wartość może spaść o ${proc(a.wynik / a.wartosc)} i nadal będziesz na zero.` : ''}`;
    const przel = w === 'PLN' ? (P.kursy.USDPLN || m.kursUSDPLN) : w === 'EUR' && P.kursy.EURUSD ? 1 / P.kursy.EURUSD : null;
    const kursowa = w !== 'USD' && ok(a.kursowa) && Math.abs(a.kursowa) >= 0.5 && przel ? `<p class="b-male pl-akapit">W ${w === 'PLN' ? 'złotych' : 'euro'} wpłaty liczone są po kursie NBP z dnia wpłaty, a wartość po dzisiejszym kursie. Sam handel to ${kw(g.w.USD.wynik * przel, w, { znak: true })}, a ${kw(a.kursowa, w, { znak: true })} to zmiana kursu dolara od dni wpłat.</p>` : '';
    const uwagi = (g.brakDanych.length ? [`<b>Bez danych (nie liczone):</b> ${E(g.brakDanych.join(', '))} – wynik jest niepełny.`] : [])
      .concat(g.eksport.length ? [`${E(g.eksport.join('; '))}. Skład tych kont jest z ostatniego eksportu – po nowych zakupach, sprzedażach czy wpłatach wgraj nowy eksport na komputerze.`] : []);
    const wybor = `<div class="pl-wybor" role="group" aria-label="Platforma">${P.grupy.map(x => `<button type="button" data-pl="${E(x.klucz)}" class="${x.klucz === g.klucz ? 'wl' : ''}">${E(x.nazwa)}</button>`).join('')}</div>`;

    let h = `<div class="pl-pasek"><button type="button" class="drugi pl-wroc" data-pl-wroc>← Panel</button>${przelacznikWalut()}</div>${wybor}`;
    h += `<section class="karta">
      <div class="et">Wynik ${E(tu)}${g.pierwsza ? ' · od pierwszej wpłaty ' + data(g.pierwsza) : ''}${g.zywyHL ? ' · z Hyperliquid na żywo' : ''}</div>
      <div class="liczba ${kl(a.wynik)}">${kw(a.wynik, w, { znak: true })}</div>
      <p class="pl-zero">${zero}</p>
      <div class="wiersze">
        <div><span class="et">Wpłaciłeś</span><b>${kw(a.wplaty, w)}</b><span class="b-male">${g.ileWplat ? odmiana(g.ileWplat, 'wpłata', 'wpłaty', 'wpłat') : 'brak wpłat'}</span></div>
        <div><span class="et">Wypłaciłeś</span><b>${kw(a.wyplaty, w)}</b><span class="b-male">${g.ileWyplat ? odmiana(g.ileWyplat, 'wypłata', 'wypłaty', 'wypłat') : 'brak wypłat'}</span></div>
        <div><span class="et">Wpłacone netto</span><b>${kw(a.netto, w)}</b><span class="b-male">próg „na zero”</span></div>
        <div><span class="et">Masz teraz</span><b>${kw(a.wartosc, w)}</b><span class="b-male">${g.naZywo ? 'na żywo w panelu' : 'część z eksportu'}</span></div>
        <div><span class="et">Wynik w % wpłat netto</span><b class="${kl(a.wynik)}">${proc(a.procentWplat, true)}</b></div>
      </div>
      ${kursowa}${uwagi.map(u => `<p class="b-male pl-uwaga">${u}</p>`).join('')}
      <div class="kontrola">${g.spina ? '✔ Kontrola w panelu: wynik zgadza się co do centa z sumą wyników kont.' : '<b class="minus">Panel zgłasza, że wynik się nie spina – nie polegaj na tej liczbie.</b>'}</div>
    </section>`;
    h += `<section class="karta"><h2>Historia <small>wpłacone netto i wartość</small></h2>${wykres(g, w, iw)}
      <p class="pl-legenda b-male"><span class="pl-l pl-l-dep"></span>wpłacone netto <span class="pl-l pl-l-wart"></span>wartość <span class="pl-l pl-l-minus"></span>strata <span class="pl-l pl-l-plus"></span>zysk</p>
      <p class="b-male">Schodki = każda wpłata i wypłata. Wartość: dzienne zapisy panelu${g.odDnia ? ' od ' + data(g.odDnia) : ''} (dni, w których panel był włączony) + stan z migawki.${P.przeliczanie === 'dzis' && w !== 'USD' ? ' Cały wykres po dzisiejszym kursie – wygląda tak samo jak w USD.' : ''} Dotknij wykresu, żeby zobaczyć szczegóły.</p></section>`;
    const lista = g.przeplywy.slice().reverse();
    h += `<section class="karta"><h2>${g.wszystkie ? 'Wpłaty i wypłaty spoza Twoich kont' : 'Wpłaty i wypłaty'} <small>${odmiana(lista.length, 'operacja', 'operacje', 'operacji')}</small></h2>
      ${lista.length ? lista.map(x => `<div class="pl-op">
        <div class="g"><span class="kier ${x.we ? 'we' : 'wy'}">${x.we ? '↓ wpłata' : '↑ wypłata'}</span><span class="d">${dataCzas(x.t)}</span><b>${kw(x.k[iw], w, { przybl: x.p[iw] })}</b></div>
        <div class="s">${E(x.skad)}${g.kontaIds.length > 1 ? ' · ' + E(x.konto) : ''} · ${E(x.ile)}${x.bc ? ' · <span class="minus">brak ceny – liczone 0</span>' : ''}</div>
        <div class="s">wpłacone netto po: ${kw(x.n[iw], w)}</div></div>`).join('') : '<p class="male">Brak wpłat i wypłat.</p>'}
      <p class="b-male pl-akapit">${g.wszystkie ? 'Przelewy między Twoimi kontami (Kraken → Phantom → Hyperliquid, XTB PLN → IKE) się znoszą, więc ich tu nie ma.' : `Przelew z innej Twojej platformy jest dla tej platformy wpłatą.${g.ileWewnatrz ? ' Przesunięcia wewnątrz platformy (' + g.ileWewnatrz + ') się znoszą i ich tu nie ma.' : ''}`} ${P.przeliczanie === 'dzis' ? 'Kwota w walucie konta z dnia operacji (USD; rachunki XTB w złotych – w złotych)' + (w === 'USD' ? '.' : ', przeliczona na ' + ZNAK[w] + ' po dzisiejszym kursie – ta sama kwota w innej walucie.') : w === 'USD' ? 'Kwota w USD z dnia operacji.' : 'Kwota po kursie NBP z dnia roboczego przed operacją.'} „≈” = wycena przybliżona.</p></section>`;
    // z czego składa się wynik: platformy (dla „wszystkie”), potem rachunki i salda; starsza migawka (bez sald) – konta platformy
    const rach = sekcjaRachunkow(g, m, live, w, iw);
    const sklad = g.wszystkie ? P.grupy.filter(x => !x.wszystkie).map(x => { const z = zZywym(x, m, live); return { nazwa: z.nazwa, klucz: z.klucz, a: z.w[w] }; })
      : !rach && g.konta ? g.konta.map(k => ({ nazwa: k.nazwa, pod: k.zrodlo, a: k.w[w] })) : null;
    if (sklad) h += `<section class="karta"><h2>${g.wszystkie ? 'Platformy' : 'Konta'} <small>wynik · do zera</small></h2>${sklad.map(s => `
      <div class="konto"${s.klucz ? ` data-pl="${E(s.klucz)}" role="button" tabindex="0"` : ''}><div class="nazwa"><span>${E(s.nazwa)}</span></div><div class="w"><b class="${kl(s.a.wynik)}">${kw(s.a.wynik, w, { znak: true })}</b></div>
        <div class="pod">wpłacone netto ${kw(s.a.netto, w)} · masz ${kw(s.a.wartosc, w)}${s.a.doZera > 0.005 ? ' · do zera ' + kw(s.a.doZera, w) + ' (' + doZeraTxt(s.a) + ')' : ''}${s.pod ? ' · ' + E(s.pod) : ''}</div></div>`).join('')}</section>`;
    if (rach) h += rach;
    return h;
  }

  // ---------- wykres: wpłacone netto (schodki) i wartość ----------
  function wykres(g, w, iw) {
    const pkt = g.seria.filter(p => ok(p.w[iw])).map(p => ({ t: p.t, wart: p.w[iw], teraz: !!p.teraz }));
    const schodki = g.przeplywy.map(x => ({ t: x.t, netto: x.n[iw], x }));
    const Wd = 340, H = 200, l = 48, r = 8, t = 12, b = 24;
    const tKon = pkt.length ? pkt[pkt.length - 1].t : Date.now();
    const tSt = Math.min(schodki.length ? schodki[0].t : Infinity, pkt.length ? pkt[0].t : Infinity);
    if (!Number.isFinite(tSt) || tKon - tSt < 60000) { st.wykres = null; return '<p class="male">Za mało danych na wykres.</p>'; }
    const ys = [0].concat(pkt.map(p => p.wart), schodki.map(s => s.netto)).filter(ok);
    let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y1 - y0 < 1e-9) y1 = y0 + 1;
    const zap = (y1 - y0) * 0.06; y1 += zap; if (y0 < 0) y0 -= zap;
    const sx = (x) => +(l + (x - tSt) / (tKon - tSt) * (Wd - l - r)).toFixed(1), sy = (y) => +(t + (1 - (y - y0) / (y1 - y0)) * (H - t - b)).toFixed(1);
    let kroki = ''; for (const s of schodki) kroki += ` H${sx(s.t)} V${sy(s.netto)}`;
    let dWart = '', dLuka = '';
    pkt.forEach((p, i) => { const q = pkt[i - 1]; if (!q) dWart += `M${sx(p.t)} ${sy(p.wart)}`; else if (p.t - q.t > 4 * 86400000) { dLuka += `M${sx(q.t)} ${sy(q.wart)} L${sx(p.t)} ${sy(p.wart)}`; dWart += ` M${sx(p.t)} ${sy(p.wart)}`; } else dWart += ` L${sx(p.t)} ${sy(p.wart)}`; });
    let pole = '';
    if (pkt.length > 1) {
      const a = pkt[0].t, z = pkt[pkt.length - 1].t, poziom = (i) => i > 0 ? schodki[i - 1].netto : 0;
      let d = pkt.map((p, i) => (i ? 'L' : 'M') + sx(p.t) + ' ' + sy(p.wart)).join(' ');
      const ost = schodki.filter(s => s.t <= z); d += ` L${sx(z)} ${sy(ost.length ? ost[ost.length - 1].netto : 0)}`;
      for (let i = schodki.length - 1; i >= 0; i--) { const s = schodki[i]; if (s.t > z || s.t <= a) continue; d += ` H${sx(s.t)} V${sy(poziom(i))}`; }
      d += ` H${sx(a)} Z`;
      pole = `<clipPath id="plt-pod"><path d="M0 ${sy(0)} H${sx(tSt)}${kroki} H${Wd} V${H} H0 Z"/></clipPath><clipPath id="plt-nad"><path d="M0 ${sy(0)} H${sx(tSt)}${kroki} H${Wd} V0 H0 Z"/></clipPath>
        <path d="${d}" class="pl-pole-minus" clip-path="url(#plt-pod)"/><path d="${d}" class="pl-pole-plus" clip-path="url(#plt-nad)"/>`;
    }
    const krok = ladnyKrok((y1 - y0) / 4), linie = []; for (let i = Math.ceil(y0 / krok - 1e-9); i * krok <= y1 + 1e-9 && linie.length < 12; i++) linie.push(i === 0 ? 0 : i * krok);
    const nfOs = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: krok < 1 ? 2 : 0 });
    const etX = [0, 1, 2].map(i => { const x = tSt + i * (tKon - tSt) / 2; return `<text class="os" x="${sx(x)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${E(dataKr(x))}</text>`; }).join('');
    st.wykres = { pkt, schodki, sx, sy, W: Wd, H, w, iw };
    return `<div class="pl-wykres" data-pl-wykres><svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Wykres: wpłacone netto i wartość w czasie (${ZNAK[w]})">
      <g class="siatka">${linie.map(v => `<line x1="${l}" x2="${Wd - r}" y1="${sy(v)}" y2="${sy(v)}"/><text class="os" x="${l - 5}" y="${sy(v) + 3.5}" text-anchor="end">${E(nfOs.format(v))}</text>`).join('')}</g>
      ${pole}<path class="pl-dep" d="M${sx(tSt)} ${sy(0)}${kroki} H${sx(tKon)}"/>
      ${dLuka ? `<path class="pl-luka" d="${dLuka}"/>` : ''}<path class="pl-wart" d="${dWart}"/>
      ${schodki.map(s => `<circle class="pl-krok ${s.x.we ? 'we' : 'wy'}" cx="${sx(s.t)}" cy="${sy(s.netto)}" r="2.6"/>`).join('')}
      ${pkt.map(p => `<circle class="pl-pkt${p.teraz ? ' teraz' : ''}" cx="${sx(p.t)}" cy="${sy(p.wart)}" r="${p.teraz ? 4 : 2.2}"/>`).join('')}
      ${etX}<line class="kursor" x1="0" x2="0" y1="${t}" y2="${H - b}" visibility="hidden"/>
    </svg><div class="dymek" hidden></div></div>`;
  }
  function ladnyKrok(x) { if (!(x > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(x))); const m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function dotyk(e, el) {
    const d = st.wykres; if (!d) return;
    const svg = el.querySelector('svg'), rect = svg.getBoundingClientRect(), x = (e.clientX - rect.left) / rect.width * d.W;
    const kand = d.pkt.map(p => ({ p, x: d.sx(p.t), y: d.sy(p.wart) })).concat(d.schodki.map(s => ({ s, x: d.sx(s.t), y: d.sy(s.netto) })));
    if (!kand.length) return;
    const k = kand.reduce((a, c) => Math.abs(c.x - x) < Math.abs(a.x - x) ? c : a), w = d.w, dym = el.querySelector('.dymek'), kur = svg.querySelector('.kursor');
    kur.setAttribute('x1', k.x); kur.setAttribute('x2', k.x); kur.setAttribute('visibility', 'visible');
    if (k.p) { const netto = d.schodki.filter(s => s.t <= k.p.t).reduce((v, s) => s.netto, 0), wy = k.p.wart - netto;
      dym.innerHTML = `<b>${k.p.teraz ? 'Teraz' : dataCzas(k.p.t)}</b><br>wartość ${kw(k.p.wart, w)}<br>wpłacone netto ${kw(netto, w)}<br><span class="${kl(wy)}">wynik ${kw(wy, w, { znak: true })}</span>`; }
    else { const x_ = k.s.x; dym.innerHTML = `<b>${dataCzas(k.s.t)}</b><br>${x_.we ? 'wpłata' : 'wypłata'} ${kw(x_.k[d.iw], w, { przybl: x_.p[d.iw] })}<br>${E(x_.skad)}<br>netto po: ${kw(k.s.netto, w)}`; }
    dym.hidden = false;
    const lewo = k.x / d.W * rect.width;
    dym.style.left = Math.min(rect.width - dym.offsetWidth, Math.max(0, lewo - dym.offsetWidth / 2)) + 'px';
    dym.style.top = Math.max(0, k.y / d.H * rect.height - dym.offsetHeight - 12) + 'px';
  }

  window.PanelPlatformy = {
    init(o) {
      st.rysuj = o.rysuj; st.pam = o.pam;
      st.waluta = WAL.includes(o.pam.czytaj('panel-pl-waluta', 'USD')) ? o.pam.czytaj('panel-pl-waluta', 'USD') : 'USD';
      document.addEventListener('click', (e) => {
        const wyb = e.target.closest('[data-pl]'), wal = e.target.closest('[data-pl-waluta]'), wroc = e.target.closest('[data-pl-wroc]');
        if (wal) { st.waluta = wal.dataset.plWaluta; st.pam.pisz('panel-pl-waluta', st.waluta); st.rysuj(); return; }
        if (wroc) { st.wybor = null; st.rysuj(); window.scrollTo(0, 0); return; }
        if (wyb) { const nowa = st.wybor !== wyb.dataset.pl; st.wybor = wyb.dataset.pl; st.rysuj(); if (nowa) window.scrollTo(0, 0); }
      });
      document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.konto[data-pl]')) { e.preventDefault(); e.target.click(); } });
      const ruch = (e) => { const el = e.target.closest && e.target.closest('[data-pl-wykres]'); if (el) dotyk(e, el); };
      document.addEventListener('pointerdown', ruch); document.addEventListener('pointermove', ruch);
    },
    otwarty(m) { return !!(st.wybor && m && m.platformy && m.platformy.grupy.some(g => g.klucz === st.wybor)); },
    // po narysowaniu widoku: wybrana platforma widoczna w przewijanym pasku
    po() { const b = document.querySelector('.pl-wybor .wl'); if (b) b.parentElement.scrollLeft = Math.max(0, b.offsetLeft - b.parentElement.offsetLeft - (b.parentElement.clientWidth - b.offsetWidth) / 2); },
    kafle, widok
  };
})();
