// Odczyt migawek z komputera: prywatny Firebase, konto e-mail/hasło właściciela (to samo co na komputerze w telefon.html).
// Firestore z kopią w telefonie – ostatnia migawka jest widoczna także bez internetu.
(function () {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  let p = null;
  function polacz() {
    if (!window.INWESTOR_FIREBASE) return Promise.resolve(null);
    if (!p) p = (async () => {
      const [app, auth, fs] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
      const a = app.initializeApp(window.INWESTOR_FIREBASE);
      const au = auth.initializeAuth(a, { persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence] });
      const db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache() });
      return { au, db, auth, fs };
    })();
    return p;
  }
  window.CHMURA = {
    skonfigurowana: () => !!window.INWESTOR_FIREBASE,
    async uzytkownik() { const f = await polacz(); if (!f) return null; await f.au.authStateReady(); return f.au.currentUser; },
    async zaloguj(email, haslo) { const f = await polacz(); return (await f.auth.signInWithEmailAndPassword(f.au, email, haslo)).user; },
    // wylogowanie usuwa też kopię migawek z pamięci telefonu (potem strona wczytuje się od nowa)
    async wyloguj() { const f = await polacz(); if (f) { await f.auth.signOut(f.au); try { await f.fs.terminate(f.db); await f.fs.clearIndexedDbPersistence(f.db); } catch (e) { /* kopia zniknie przy następnym wylogowaniu */ } } },
    // nasłuch dokumentu uzytkownicy/{uid}/inwestor/{nazwa}; zwraca funkcję wyłączającą nasłuch
    async sluchaj(nazwa, naDane, naBlad) {
      const f = await polacz(); if (!f) return () => {};
      await f.au.authStateReady();
      const u = f.au.currentUser; if (!u) return () => {};
      return f.fs.onSnapshot(f.fs.doc(f.db, 'uzytkownicy', u.uid, 'inwestor', nazwa),
        (s) => naDane(s.exists() ? s.data() : null, s.metadata.fromCache), naBlad);
    }
  };
})();
