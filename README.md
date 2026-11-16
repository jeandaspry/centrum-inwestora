# Centrum inwestora – aplikacja na telefon

Aplikacja webowa (PWA) na iPhone'a: **Panel**, **Asystent rynku** i **Laboratorium backtestów**.

- Cała aplikacja jest za **logowaniem** (Firebase Authentication, e-mail i hasło, rejestracja wyłączona). Bez zalogowania
  nie wczytuje się żadna karta; strony kart otwarte wprost z adresu przechodzą do logowania (`js/tylko-w-aplikacji.js`).
- Wylogowanie usuwa z telefonu kopię migawek panelu; „Usuń wszystko z tego telefonu” kasuje wszystkie dane aplikacji.

- **Asystent i Laboratorium** działają w telefonie same, bez komputera. Świece i funding pobierają z publicznych API
  Binance i Hyperliquid i trzymają je w pamięci telefonu (IndexedDB). Kod liczący (`silnik/`) jest kopią 1:1 wersji z komputera
  (kopiuje go `narzedzia/zbuduj-telefon.ps1` w folderze Centrum-Inwestora).
- **Panel** pokazuje migawkę wyników wysyłaną przez panel na komputerze do prywatnego Firebase (Firestore), a pozycje
  Hyperliquid liczy na żywo z publicznego API. Dane widzi wyłącznie zalogowany właściciel konta (`firestore.rules`).
  Kafelki **Platformy** (`js/panel-platformy.js`): na każdej platformie wpłaty i wypłaty z datami, wynik i ile trzeba zarobić,
  żeby wyjść na zero – w USD, PLN albo EUR, z wykresem; liczby przychodzą gotowe w migawce z panelu.
- W repozytorium jest tylko kod: bez danych finansowych, adresów, kluczy i haseł. `js/dane-testowe.js` to dane zmyślone.

Instalacja na iPhonie: Safari → Udostępnij → Do ekranu początkowego.
