// ZMYŚLONE dane do podglądu panelu bez połączenia (panel.html?test). Nie są to dane żadnej prawdziwej osoby.
window.MIGAWKA_TESTOWA = {
  wersja: 1, czas: Date.now() - 4 * 60000, zrodlo: 'panel', kursUSDPLN: 3.65,
  zakresy: {
    zywe: { nazwa: 'na żywo', konta: ['hl', 'sol', 'kr'], wynikUSD: 412.5, wynikPLN: 1490.2, wplaconeNettoUSD: 2000, wplaconeNettoPLN: 7400, wartoscUSD: 2412.5, wartoscPLN: 8805.6,
      niezrealizowanyUSD: 37.25, niezrealizowanyPLN: 136, zrealizowanyUSD: 375.25, zrealizowanyPLN: 1354.2, spina: true, kontrolaUSD: 0, brakujaceKonta: [],
      odWczoraj: { usd: 22.4, pln: 81.8 }, cel: { wynik: 412.5, kwotaCelu: 5000, postep: 0.0825, zostalo: 4587.5, naDzien: 5.1, osiagniety: false } },
    wszystko: { nazwa: 'wszystkie konta', konta: ['hl', 'sol', 'kr', 'xtb'], wynikUSD: 380.1, wynikPLN: 1371.9, wplaconeNettoUSD: 2600, wplaconeNettoPLN: 9600, wartoscUSD: 2980.1, wartoscPLN: 10877.4,
      niezrealizowanyUSD: 30.1, niezrealizowanyPLN: 110, zrealizowanyUSD: 350, zrealizowanyPLN: 1261.9, spina: true, kontrolaUSD: 0, brakujaceKonta: [],
      odWczoraj: { usd: 18.9, pln: 69 }, cel: { wynik: 380.1, kwotaCelu: 5000, postep: 0.07602, zostalo: 4619.9, naDzien: 4.7, osiagniety: false } }
  },
  celUstawienia: { zakres: 'wszystko', tylkoZrealizowany: false, odejmij: 0, kwota: 5000, od: '2026-08-27', termin: null },
  konta: [
    { id: 'hl', nazwa: 'Hyperliquid', platforma: 'Hyperliquid', naZywo: true, liczone: true, wartoscUSD: 1250, wynikUSD: 310.2, wynikPLN: 1120.4, niezrealizowanyUSD: 37.25 },
    { id: 'sol', nazwa: 'Phantom (Solana)', platforma: 'Phantom', naZywo: true, liczone: true, wartoscUSD: 162.5, wynikUSD: -12.7, wynikPLN: -46.4, niezrealizowanyUSD: 0 },
    { id: 'kr', nazwa: 'Kraken', platforma: 'Kraken', naZywo: true, liczone: true, wartoscUSD: 1000, wynikUSD: 115, wynikPLN: 416.2, niezrealizowanyUSD: 0 },
    { id: 'xtb', nazwa: 'XTB USD', platforma: 'XTB', naZywo: false, liczone: true, wartoscUSD: 567.6, wynikUSD: -32.4, wynikPLN: -118.3, niezrealizowanyUSD: -7.15 }
  ],
  pozycje: [
    { id: 'hl:BTC', platforma: 'hyperliquid', gielda: 'Hyperliquid', rynek: 'BTC', strona: 'long', dzwignia: 40, typMarginu: 'izolowany', kontoId: 'hl',
      wejscie: 64000, ilosc: 0.05, wartosc: 3218.6, cena: 64372, depozyt: 80, oplatyOtwarcia: 1.44, finansowanie: -0.12, pnl: 18.6,
      zamkniecieTeraz: { netto: 15.6, naKonto: 95.6, roe: 0.19 }, wyjscieNaZero: 64060, likwidacja: 63210, likwidacjaZrodlo: 'api', odlegloscLikwidacji: 0.0181 }
  ],
  hl: { adresy: [], dexy: [] },
  pilne: []
};
window.PIT_TESTOWY = { wersja: 1, czas: Date.now() - 30 * 60000, zrodlo: 'kalkulator', rok: 2026, doZaplaty: 214,
  krypto: { przychod: 5200, koszty: 4300, dochod: 900, nadwyzka: 0, podatek: 171 }, perpyIInne: { przychod: 800, koszty: 574, dochod: 226, strata: 0, podatek: 43 }, dywidendyDoplata: 0 };
// „Platformy” (zmyślone, spójne z kontami powyżej): bank → Kraken → Phantom → Hyperliquid, bank → XTB
(function () {
  const dzien = 86400000, teraz = Date.now(), PLN = 3.65, EUR = 1.08, W3 = (usd) => [usd, usd * PLN, usd / EUR];
  function grupa(klucz, nazwa, kontaIds, wartoscUSD, ops) {
    let n = 0;
    const przeplywy = ops.map(([d, we, usd, skad, ile, konto]) => { n += we ? usd : -usd; return { t: teraz - d * dzien, konto, we, skad, ile, k: W3(usd), n: W3(n), p: [false, false, false], bc: false }; });
    const wpl = ops.filter(o => o[1]).reduce((s, o) => s + o[2], 0), wyp = ops.filter(o => !o[1]).reduce((s, o) => s + o[2], 0), w = {};
    ['USD', 'PLN', 'EUR'].forEach((x, i) => { const f = W3(1)[i], wart = wartoscUSD * f, netto = (wpl - wyp) * f, wynik = wart - netto, doZera = Math.max(0, -wynik);
      w[x] = { wartosc: wart, wplaty: wpl * f, wyplaty: wyp * f, netto, wynik, doZera, procentDoZera: doZera ? doZera / wart : 0, procentWplat: netto > 0 ? wynik / netto : null, kursowa: x === 'USD' ? null : 0 }; });
    const nettoW = (t) => przeplywy.filter(x => x.t <= t).reduce((v, x) => x.n[0], 0);
    const seria = [];
    for (let i = 0; i < 12; i++) { const t = teraz - (23 - i * 2) * dzien, v = nettoW(t) * (1 + 0.05 * Math.sin(i)); seria.push({ t, w: W3(v) }); }
    seria.push({ t: teraz - 4 * 60000, w: W3(wartoscUSD), teraz: true });
    return { klucz, nazwa, wszystkie: klucz === 'wszystkie', kontaIds, naZywo: !kontaIds.includes('xtb'), spina: true, pierwsza: przeplywy[0].t, brakDanych: [],
      eksport: kontaIds.includes('xtb') ? ['XTB USD – eksport sprzed tygodnia'] : [], ileWplat: ops.filter(o => o[1]).length, ileWyplat: ops.filter(o => !o[1]).length, ileWewnatrz: 0,
      w, przeplywy, seria, odDnia: seria[0].t, konta: null };
  }
  const bank = (d, usd, konto) => [d, true, usd, 'z banku', usd + ' USD', konto];
  window.MIGAWKA_TESTOWA.platformy = { wersja: 1, kursy: { USDPLN: PLN, EURUSD: EUR }, grupy: [
    grupa('wszystkie', 'Wszystkie razem', ['hl', 'sol', 'kr', 'xtb'], 2980.1, [bank(30, 1500, 'Kraken'), bank(28, 600, 'XTB USD'), bank(12, 500, 'Kraken')]),
    grupa('p:Hyperliquid', 'Hyperliquid', ['hl'], 1250, [[25, true, 500, 'z: Phantom (Solana)', '500 USDC', 'Hyperliquid'], [10, true, 439.8, 'z: Phantom (Solana)', '439,8 USDC', 'Hyperliquid']]),
    grupa('p:Phantom', 'Phantom', ['sol'], 162.5, [[26, true, 600, 'z: Kraken', '600 USDC', 'Phantom (Solana)'], [25, false, 500, 'na: Hyperliquid', '500 USDC', 'Phantom (Solana)'], [11, true, 515, 'z: Kraken', '515 USDC', 'Phantom (Solana)'], [10, false, 439.8, 'na: Hyperliquid', '439,8 USDC', 'Phantom (Solana)']]),
    grupa('p:Kraken', 'Kraken', ['kr'], 1000, [bank(30, 1500, 'Kraken'), [26, false, 600, 'na: Phantom (Solana)', '600 USDC', 'Kraken'], bank(12, 500, 'Kraken'), [11, false, 515, 'na: Phantom (Solana)', '515 USDC', 'Kraken']]),
    grupa('p:XTB', 'XTB', ['xtb'], 567.6, [bank(28, 600, 'XTB USD')])
  ] };
})();
