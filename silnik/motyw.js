/* Motyw wyglądu: "morski" (domyślny, ciemny) albo "papier" (jasny). Ustawia <html data-motyw="…"> zanim strona się pokaże
 * (skrypt w <head>). Wybór pamięta localStorage („inwestor-motyw”). Synchronizacja:
 *  - ramki i karty tej samej strony (np. aplikacja na telefonie) – zdarzenie storage,
 *  - Centrum na komputerze (inne porty = osobna pamięć) – wiadomość {centrum: 'motyw'} od Centrum; przełącznik w ramce prosi
 *    Centrum o zmianę wszędzie.
 * Po zmianie: zdarzenie 'motyw' na document – strony przerysowują wykresy (kolory biorą ze zmiennych CSS).
 * Przełącznik: dowolny element z atrybutem data-motyw-przelacz albo data-motyw-ustaw="papier|morski". */
(function () {
  'use strict';
  const KLUCZ = 'inwestor-motyw', MOTYWY = ['morski', 'papier'];
  const html = document.documentElement;
  const czytaj = () => { try { return localStorage.getItem(KLUCZ); } catch (e) { return null; } };
  const pisz = (m) => { try { localStorage.setItem(KLUCZ, m); } catch (e) { /* tryb prywatny */ } };
  let czcionki = false;
  // przyciski wyboru motywu (np. „Więcej” w aplikacji na telefon): zaznaczony = klasa wl + aria-pressed
  const zaznacz = (m) => document.querySelectorAll('[data-motyw-ustaw]').forEach(b => { const t = b.getAttribute('data-motyw-ustaw') === m; b.classList.toggle('wl', t); b.setAttribute('aria-pressed', String(t)); });
  function zastosuj(m) {
    m = MOTYWY.includes(m) ? m : 'morski';
    if (m === 'papier' && !czcionki) {
      czcionki = true;
      const l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';
      document.head.appendChild(l);
    }
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', m === 'papier' ? '#f6f3ec' : '#011413');
    if (html.getAttribute('data-motyw') === m) return;
    // zmiana od razu, bez półsekundowych przejść kolorów na przyciskach (papier.css: html.bez-przejsc)
    const zmiana = html.hasAttribute('data-motyw');
    if (zmiana) html.classList.add('bez-przejsc');
    html.setAttribute('data-motyw', m);
    if (zmiana) {
      if (document.body) void getComputedStyle(document.body).color;   // przelicz style teraz, póki przejścia są wyłączone
      setTimeout(() => html.classList.remove('bez-przejsc'), 120);
    }
    zaznacz(m);
    if (document.readyState !== 'loading') document.dispatchEvent(new CustomEvent('motyw', { detail: m }));
  }
  zastosuj(czytaj() || 'morski');

  const wRamce = window.parent !== window;
  window.MOTYW = {
    get: () => html.getAttribute('data-motyw') || 'morski',
    ustaw(m, bezPowiadomienia) {
      pisz(m); zastosuj(m);
      // w Centrum na komputerze: Centrum ustawi motyw sobie i pozostałym kartom (sama nazwa motywu – nic poufnego)
      if (wRamce && !bezPowiadomienia) { try { window.parent.postMessage({ centrum: 'motyw', motyw: m }, '*'); } catch (e) { } }
    },
    przelacz() { this.ustaw(this.get() === 'papier' ? 'morski' : 'papier'); }
  };
  addEventListener('storage', (e) => { if (e.key === KLUCZ && e.newValue) zastosuj(e.newValue); });
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.centrum !== 'motyw' || !wRamce || e.source !== window.parent) return;
    if (!MOTYWY.includes(d.motyw)) return;
    pisz(d.motyw); zastosuj(d.motyw);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-motyw-przelacz], [data-motyw-ustaw]'); if (!b) return;
    e.preventDefault();
    if (b.hasAttribute('data-motyw-ustaw')) MOTYW.ustaw(b.getAttribute('data-motyw-ustaw')); else MOTYW.przelacz();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const m = MOTYW.get();
    zaznacz(m);
  });
})();
