# Centrum inwestora – aplikacja na telefon

Aplikacja webowa (PWA) na iPhone'a: **Panel**, **Asystent rynku** i **Laboratorium backtestów**.

- **Asystent i Laboratorium** działają w telefonie same, bez komputera. Świece i funding pobierają z publicznych API
  Binance i Hyperliquid i trzymają je w pamięci telefonu (IndexedDB). Kod liczący (`silnik/`) jest kopią 1:1 wersji z komputera
  (kopiuje go `narzedzia/zbuduj-telefon.ps1` w folderze Centrum-Inwestora).
- **Panel** pokazuje migawkę wyników wysyłaną przez panel na komputerze do prywatnego Firebase (Firestore), a pozycje
  Hyperliquid liczy na żywo z publicznego API. Dane widzi wyłącznie zalogowany właściciel konta (`firestore.rules`).
- W repozytorium jest tylko kod: bez danych finansowych, adresów, kluczy i haseł. `js/dane-testowe.js` to dane zmyślone.

Instalacja na iPhonie: Safari → Udostępnij → Do ekranu początkowego.
