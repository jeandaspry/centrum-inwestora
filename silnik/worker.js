/* Wątek roboczy: liczy pojedyncze permutacje bramki 2 (optymalizacja w próbie),
 * bramki 4 (cały walk-forward na danych przetasowanych po pierwszym oknie treningu)
 * i walidacji asystenta ('as': walk-forward statystyki układów na danych przetasowanych). */
importScripts('lab.js', 'asystent-silnik.js');
let s = null;
onmessage = function (e) {
  const m = e.data;
  if (m.typ === 'init') {
    s = { n: m.n, t: new Float64Array(m.n), lo: m.lo, lh: m.lh, ll: m.ll, lc: m.lc, F: m.F || null };
    return;
  }
  const st = LAB.STRATEGIE[m.strategia];
  for (const ziarno of m.ziarna) {
    let wynik;
    if (m.typ === 'g2') {
      const p = LAB.permutuj(LAB.wytnij(s, m.b), m.a, ziarno);
      wynik = LAB.optymalizuj(p, st, m.a, m.b, m.koszt, false).pf;
    } else if (m.typ === 'as') {
      const p = LAB.permutuj(s, m.start, ziarno);
      const wf = LAB.AS.policz(p, m.ms, m.opcje, m.start).wf;
      wynik = wf.sumaR; postMessage({ ziarno, wynik, transakcji: wf.transakcje.length }); continue;
    } else {
      const p = LAB.permutuj(s, m.b, ziarno);
      wynik = LAB.walkForward(p, st, m.b, m.trening, m.krok, m.koszt).pf;
    }
    postMessage({ ziarno, wynik });
  }
  postMessage({ koniec: true });
};
