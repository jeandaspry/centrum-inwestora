// Strony w kartach (Panel, Asystent, Laboratorium) działają tylko wewnątrz aplikacji, za ekranem logowania.
// Otwarte wprost z adresu przechodzą na stronę startową, czyli do logowania. Wyjątek: podgląd ?test na tym komputerze.
(function () {
  'use strict';
  const podglad = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]test\b/.test(location.search);
  let wAplikacji = false;
  try { wAplikacji = window.parent !== window && window.parent.location.origin === location.origin && window.parent.INWESTOR_POWLOKA === true; } catch (e) { wAplikacji = false; }
  if (!wAplikacji && !podglad) {
    document.documentElement.style.display = 'none';
    // najpierw zatrzymaj wczytywanie (żaden dalszy skrypt strony się nie uruchomi), potem przejdź – odwrotnie stop() anulowałby przejście
    try { window.stop(); } catch (e) { /* reszta strony i tak się nie pokaże */ }
    location.replace(new URL(location.pathname.includes('/silnik/') ? '../' : './', location.href).href);
  }
})();
