/* Panel na telefonie: migawka wyników z panelu na komputerze (prywatny Firebase) + pozycje Hyperliquid na żywo.
 * Liczby z migawki są te same co w panelu. Telefon sam pobiera tylko pozycje Hyperliquid (publiczne API) – jeśli są to te same
 * pozycje co w migawce, do wyniku dolicza zmianę ich niezrealizowanego wyniku od chwili migawki. Inne konta: wartości z migawki. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const HL = 'https://api.hyperliquid.xyz/info';
  const TEST = /[?&]test\b/.test(location.search);
  const pam = {
    czytaj(k, d) { try { const v = localStorage.getItem('inwestor-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    pisz(k, v) { try { localStorage.setItem('inwestor-' + k, JSON.stringify(v)); } catch (e) { /* tryb prywatny */ } }
  };
  const S = { m: null, pit: null, zKopii: false, zakres: pam.czytaj('panel-zakres', 'zywe'), hl: null, hlCzas: 0, hlBlad: null, uzytkownik: null };

  // ---------- formatowanie ----------
  const nf = (m) => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: m, maximumFractionDigits: m });
  const usd = (v, znak, m = 2) => v === null || v === undefined || !Number.isFinite(v) ? '—' : (znak ? (v > 0 ? '+' : v < 0 ? '−' : '') : (v < 0 ? '−' : '')) + nf(m).format(Math.abs(v)) + ' $';
  const zl = (v, znak) => v === null || v === undefined || !Number.isFinite(v) ? '—' : (znak ? (v > 0 ? '+' : v < 0 ? '−' : '') : (v < 0 ? '−' : '')) + nf(2).format(Math.abs(v)) + ' zł';
  const cena = (v) => !Number.isFinite(v) ? '—' : nf(v >= 1000 ? 1 : v >= 1 ? 3 : 6).format(v);
  const proc = (v, m = 1) => !Number.isFinite(v) ? '—' : nf(m).format(v * 100) + '%';
  const kl = (v) => (v > 0 ? 'plus' : v < 0 ? 'minus' : '');
  const E = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const godz = (t) => new Date(t).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const temu = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'przed chwilą' : m < 60 ? m + ' min temu' : m < 1440 ? Math.round(m / 60) + ' h temu' : Math.round(m / 1440) + ' dni temu'; };

  // cel zysku – kopia Obl.cel z panelu (Kalkulator-Podatku-Krypto/app/panel/obliczenia.js), żeby telefon liczył go tak samo
  function cel(wynik, kwotaCelu, odMs, terazMs, terminMs) {
    const dni = Math.max((terazMs - odMs) / 86400000, 1 / 24);
    const naDzien = wynik / dni;
    const zostalo = Math.max(0, kwotaCelu - wynik);
    const r = { wynik, kwotaCelu, postep: kwotaCelu > 0 ? wynik / kwotaCelu : 0, zostalo, dni, naDzien, osiagniety: wynik >= kwotaCelu };
    r.postepPierscien = Math.min(1, Math.max(0, r.postep));
    if (!r.osiagniety && naDzien > 0) { r.dniDoCelu = zostalo / naDzien; r.dataCelu = terazMs + r.dniDoCelu * 86400000; }
    if (terminMs && terminMs > terazMs && !r.osiagniety) { r.dniDoTerminu = (terminMs - terazMs) / 86400000; r.potrzebneNaDzien = zostalo / r.dniDoTerminu; }
    return r;
  }

  // ---------- Hyperliquid na żywo ----------
  async function hl(cialo) {
    const r = await fetch(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cialo) });
    if (!r.ok) throw new Error('Hyperliquid ' + r.status);
    return r.json();
  }
  async function pobierzHL() {
    const m = S.m; if (!m || !m.hl || !m.hl.adresy.length || document.hidden) return;
    try {
      const mids = await hl({ type: 'allMids' }), poz = [];
      for (const adres of m.hl.adresy) {
        for (const dex of [''].concat(m.hl.dexy || [])) {
          const st = await hl(dex ? { type: 'clearinghouseState', user: adres, dex } : { type: 'clearinghouseState', user: adres });
          for (const ap of st.assetPositions || []) {
            const p = ap.position, szi = Number(p.szi); if (!szi) continue;
            poz.push({ coin: p.coin, strona: szi > 0 ? 'long' : 'short', ilosc: Math.abs(szi), wejscie: Number(p.entryPx), upnl: Number(p.unrealizedPnl),
              likw: p.liquidationPx ? Number(p.liquidationPx) : null, dzw: p.leverage ? Number(p.leverage.value) : null, typ: p.leverage ? p.leverage.type : null,
              depozyt: Number(p.marginUsed), wartosc: Number(p.positionValue), cena: Number(mids[p.coin]) || Number(p.positionValue) / Math.abs(szi) });
          }
        }
      }
      S.hl = poz; S.hlCzas = Date.now(); S.hlBlad = null;
    } catch (e) { S.hlBlad = e.message; }
    rysuj();
  }
  // czy pozycje HL są te same co w migawce; jeśli tak – zmiana niezrealizowanego wyniku od migawki
  function zmianaHL() {
    const m = S.m;
    if (!S.hl) return { d: 0, stan: S.hlBlad ? 'blad' : 'brak', konto: null };
    const snap = m.pozycje.filter(p => p.platforma === 'hyperliquid');
    const konto = snap.length ? snap[0].kontoId : (m.konta.find(k => /hyperliquid/i.test(k.platforma)) || {}).id;
    const zywe = new Map(S.hl.map(x => [x.coin + '|' + x.strona, x]));
    if (zywe.size !== snap.length) return { d: 0, stan: 'zmiana', konto };
    let d = 0;
    for (const p of snap) {
      const x = zywe.get(p.rynek + '|' + p.strona);
      if (!x || Math.abs(x.ilosc - p.ilosc) > 1e-9 * Math.max(1, p.ilosc)) return { d: 0, stan: 'zmiana', konto };
      d += x.upnl - p.pnl;
    }
    return { d, stan: 'ok', konto };
  }

  // ---------- rysowanie ----------
  function rysuj() {
    document.querySelectorAll('#zakres button').forEach(b => b.classList.toggle('wl', b.dataset.z === S.zakres));
    const m = S.m;
    if (!m) return;
    const z0 = m.zakresy[S.zakres] || m.zakresy.zywe, kurs = m.kursUSDPLN;
    const zm = zmianaHL();
    const d = zm.stan === 'ok' && (!zm.konto || z0.konta.includes(zm.konto)) ? zm.d : 0;
    const plusPln = (v) => (v === null || v === undefined ? v : v + (kurs ? d * kurs : 0));
    const z = Object.assign({}, z0, {
      wynikUSD: z0.wynikUSD + d, wynikPLN: kurs ? plusPln(z0.wynikPLN) : z0.wynikPLN,
      wartoscUSD: z0.wartoscUSD + d, wartoscPLN: kurs ? plusPln(z0.wartoscPLN) : z0.wartoscPLN,
      niezrealizowanyUSD: z0.niezrealizowanyUSD + d
    });
    const wcz = z0.odWczoraj ? { usd: z0.odWczoraj.usd + d, pln: z0.odWczoraj.pln !== null && z0.odWczoraj.pln !== undefined && kurs ? z0.odWczoraj.pln + d * kurs : z0.odWczoraj.pln } : null;
    const cu = m.celUstawienia, c = cel(z0.cel.wynik + (cu.tylkoZrealizowany ? 0 : d), z0.cel.kwotaCelu, Date.parse(cu.od + 'T00:00:00'), Date.now(), cu.termin ? Date.parse(cu.termin + 'T23:59:59') : null);
    const R = 48, obw = 2 * Math.PI * R;

    // stan u góry
    const wiek = Date.now() - m.czas, kolor = wiek < 15 * 60000 ? 'zywe' : wiek < 24 * 3600000 ? 'uwaga' : 'blad';
    $('stan').innerHTML = `<span class="k"><span class="kropka ${kolor}"></span>migawka z komputera ${godz(m.czas)} (${temu(m.czas)})${S.zKopii ? ', bez internetu' : ''}${TEST ? ' – DANE ZMYŚLONE' : ''}</span>`
      + (m.hl && m.hl.adresy.length ? `<span class="k"><span class="kropka ${S.hlBlad ? 'blad' : S.hl ? 'zywe' : ''}"></span>${S.hlBlad ? 'Hyperliquid: brak połączenia' : S.hl ? 'Hyperliquid na żywo' : 'łączę z Hyperliquid…'}</span>` : '');

    let h = '';
    if (m.pilne && m.pilne.length) h += `<div class="ramka blad"><b>Uwaga – dane mogą być niepełne:</b><ul>${m.pilne.map(t => `<li>${E(t)}</li>`).join('')}</ul></div>`;
    if (zm.stan === 'zmiana') h += `<div class="ramka uwaga">Pozycje na Hyperliquid zmieniły się od migawki. Suma poniżej jest z migawki, a nowe pozycje widać na żywo niżej. Pełny wynik policzy panel na komputerze.</div>`;
    if (wiek > 24 * 3600000) h += `<div class="ramka uwaga">Migawka ma ${temu(m.czas).replace(' temu', '')}. Kraken, XTB i portfele odświeżą się, gdy panel będzie otwarty na komputerze.</div>`;

    h += `<section class="karta">
      <div class="et">Wynik – ${S.zakres === 'zywe' ? 'konta na żywo' : 'wszystkie konta'}${d ? ' · z Hyperliquid na żywo' : ''}</div>
      <div class="liczba ${kl(z.wynikUSD)}">${usd(z.wynikUSD, true)}</div>
      <div class="liczba-pln">${zl(z.wynikPLN, true)}</div>
      <div class="wiersze">
        <div><span class="et">Wpłaciłeś netto</span><b>${usd(z.wplaconeNettoUSD)}</b></div>
        <div><span class="et">Masz teraz</span><b>${usd(z.wartoscUSD)}</b></div>
        <div><span class="et">Od wczoraj</span><b class="${wcz ? kl(wcz.usd) : ''}">${wcz ? usd(wcz.usd, true) : 'od jutra'}</b></div>
        <div><span class="et">Otwarte / zrealizowane</span><b><span class="${kl(z.niezrealizowanyUSD)}">${usd(z.niezrealizowanyUSD, true)}</span> / <span class="${kl(z.zrealizowanyUSD)}">${usd(z.zrealizowanyUSD, true)}</span></b></div>
      </div>
      <div class="kontrola">${z0.spina ? '✔ Kontrola w panelu: suma wyników kont = wartość − wpłaty netto.' : '<b class="minus">Panel zgłasza, że wynik się nie spina – nie polegaj na tej liczbie.</b>'}</div>
      <div class="cel">
        <div class="pierscien" role="img" aria-label="Postęp celu ${proc(c.postep, 1)}">
          <svg viewBox="0 0 112 112"><circle cx="56" cy="56" r="${R}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="10"/>
            <circle cx="56" cy="56" r="${R}" fill="none" stroke-width="10" stroke-linecap="round" stroke="${c.wynik < 0 ? 'var(--s-minus)' : 'var(--s-plus)'}" stroke-dasharray="${(c.postepPierscien * obw).toFixed(2)} ${obw.toFixed(2)}"/></svg>
          <div class="srodek"><div class="proc">${proc(c.postep, Math.abs(c.postep) < 0.1 ? 1 : 0)}</div><div class="pod">celu ${usd(c.kwotaCelu, false, 0)}</div></div>
        </div>
        <div class="male" style="margin:0">${c.osiagniety ? '<b>Cel osiągnięty!</b>' : `Brakuje <b>${usd(c.zostalo)}</b>`}<br>tempo ${usd(c.naDzien, true)}/dzień${c.dataCelu && c.dniDoCelu <= 3650 ? '<br>cel ok. ' + new Date(c.dataCelu).toLocaleDateString('pl-PL') : c.naDzien <= 0 ? '<br>przy tym tempie celu nie widać' : ''}</div>
      </div>
    </section>`;

    // pozycje: Hyperliquid na żywo (jeśli jest połączenie) + pozostałe z migawki
    const snapHL = m.pozycje.filter(p => p.platforma === 'hyperliquid'), inne = m.pozycje.filter(p => p.platforma !== 'hyperliquid');
    const lista = (S.hl ? S.hl.map(x => ({ x, p: snapHL.find(p => p.rynek === x.coin && p.strona === x.strona) || null })) : snapHL.map(p => ({ x: null, p }))).concat(inne.map(p => ({ x: null, p })));
    h += `<section class="karta"><h2>Otwarte pozycje <small>${lista.length}</small></h2>${lista.length ? lista.map(kartaPozycji).join('') : '<p class="male">Brak otwartych pozycji z dźwignią.</p>'}</section>`;

    // konta
    const konta = m.konta.filter(k => S.zakres === 'wszystko' || k.naZywo);
    h += `<section class="karta"><h2>Konta <small>wynik · wartość</small></h2>${konta.map(k => {
      const dk = k.id === zm.konto ? d : 0, w = k.wynikUSD === null ? null : k.wynikUSD + dk;
      const liczone = z0.konta.includes(k.id);
      return `<div class="konto${liczone ? '' : ' poza'}"><div class="nazwa"><span class="kropka ${k.naZywo ? 'zywe' : ''}"></span><span>${E(k.nazwa)}</span></div>
        <div class="w"><b class="${kl(w)}">${w === null ? '—' : usd(w, true)}</b></div>
        <div class="pod">${k.wartoscUSD === null || k.wartoscUSD === undefined ? 'brak wyceny' : 'wartość ' + usd(k.wartoscUSD + dk)}${k.naZywo ? '' : ' · z eksportu'}${liczone ? '' : ' · poza sumą'}${dk ? ' · Hyperliquid na żywo' : ''}</div></div>`;
    }).join('')}</section>`;

    // PIT-38
    const P = S.pit;
    h += `<section class="karta"><h2>PIT-38 ${P ? 'za ' + P.rok : ''} <small>${P ? 'z kalkulatora, ' + godz(P.czas) : ''}</small></h2>${P ? `
      <div class="et">Podatek do zapłaty (z tego kalkulatora)</div>
      <div class="pit-kwota">${zl(P.doZaplaty)}</div>
      <div class="wiersze">
        <div><span class="et">Kryptowaluty – ${P.krypto.dochod > 0 ? 'dochód' : 'nadwyżka kosztów'}</span><b>${zl(P.krypto.dochod > 0 ? P.krypto.dochod : P.krypto.nadwyzka)}</b><span class="b-male">podatek ${zl(P.krypto.podatek)}</span></div>
        <div><span class="et">Perpy i inne – ${P.perpyIInne.strata > 0 ? 'strata' : 'dochód'}</span><b>${zl(P.perpyIInne.strata > 0 ? P.perpyIInne.strata : P.perpyIInne.dochod)}</b><span class="b-male">podatek ${zl(P.perpyIInne.podatek)}</span></div>
      </div><p class="b-male" style="margin-top:10px">Pełne rozliczenie i formularz są w kalkulatorze na komputerze.</p>`
      : '<p class="male">Podgląd pojawi się, gdy otworzysz kalkulator PIT-38 na komputerze (np. w Centrum).</p>'}</section>`;

    h += `<div class="stopka">${S.uzytkownik ? `<p class="b-male">Zalogowano: ${E(S.uzytkownik.email || '')}</p><button class="drugi" id="wyloguj">Wyloguj</button>` : TEST ? '<p class="b-male">Podgląd na zmyślonych danych.</p>' : ''}</div>`;
    $('tresc').innerHTML = h;
    // w aplikacji wylogowuje całą aplikację (powłoka zamyka karty i czyści kopię migawek)
    const w = $('wyloguj'); if (w) w.onclick = async () => {
      w.disabled = true;
      if (window.parent !== window) { window.parent.postMessage({ centrum: 'wyloguj' }, location.origin); return; }
      await window.CHMURA.wyloguj(); location.reload();
    };
  }

  function kartaPozycji({ x, p }) {
    const rynek = x ? x.coin : p.rynek, strona = x ? x.strona : p.strona, dzw = x ? x.dzw : p.dzwignia;
    const upnl = x ? x.upnl : p.pnl, cenaT = x ? x.cena : p.cena, wej = x ? x.wejscie : p.wejscie, il = x ? x.ilosc : p.ilosc, wart = x ? x.wartosc : p.wartosc;
    const lik = x ? x.likw : p.likwidacja, odl = lik && cenaT ? Math.abs(cenaT - lik) / cenaT : null;
    const netto = p && p.zamkniecieTeraz ? p.zamkniecieTeraz.netto + (x ? x.upnl - p.pnl : 0) : null;
    const st = odl === null ? '' : odl < 0.03 ? 'critical' : odl < 0.06 ? 'warning' : '';
    return `<div class="pozycja">
      <div class="gora"><span class="rynek">${E(rynek)}</span><span class="etykieta ${strona}">${strona.toUpperCase()}</span>${dzw ? `<span class="etykieta">${nf(0).format(dzw)}×</span>` : ''}<span class="b-male">${x ? 'na żywo' : 'z migawki ' + godz(S.m.czas)}</span></div>
      <div class="pnl ${kl(upnl)}">${usd(upnl, true)}</div>
      <div class="b-male">${netto !== null ? `gdybyś zamknął teraz, po opłatach ≈ <b class="${kl(netto)}">${usd(netto, true)}</b>` : 'wynik na giełdzie, bez opłat zamknięcia'}</div>
      <div class="siatka">
        <div><div class="et">Cena</div><div class="w">${cena(cenaT)}</div></div>
        <div><div class="et">Wejście</div><div class="w">${cena(wej)}</div></div>
        <div><div class="et">Wielkość</div><div class="w">${nf(4).format(il)} · ${usd(wart, false, 0)}</div></div>
        <div><div class="et">Wyjście na zero</div><div class="w">${p && p.wyjscieNaZero ? cena(p.wyjscieNaZero) : '—'}</div></div>
      </div>
      ${lik ? `<div class="miernik"><i class="${st}" style="width:${Math.min(100, (odl || 0) / 0.1 * 100).toFixed(1)}%"></i></div>
        <div class="opis-lik"><span>Likwidacja <b>${cena(lik)}</b></span><span class="${st ? 'pogrub' : ''}">${st === 'critical' ? 'PILNE: ' : st === 'warning' ? 'UWAGA: ' : ''}${proc(odl, 2)} od ceny</span></div>` : '<p class="b-male" style="margin-top:8px">Likwidacja: brak danych albo pozycja w pełni zabezpieczona.</p>'}
    </div>`;
  }

  // ---------- stany: brak połączenia, logowanie, dane ----------
  function niepolaczony() {
    $('stan').textContent = '';
    $('tresc').innerHTML = `<section class="karta"><h2>Panel z komputera</h2>
      <p class="male">Panel na telefonie pokazuje migawkę wyników z panelu na komputerze: wynik ze wszystkich kont, cel 5000 USD, konta i PIT-38. Pozycje z Hyperliquid liczy na żywo sam.</p>
      <p class="male">Połączenie jeszcze nie jest skonfigurowane: zakładamy prywatny projekt Firebase, a potem logujesz się tutaj i na komputerze tym samym kontem.</p>
      <p class="b-male"><a href="?test">Zobacz podgląd na zmyślonych danych</a></p></section>`;
  }
  function logowanie(blad) {
    $('stan').textContent = '';
    $('tresc').innerHTML = `<section class="karta"><h2>Zaloguj się</h2>
      <p class="male">To samo konto, którym na komputerze połączyłeś panel (strona telefon.html).</p>
      <form class="formularz" id="logowanie">
        <label>E-mail<input type="email" id="email" autocomplete="username" required></label>
        <label>Hasło<input type="password" id="haslo" autocomplete="current-password" required></label>
        <button class="glowny" type="submit">Zaloguj</button>
      </form>${blad ? `<p class="male minus" style="margin-top:10px">${E(blad)}</p>` : ''}</section>`;
    $('logowanie').addEventListener('submit', async (e) => {
      e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true;
      try { await window.CHMURA.zaloguj($('email').value.trim(), $('haslo').value); start(); }
      catch (x) { logowanie(/wrong-password|invalid-credential|user-not-found/.test(x.code || '') ? 'Zły e-mail albo hasło.' : 'Nie udało się zalogować: ' + (x.code || x.message)); }
    });
  }

  async function start() {
    if (TEST) { S.m = window.MIGAWKA_TESTOWA; S.pit = window.PIT_TESTOWY; rysuj(); return; }
    if (!window.CHMURA.skonfigurowana()) { niepolaczony(); return; }
    try { S.uzytkownik = await window.CHMURA.uzytkownik(); } catch (e) { logowanie('Nie mogę połączyć się z kontem: ' + e.message); return; }
    if (!S.uzytkownik) { logowanie(); return; }
    $('tresc').innerHTML = '<p class="male">Czekam na migawkę z komputera…</p>';
    window.CHMURA.sluchaj('migawka', (d, zKopii) => {
      if (!d) { $('tresc').innerHTML = '<section class="karta"><h2>Brak migawki</h2><p class="male">Otwórz panel na komputerze (np. w Centrum inwestora) – pierwsza migawka przyjdzie w ciągu minuty.</p></section>'; return; }
      const nowa = !S.m || S.m.czas !== d.czas; S.m = d; S.zKopii = zKopii;
      if (nowa) S.hl = null;   // pozycje porównujemy z nową migawką
      rysuj(); pobierzHL();
    }, (e) => { $('tresc').innerHTML = `<div class="ramka blad">Nie mogę odczytać migawki: ${E(e.code || e.message)}</div>`; });
    window.CHMURA.sluchaj('pit', (d) => { S.pit = d; rysuj(); });
  }

  document.getElementById('zakres').addEventListener('click', (e) => { const b = e.target.closest('[data-z]'); if (!b) return; S.zakres = b.dataset.z; pam.pisz('panel-zakres', S.zakres); rysuj(); });
  setInterval(pobierzHL, 10000);
  setInterval(() => { if (!document.hidden) rysuj(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pobierzHL(); });
  // podgląd z prawdziwą migawką tylko na tym komputerze (localhost) – do sprawdzania przed publikacją
  if (!TEST && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    const lok = pam.czytaj('migawka-lokalna', null);
    if (lok) { S.m = lok; S.pit = pam.czytaj('pit-lokalny', null); rysuj(); pobierzHL(); return; }
  }
  start();
})();
