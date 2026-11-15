// Logowanie do aplikacji i odczyt migawek z komputera: prywatny Firebase, konto e-mail/hasło właściciela
// (to samo co na komputerze w telefon.html). Bez zalogowania aplikacja pokazuje tylko ekran logowania.
// Firestore (z kopią w telefonie – ostatnia migawka widoczna także bez internetu) uruchamia się dopiero w Panelu;
// powłoka aplikacji używa tylko logowania.
(function () {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  let p = null, baza = null;
  function polacz() {
    if (!window.INWESTOR_FIREBASE) return Promise.resolve(null);
    if (!p) p = (async () => {
      const [app, auth] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js')]);
      const a = app.initializeApp(window.INWESTOR_FIREBASE);
      const au = auth.initializeAuth(a, { persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence] });
      return { a, au, auth };
    })();
    return p;
  }
  // kopia offline w trybie wielu kart: Panel (ramka) i Dziennik (przez powłokę) mogą jej używać jednocześnie
  async function firestore() {
    const f = await polacz();
    const fs = await import(SDK + 'firebase-firestore.js');
    if (!baza) baza = fs.initializeFirestore(f.a, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    return { f, fs, db: baza };
  }
  async function dokument(nazwa) {
    const f = await polacz(); if (!f) throw new Error('aplikacja nie jest połączona z kontem');
    await f.au.authStateReady();
    const u = f.au.currentUser; if (!u) throw new Error('zaloguj się w aplikacji');
    const { fs, db } = await firestore();
    return { fs, ref: fs.doc(db, 'uzytkownicy', u.uid, 'inwestor', nazwa) };
  }
  window.CHMURA = {
    skonfigurowana: () => !!window.INWESTOR_FIREBASE,
    async uzytkownik() { const f = await polacz(); if (!f) return null; await f.au.authStateReady(); return f.au.currentUser; },
    async zaloguj(email, haslo) { const f = await polacz(); return (await f.auth.signInWithEmailAndPassword(f.au, email, haslo)).user; },
    // zmiana zalogowania (np. wygaśnięcie sesji); zwraca funkcję wyłączającą nasłuch
    async naZmiane(cb) { const f = await polacz(); if (!f) return () => {}; return f.auth.onAuthStateChanged(f.au, cb); },
    // samo wylogowanie; kopię migawek (bazy firestore/*) usuwa powłoka przy następnym starcie strony,
    // bo otwarta baza nie da się usunąć, dopóki strona z Panelem żyje
    async wyloguj() { const f = await polacz(); if (f) await f.auth.signOut(f.au); },
    // jednorazowy odczyt dokumentu (z serwera, bez internetu – z kopii w telefonie); null = brak dokumentu
    async pobierz(nazwa) {
      const { fs, ref } = await dokument(nazwa);
      let s; try { s = await fs.getDocFromServer(ref); } catch (e) { s = await fs.getDocFromCache(ref).catch(() => null); }
      return s && s.exists() ? s.data() : null;
    },
    // zapis dokumentu (Firestore nie przyjmuje undefined – czyścimy przez JSON)
    async zapisz(nazwa, dane) { const { fs, ref } = await dokument(nazwa); await fs.setDoc(ref, JSON.parse(JSON.stringify(dane))); },
    // nasłuch dokumentu uzytkownicy/{uid}/inwestor/{nazwa}; zwraca funkcję wyłączającą nasłuch
    async sluchaj(nazwa, naDane, naBlad) {
      const f = await polacz(); if (!f) return () => {};
      await f.au.authStateReady();
      const u = f.au.currentUser; if (!u) return () => {};
      const { fs, db } = await firestore();
      return fs.onSnapshot(fs.doc(db, 'uzytkownicy', u.uid, 'inwestor', nazwa),
        (s) => naDane(s.exists() ? s.data() : null, s.metadata.fromCache), naBlad);
    }
  };
})();
