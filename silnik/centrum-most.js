/* Most do Centrum inwestora (Centrum-Inwestora/index.html).
 * Gdy strona jest pokazana w Centrum (w ramce), linki z atrybutem data-centrum="<karta>" przełączają kartę Centrum
 * zamiast otwierać stronę w ramce, a powiadomienia na pulpit idą przez Centrum: przeglądarka nie pozwala ramce
 * z innego portu prosić o zgodę na powiadomienia. Otwarta osobno strona działa dokładnie jak wcześniej. */
(function () {
  'use strict';
  let osadzony = false;
  try { osadzony = window.self !== window.top; } catch (e) { osadzony = true; }
  // adres Centrum: z listy przodków (Chrome) albo z adresu strony, która otworzyła ramkę
  let rodzic = '*';
  try {
    if (location.ancestorOrigins && location.ancestorOrigins.length) rodzic = location.ancestorOrigins[0];
    else if (document.referrer) rodzic = new URL(document.referrer).origin;
  } catch (e) { /* zostaje '*' */ }
  const wyslij = d => { if (osadzony) window.parent.postMessage(d, rodzic); };
  const czekajacy = [];

  if (osadzony) {
    document.documentElement.setAttribute('data-w-centrum', '');
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('[data-centrum]');
      if (!a) return;
      e.preventDefault();
      wyslij({ centrum: 'przejdz', karta: a.getAttribute('data-centrum') });
    });
    window.addEventListener('message', e => {
      if (e.source !== window.parent || (rodzic !== '*' && e.origin !== rodzic)) return;
      const d = e.data;
      if (d && d.centrum === 'zgoda') czekajacy.splice(0).forEach(f => f(d.stan));
    });
  }

  window.CENTRUM = {
    osadzony,
    // zgoda na powiadomienia pytana przez Centrum; wynik: 'granted' / 'denied' / 'default' / 'brak-odpowiedzi'
    prosOZgode() {
      return new Promise(ok => {
        if (!osadzony) { ok(null); return; }
        czekajacy.push(ok);
        wyslij({ centrum: 'zgoda-powiadomien' });
        setTimeout(() => { const i = czekajacy.indexOf(ok); if (i >= 0) { czekajacy.splice(i, 1); ok('brak-odpowiedzi'); } }, 30000);
      });
    },
    powiadom(tytul, tekst) { wyslij({ centrum: 'powiadom', tytul: String(tytul), tekst: String(tekst) }); }
  };
})();
